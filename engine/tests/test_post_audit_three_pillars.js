/**
 * DARADORBET — TEST SUITE: 3 PILARES POST-AUDITORÍA
 * 1. Liquidación contrafactual de rechazos y Discovery (idempotencia, SHA-256, sin datos inventados).
 * 2. Auditoría de calibración de mercados (ECE, Brier, LogLoss, Team vs Player Props).
 * 3. RETO ESCALERA en simulación controlada (solo mercados calibrados, simulationOnly=true, realCapitalAllowed=false).
 * 4. Integridad de los 101 hashes SHA-256 históricos intactos.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { RejectedDiscoveryCounterfactualRunner } = require('../experimental/counterfactual/rejectedDiscoveryCounterfactualRunner');
const { MarketCalibrationAuditor } = require('../experimental/calibration/marketCalibrationAuditor');
const { LadderSimulationEngine } = require('../experimental/ladder/ladderSimulationEngine');
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

console.log('\n=== TEST SUITE: FASE POST-AUDITORÍA (3 PILARES) ===\n');

test('1. Fase 1: Runner de rechazos y Discovery es idempotente, append-only y con cadena SHA-256 válida', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_p1_'));
  const runner = new RejectedDiscoveryCounterfactualRunner({
    ledgerPath: path.join(dir, 'ledger.json'),
    settlementPath: path.join(dir, 'settlements.json'),
    exportPath: path.join(dir, 'export.json')
  });
  const r1 = runner.run();
  assert.strictEqual(r1.autoExecutionAllowed, false);
  assert.strictEqual(r1.operationalIsolation, true);
  assert.strictEqual(r1.integrity.ok, true);
  assert.ok(r1.summary.totalIdentified > 0);
  assert.strictEqual(r1.summary.appendedNew, r1.summary.totalIdentified);

  // Segunda corrida: 100% idempotente
  const r2 = runner.run();
  assert.strictEqual(r2.summary.appendedNew, 0);
  assert.strictEqual(r2.summary.skippedDuplicate, r1.summary.totalIdentified);
  assert.strictEqual(r2.integrity.ok, true);
});

test('2. Fase 2: Auditor de calibración separa TEAM_PROPS vs PLAYER_PROPS y detecta penalizaciones de Log Loss', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_p2_'));
  const auditor = new MarketCalibrationAuditor({ exportPath: path.join(dir, 'cal.json') });
  const rep = auditor.run();
  assert.strictEqual(rep.mode, 'READ_ONLY_CALIBRATION_AUDIT');
  assert.ok(rep.overall.n > 0);
  assert.ok(rep.byGroup.TEAM_PROPS.n > 0);
  assert.ok(rep.byGroup.PLAYER_PROPS.n > 0);
  assert.ok(typeof rep.byGroup.TEAM_PROPS.ece === 'number');
  assert.ok(Array.isArray(rep.worstLogLossPenalties));
});

test('3. Fase 3: RETO ESCALERA en simulación bloquea mercados no calibrados y prohíbe capital real', () => {
  const sim = new LadderSimulationEngine({ initialCapital: 50000, targetSteps: 3 });
  assert.strictEqual(sim.isEligible({ market: 'Remates totales', odds: 1.70 }), true);
  assert.strictEqual(sim.isEligible({ market: 'Córners de equipo', odds: 1.65 }), true);
  assert.strictEqual(sim.isEligible({ market: 'Remates al arco de equipo', odds: 1.70 }), false);
  assert.strictEqual(sim.isEligible({ market: 'Goles de equipo', odds: 1.60 }), false);

  const out = sim.simulate([
    { id: '1', date: '2026-11-20', market: 'Remates totales', odds: 1.50, status: 'ACERTADA' },
    { id: '2', date: '2026-11-21', market: 'Remates al arco de equipo', odds: 1.80, status: 'FALLADA' }, // excluido
    { id: '3', date: '2026-11-22', market: 'Córners de equipo', odds: 1.60, status: 'ANULADA_NO_TITULAR' }, // void preserva capital
    { id: '4', date: '2026-11-23', market: 'Córners de equipo', odds: 2.00, status: 'ACERTADA' },
    { id: '5', date: '2026-11-24', market: 'Remates totales', odds: 1.50, status: 'ACERTADA' }
  ]);
  assert.strictEqual(out.simulationOnly, true);
  assert.strictEqual(out.realCapitalAllowed, false);
  assert.strictEqual(out.autoExecutionAllowed, false);
  assert.strictEqual(out.summary.eligiblePicksReplayed, 4);
  assert.strictEqual(out.summary.voidSteps, 1);
  assert.strictEqual(out.summary.cyclesCompleted, 1);
  assert.strictEqual(out.summary.totalSimulatedReturned, 225000); // 50000 * 1.5 * 2.0 * 1.5
});

test('4. Integridad de los 101 hashes SHA-256 históricos intactos', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0);
  assert.strictEqual(audit.violations.length, 0);
  assert.strictEqual(audit.intactCount, 101);
});

console.log(`\n=== RESULTADO POST-AUDITORÍA: ${passed} PASS | ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);
