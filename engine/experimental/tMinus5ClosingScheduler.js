/**
 * T-5 CLOSING ODDS SCHEDULER (AISLADO — SHADOW MODE ONLY)
 * Fase 2.3: Consulta cuotas de cierre en la ventana T-10 a T-1 min (objetivo T-5 min)
 * exclusivamente para las observaciones de shadow_lab_v2_3.json.
 *
 * Aislamiento total:
 * - NO modifica engine/scheduler/centralScheduler.js ni ninguna tarea productiva.
 * - Control de concurrencia por mutex (inFlight).
 * - Si no existe cuota opuesta, la marca explícitamente como estimada (nunca no-vig exacto).
 */

const shadowLabRunner = require('./shadowLabRunner');

class TMinus5ClosingScheduler {
  constructor(options = {}) {
    this.runner = options.runner || shadowLabRunner;
    this.oddsProvider = options.oddsProvider || null; // async (obs) => ({ closingOdds, closingOppositeOdds, source })
    this.pollIntervalMs = options.pollIntervalMs || 60 * 1000; // Cada 1 min
    this.windowMinMinutes = options.windowMinMinutes ?? 1;   // T-1 min
    this.windowMaxMinutes = options.windowMaxMinutes ?? 10;  // T-10 min (objetivo T-5)
    this.timer = null;
    this.isRunning = false;
    this.inFlight = false;
    this.lastRunAtUtc = null;
    this.lastRunSummary = null;
  }

  /**
   * Identifica observaciones pendientes de cuota de cierre dentro de la ventana [T-10, T-1] min.
   */
  findEligibleForClosingCapture(nowMs = Date.now()) {
    const records = this.runner._readAll();
    return records.filter(rec => {
      if (!rec || !rec.kickoffUtc) return false;
      if (rec.closingOddsSnapshot && rec.closingOddsSnapshot.closingOdds !== null) return false;
      if (rec.settlement && rec.settlement.status === 'SETTLED') return false;
      const koMs = Date.parse(rec.kickoffUtc);
      if (!Number.isFinite(koMs)) return false;
      const minsLeft = (koMs - nowMs) / 60000;
      return minsLeft >= this.windowMinMinutes && minsLeft <= this.windowMaxMinutes;
    });
  }

  /**
   * Ejecuta un ciclo único aislado de captura T-5 min.
   */
  async runCycle(nowMs = Date.now()) {
    if (this.inFlight) {
      return { skipped: true, reason: 'MUTEX_LOCKED' };
    }
    this.inFlight = true;
    const captured = [];
    const errors = [];

    try {
      const eligible = this.findEligibleForClosingCapture(nowMs);
      for (const obs of eligible) {
        if (!this.oddsProvider) {
          errors.push({ predictionId: obs.predictionId, reason: 'NO_ODDS_PROVIDER_CONFIGURED' });
          continue;
        }
        try {
          const quote = await this.oddsProvider(obs);
          if (!quote || !quote.closingOdds) {
            errors.push({ predictionId: obs.predictionId, reason: 'EMPTY_CLOSING_QUOTE' });
            continue;
          }
          const res = this.runner.recordClosingOdds(obs.predictionId, {
            closingOdds: quote.closingOdds,
            closingOppositeOdds: quote.closingOppositeOdds ?? null,
            capturedAtUtc: new Date(nowMs).toISOString(),
            source: quote.source || 'StatsHub MCP (T-5 Scheduler)'
          });
          if (res.updated) {
            captured.push({
              predictionId: obs.predictionId,
              closingOdds: quote.closingOdds,
              clvOddsPct: res.clvOddsPct,
              clvProbPp: res.clvProbPp
            });
          } else {
            errors.push({ predictionId: obs.predictionId, reason: res.reason });
          }
        } catch (err) {
          errors.push({ predictionId: obs.predictionId, reason: err.message });
        }
      }

      this.lastRunAtUtc = new Date(nowMs).toISOString();
      this.lastRunSummary = {
        eligibleCount: eligible.length,
        capturedCount: captured.length,
        errorCount: errors.length,
        captured,
        errors
      };
      return this.lastRunSummary;
    } finally {
      this.inFlight = false;
    }
  }

  start() {
    if (this.isRunning) return { started: false, reason: 'ALREADY_RUNNING' };
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.runCycle().catch(err => console.warn('[T-5 Scheduler] Error:', err.message));
    }, this.pollIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    return { started: true, pollIntervalMs: this.pollIntervalMs, window: `T-${this.windowMaxMinutes}..T-${this.windowMinMinutes} min` };
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    return { stopped: true };
  }
}

module.exports = TMinus5ClosingScheduler;
