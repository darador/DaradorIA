/**
 * DARADORBET — SUITE DE 12 TESTS OBLIGATORIOS: CIRCUITO CONTRAFACTUAL DE ELENA
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { CounterfactualStore } = require('../experimental/counterfactual/counterfactualStore');
const { CounterfactualElenaEngine, CIRCUIT_STATES } = require('../experimental/counterfactual/counterfactualElenaEngine');
const storage = require('../data/storage');
const tracker = require('../prediction/observationTracker');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

function makeTempEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_cf_'));
  const store = new CounterfactualStore({
    ledgerPath: path.join(dir, 'cf_ledger.json'),
    settlementPath: path.join(dir, 'cf_settlements.json')
  });
  const engine = new CounterfactualElenaEngine({
    store,
    exportPath: path.join(dir, 'cf_export.json')
  });
  return { dir, store, engine };
}

(async () => {
  console.log('\n=== TEST SUITE: EVALUACIONES CONTRAFACTUALES DE ELENA (12 ESCENARIOS) ===\n');

  const KICKOFF_ISO = '2026-11-24T17:45:00.000Z';
  const KICKOFF_TS = new Date(KICKOFF_ISO).getTime();

  // 1. Elena puede evaluar una selección con partido en curso
  await test('1. Elena puede evaluar una selección con partido EN CURSO (LIVE)', async () => {
    const { engine } = makeTempEngine();
    const pick = {
      id: 'cf_test_live_1',
      match: 'Real Madrid vs PSV Eindhoven',
      league: 'UEFA Champions League',
      player: 'Sven Mijnans',
      market: 'Remates totales',
      line: 'Más de 1.5',
      odds: 2.10,
      real_prob: 56.0, // EV = +17.6%
      sample_size: 16,
      eventDateUtc: KICKOFF_ISO
    };
    const rec = engine.evaluateCounterfactual(pick, { now: KICKOFF_TS + 25 * 60 * 1000 });
    assert.strictEqual(rec.matchStateAtEvaluation, 'LIVE');
    assert.strictEqual(rec.decision, CIRCUIT_STATES.COUNTERFACTUAL.APPROVED);
    assert.strictEqual(rec.autoExecutionAllowed, false);
    assert.strictEqual(rec.circuit, 'COUNTERFACTUAL');
    assert.strictEqual(rec.availableDataSnapshot.t60LineupAvailable, false);
  });

  // 2. Elena puede evaluar una selección con partido finalizado
  await test('2. Elena puede evaluar una selección con partido FINALIZADO (FINISHED)', async () => {
    const { engine } = makeTempEngine();
    const pick = {
      id: 'cf_test_fin_1',
      match: 'Galatasaray vs Aston Villa',
      league: 'UEFA Champions League',
      player: 'Aaron Wan-Bissaka',
      market: 'Entradas (Tackles)',
      line: 'Más de 1.5',
      odds: 1.60,
      real_prob: 65.3, // EV = +4.48% < 7% -> REJECTED
      sample_size: 20,
      eventDateUtc: KICKOFF_ISO
    };
    const rec = engine.evaluateCounterfactual(pick, { now: KICKOFF_TS + 150 * 60 * 1000 });
    assert.strictEqual(rec.matchStateAtEvaluation, 'FINISHED');
    assert.strictEqual(rec.decision, CIRCUIT_STATES.COUNTERFACTUAL.REJECTED);
    assert.ok(rec.decisionReasons[0].includes('VETO MATEMÁTICO CONTRAFACTUAL'));
  });

  // 3. Elena no puede convertir una evaluación contrafactual en aprobación prepartido
  await test('3. Evaluación contrafactual jamás se convierte en aprobación prepartido', async () => {
    const { engine } = makeTempEngine();
    const pick = {
      id: 'cf_test_no_prematch',
      match: 'Arsenal vs Dortmund',
      player: 'Gabriel Magalhães',
      market: 'Faltas',
      line: 'Más de 0.5',
      odds: 1.95,
      real_prob: 62.0,
      sample_size: 18,
      eventDateUtc: KICKOFF_ISO
    };
    const rec = engine.evaluateCounterfactual(pick, { now: KICKOFF_TS + 40 * 60 * 1000 });
    assert.strictEqual(rec.decision, 'COUNTERFACTUAL_APPROVED');
    assert.notStrictEqual(rec.decision, 'APROBADO');
    assert.notStrictEqual(rec.decision, 'PREMATCH_APPROVED');
  });

  // 4. Una selección contrafactual no puede ingresar a saveApprovedPick()
  await test('4. Una selección contrafactual no puede ingresar a storage.saveApprovedPick()', async () => {
    const cfPick = {
      id: 'cf_test_blocked_approved',
      circuit: 'COUNTERFACTUAL',
      status: 'COUNTERFACTUAL_APPROVED',
      eventDateUtc: KICKOFF_ISO
    };
    let blocked = false;
    try {
      storage.saveApprovedPick(cfPick, { now: KICKOFF_TS - 3600000 });
    } catch (e) {
      blocked = e.message.includes('COUNTERFACTUAL_ISOLATION_BLOCKED');
    }
    assert.strictEqual(blocked, true);
  });

  // 5. Una selección contrafactual no modifica bankroll ni capital
  await test('5. Una selección contrafactual no modifica bankroll, approved_picks ni capital', async () => {
    const approvedBefore = fs.readFileSync(path.join(__dirname, '..', 'storage_data', 'approved_picks.json'), 'utf8');
    const historialBefore = fs.readFileSync(path.join(__dirname, '..', '..', 'historial_picks.json'), 'utf8');
    const { engine } = makeTempEngine();
    engine.evaluateCounterfactual({
      id: 'cf_test_bankroll',
      match: 'Test Match',
      player: 'Test Player',
      market: 'Remates',
      line: 'Más de 1.5',
      odds: 2.0,
      real_prob: 60,
      sample_size: 15,
      eventDateUtc: KICKOFF_ISO
    }, { now: KICKOFF_TS + 30 * 60 * 1000 });
    const approvedAfter = fs.readFileSync(path.join(__dirname, '..', 'storage_data', 'approved_picks.json'), 'utf8');
    const historialAfter = fs.readFileSync(path.join(__dirname, '..', '..', 'historial_picks.json'), 'utf8');
    assert.strictEqual(approvedBefore, approvedAfter);
    assert.strictEqual(historialBefore, historialAfter);
  });

  // 6. No ingresa en ROI/Yield operativo
  await test('6. No ingresa en ROI/Yield operativo (api/metrics.json inalterado)', async () => {
    const metricsPath = path.join(__dirname, '..', '..', 'api', 'metrics.json');
    const before = fs.readFileSync(metricsPath, 'utf8');
    const { engine } = makeTempEngine();
    const rec = engine.evaluateCounterfactual({
      id: 'cf_test_roi_iso',
      match: 'Test Match',
      player: 'Test Player',
      market: 'Remates',
      line: 'Más de 1.5',
      odds: 2.2,
      real_prob: 55,
      sample_size: 15,
      eventDateUtc: KICKOFF_ISO
    }, { now: KICKOFF_TS + 130 * 60 * 1000 });
    engine.settleCounterfactual(rec.evaluationId, { matchStatus: 'FINISHED', confirmed: true, outcome: 'WON', actualStat: 3 });
    const after = fs.readFileSync(metricsPath, 'utf8');
    assert.strictEqual(before, after);
  });

  // 7. Se liquida virtualmente solo después de FINISHED confirmado
  await test('7. Liquidación virtual bloqueada antes de FINISHED confirmado y permitida tras FINISHED', async () => {
    const { engine } = makeTempEngine();
    const rec = engine.evaluateCounterfactual({
      id: 'cf_test_settle_guard',
      match: 'Test Match',
      player: 'Test Player',
      market: 'Remates',
      line: 'Más de 1.5',
      odds: 2.0,
      real_prob: 60,
      sample_size: 15,
      eventDateUtc: KICKOFF_ISO
    }, { now: KICKOFF_TS + 30 * 60 * 1000 });

    const rLive = engine.settleCounterfactual(rec.evaluationId, { matchStatus: 'LIVE', confirmed: false, outcome: 'WON' });
    assert.strictEqual(rLive.settled, false);

    const rUnconf = engine.settleCounterfactual(rec.evaluationId, { matchStatus: 'FINISHED', confirmed: false, outcome: 'WON' });
    assert.strictEqual(rUnconf.settled, false);

    const rFin = engine.settleCounterfactual(rec.evaluationId, { matchStatus: 'FINISHED', confirmed: true, outcome: 'WON', actualStat: 2 });
    assert.strictEqual(rFin.settled, true);
    assert.strictEqual(rFin.record.status, CIRCUIT_STATES.COUNTERFACTUAL.WON);
    assert.strictEqual(rFin.record.profitVirtual, 1.0);
  });

  // 8. Una liquidación repetida no duplica resultados (idempotencia)
  await test('8. Liquidación repetida es idempotente y no duplica resultados', async () => {
    const { engine, store } = makeTempEngine();
    const rec = engine.evaluateCounterfactual({
      id: 'cf_test_idemp',
      match: 'Test Match',
      player: 'Test Player',
      market: 'Remates',
      line: 'Más de 1.5',
      odds: 2.0,
      real_prob: 60,
      sample_size: 15,
      eventDateUtc: KICKOFF_ISO
    }, { now: KICKOFF_TS + 130 * 60 * 1000 });

    const s1 = engine.settleCounterfactual(rec.evaluationId, { matchStatus: 'FINISHED', confirmed: true, outcome: 'LOST', actualStat: 0 });
    const s2 = engine.settleCounterfactual(rec.evaluationId, { matchStatus: 'FINISHED', confirmed: true, outcome: 'LOST', actualStat: 0 });
    assert.strictEqual(s1.duplicate, false);
    assert.strictEqual(s2.duplicate, true);
    assert.strictEqual(store.getAllSettlements().length, 1);
  });

  // 9. Datos insuficientes generan INSUFFICIENT_DATA
  await test('9. Datos insuficientes generan INSUFFICIENT_DATA', async () => {
    const { engine } = makeTempEngine();
    const rec = engine.evaluateCounterfactual({
      id: 'cf_test_insuff',
      match: 'Test Match',
      player: 'Jugador Sin Datos',
      market: 'Remates',
      line: 'Más de 1.5',
      odds: null,
      real_prob: null,
      eventDateUtc: KICKOFF_ISO
    }, { now: KICKOFF_TS + 40 * 60 * 1000 });
    assert.strictEqual(rec.decision, CIRCUIT_STATES.COUNTERFACTUAL.REJECTED);
    assert.strictEqual(rec.dataSufficiency, 'INSUFFICIENT_DATA');
  });

  // 10. Una nueva evaluación crea una versión y conserva la anterior (append-only + SHA-256 chain)
  await test('10. Nueva evaluación crea nueva versión vinculada y conserva la anterior con cadena SHA-256 válida', async () => {
    const { engine, store } = makeTempEngine();
    const basePick = {
      id: 'cf_test_versioned',
      match: 'Test Match',
      player: 'Jugador V',
      market: 'Remates',
      line: 'Más de 1.5',
      odds: 1.70,
      real_prob: 60, // EV = +2% -> REJECTED
      sample_size: 15,
      eventDateUtc: KICKOFF_ISO
    };
    const v1 = engine.evaluateCounterfactual(basePick, { now: KICKOFF_TS + 15 * 60 * 1000 });
    const v2 = engine.evaluateCounterfactual({ ...basePick, odds: 2.0 }, { now: KICKOFF_TS + 35 * 60 * 1000 });
    assert.strictEqual(v1.versionNumber, 1);
    assert.strictEqual(v2.versionNumber, 2);
    assert.strictEqual(v2.previousVersionId, v1.evaluationId);
    assert.strictEqual(store.getVersionsForPick('cf_test_versioned').length, 2);
    const chain = store.verifyChain();
    assert.strictEqual(chain.ok, true);
    assert.strictEqual(chain.totalRecords, 2);
  });

  // 11. No se mezclan métricas reales y contrafactuales
  await test('11. Métricas virtuales independientes con advertencia de muestra pequeña', async () => {
    const { engine } = makeTempEngine();
    const r1 = engine.evaluateCounterfactual({
      id: 'cf_m1', match: 'M1', league: 'UCL', player: 'P1', market: 'Remates', line: '+1.5',
      odds: 2.0, real_prob: 60, sample_size: 15, eventDateUtc: KICKOFF_ISO
    }, { now: KICKOFF_TS + 130 * 60 * 1000 });
    engine.settleCounterfactual(r1.evaluationId, { matchStatus: 'FINISHED', confirmed: true, outcome: 'WON' });

    const metrics = engine.computeVirtualMetrics();
    assert.strictEqual(metrics.circuit, 'COUNTERFACTUAL_RESEARCH_ONLY');
    assert.strictEqual(metrics.totalEvaluated, 1);
    assert.strictEqual(metrics.totalApproved, 1);
    assert.strictEqual(metrics.totalSettled, 1);
    assert.strictEqual(metrics.hitRatePct, 100);
    assert.strictEqual(metrics.virtualRoiPct, 100);
    assert.strictEqual(typeof metrics.brierScore, 'number');
    assert.strictEqual(typeof metrics.logLoss, 'number');
    assert.strictEqual(metrics.sampleSizeConclusive, false);
    assert.ok(metrics.statisticalWarning.includes('No concluyente'));
  });

  // 12. Los 101 hashes históricos permanecen intactos
  await test('12. Los 101 hashes SHA-256 históricos permanecen intactos', async () => {
    const audit = tracker.verifyIntegrity();
    assert.strictEqual(audit.alteredCount, 0);
    assert.strictEqual(audit.violations.length, 0);
    assert.strictEqual(audit.intactCount, 101);
  });

  console.log(`\n=== RESULTADO CONTRAFACTUAL: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
