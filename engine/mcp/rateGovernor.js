/**
 * MCP RATE GOVERNOR - CONTROLADOR CENTRAL DE CUOTAS Y CONCURRENCIA
 * Garantiza el cumplimiento de las restricciones de StatsHub:
 * - Máx 20 llamadas/minuto (límite 30)
 * - Máx 280 llamadas/día (límite 300)
 * - Máx 2 concurrentes (límite 4)
 * - Persistencia del contador diario en disco
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

class RateGovernor {
  constructor() {
    this.limits = config.mcp.rateLimits;
    this.usageFile = path.join(config.paths.storageDir, 'mcp_daily_usage.json');
    this.recentTimestamps = [];
    this.activeRequests = 0;
    this.requestQueue = [];
    this.isProcessingQueue = false;

    this._ensureStorage();
    this._loadDailyUsage();
  }

  _ensureStorage() {
    if (!fs.existsSync(config.paths.storageDir)) {
      fs.mkdirSync(config.paths.storageDir, { recursive: true });
    }
  }

  _loadDailyUsage() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (fs.existsSync(this.usageFile)) {
        const data = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
        if (data.date === today) {
          this.dailyCount = data.count || 0;
          this.dailyEntities = new Set(data.entities || []);
          return;
        }
      }
    } catch (e) {
      console.warn('[Governor] Error leyendo daily usage, inicializando nuevo:', e.message);
    }
    this.dailyCount = 0;
    this.dailyEntities = new Set();
    this._saveDailyUsage();
  }

  _saveDailyUsage() {
    const today = new Date().toISOString().slice(0, 10);
    const data = {
      date: today,
      count: this.dailyCount,
      entities: Array.from(this.dailyEntities),
      lastUpdated: new Date().toISOString()
    };
    try {
      fs.writeFileSync(this.usageFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[Governor] Fallo al guardar daily usage:', e.message);
    }
  }

  getStatus() {
    const now = Date.now();
    this.recentTimestamps = this.recentTimestamps.filter(t => now - t < 60000);
    return {
      activeRequests: this.activeRequests,
      callsLastMinute: this.recentTimestamps.length,
      maxPerMinute: this.limits.maxPerMinute,
      dailyCallsUsed: this.dailyCount,
      dailyCallsRemaining: Math.max(0, this.limits.maxDailyCalls - this.dailyCount),
      dailyEntitiesCount: this.dailyEntities.size,
      queueLength: this.requestQueue.length
    };
  }

  async acquire(entityId = null) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject, entityId, timestamp: Date.now() });
      this._processQueue();
    });
  }

  release() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this._processQueue();
  }

  async _processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      this.recentTimestamps = this.recentTimestamps.filter(t => now - t < 60000);

      // 1. Chequeo de límite diario
      if (this.dailyCount >= this.limits.maxDailyCalls) {
        const next = this.requestQueue.shift();
        next.reject(new Error(`[Governor] Presupuesto diario de StatsHub agotado (${this.dailyCount}/${this.limits.maxDailyCalls})`));
        continue;
      }

      // 2. Chequeo de concurrencia
      if (this.activeRequests >= this.limits.maxConcurrent) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      // 3. Chequeo de llamadas por minuto
      if (this.recentTimestamps.length >= this.limits.maxPerMinute) {
        const oldest = this.recentTimestamps[0];
        const waitMs = Math.max(200, 60000 - (now - oldest) + 100);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // 4. Todo despejado: despachar request
      const task = this.requestQueue.shift();
      this.activeRequests++;
      this.recentTimestamps.push(Date.now());
      this.dailyCount++;
      if (task.entityId) {
        this.dailyEntities.add(task.entityId);
      }
      this._saveDailyUsage();

      task.resolve();
      await new Promise(r => setTimeout(r, 150)); // Jitter mínimo entre llamadas
    }

    this.isProcessingQueue = false;
  }
}

module.exports = new RateGovernor();
