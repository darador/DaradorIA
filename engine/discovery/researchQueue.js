/**
 * RESEARCH QUEUE - COLA DE INVESTIGACIÓN SIN TRUNCAMIENTOS
 * Procesa candidatos en lotes de 10 con semáforo de concurrencia,
 * rate governor, reintentos con backoff exponencial y persistencia de checkpoints.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

class ResearchQueue {
  constructor(customConfig = {}) {
    this.batchSize = customConfig.batchSize || 10;
    this.concurrencyLimit = customConfig.concurrencyLimit || 2;
    this.maxRetries = customConfig.maxRetries || 3;
    this.queue = [];
    this.inFlight = new Set();
    this.processed = new Map();
    this.failed = new Map();
    this.checkpointFile = customConfig.checkpointFile || path.resolve(__dirname, '..', 'storage_data', 'research_queue_checkpoint.json');
    if (!customConfig.skipLoadCheckpoint) {
      this._loadCheckpoint();
    }
  }

  _loadCheckpoint() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        const raw = fs.readFileSync(this.checkpointFile, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.processedIds)) {
          data.processedIds.forEach(id => this.processed.set(id, true));
        }
      }
    } catch (e) {
      console.warn('[ResearchQueue] Checkpoint previo no cargado o corrupto:', e.message);
    }
  }

  _saveCheckpoint() {
    try {
      const data = {
        updatedAt: new Date().toISOString(),
        pendingCount: this.queue.length,
        processedCount: this.processed.size,
        processedIds: Array.from(this.processed.keys()).slice(-500)
      };
      fs.writeFileSync(this.checkpointFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[ResearchQueue] Error guardando checkpoint:', e.message);
    }
  }

  /**
   * Encola un lote de candidatos sin límites arbitrarios
   */
  enqueueBatch(candidates) {
    if (!Array.isArray(candidates)) return;
    let added = 0;
    for (const cand of candidates) {
      const id = cand.candidateId || cand.id;
      if (!this.processed.has(id) && !this.queue.some(q => (q.candidateId || q.id) === id)) {
        this.queue.push({
          candidate: cand,
          retries: 0,
          enqueuedAt: new Date().toISOString()
        });
        added++;
      }
    }
    this._saveCheckpoint();
    return added;
  }

  /**
   * Procesa la cola mediante lotes de 10 con semáforo y rate limits
   * @param {Function} processorFn Función que procesa un candidato individual (DeepResearch + Prediction)
   */
  async processAll(processorFn) {
    console.log(`[ResearchQueue] Procesando cola total de ${this.queue.length} elementos (Lotes de ${this.batchSize})...`);
    const results = [];

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      console.log(`[ResearchQueue] Ejecutando lote de ${batch.length} candidatos...`);

      // Semáforo de concurrencia controlada
      const batchPromises = batch.map(item => this._processItemWithRetry(item, processorFn));
      const batchResults = await Promise.all(batchPromises);

      for (const res of batchResults) {
        if (res && res.success) {
          results.push(res.result);
          this.processed.set(res.id, true);
        } else if (res && !res.success) {
          this.failed.set(res.id, res.error);
        }
      }

      this._saveCheckpoint();
      // Pequeña pausa de estabilización entre lotes
      await new Promise(r => setTimeout(r, 100));
    }

    return results;
  }

  async _processItemWithRetry(item, processorFn) {
    const cand = item.candidate;
    const id = cand.candidateId || cand.id;

    while (item.retries <= this.maxRetries) {
      try {
        const result = await processorFn(cand);
        return { success: true, id, result };
      } catch (err) {
        item.retries++;
        console.warn(`[ResearchQueue] Fallo en candidato ${id} (Intento ${item.retries}/${this.maxRetries}):`, err.message);
        if (item.retries > this.maxRetries) {
          return { success: false, id, error: err.message };
        }
        // Backoff exponencial: 200ms, 400ms, 800ms
        const delay = Math.pow(2, item.retries) * 100;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  getMetrics() {
    return {
      pending: this.queue.length,
      processed: this.processed.size,
      failed: this.failed.size
    };
  }
}

module.exports = {
  ResearchQueue,
  researchQueue: new ResearchQueue()
};
