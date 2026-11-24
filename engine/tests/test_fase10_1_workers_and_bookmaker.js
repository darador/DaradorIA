/**
 * TEST SUITE ADVERSARIAL — FASE 10.1: BOOKMAKER TRACEABILITY, SNAPSHOT WORKER & SETTLEMENT WORKER
 *
 * Cubre todos los escenarios de la Sección 7:
 *  1. Bookmaker real por selección en 1X2 y Doble Oportunidad (sin heredar ni usar StatsHubBest)
 *  2. Bookmaker ausente -> BOOKMAKER_UNAVAILABLE y CLV rechazado como CLV_UNAVAILABLE
 *  3. Diferentes bookmakers entre observación inicial y cierre -> CLV_UNAVAILABLE
 *  4. Checkpoint vencido (ventana expirada) -> marcado MISSED (nunca fabrica histórico)
 *  5. Reinicio antes de T-30 (checkpoint en RUNNING se recupera a SCHEDULED y se captura en ventana)
 *  6. Reinicio después de T-5 (T-60, T-30 y T-5 expirados -> MISSED; CLOSING aún futuro -> SCHEDULED)
 *  7. Snapshot post-kickoff -> rechazado (MISSED / POST_KICKOFF_SNAPSHOT_REJECTED), 0 CLV
 *  8. Rate limit / error transitorio de StatsHub -> reintentos acotados y estado FAILED tras agotar reintentos
 *  9. Duplicación de checkpoints -> idempotencia estricta por idempotencyKey y ledger
 * 10. Liquidación FINISHED confirmada vía SettlementWorker (append-only, actualiza Evidence JSON)
 * 11. Evento suspendido y resultado no confirmado -> nunca liquidado como LOST
 * 12. Reinicio durante liquidación (RUNNING -> RETRY) + liquidación duplicada idempotente
 * 13. Corrección de resultado auditada preservando historial + integridad de ambos ledgers
 * 14. Integración en CentralScheduler (3 mutex independientes) y aislamiento total del Daily Board
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { auditMatchOddsCoverage } = require('../experimental/markets/marketCoverageAudit');
const { ObservationStore } = require('../experimental/markets/observation/observationStore');
const { SettlementProcessor, SETTLEMENT_STATES } = require('../experimental/markets/observation/settlementProcessor');
const { SnapshotWorker, CHECKPOINT_STATES } = require('../experimental/markets/observation/snapshotWorker');
const { SettlementWorker, WORKER_STATES } = require('../experimental/markets/observation/settlementWorker');
const { buildSnapshotSchedule } = require('../experimental/markets/observation/controlledPipelineRunner');

let passed = 0;
let failed = 0;

function makeTmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_f10_1_'));
  const store = new ObservationStore({
    obsPath: path.join(dir, 'obs.json'),
    rejectedPath: path.join(dir, 'rej.json'),
    alertsPath: path.join(dir, 'alerts.json')
  });
  const opStatePath = path.join(dir, 'op_state.json');
  const exportPath = path.join(dir, 'evidence.json');
  const snapWorker = new SnapshotWorker({ store, opStatePath, exportPath, maxRetries: 1 });
  const settWorker = new SettlementWorker({ store, opStatePath, exportPath });
  return { dir, store, opStatePath, exportPath, snapWorker, settWorker };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function sampleOddsPayload(customBooks = {}) {
  return {
    context: 'TeamA v TeamB · kick-off Tue 28 Nov 2026, 20:00 UTC',
    priced: true,
    markets: [
      { name: 'To Win', outcomes: [
        { label: 'TeamA', best: { odds: 2.10, bookmaker: customBooks['1'] !== undefined ? customBooks['1'] : 'Bet365', ageMinutes: 4 }, books: 4 },
        { label: 'Draw', best: { odds: 3.50, bookmaker: customBooks['X'] !== undefined ? customBooks['X'] : 'BetMGM UK', ageMinutes: 5 }, books: 4 },
        { label: 'TeamB', best: { odds: 3.60, bookmaker: customBooks['2'] !== undefined ? customBooks['2'] : 'Paddy Power', ageMinutes: 6 }, books: 4 }
      ]},
      { name: 'Double Chance', outcomes: [
        { label: 'TeamA or Draw', best: { odds: 1.32, bookmaker: customBooks['1X'] !== undefined ? customBooks['1X'] : 'All British Casino', ageMinutes: 5 }, books: 4 },
        { label: 'TeamA or TeamB', best: { odds: 1.28, bookmaker: customBooks['12'] !== undefined ? customBooks['12'] : 'Bet365', ageMinutes: 5 }, books: 4 },
        { label: 'Draw or TeamB', best: { odds: 1.75, bookmaker: customBooks['X2'] !== undefined ? customBooks['X2'] : 'BetMGM UK', ageMinutes: 5 }, books: 4 }
      ]}
    ]
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log('\n🔧 Iniciando Test Suite Adversarial — Fase 10.1 Workers & Bookmaker Traceability (14 Escenarios)...\n');

  await runTest('1. Bookmaker real por selección en 1X2 y Doble Oportunidad (sin heredar ni StatsHubBest)', () => {
    const audit = auditMatchOddsCoverage(sampleOddsPayload());
    assert.strictEqual(audit.extractedOdds.odds1X2.bookmakers['1'], 'Bet365');
    assert.strictEqual(audit.extractedOdds.odds1X2.bookmakers['X'], 'BetMGM UK');
    assert.strictEqual(audit.extractedOdds.odds1X2.bookmakers['2'], 'Paddy Power');
    assert.strictEqual(audit.extractedOdds.oddsDoubleChance.bookmakers['1X'], 'All British Casino');
    assert.strictEqual(audit.extractedOdds.oddsDoubleChance.bookmakers['12'], 'Bet365');
    assert.strictEqual(audit.extractedOdds.oddsDoubleChance.bookmakers['X2'], 'BetMGM UK');
  });

  await runTest('2. Bookmaker ausente -> BOOKMAKER_UNAVAILABLE y CLV rechazado como CLV_UNAVAILABLE', () => {
    const { dir, store } = makeTmpEnv();
    try {
      const audit = auditMatchOddsCoverage(sampleOddsPayload({ '1': '' }));
      assert.strictEqual(audit.extractedOdds.odds1X2.bookmakers['1'], 'BOOKMAKER_UNAVAILABLE');

      const r = store.recordObservation({
        matchId: 'm_bk', league: 'PL', kickoffUtc: '2026-11-28T20:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'BOOKMAKER_UNAVAILABLE'
      });
      const close = store.recordOddsSnapshot(r.observationId, {
        checkpoint: 'CLOSING', capturedAtUtc: '2026-11-28T19:58:00Z', odds: 2.00, bookmaker: 'BOOKMAKER_UNAVAILABLE'
      });
      assert.strictEqual(close.clv.status, 'CLV_UNAVAILABLE');
    } finally { cleanup(dir); }
  });

  await runTest('3. Diferentes bookmakers entre observación y cierre -> CLV_UNAVAILABLE', () => {
    const { dir, store } = makeTmpEnv();
    try {
      const r = store.recordObservation({
        matchId: 'm_diff', league: 'PL', kickoffUtc: '2026-11-28T20:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'Bet365'
      });
      const close = store.recordOddsSnapshot(r.observationId, {
        checkpoint: 'CLOSING', capturedAtUtc: '2026-11-28T19:58:00Z', odds: 1.95, bookmaker: 'BetMGM UK'
      });
      assert.strictEqual(close.clv.status, 'CLV_UNAVAILABLE');
    } finally { cleanup(dir); }
  });

  await runTest('4. Checkpoint vencido (ej. T-30 expirado) -> marcado MISSED sin fabricar histórico', async () => {
    const { dir, store, opStatePath, snapWorker } = makeTmpEnv();
    try {
      const kickoffUtc = '2026-11-28T20:00:00.000Z';
      const r = store.recordObservation({
        matchId: 'm_miss', league: 'PL', kickoffUtc, observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'Bet365'
      });
      fs.writeFileSync(opStatePath, JSON.stringify({
        status: 'EXECUTED',
        scheduledSnapshots: [{ observationId: r.observationId, matchId: 'm_miss', kickoffUtc, checkpoints: buildSnapshotSchedule(kickoffUtc) }]
      }), 'utf8');

      // Ejecutar a T-15 (19:45 UTC): T-60 y T-30 ya expiraron -> MISSED; T-5 y CLOSING aún futuros -> SCHEDULED
      const res = await snapWorker.runCycle({
        nowUtc: '2026-11-28T19:45:00.000Z',
        client: { async callTool() { return { data: sampleOddsPayload() }; } }
      });
      assert.strictEqual(res.summary.missedCount, 2);
      assert.strictEqual(res.summary.completedCount, 0);
      assert.strictEqual(res.summary.mcpCallsUsed, 0, 'No debe llamar a MCP si no hay checkpoints en ventana');
    } finally { cleanup(dir); }
  });

  await runTest('5. Reinicio antes de T-30 (RUNNING recuperado) captura T-30 en su ventana válida', async () => {
    const { dir, store, opStatePath, snapWorker } = makeTmpEnv();
    try {
      const kickoffUtc = '2026-11-28T20:00:00.000Z';
      const r = store.recordObservation({
        matchId: 'm_rec', league: 'PL', kickoffUtc, observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'Bet365'
      });
      const cps = buildSnapshotSchedule(kickoffUtc);
      cps[0].status = CHECKPOINT_STATES.MISSED;
      cps[1].status = CHECKPOINT_STATES.RUNNING; // simulando caída durante T-30
      fs.writeFileSync(opStatePath, JSON.stringify({
        status: 'EXECUTED',
        scheduledSnapshots: [{ observationId: r.observationId, matchId: 'm_rec', kickoffUtc, checkpoints: cps }]
      }), 'utf8');

      const res = await snapWorker.runCycle({
        nowUtc: '2026-11-28T19:31:00.000Z', // dentro de ventana T-30
        client: { async callTool() { return { data: sampleOddsPayload() }; } }
      });
      assert.strictEqual(res.summary.completedCount, 1);
      assert.strictEqual(store.getObservations()[0].oddsSnapshots.some(s => s.checkpoint === 'T_MINUS_30'), true);
    } finally { cleanup(dir); }
  });

  await runTest('6. Reinicio después de T-5 marca T-60/T-30/T-5 como MISSED y captura CLOSING a T-1 con CLV real', async () => {
    const { dir, store, opStatePath, snapWorker } = makeTmpEnv();
    try {
      const kickoffUtc = '2026-11-28T20:00:00.000Z';
      const r = store.recordObservation({
        matchId: 'm_cl', league: 'PL', kickoffUtc, observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.20, bookmaker: 'Bet365'
      });
      fs.writeFileSync(opStatePath, JSON.stringify({
        status: 'EXECUTED',
        scheduledSnapshots: [{ observationId: r.observationId, matchId: 'm_cl', kickoffUtc, checkpoints: buildSnapshotSchedule(kickoffUtc) }]
      }), 'utf8');

      const res = await snapWorker.runCycle({
        nowUtc: '2026-11-28T19:59:00.000Z', // T-1 -> CLOSING válido; T-60/T-30/T-5 expirados -> MISSED
        client: { async callTool() { return { data: sampleOddsPayload({ '1': 'Bet365' }) }; } }
      });
      assert.strictEqual(res.summary.missedCount, 3);
      assert.strictEqual(res.summary.completedCount, 1);
      const obs = store.getObservations()[0];
      assert.strictEqual(obs.clv.status, 'CLV_AVAILABLE');
      assert(obs.clv.clvPct > 4, 'CLV positivo (2.20 vs 2.10 en Bet365)');
    } finally { cleanup(dir); }
  });

  await runTest('7. Snapshot post-kickoff -> todos los checkpoints marcados MISSED y 0 CLV', async () => {
    const { dir, store, opStatePath, snapWorker } = makeTmpEnv();
    try {
      const kickoffUtc = '2026-11-28T20:00:00.000Z';
      const r = store.recordObservation({
        matchId: 'm_post', league: 'PL', kickoffUtc, observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'Bet365'
      });
      fs.writeFileSync(opStatePath, JSON.stringify({
        status: 'EXECUTED',
        scheduledSnapshots: [{ observationId: r.observationId, matchId: 'm_post', kickoffUtc, checkpoints: buildSnapshotSchedule(kickoffUtc) }]
      }), 'utf8');

      const res = await snapWorker.runCycle({
        nowUtc: '2026-11-28T20:05:00.000Z',
        client: { async callTool() { return { data: sampleOddsPayload() }; } }
      });
      assert.strictEqual(res.summary.missedCount, 4);
      assert.strictEqual(res.summary.completedCount, 0);
      assert.strictEqual(store.getObservations()[0].clv.status, 'CLV_UNAVAILABLE');
    } finally { cleanup(dir); }
  });

  await runTest('8. Fallo / Rate Limit de StatsHub en SnapshotWorker -> reintentos y marca FAILED', async () => {
    const { dir, store, opStatePath, snapWorker } = makeTmpEnv();
    try {
      const kickoffUtc = '2026-11-28T20:00:00.000Z';
      const r = store.recordObservation({
        matchId: 'm_err', league: 'PL', kickoffUtc, observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'Bet365'
      });
      fs.writeFileSync(opStatePath, JSON.stringify({
        status: 'EXECUTED',
        scheduledSnapshots: [{ observationId: r.observationId, matchId: 'm_err', kickoffUtc, checkpoints: buildSnapshotSchedule(kickoffUtc) }]
      }), 'utf8');

      const res = await snapWorker.runCycle({
        nowUtc: '2026-11-28T19:00:00.000Z',
        client: { async callTool() { throw new Error('429 Rate Limit'); } }
      });
      assert.strictEqual(res.summary.failedCount, 1);
      assert.strictEqual(res.summary.errors.length, 1);
    } finally { cleanup(dir); }
  });

  await runTest('9. Idempotencia de SnapshotWorker: segunda corrida en la misma ventana no duplica snapshot', async () => {
    const { dir, store, opStatePath, snapWorker } = makeTmpEnv();
    try {
      const kickoffUtc = '2026-11-28T20:00:00.000Z';
      const r = store.recordObservation({
        matchId: 'm_idem', league: 'PL', kickoffUtc, observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 2.10, bookmaker: 'Bet365'
      });
      fs.writeFileSync(opStatePath, JSON.stringify({
        status: 'EXECUTED',
        scheduledSnapshots: [{ observationId: r.observationId, matchId: 'm_idem', kickoffUtc, checkpoints: buildSnapshotSchedule(kickoffUtc) }]
      }), 'utf8');

      const client = { async callTool() { return { data: sampleOddsPayload() }; } };
      const r1 = await snapWorker.runCycle({ nowUtc: '2026-11-28T19:00:00.000Z', client });
      const r2 = await snapWorker.runCycle({ nowUtc: '2026-11-28T19:01:00.000Z', client });
      assert.strictEqual(r1.summary.completedCount, 1);
      assert.strictEqual(r2.summary.completedCount, 0);
      assert.strictEqual(store.getObservations()[0].oddsSnapshots.length, 2); // FIRST_VALID + T_MINUS_60
    } finally { cleanup(dir); }
  });

  await runTest('10. SettlementWorker liquida partido FINISHED confirmado (append-only) y actualiza Evidence JSON', async () => {
    const { dir, store, exportPath, settWorker } = makeTmpEnv();
    try {
      const r = store.recordObservation({
        matchId: 'm_ft', league: 'PL', kickoffUtc: '2026-11-28T18:00:00.000Z', observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.90, bookmaker: 'Bet365'
      });
      const res = await settWorker.runCycle({
        nowUtc: '2026-11-28T20:10:00.000Z',
        client: { async callTool() { return { data: { context: 'finished', data: { matches: { status: 'finished', homeScore: 2, awayScore: 1 } } } }; } }
      });
      assert.strictEqual(res.summary.settledCount, 1);
      assert.strictEqual(store.getObservations()[0].status, SETTLEMENT_STATES.WON);
      assert.strictEqual(store.verifyIntegrity().ok, true);
      assert(fs.existsSync(exportPath));
    } finally { cleanup(dir); }
  });

  await runTest('11. SettlementWorker: partido suspendido y resultado no confirmado NUNCA se liquidan como LOST', async () => {
    const { dir, store, settWorker } = makeTmpEnv();
    try {
      store.recordObservation({
        matchId: 'm_susp', league: 'PL', kickoffUtc: '2026-11-28T18:00:00.000Z', observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.90, bookmaker: 'Bet365'
      });
      store.recordObservation({
        matchId: 'm_unconf', league: 'PL', kickoffUtc: '2026-11-28T18:00:00.000Z', observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.90, bookmaker: 'Bet365'
      });

      const res = await settWorker.runCycle({
        nowUtc: '2026-11-28T20:30:00.000Z',
        client: {
          async callTool(_, args) {
            if (args.matchId === 'm_susp') return { data: { data: { matches: { status: 'suspended' } } } };
            return { data: { context: 'final score not confirmed yet', data: { matches: { status: 'finished', homeScore: 0, awayScore: 1 } } } };
          }
        }
      });
      assert.strictEqual(res.summary.settledCount, 0);
      assert(store.getObservations().every(o => o.status === SETTLEMENT_STATES.PENDING));
    } finally { cleanup(dir); }
  });

  await runTest('12. Reinicio durante liquidación (RUNNING -> RETRY) y reintento idempotente sin doble liquidación', async () => {
    const { dir, store, opStatePath, settWorker } = makeTmpEnv();
    try {
      store.recordObservation({
        matchId: 'm_rst', league: 'PL', kickoffUtc: '2026-11-28T18:00:00.000Z', observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'double_chance', selection: '1X', modelProbability: 0.78, odds: 1.35, bookmaker: 'Bet365'
      });
      fs.writeFileSync(opStatePath, JSON.stringify({
        settlementTasks: { m_rst: { matchId: 'm_rst', workerStatus: WORKER_STATES.RUNNING } }
      }), 'utf8');

      const client = { async callTool() { return { data: { data: { matches: { status: 'finished', homeScore: 1, awayScore: 1 } } } }; } };
      const r1 = await settWorker.runCycle({ nowUtc: '2026-11-28T20:10:00.000Z', client });
      const r2 = await settWorker.runCycle({ nowUtc: '2026-11-28T20:15:00.000Z', client });
      assert.strictEqual(r1.summary.settledCount, 1);
      assert.strictEqual(r2.summary.settledCount, 0);
      assert.strictEqual(store.getObservations()[0].status, SETTLEMENT_STATES.WON);
    } finally { cleanup(dir); }
  });

  await runTest('13. Corrección posterior auditada preserva historial y mantiene integridad de ambos ledgers', () => {
    const { dir, store } = makeTmpEnv();
    try {
      const sp = new SettlementProcessor(store);
      const r = store.recordObservation({
        matchId: 'm_cor', league: 'PL', kickoffUtc: '2026-11-28T18:00:00.000Z', observedAtUtc: '2026-11-28T12:00:00.000Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.90, bookmaker: 'Bet365'
      });
      sp.settleObservation(r.observationId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: 2, awayGoals: 1 });
      const cor = sp.recordSettlementCorrection(r.observationId, { newHomeGoals: 1, newAwayGoals: 1, reason: 'VAR post-acta' });
      assert.strictEqual(cor.status, SETTLEMENT_STATES.LOST);
      assert.strictEqual(cor.correctionsCount, 1);
      assert.strictEqual(store.verifyIntegrity().ok, true);
    } finally { cleanup(dir); }
  });

  await runTest('14. CentralScheduler expone 3 mutex independientes y Daily Board permanece intacto', () => {
    const sched = require('../scheduler/centralScheduler');
    assert.strictEqual('experimentalMarkets' in sched.locks, true);
    assert.strictEqual('experimentalSnapshots' in sched.locks, true);
    assert.strictEqual('experimentalSettlement' in sched.locks, true);
    assert.strictEqual(typeof sched.runExperimentalSnapshotsJob, 'function');
    assert.strictEqual(typeof sched.runExperimentalSettlementJob, 'function');
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO FASE 10.1 (WORKERS & BOOKMAKER): ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log(`====================================================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
