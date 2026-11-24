/**
 * FASE 10.1 — SNAPSHOT WORKER (AISLADO / SHADOW MODE)
 *
 * Consume los checkpoints programados (T_MINUS_60, T_MINUS_30, T_MINUS_5, CLOSING)
 * de fase10_operational_state.json y registra snapshots reales pre-partido en
 * ObservationStore (append-only en *_snapshots.json).
 *
 * Reglas temporales inviolables:
 *  - Nunca fabrica snapshots históricos con cuotas actuales si la ventana ya venció -> MISSED.
 *  - Nunca captura ni persiste cuotas después del kickoff (nowMs >= kickoffMs -> MISSED / REJECTED).
 *  - CLOSING es la última cuota pre-partido válida, nunca in-play.
 *  - Agrupa consultas por matchId (1 sola llamada getMatchOdds por partido por ciclo).
 *  - Idempotencia estricta por idempotencyKey = `${observationId}__${checkpoint}`.
 *  - Reintentos acotados con backoff ante errores transitorios.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const defaultMcpClient = require('../../../mcp/mcpClient');
const { auditMatchOddsCoverage } = require('../marketCoverageAudit');
const { ObservationStore } = require('./observationStore');
const { ObservationOrchestrator } = require('./observationOrchestrator');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_OP_STATE_PATH = path.join(STORAGE_DIR, 'fase10_operational_state.json');

const CHECKPOINT_STATES = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  MISSED: 'MISSED',
  CANCELLED: 'CANCELLED'
});

// Ventanas de gracia (minutos) después del scheduledUtc antes de marcar MISSED (sin inventar históricos)
const CHECKPOINT_GRACE_MINUTES = Object.freeze({
  T_MINUS_60: 10,
  T_MINUS_30: 8,
  T_MINUS_5: 3,
  CLOSING: 1
});

const EARLY_TOLERANCE_MS = 2 * 60 * 1000; // 2 min antes de la marca exacta

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 2), 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/**
 * Extrae cuota y bookmaker real de una observación específica desde auditMatchOddsCoverage().
 */
function extractQuoteForObservation(obs, oddsAudit) {
  if (!oddsAudit || !oddsAudit.priced) return null;
  const ex = oddsAudit.extractedOdds || {};
  const fam = obs.marketFamily;
  const sel = String(obs.selection || '').toUpperCase();

  if (fam === 'match_1x2' && ex.odds1X2) {
    const oddsMap = { '1': ex.odds1X2.home, 'X': ex.odds1X2.draw, '2': ex.odds1X2.away };
    const odds = oddsMap[sel];
    if (!Number.isFinite(odds) || odds <= 1) return null;
    return {
      odds,
      bookmaker: ex.odds1X2.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
      line: null
    };
  }

  if (fam === 'double_chance' && ex.oddsDoubleChance) {
    const odds = ex.oddsDoubleChance[sel];
    if (!Number.isFinite(odds) || odds <= 1) return null;
    return {
      odds,
      bookmaker: ex.oddsDoubleChance.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
      line: null
    };
  }

  if (fam === 'btts' && ex.oddsBtts) {
    const odds = ex.oddsBtts[sel];
    if (!Number.isFinite(odds) || odds <= 1) return null;
    return {
      odds,
      bookmaker: ex.oddsBtts.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
      line: null
    };
  }

  if (fam === 'match_goals' && ex.oddsTotalGoals) {
    const odds = ex.oddsTotalGoals[sel];
    if (!Number.isFinite(odds) || odds <= 1) return null;
    return {
      odds,
      bookmaker: ex.oddsTotalGoals.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
      line: ex.oddsTotalGoals.line
    };
  }

  if (fam === 'asian_handicap' && ex.oddsAsianHandicap) {
    const odds = ex.oddsAsianHandicap[sel];
    if (!Number.isFinite(odds) || odds <= 1) return null;
    return {
      odds,
      bookmaker: ex.oddsAsianHandicap.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
      line: sel === 'AWAY' ? ex.oddsAsianHandicap.lineAway : ex.oddsAsianHandicap.lineHome
    };
  }

  return null;
}

class SnapshotWorker {
  constructor(options = {}) {
    this.store = options.store || new ObservationStore(options.storeOptions);
    this.orchestrator = options.orchestrator || new ObservationOrchestrator({
      store: this.store,
      exportPath: options.exportPath
    });
    this.opStatePath = options.opStatePath || DEFAULT_OP_STATE_PATH;
    this.maxRetries = options.maxRetries ?? 2;
    this.autoExecutionAllowed = false;
    this._running = false;
  }

  _loadOpState() {
    if (!fs.existsSync(this.opStatePath)) {
      return { status: 'NOT_EXECUTED', scheduledSnapshots: [], snapshotWorker: null };
    }
    const parsed = JSON.parse(fs.readFileSync(this.opStatePath, 'utf8'));
    // Recuperar cualquier checkpoint que haya quedado en RUNNING tras reinicio
    for (const entry of (parsed.scheduledSnapshots || [])) {
      for (const cp of (entry.checkpoints || [])) {
        if (cp.status === CHECKPOINT_STATES.RUNNING) {
          cp.status = CHECKPOINT_STATES.SCHEDULED;
          cp.recoveredFromRestart = true;
        }
      }
    }
    return parsed;
  }

  _saveOpState(state) {
    atomicWriteJson(this.opStatePath, state);
  }

  /**
   * Ejecuta un ciclo del SnapshotWorker para el instante nowUtc.
   */
  async runCycle({
    nowUtc = new Date().toISOString(),
    client = defaultMcpClient,
    exportDashboard = true
  } = {}) {
    if (this._running) {
      return { skipped: true, reason: 'SNAPSHOT_WORKER_LOCKED', autoExecutionAllowed: false };
    }
    this._running = true;

    const nowMs = Date.parse(nowUtc);
    const startedAtUtc = new Date().toISOString();
    const summary = {
      startedAtUtc,
      completedAtUtc: null,
      nowUtcEvaluated: nowUtc,
      autoExecutionAllowed: false,
      mcpCallsUsed: 0,
      checkpointsEvaluated: 0,
      completedCount: 0,
      missedCount: 0,
      failedCount: 0,
      skippedFutureCount: 0,
      skippedIdempotentCount: 0,
      errors: []
    };

    try {
      const opState = this._loadOpState();
      const observations = this.store.getObservations();
      const obsMap = new Map(observations.map(o => [o.observationId, o]));

      // 1. Clasificar checkpoints: futuros, vencidos (MISSED), o activos en ventana válida
      const dueTasks = [];
      for (const entry of (opState.scheduledSnapshots || [])) {
        const obs = obsMap.get(entry.observationId);
        const koMs = Date.parse(entry.kickoffUtc || obs?.kickoffUtc);

        for (const cp of (entry.checkpoints || [])) {
          summary.checkpointsEvaluated++;
          const idemKey = cp.idempotencyKey || `${entry.observationId}__${cp.checkpoint}`;
          cp.idempotencyKey = idemKey;

          if ([CHECKPOINT_STATES.COMPLETED, CHECKPOINT_STATES.MISSED, CHECKPOINT_STATES.CANCELLED].includes(cp.status)) {
            summary.skippedIdempotentCount++;
            continue;
          }

          if (!obs || !Number.isFinite(koMs)) {
            cp.status = CHECKPOINT_STATES.CANCELLED;
            cp.reason = 'OBSERVATION_OR_KICKOFF_NOT_FOUND';
            continue;
          }

          // Evitar duplicar si el ledger ya tiene ese checkpoint para esa observación
          if ((obs.oddsSnapshots || []).some(s => s.checkpoint === cp.checkpoint)) {
            cp.status = CHECKPOINT_STATES.COMPLETED;
            cp.reason = 'ALREADY_PERSISTED_IN_LEDGER';
            summary.skippedIdempotentCount++;
            continue;
          }

          const schedMs = Date.parse(cp.scheduledUtc);
          const graceMs = (CHECKPOINT_GRACE_MINUTES[cp.checkpoint] ?? 5) * 60 * 1000;

          // Regla crítica 1: post-kickoff -> NUNCA capturar cuota in-play
          if (nowMs >= koMs) {
            cp.status = CHECKPOINT_STATES.MISSED;
            cp.updatedAtUtc = nowUtc;
            cp.reason = `POST_KICKOFF_WINDOW_EXPIRED (now=${nowUtc} >= kickoff=${obs.kickoffUtc})`;
            summary.missedCount++;
            continue;
          }

          // Regla crítica 2: ventana del checkpoint ya expiró -> MISSED (nunca fabricar histórico)
          if (nowMs > schedMs + graceMs) {
            cp.status = CHECKPOINT_STATES.MISSED;
            cp.updatedAtUtc = nowUtc;
            cp.reason = `CHECKPOINT_WINDOW_EXPIRED (scheduled=${cp.scheduledUtc}, grace=${CHECKPOINT_GRACE_MINUTES[cp.checkpoint]}m)`;
            summary.missedCount++;
            continue;
          }

          // Todavía no llegó su ventana -> queda SCHEDULED
          if (nowMs < schedMs - EARLY_TOLERANCE_MS) {
            summary.skippedFutureCount++;
            continue;
          }

          // En ventana válida pre-kickoff -> encolar para captura agrupada por matchId
          cp.status = CHECKPOINT_STATES.RUNNING;
          dueTasks.push({ entry, cp, obs });
        }
      }

      // Persistir estado RUNNING / MISSED antes de llamar a MCP (seguridad ante reinicio)
      this._saveOpState(opState);

      // 2. Agrupar por matchId para hacer 1 sola llamada getMatchOdds por partido
      const tasksByMatch = new Map();
      for (const task of dueTasks) {
        const mId = task.obs.matchId;
        if (!tasksByMatch.has(mId)) tasksByMatch.set(mId, []);
        tasksByMatch.get(mId).push(task);
      }

      for (const [matchId, tasks] of tasksByMatch.entries()) {
        let oddsRes = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
          try {
            oddsRes = await client.callTool('getMatchOdds', { matchId }, { bypassCache: true, timeoutMs: 12000 });
            summary.mcpCallsUsed++;
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
          }
        }

        if (lastErr) {
          summary.errors.push({ matchId, error: lastErr.message });
          for (const { cp } of tasks) {
            cp.retries = (cp.retries || 0) + 1;
            cp.status = cp.retries >= this.maxRetries ? CHECKPOINT_STATES.FAILED : CHECKPOINT_STATES.SCHEDULED;
            cp.reason = `MCP_ERROR: ${lastErr.message}`;
            cp.updatedAtUtc = nowUtc;
            if (cp.status === CHECKPOINT_STATES.FAILED) summary.failedCount++;
          }
          continue;
        }

        const oddsAudit = auditMatchOddsCoverage(oddsRes?.data);
        for (const { cp, obs } of tasks) {
          const quote = extractQuoteForObservation(obs, oddsAudit);
          if (!quote) {
            cp.status = CHECKPOINT_STATES.FAILED;
            cp.reason = 'QUOTE_NOT_FOUND_IN_MATCH_ODDS';
            cp.updatedAtUtc = nowUtc;
            summary.failedCount++;
            continue;
          }

          const rec = this.store.recordOddsSnapshot(obs.observationId, {
            checkpoint: cp.checkpoint,
            capturedAtUtc: nowUtc,
            odds: quote.odds,
            bookmaker: quote.bookmaker,
            marketFamily: obs.marketFamily,
            selection: obs.selection,
            line: quote.line,
            source: 'statshub:getMatchOdds'
          });

          if (rec.updated) {
            cp.status = CHECKPOINT_STATES.COMPLETED;
            cp.capturedAtUtc = nowUtc;
            cp.capturedOdds = quote.odds;
            cp.capturedBookmaker = quote.bookmaker;
            cp.eventId = rec.eventId;
            cp.clvStatus = rec.clv?.status || 'CLV_UNAVAILABLE';
            cp.reason = null;
            summary.completedCount++;
          } else {
            cp.status = CHECKPOINT_STATES.FAILED;
            cp.reason = rec.reason || 'SNAPSHOT_REJECTED';
            cp.updatedAtUtc = nowUtc;
            summary.failedCount++;
          }
        }
      }

      summary.completedAtUtc = new Date().toISOString();
      opState.snapshotWorker = {
        lastRunAtUtc: summary.completedAtUtc,
        lastSummary: summary
      };
      this._saveOpState(opState);

      if (exportDashboard) {
        this._exportWithWorkerTelemetry(opState);
      }

      return { ok: true, summary };
    } finally {
      this._running = false;
    }
  }

  _exportWithWorkerTelemetry(opState) {
    const exported = this.orchestrator.buildAndExportDashboardData({ writeToDisk: false });
    const cpCounts = { SCHEDULED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0, MISSED: 0, CANCELLED: 0 };
    for (const e of (opState.scheduledSnapshots || [])) {
      for (const cp of (e.checkpoints || [])) {
        cpCounts[cp.status] = (cpCounts[cp.status] || 0) + 1;
      }
    }
    const enriched = {
      ...exported,
      operationalStatus: {
        status: opState.status || 'EXECUTED',
        lastRunAtUtc: opState.lastRunAtUtc || null,
        lastStatsHubQueryAtUtc: opState.lastStatsHubQueryAtUtc || null,
        runsCount: opState.runsCount || 0,
        lastRunSummary: opState.lastRunSummary || null,
        scheduledSnapshotsCount: (opState.scheduledSnapshots || []).length,
        checkpointCounts: cpCounts,
        snapshotWorker: opState.snapshotWorker || null,
        settlementWorker: opState.settlementWorker || null
      }
    };
    atomicWriteJson(this.orchestrator.exportPath, enriched);
  }
}

module.exports = {
  SnapshotWorker,
  CHECKPOINT_STATES,
  CHECKPOINT_GRACE_MINUTES,
  extractQuoteForObservation
};
