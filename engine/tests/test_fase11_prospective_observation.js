/**
 * DARADORBET — TEST SUITE FASE 11: OBSERVACIÓN PROSPECTIVA Y RETO ESCALERA (15 ESCENARIOS)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ProspectiveObservationStore } = require('../experimental/prospective/prospectiveObservationStore');
const { ProspectiveLadderEngine } = require('../experimental/prospective/prospectiveLadderEngine');
const { ProspectiveAnalyticsExporter } = require('../experimental/prospective/prospectiveAnalyticsExporter');
const tracker = require('../prediction/observationTracker');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_f11_'));
  const store = new ProspectiveObservationStore({
    snapshotPath: path.join(dir, 'snaps.json'),
    settlementPath: path.join(dir, 'settles.json')
  });
  const ladder = new ProspectiveLadderEngine({ statePath: path.join(dir, 'ladder.json') });
  const exporter = new ProspectiveAnalyticsExporter({ store, ladder, exportPath: path.join(dir, 'export.json') });
  return { dir, store, ladder, exporter };
}

console.log('\n=== TEST SUITE FASE 11: OBSERVACIÓN PROSPECTIVA Y RETO ESCALERA (15 ESCENARIOS) ===\n');

const FUTURE_KO = '2026-11-26T20:00:00.000Z';
const DETECT_PRE = '2026-11-25T12:00:00.000Z';

test('1. Creación de snapshots prospectivos válidos', () => {
  const { store } = makeTmp();
  const s = store.recordSnapshot({
    opportunityKey: 'm1|Córners de equipo|Slavia|Más de 4.5',
    circuit: 'OPERATIVO',
    matchId: 'm1', match: 'Slavia vs Villarreal', competition: 'UCL',
    market: 'Córners de equipo', selection: 'Slavia', line: 'Más de 4.5',
    odds: 1.85, bookmaker: 'bet365', modelProbability: 0.68, expectedValuePct: 25.8,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO',
    detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO, lineupStatus: 'NO_APLICA'
  });
  assert.strictEqual(s.versionNumber, 1);
  assert.strictEqual(s.circuit, 'OPERATIVO');
  assert.ok(s.recordHash && s.recordHash.length === 64);
});

test('2. Inmutabilidad de snapshots originales', () => {
  const { store } = makeTmp();
  const v1 = store.recordSnapshot({
    opportunityKey: 'm1|Remates totales|Player A|Más de 0.5',
    circuit: 'SHADOW_OBSERVACION',
    match: 'Match 1', market: 'Remates totales', selection: 'Player A', line: 'Más de 0.5',
    odds: 1.60, detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO
  });
  const stored = store.getVersionsForKey('m1|Remates totales|Player A|Más de 0.5')[0];
  assert.strictEqual(stored.recordHash, v1.recordHash);
  assert.strictEqual(stored.odds, 1.60);
});

test('3. Versionado de cambios de cuota y línea sin sobrescribir', () => {
  const { store } = makeTmp();
  const key = 'm1|Córners de equipo|Slavia|Más de 4.5';
  const v1 = store.recordSnapshot({ opportunityKey: key, circuit: 'OPERATIVO', match: 'M1', market: 'Córners de equipo', selection: 'Slavia', line: 'Más de 4.5', odds: 1.85, detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  const v2 = store.recordSnapshot({ opportunityKey: key, circuit: 'OPERATIVO', match: 'M1', market: 'Córners de equipo', selection: 'Slavia', line: 'Más de 4.5', odds: 1.92, detectedAtUtc: '2026-11-25T15:00:00.000Z', kickoffUtc: FUTURE_KO });
  assert.strictEqual(v2.versionNumber, 2);
  assert.strictEqual(v2.previousVersionId, v1.snapshotId);
  assert.strictEqual(store.getVersionsForKey(key).length, 2);
});

test('4. Rechazo de eventos ya iniciados como nuevas oportunidades prepartido', () => {
  const { store } = makeTmp();
  assert.throws(() => {
    store.recordSnapshot({
      opportunityKey: 'm_live|Córners|A|+4.5', circuit: 'OPERATIVO',
      match: 'Live Match', market: 'Córners de equipo', odds: 1.8,
      detectedAtUtc: '2026-11-26T20:15:00.000Z', kickoffUtc: FUTURE_KO, matchStateAtEvaluation: 'LIVE'
    });
  }, /PROSPECTIVE_TEMPORAL_VIOLATION/);
});

test('5. Separación de los 4 circuitos (OPERATIVO, CONTRAFACTUAL, RETO_ESCALERA, SHADOW_OBSERVACION)', () => {
  const { store } = makeTmp();
  store.recordSnapshot({ opportunityKey: 'k1', circuit: 'OPERATIVO', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  store.recordSnapshot({ opportunityKey: 'k2', circuit: 'CONTRAFACTUAL', detectedAtUtc: '2026-11-26T21:00:00.000Z', kickoffUtc: FUTURE_KO, matchStateAtEvaluation: 'LIVE' });
  store.recordSnapshot({ opportunityKey: 'k3', circuit: 'RETO_ESCALERA', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  store.recordSnapshot({ opportunityKey: 'k4', circuit: 'SHADOW_OBSERVACION', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  const circuits = new Set(store.getAllSnapshots().map(s => s.circuit));
  assert.strictEqual(circuits.size, 4);
});

test('6. Bloqueo de aprobación contrafactual en circuito OPERATIVO', () => {
  const { store } = makeTmp();
  assert.throws(() => {
    store.recordSnapshot({
      opportunityKey: 'cf_leak', circuit: 'OPERATIVO', originCircuit: 'CONTRAFACTUAL',
      elenaDecision: 'COUNTERFACTUAL_APPROVED', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO
    });
  }, /CIRCUIT_ISOLATION_VIOLATION/);
});

test('7. Ingreso correcto a RETO ESCALERA con mercado permitido y bloqueo de excluidos', () => {
  const { ladder } = makeTmp();
  const rej = ladder.considerOpportunity({
    snapshotId: 's_excl', opportunityKey: 'k_excl', circuit: 'RETO_ESCALERA',
    match: 'M1', market: 'Remates al arco de equipo', selection: 'T1', odds: 1.7,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  assert.strictEqual(rej.entered, false);
  assert.ok(rej.reasons.some(r => r.includes('MARKET_EXCLUDED_LADDER')));

  const ok = ladder.considerOpportunity({
    snapshotId: 's_ok', opportunityKey: 'k_ok', circuit: 'RETO_ESCALERA',
    match: 'M2', market: 'Córners de equipo', selection: 'Slavia', odds: 1.50,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  assert.strictEqual(ok.entered, true);
  assert.strictEqual(ok.bet.stake, 50000);
  assert.strictEqual(ok.bet.potentialReturn, 75000);
});

test('8. Bloqueo de segunda apuesta abierta en RETO ESCALERA', () => {
  const { ladder } = makeTmp();
  ladder.considerOpportunity({
    snapshotId: 's1', opportunityKey: 'k1', circuit: 'RETO_ESCALERA',
    match: 'M1', market: 'Córners de equipo', selection: 'T1', odds: 1.40,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  const second = ladder.considerOpportunity({
    snapshotId: 's2', opportunityKey: 'k2', circuit: 'RETO_ESCALERA',
    match: 'M2', market: 'Remates totales', selection: 'P1', odds: 1.50,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO', lineupStatus: 'CONFIRMADA'
  });
  assert.strictEqual(second.entered, false);
  assert.ok(second.reasons.some(r => r.includes('OPEN_BET_LOCKED')));
});

test('9. Liquidación y liberación de capital (bloquea si no confirmado)', () => {
  const { ladder } = makeTmp();
  const { bet } = ladder.considerOpportunity({
    snapshotId: 's1', opportunityKey: 'k1', circuit: 'RETO_ESCALERA',
    match: 'M1', market: 'Córners de equipo', selection: 'T1', odds: 1.50,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  const unconf = ladder.settleOpenBet(bet.betId, { outcome: 'WON', confirmed: false });
  assert.strictEqual(unconf.settled, false);
  assert.strictEqual(ladder.getState().committedStake, 50000);

  const settled = ladder.settleOpenBet(bet.betId, { outcome: 'WON', confirmed: true });
  assert.strictEqual(settled.settled, true);
  assert.strictEqual(settled.state.openBet, null);
  assert.strictEqual(settled.state.committedStake, 0);
  assert.strictEqual(settled.state.currentCapital, 75000);
  assert.strictEqual(settled.state.currentStep, 2);
});

test('10. Idempotencia en liquidación prospectiva y de RETO ESCALERA', () => {
  const { store, ladder } = makeTmp();
  store.recordSnapshot({ opportunityKey: 'k_idemp', circuit: 'OPERATIVO', match: 'M1', market: 'Córners de equipo', odds: 1.80, detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  const a1 = store.settleOpportunity('k_idemp', { outcome: 'WON', confirmed: true });
  const a2 = store.settleOpportunity('k_idemp', { outcome: 'WON', confirmed: true });
  assert.strictEqual(a1.duplicate, false);
  assert.strictEqual(a2.duplicate, true);
  assert.strictEqual(store.getAllSettlements().length, 1);

  const { bet } = ladder.considerOpportunity({
    snapshotId: 's1', opportunityKey: 'k1', circuit: 'RETO_ESCALERA',
    match: 'M1', market: 'Córners de equipo', selection: 'T1', odds: 1.50,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  const l1 = ladder.settleOpenBet(bet.betId, { outcome: 'WON', confirmed: true });
  const l2 = ladder.settleOpenBet(bet.betId, { outcome: 'WON', confirmed: true });
  assert.strictEqual(l1.duplicate, false);
  assert.strictEqual(l2.duplicate, true);
});

test('11. Cálculo de ROI y métricas de calibración (Brier y Log Loss)', () => {
  const { store, exporter } = makeTmp();
  store.recordSnapshot({ opportunityKey: 'k1', circuit: 'OPERATIVO', match: 'M1', market: 'Remates totales', odds: 2.0, modelProbability: 0.70, elenaDecision: 'APROBADO', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  store.settleOpportunity('k1', { outcome: 'WON', confirmed: true });
  const out = exporter.export();
  assert.strictEqual(out.summary.hitRatePct, 100);
  assert.strictEqual(out.summary.roiPct, 100);
  assert.strictEqual(typeof out.summary.brierScore, 'number');
  assert.strictEqual(typeof out.summary.logLoss, 'number');
});

test('12. Separación entre replay histórico (+205.480,31) y simulación prospectiva ($50.000 inicial)', () => {
  const { exporter } = makeTmp();
  const out = exporter.export();
  assert.strictEqual(out.prospectiveLadder.currentCapital, 50000);
  assert.strictEqual(out.prospectiveLadder.cumulativeProfit, 0);
  assert.ok(out.historicalReplayReference.label.includes('NO SUMADO'));
});

test('13. Integridad de cadena SHA-256 en store prospectivo', () => {
  const { store } = makeTmp();
  store.recordSnapshot({ opportunityKey: 'k1', circuit: 'OPERATIVO', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  store.recordSnapshot({ opportunityKey: 'k2', circuit: 'SHADOW_OBSERVACION', detectedAtUtc: DETECT_PRE, kickoffUtc: FUTURE_KO });
  const chain = store.verifyChain();
  assert.strictEqual(chain.ok, true);
  assert.strictEqual(chain.totalSnapshots, 2);
});

test('14. Protección de los 101 hashes SHA-256 históricos sellados', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0);
  assert.strictEqual(audit.violations.length, 0);
  assert.strictEqual(audit.intactCount, 101);
});

test('15. Exclusión de registros CONTRAFACTUALES en métricas prospectivas', () => {
  const { store, exporter } = makeTmp();
  store.recordSnapshot({ opportunityKey: 'k_cf', circuit: 'CONTRAFACTUAL', odds: 2.0, detectedAtUtc: '2026-11-26T21:00:00.000Z', kickoffUtc: FUTURE_KO, matchStateAtEvaluation: 'FINISHED' });
  const out = exporter.export();
  assert.strictEqual(out.summary.detectedCount, 0);
});

console.log(`\n=== RESULTADO FASE 11: ${passed} PASS | ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);
