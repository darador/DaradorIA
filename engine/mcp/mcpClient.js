/**
 * MCP CLIENT - CLIENTE AUTÓNOMO STATSHUB MCP
 * Implementa el protocolo estándar JSON-RPC 2.0 sobre Stdio para interactuar
 * con 'mcp-remote https://www.statshub.com/mcp'.
 * Integra automáticamente el RateGovernor y el MCPCache.
 */
const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const rateGovernor = require('./rateGovernor');
const cache = require('./cache');
const config = require('../config');

class StatsHubMCPClient {
  constructor() {
    this.process = null;
    this.rl = null;
    this.pendingRequests = new Map();
    this.requestId = 1;
    this.isInitialized = false;
    this.initPromise = null;
    this.mcpBinary = this._resolveMcpBinary();
  }

  _resolveMcpBinary() {
    // 1. Buscar binario ya descargado en cache de npx (para evitar descargas o chequeos de red a npm)
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\ruben\\AppData\\Local';
    const npxDir = path.join(localAppData, 'npm-cache', '_npx');
    if (fs.existsSync(npxDir)) {
      try {
        const hashes = fs.readdirSync(npxDir);
        for (const h of hashes) {
          const binPath = path.join(npxDir, h, 'node_modules', '.bin', process.platform === 'win32' ? 'mcp-remote.cmd' : 'mcp-remote');
          if (fs.existsSync(binPath)) {
            return binPath;
          }
        }
      } catch (e) {}
    }

    // 2. Fallback a npx con prefer-offline
    return process.platform === 'win32' ? 'npx.cmd' : 'npx';
  }

  /**
   * Inicializa la conexión con el proceso MCP Stdio si no está activo
   */
  async ensureConnection() {
    if (this.isInitialized && this.process && !this.process.killed) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      try {
        const isWin = process.platform === 'win32';
        let spawnCmd = this.mcpBinary;
        let spawnArgs = [config.mcp.serverUrl];

        if (isWin && (spawnCmd.endsWith('.cmd') || spawnCmd.endsWith('.bat') || spawnCmd.endsWith('npx'))) {
          spawnArgs = ['/c', spawnCmd, config.mcp.serverUrl];
          spawnCmd = process.env.ComSpec || 'cmd.exe';
        }

        this.process = spawn(spawnCmd, spawnArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: process.env,
          windowsHide: true
        });

        this.rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity
        });

        this.rl.on('line', (line) => {
          this._handleMessage(line);
        });

        this.process.stderr.on('data', (data) => {
          const msg = data.toString();
          if (msg.includes('error') || msg.includes('Error')) {
            console.warn('[MCP-stderr]:', msg.trim());
          }
        });

        this.process.on('close', (code) => {
          this.isInitialized = false;
          this.process = null;
          this.initPromise = null;
        });

        this.process.on('error', (err) => {
          this.isInitialized = false;
          this.initPromise = null;
          reject(err);
        });

        // Handshake inicial MCP (initialize)
        const initReq = {
          jsonrpc: '2.0',
          id: this.requestId++,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'DaradorIA-Engine', version: '1.0.0' }
          }
        };

        const timer = setTimeout(() => {
          this.isInitialized = true;
          resolve();
        }, 3000);

        this.pendingRequests.set(initReq.id, {
          resolve: () => {
            clearTimeout(timer);
            this._sendNotification('notifications/initialized');
            this.isInitialized = true;
            resolve();
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        });

        this._sendRaw(initReq);
      } catch (err) {
        this.initPromise = null;
        reject(err);
      }
    });

    return this.initPromise;
  }

  _sendRaw(obj) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('[MCP] Stdin no está disponible para escritura');
    }
    const jsonStr = JSON.stringify(obj);
    this.process.stdin.write(jsonStr + '\n');
  }

  _sendNotification(method, params = {}) {
    this._sendRaw({
      jsonrpc: '2.0',
      method,
      params
    });
  }

  _handleMessage(line) {
    if (!line || !line.trim()) return;
    try {
      const msg = JSON.parse(line.trim());
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const handler = this.pendingRequests.get(msg.id);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          handler.resolve(msg.result);
        }
      }
    } catch (e) {
      // Línea no JSON
    }
  }

  /**
   * Invoca una herramienta MCP con caché automático y control de cuotas
   */
  async callTool(toolName, args = {}, options = {}) {
    const { bypassCache = false, entityId = null, timeoutMs = 15000 } = options;

    // 1. Revisar Caché
    if (!bypassCache) {
      const cached = cache.get(toolName, args);
      if (cached !== null) {
        return { data: cached, source: 'cache' };
      }
    }

    // 2. Adquirir permiso del Rate Governor
    await rateGovernor.acquire(entityId);

    try {
      // 3. Asegurar conexión MCP activa
      await this.ensureConnection();

      // 4. Enviar llamada RPC tools/call
      const id = this.requestId++;
      const payload = {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      };

      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`[MCP] Timeout tras ${timeoutMs}ms llamando a ${toolName}`));
        }, timeoutMs);

        this.pendingRequests.set(id, {
          resolve: (res) => {
            clearTimeout(timer);
            resolve(res);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        });

        this._sendRaw(payload);
      });

      // Procesar resultado de MCP tools/call
      let parsedData = result;
      if (result && Array.isArray(result.content) && result.content[0]?.text) {
        try {
          parsedData = JSON.parse(result.content[0].text);
        } catch (e) {
          parsedData = result.content[0].text;
        }
      }

      // 5. Guardar en Caché
      cache.set(toolName, args, parsedData);

      return { data: parsedData, source: 'live' };
    } catch (err) {
      console.warn(`[MCP] Fallo en ${toolName}: ${err.message}`);
      return { data: null, source: 'error', error: err.message };
    } finally {
      // 6. Liberar semáforo
      rateGovernor.release();
    }
  }

  /**
   * Cierra ordenadamente la conexión
   */
  close() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
      this.isInitialized = false;
    }
  }
}

module.exports = new StatsHubMCPClient();
