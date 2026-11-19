/**
 * MCP CACHE - GESTIÓN DE CACHÉ PERSISTENTE CON TTL POR HERRAMIENTA
 * Evita quemar llamadas al MCP de StatsHub almacenando respuestas
 * con políticas de expiración según la volatilidad del dato.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

class MCPCache {
  constructor() {
    this.cacheDir = config.paths.cacheDir;
    this.memoryCache = new Map();
    this.hits = 0;
    this.misses = 0;

    this._ensureDir();
    this._cleanExpiredFiles();
  }

  _ensureDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  _generateKey(toolName, args = {}) {
    // Normalizar argumentos para consistencia de claves
    const sortedArgs = Object.keys(args)
      .sort()
      .reduce((acc, key) => {
        acc[key] = args[key];
        return acc;
      }, {});
    const raw = `${toolName}:${JSON.stringify(sortedArgs)}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  _resolveTTL(toolName) {
    if (toolName === 'getFixturesByDate') return config.mcp.cacheTTL.fixtures;
    if (['getPropScreener', 'getTeamPropScreener', 'getOutliers'].includes(toolName)) return config.mcp.cacheTTL.screeners;
    if (['getPlayerTrends', 'getTeamTrends'].includes(toolName)) return config.mcp.cacheTTL.trends;
    if (['getPlayerStats', 'getPlayerStatsWithOdds', 'getPlayer'].includes(toolName)) return config.mcp.cacheTTL.playerStats;
    if (['getTeamStatistics', 'getTeamPerformance', 'getLeagueTable', 'getTeam'].includes(toolName)) return config.mcp.cacheTTL.teamStats;
    if (['getReferee', 'getRefereesList'].includes(toolName)) return config.mcp.cacheTTL.referee;
    return config.mcp.cacheTTL.default;
  }

  get(toolName, args) {
    const key = this._generateKey(toolName, args);
    const now = Date.now();

    // 1. Verificar memoria
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key);
      if (entry.expiresAt > now) {
        this.hits++;
        return entry.data;
      }
      this.memoryCache.delete(key);
    }

    // 2. Verificar disco
    const filePath = path.join(this.cacheDir, `${key}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const entry = JSON.parse(fileContent);
        if (entry.expiresAt > now) {
          this.memoryCache.set(key, entry);
          this.hits++;
          return entry.data;
        }
        fs.unlinkSync(filePath);
      } catch (e) {
        // Archivo corrupto o expirado
      }
    }

    this.misses++;
    return null;
  }

  set(toolName, args, data, customTTL = null) {
    if (!data) return;
    const key = this._generateKey(toolName, args);
    const ttl = customTTL || this._resolveTTL(toolName);
    const expiresAt = Date.now() + ttl;

    const entry = {
      toolName,
      args,
      cachedAt: new Date().toISOString(),
      expiresAt,
      data
    };

    // Guardar en memoria
    this.memoryCache.set(key, entry);

    // Guardar en disco
    const filePath = path.join(this.cacheDir, `${key}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    } catch (e) {
      console.warn(`[Cache] Fallo al escribir archivo de caché (${key}):`, e.message);
    }
  }

  _cleanExpiredFiles() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const now = Date.now();
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const p = path.join(this.cacheDir, file);
        try {
          const entry = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (entry.expiresAt <= now) {
            fs.unlinkSync(p);
          }
        } catch (e) {
          fs.unlinkSync(p);
        }
      }
    } catch (e) {
      // Ignorar
    }
  }

  getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses) * 100).toFixed(1) + '%' : '0%',
      inMemoryEntries: this.memoryCache.size
    };
  }
}

module.exports = new MCPCache();
