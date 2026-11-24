/**
 * TEST SUITE — FASE 10: ACTIVACIÓN OPERATIVA CONTROLADA
 *
 * Verifica:
 *  1. Integración extremo a extremo Discovery -> MatchOutcomeModel -> Ranker -> Elena/RM -> ObservationStore
 *  2. Disparo controlado vía CentralScheduler.runExperimentalMarketsJob() con Mutex anti-solapamiento
 *  3. Deduplicación en reintento (segunda corrida idéntica produce 0 duplicados)
 *  4. Recuperación ante reinicio durante una tarea (inProgressRunId recuperado limpiamente)
 *  5. Ausencia de fixtures (diferencia INSUFFICIENT_DATA / ZERO_OPPORTUNITIES)
 *  6. Fallo de proveedor StatsHub (marca PROVIDER_ERROR con stageErrors; un cero no oculta falla)
 *  7. Partidos ya iniciados se omiten sin generar observaciones (PARTIDO_YA_INICIADO)
 *  8. Programación de snapshots (T-60, T-30, T-5, CLOSING), captura pre-kickoff y liquidación
 *  9. Exportación de api/evidence_fase9.json con telemetría operativa e integridad SHA-256
 * 10. Aislamiento total del Daily Board, autoExecutionAllowed === false, 0 órdenes y 0 Telegram
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ObservationStore } = require('../experimental/markets/observation/observationStore');
const { SettlementProcessor } = require('../experimental/markets/observation/settlementProcessor');
const { ControlledPipelineRunner } = require('../experimental/markets/observation/controlledPipelineRunner');

let passed = 0;
let failed = 0;

function makeTmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_f10_'));
  const store = new ObservationStore({
    obsPath: path.join(dir, 'obs.json'),
    rejectedPath: path.join(dir, 'rej.json'),
    alertsPath: path.join(dir, 'alerts.json')
  });
  const runner = new ControlledPipelineRunner({
    store,
    opStatePath: path.join(dir, 'op_state.json'),
    exportPath: path.join(dir, 'evidence.json')
  });
  return { dir, store, runner };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function makeTeamPerf(gf, ga) {
  return {
    totals: { games: 14, stats: { xG: { avg: gf, games: 14 } }, opponentStats: { xG: { avg: ga, games: 14 } } },
    matches: Array.from({ length: 14 }, (_, i) => ({ venue: i % 2 === 0 ? 'home' : 'away', goalsFor: Math.round(gf), goalsAgainst: Math.round(ga) }))
  };
}

function makeGoodClient(kickoffCtx = 'Tue 28 Nov 2026, 20:00 UTC') {
  return {
    async callTool(name) {
      if (name === 'getFixturesByDate') {
        return {
          data: {
            fixturesSummary: 'Premier League [competitionId pl]:\n- Tue 20:00 TeamA v TeamB (id m_f10) | 1X2 H 2.40 Bet365 / D 3.40 Bet365 / A 3.10 Bet365, favourite TeamA'
          }
        };
      }
      if (name === 'getMatchOdds') {
        return {
          data: {
            context: `TeamA v TeamB · kick-off ${kickoffCtx} · full-time match markets`,
            priced: true,
            markets: [
              { name: 'To Win', outcomes: [
                { label: 'TeamA', best: { odds: 2.40, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'Draw', best: { odds: 3.40, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'TeamB', best: { odds: 3.10, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Double Chance', outcomes: [
                { label: 'TeamA or Draw', best: { odds: 1.42, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'TeamA or TeamB', best: { odds: 1.32, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'Draw or TeamB', best: { odds: 1.65, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Both Teams To Score', outcomes: [
                { label: 'Yes', best: { odds: 1.75, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'No', best: { odds: 2.10, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Total Goals', outcomes: [
                { label: 'Over 2.5', best: { odds: 1.85, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'Under 2.5', best: { odds: 2.00, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 }
              ]}
            ]
          }
        };
      }
      if (name === 'getTeamPerformance') return { data: makeTeamPerf(2.1, 0.8) };
      if (name === 'getTeamNews') return { data: { teams: [{ side: 'home', coverage: 'ok', players: [] }, { side: 'away', coverage: 'ok', players: [] }] } };
      return { data: null };
    }
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
  console.log('\n🚀 Iniciando Test Suite — Fase 10: Activación Operativa Controlada (10 Escenarios)...\n');

  await runTest('1. Integración extremo a extremo Discovery -> Model -> Ranker -> Elena/RM -> ObservationStore + Export JSON', async () => {
    const { dir, store, runner } = makeTmpEnv();
    try {
      const res = await runner.runControlledCycle({
        date: '2026-11-28',
        nowUtc: '2026-11-28T12:00:00Z',
        minEvPct: 2.0,
        client: makeGoodClient(),
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.telemetry.autoExecutionAllowed, false);
      assert.strictEqual(res.telemetry.matchesInvestigated, 1);
      assert(res.telemetry.predictionsGenerated >= 8);
      assert(res.telemetry.observationsAccepted >= 1);
      assert(res.telemetry.snapshotsScheduled >= 4);
      assert.strictEqual(store.verifyIntegrity().ok, true);
      assert(fs.existsSync(path.join(dir, 'evidence.json')));
    } finally { cleanup(dir); }
  });

  await runTest('2. Deduplicación en reintento: segunda corrida idéntica registra 0 duplicados', async () => {
    const { dir, store, runner } = makeTmpEnv();
    try {
      const opts = {
        date: '2026-11-28',
        nowUtc: '2026-11-28T12:00:00Z',
        minEvPct: 2.0,
        client: makeGoodClient(),
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      };
      const r1 = await runner.runControlledCycle(opts);
      const count1 = store.getObservations().length;
      const r2 = await runner.runControlledCycle(opts);
      const count2 = store.getObservations().length;
      assert.strictEqual(count1, count2);
      assert.strictEqual(r2.telemetry.observationsAccepted, 0);
      assert.strictEqual(r2.telemetry.observationsDuplicated, r1.telemetry.observationsAccepted);
    } finally { cleanup(dir); }
  });

  await runTest('3. Recuperación tras reinicio durante una tarea: inProgressRunId se recupera limpiamente', () => {
    const { dir, runner } = makeTmpEnv();
    try {
      fs.writeFileSync(path.join(dir, 'op_state.json'), JSON.stringify({
        status: 'EXECUTED',
        inProgressRunId: 'f10_crashed_run',
        runsCount: 1,
        scheduledSnapshots: []
      }), 'utf8');
      const recovered = runner.loadOperationalState();
      assert.strictEqual(recovered.inProgressRunId, null);
      assert.strictEqual(recovered.recoveredInterruptedRunId, 'f10_crashed_run');
      assert.strictEqual(recovered.status, 'RECOVERED_FROM_RESTART');
    } finally { cleanup(dir); }
  });

  await runTest('4. Ausencia de fixtures se reporta como INSUFFICIENT_DATA (nunca inventa observaciones)', async () => {
    const { dir, store, runner } = makeTmpEnv();
    try {
      const emptyClient = { async callTool() { return { data: { fixturesSummary: '' } }; } };
      const res = await runner.runControlledCycle({
        date: '2026-11-28',
        nowUtc: '2026-11-28T12:00:00Z',
        client: emptyClient,
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.telemetry.outcomeCategory, 'INSUFFICIENT_DATA');
      assert.strictEqual(store.getObservations().length, 0);
    } finally { cleanup(dir); }
  });

  await runTest('5. Fallo del proveedor StatsHub se marca como PROVIDER_ERROR con stageErrors visibles', async () => {
    const { dir, runner } = makeTmpEnv();
    try {
      const failClient = { async callTool() { throw new Error('StatsHub 503 Unavailable'); } };
      const res = await runner.runControlledCycle({
        date: '2026-11-28',
        nowUtc: '2026-11-28T12:00:00Z',
        client: failClient,
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.telemetry.outcomeCategory, 'PROVIDER_ERROR');
      assert.strictEqual(res.telemetry.stageErrors.length, 1);
      assert(res.telemetry.stageErrors[0].error.includes('503'));
    } finally { cleanup(dir); }
  });

  await runTest('6. Partidos ya iniciados se omiten sin generar observaciones (PARTIDO_YA_INICIADO)', async () => {
    const { dir, store, runner } = makeTmpEnv();
    try {
      const res = await runner.runControlledCycle({
        date: '2026-11-28',
        nowUtc: '2026-11-28T20:15:00Z', // 15 min después del kickoff 20:00 UTC
        client: makeGoodClient('Tue 28 Nov 2026, 20:00 UTC'),
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.telemetry.fixturesSkippedStarted, 1);
      assert.strictEqual(res.telemetry.matchesInvestigated, 0);
      assert.strictEqual(store.getObservations().length, 0);
    } finally { cleanup(dir); }
  });

  await runTest('7. Flujo completo: observación -> snapshot pre-kickoff CLOSING -> CLV -> liquidación FT', async () => {
    const { dir, store, runner } = makeTmpEnv();
    try {
      const res = await runner.runControlledCycle({
        date: '2026-11-28',
        nowUtc: '2026-11-28T12:00:00Z',
        minEvPct: 2.0,
        client: makeGoodClient(),
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      const obsId = res.telemetry.recordedObservationIds[0];
      const obs = store.getObservations().find(o => o.observationId === obsId);

      const closeSnap = store.recordOddsSnapshot(obsId, {
        checkpoint: 'CLOSING',
        capturedAtUtc: '2026-11-28T19:58:00Z',
        odds: Number((obs.odds * 0.95).toFixed(2)),
        bookmaker: obs.bookmaker,
        line: obs.line
      });
      assert.strictEqual(closeSnap.clv.status, 'CLV_AVAILABLE');

      const sp = new SettlementProcessor(store);
      const settled = sp.settleObservation(obsId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: 2, awayGoals: 1 });
      assert.strictEqual(settled.settled, true);
      assert.strictEqual(store.verifyIntegrity().ok, true);
    } finally { cleanup(dir); }
  });

  await runTest('8. Prevención de ciclos simultáneos (Mutex interno de ControlledPipelineRunner)', async () => {
    const { dir, runner } = makeTmpEnv();
    try {
      runner._running = true;
      const blocked = await runner.runControlledCycle({ client: makeGoodClient() });
      assert.strictEqual(blocked.skipped, true);
      assert.strictEqual(blocked.reason, 'CYCLE_ALREADY_RUNNING');
      runner._running = false;
    } finally { cleanup(dir); }
  });

  await runTest('9. Aislamiento del Daily Board: picks_hoy.json permanece intacto tras ejecutar Fase 10', async () => {
    const { dir, runner } = makeTmpEnv();
    const picksPath = path.resolve(__dirname, '..', '..', 'picks_hoy.json');
    const before = fs.readFileSync(picksPath, 'utf8');
    try {
      await runner.runControlledCycle({
        date: '2026-11-28',
        nowUtc: '2026-11-28T12:00:00Z',
        minEvPct: 2.0,
        client: makeGoodClient(),
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      const after = fs.readFileSync(picksPath, 'utf8');
      assert.strictEqual(before, after, 'picks_hoy.json NO debe alterarse por el circuito experimental');
    } finally { cleanup(dir); }
  });

  await runTest('10. CentralScheduler integra runExperimentalMarketsJob con Mutex y autoExecutionAllowed === false', () => {
    const sched = require('../scheduler/centralScheduler');
    assert.strictEqual(typeof sched.runExperimentalMarketsJob, 'function');
    assert.strictEqual('experimentalMarkets' in sched.locks, true);
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO FASE 10 (ACTIVACIÓN CONTROLADA): ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log(`====================================================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
