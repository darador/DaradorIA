/**
 * FASE 10.1 — SETTLEMENT WORKER (AISLADO / SHADOW MODE)
 *
 * Procesa observaciones PENDING en ObservationStore, consulta resultados oficiales
 * vía StatsHub MCP (getMatchDetails) solo para eventos cuyo horario FT ya pasó,
 * liquida únicamente resultados FINISHED y confirmados vía SettlementProcessor
 * (append-only en *_settlements.json) y re-exporta api/evidence_fase9.json.
 *
 * Estados de tarea:
 *   PENDING | RUNNING | SETTLED | RETRY | UNAVAILABLE | ERROR
 */

'use strict';

const fs = require('fs');
const path = require('path');

const defaultMcpClient = require('../../../mcp/mcpClient');
const { ObservationStore } = require('./observationStore');
const { SettlementProcessor, SETTLEMENT_STATES } = require('./settlementProcessor');
const { ObservationOrchestrator } = require('./observationOrchestrator');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_OP_STATE_PATH = path.join(STORAGE_DIR, 'fase10_operational_state.json');

const WORKER_STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SETTLED: 'SETTLED',
  RETRY: 'RETRY',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
});

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
 * Extrae estado y marcador confirmado 90 min desde respuesta real de StatsHub getMatchDetails.
 */
function parseMatchDetailsForSettlement(detailsPayload) {
  const m = detailsPayload?.data?.matches || detailsPayload?.matches || detailsPayload || {};
  const rawStatus = String(m.status || '').toLowerCase();
  const context = String(detailsPayload?.context || '').toLowerCase();

  // StatsHub advierte explícitamente "final score not confirmed yet"
  const unconfirmedNote = context.includes('not confirmed yet');

  let matchStatus = 'SCHEDULED';
  if (['finished', 'ft', 'ended', 'aet', 'pen'].includes(rawStatus)) matchStatus = 'FINISHED';
  else if (['suspended', 'interrupted'].includes(rawStatus)) matchStatus = 'SUSPENDED';
  else if (['postponed'].includes(rawStatus)) matchStatus = 'POSTPONED';
  else if (['cancelled', 'canceled', 'abandoned'].includes(rawStatus)) matchStatus = 'CANCELLED';
  else if (['live', 'inprogress', 'in_play'].includes(rawStatus)) matchStatus = 'IN_PLAY';

  // Parsear marcador 90 min (homeScore/awayScore o score "2-1")
  let homeGoals = Number.isFinite(Number(m.homeScore)) ? Number(m.homeScore) : (Number.isFinite(Number(m.homeGoals)) ? Number(m.homeGoals) : null);
  let awayGoals = Number.isFinite(Number(m.awayScore)) ? Number(m.awayScore) : (Number.isFinite(Number(m.awayGoals)) ? Number(m.awayGoals) : null);
  if ((homeGoals === null || awayGoals === null) && typeof m.score === 'string') {
    const sm = m.score.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (sm) {
      homeGoals = Number(sm[1]);
      awayGoals = Number(sm[2]);
    }
  }

  const resultConfirmed = matchStatus === 'FINISHED' && !unconfirmedNote && homeGoals !== null && awayGoals !== null && m.resultConfirmed !== false;

  return {
    matchStatus,
    resultConfirmed,
    homeGoals,
    awayGoals,
    officiallyVoided: Boolean(m.officiallyVoided),
    resultSource: 'statshub:getMatchDetails'
  };
}

class SettlementWorker {
  constructor(options = {}) {
    this.store = options.store || new ObservationStore(options.storeOptions);
    this.settlement = options.settlement || new SettlementProcessor(this.store);
    this.orchestrator = options.orchestrator || new ObservationOrchestrator({
      store: this.store,
      settlement: this.settlement,
      exportPath: options.exportPath
    });
    this.opStatePath = options.opStatePath || DEFAULT_OP_STATE_PATH;
    this.minMinutesAfterKickoff = options.minMinutesAfterKickoff ?? 105;
    this.autoExecutionAllowed = false;
    this._running = false;
  }

  _loadOpState() {
    if (!fs.existsSync(this.opStatePath)) {
      return { status: 'NOT_EXECUTED', scheduledSnapshots: [], settlementTasks: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(this.opStatePath, 'utf8'));
    parsed.settlementTasks = parsed.settlementTasks || {};
    // Recuperar tareas que hayan quedado en RUNNING tras un reinicio
    for (const key of Object.keys(parsed.settlementTasks)) {
      if (parsed.settlementTasks[key].workerStatus === WORKER_STATES.RUNNING) {
        parsed.settlementTasks[key].workerStatus = WORKER_STATES.RETRY;
        parsed.settlementTasks[key].recoveredFromRestart = true;
      }
    }
    return parsed;
  }

  _saveOpState(state) {
    atomicWriteJson(this.opStatePath, state);
  }

  /**
   * Ejecuta un ciclo del SettlementWorker.
   */
  async runCycle({
    nowUtc = new Date().toISOString(),
    client = defaultMcpClient,
    forceCheckBeforeFt = false,
    exportDashboard = true
  } = {}) {
    if (this._running) {
      return { skipped: true, reason: 'SETTLEMENT_WORKER_LOCKED', autoExecutionAllowed: false };
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
      pendingObservationsFound: 0,
      matchesChecked: 0,
      matchesSkippedNotFinishedTime: 0,
      settledCount: 0,
      pendingRemainingCount: 0,
      retryCount: 0,
      errorCount: 0,
      errors: []
    };

    try {
      const opState = this._loadOpState();
      const observations = this.store.getObservations();
      const pendingObs = observations.filter(o => o.status === SETTLEMENT_STATES.PENDING || o.status === SETTLEMENT_STATES.UNAVAILABLE);
      summary.pendingObservationsFound = pendingObs.length;

      // Agrupar por matchId (1 sola llamada getMatchDetails por partido)
      const byMatch = new Map();
      for (const obs of pendingObs) {
        if (!byMatch.has(obs.matchId)) byMatch.set(obs.matchId, []);
        byMatch.get(obs.matchId).push(obs);
      }

      for (const [matchId, obsList] of byMatch.entries()) {
        const koMs = Date.parse(obsList[0].kickoffUtc);
        const readyMs = koMs + this.minMinutesAfterKickoff * 60 * 1000;

        if (!forceCheckBeforeFt && Number.isFinite(koMs) && nowMs < readyMs) {
          summary.matchesSkippedNotFinishedTime++;
          summary.pendingRemainingCount += obsList.length;
          continue;
        }

        opState.settlementTasks[matchId] = {
          matchId,
          workerStatus: WORKER_STATES.RUNNING,
          lastAttemptUtc: nowUtc
        };
        this._saveOpState(opState);

        summary.matchesChecked++;
        let detailsRes;
        try {
          detailsRes = await client.callTool('getMatchDetails', { matchId }, { bypassCache: true, timeoutMs: 12000 });
          summary.mcpCallsUsed++;
        } catch (err) {
          opState.settlementTasks[matchId] = {
            matchId,
            workerStatus: WORKER_STATES.RETRY,
            lastAttemptUtc: nowUtc,
            error: err.message
          };
          summary.retryCount += obsList.length;
          summary.errorCount++;
          summary.errors.push({ matchId, error: err.message });
          continue;
        }

        const parsed = parseMatchDetailsForSettlement(detailsRes?.data);
        let settledInMatch = 0;

        for (const obs of obsList) {
          const res = this.settlement.settleObservation(obs.observationId, {
            ...parsed,
            settledAtUtc: nowUtc
          });
          if (res.settled) {
            settledInMatch++;
            summary.settledCount++;
          } else {
            summary.pendingRemainingCount++;
          }
        }

        opState.settlementTasks[matchId] = {
          matchId,
          workerStatus: settledInMatch === obsList.length ? WORKER_STATES.SETTLED : (parsed.matchStatus === 'FINISHED' ? WORKER_STATES.UNAVAILABLE : WORKER_STATES.PENDING),
          matchStatus: parsed.matchStatus,
          resultConfirmed: parsed.resultConfirmed,
          lastAttemptUtc: nowUtc,
          settledInMatch
        };
      }

      summary.completedAtUtc = new Date().toISOString();
      opState.settlementWorker = {
        lastRunAtUtc: summary.completedAtUtc,
        lastSummary: summary
      };
      this._saveOpState(opState);

      if (exportDashboard) {
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

      return { ok: true, summary };
    } finally {
      this._running = false;
    }
  }
}

module.exports = {
  SettlementWorker,
  WORKER_STATES,
  parseMatchDetailsForSettlement
};
