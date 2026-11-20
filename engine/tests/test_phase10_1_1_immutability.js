/**
 * TEST DE VERIFICACIÓN FASE 10.1.1: AUDITORÍA DE INMUTABILIDAD Y RECONCILIACIÓN MATEMÁTICA
 * Valida:
 * 1. Límites exactos de los intervalos de calibración (Boundary tests, intervalos semi-abiertos [a, b)).
 * 2. Consistencia y suma exhaustiva de los denominadores (N=18 para Modelo B y Modelo C).
 * 3. Inmutabilidad histórica de las probabilidades congeladas (Bruno Gomes, Bragantino córners, Internacional, USM Alger).
 * 4. Reconciliación total del universo de 42 candidatos sin duplicados ni estados ambiguos.
 * 5. Escenario contrafactual diferenciado de descartes reales.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tracker = require('../prediction/observationTracker');

console.log('🧪 Iniciando verificación de Fase 10.1.1: Inmutabilidad y Reconciliación Matemática...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// =========================================================================
// 1. TESTS DE LÍMITES DE INTERVALOS (BOUNDARY TESTS)
// =========================================================================
console.log('--- 1. Tests Específicos para Límites de Intervalos ---');

it('Probabilidad 0.00 debe asignarse a [0.00, 0.50)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.00), '[0.00, 0.50)');
});

it('Probabilidad 0.4999 debe asignarse a [0.00, 0.50)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.4999), '[0.00, 0.50)');
});

it('Probabilidad 0.50 debe asignarse a [0.50, 0.60) (Cerrado por izquierda)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.50), '[0.50, 0.60)');
});

it('Probabilidad 0.60 debe asignarse a [0.60, 0.70) (Cerrado por izquierda)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.60), '[0.60, 0.70)');
});

it('Probabilidad 0.70 debe asignarse a [0.70, 0.80) (Cerrado por izquierda)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.70), '[0.70, 0.80)');
});

it('Probabilidad 0.7999 debe asignarse a [0.70, 0.80)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.7999), '[0.70, 0.80)');
});

it('Probabilidad 0.80 debe asignarse a [0.80, 0.90) y NUNCA a [0.70, 0.80)', () => {
  const bin = tracker.getBinForProbability(0.80);
  assert.strictEqual(bin, '[0.80, 0.90)');
  assert.notStrictEqual(bin, '[0.70, 0.80)');
});

it('Probabilidad 0.8999 debe asignarse a [0.80, 0.90)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.8999), '[0.80, 0.90)');
});

it('Probabilidad 0.90 debe asignarse a [0.90, 1.00] (Cerrado por izquierda)', () => {
  assert.strictEqual(tracker.getBinForProbability(0.90), '[0.90, 1.00]');
});

it('Probabilidad 1.00 debe asignarse a [0.90, 1.00] (Límite superior inclusivo)', () => {
  assert.strictEqual(tracker.getBinForProbability(1.00), '[0.90, 1.00]');
});

it('Probabilidades inválidas (<0, >1, NaN) deben retornar null', () => {
  assert.strictEqual(tracker.getBinForProbability(-0.01), null);
  assert.strictEqual(tracker.getBinForProbability(1.05), null);
  assert.strictEqual(tracker.getBinForProbability(NaN), null);
  assert.strictEqual(tracker.getBinForProbability(undefined), null);
});

// =========================================================================
// 2. DENOMINADORES Y CONSISTENCIA DE CALIBRACIÓN (N = 18)
// =========================================================================
console.log('\n--- 2. Denominadores y Calibración Exacta (N = 18) ---');

const comp = tracker.compareModels();
const commonSubset = comp.commonSubsetComparison;

it('Subconjunto común debe tener exactamente N=18 para ambos modelos', () => {
  assert.strictEqual(commonSubset.N_common, 18);
  assert.strictEqual(commonSubset.modelB.N, 18);
  assert.strictEqual(commonSubset.modelC.N, 18);
});

it('La suma de los bins de calibración del Modelo B debe ser exactamente 18', () => {
  const binsB = commonSubset.modelB.calibrationBins;
  const sumB = binsB.reduce((acc, b) => acc + b.sampleSize, 0);
  assert.strictEqual(sumB, 18, `Suma esperada 18, obtenida ${sumB}`);
});

it('La suma de los bins de calibración del Modelo C debe ser exactamente 18', () => {
  const binsC = commonSubset.modelC.calibrationBins;
  const sumC = binsC.reduce((acc, b) => acc + b.sampleSize, 0);
  assert.strictEqual(sumC, 18, `Suma esperada 18, obtenida ${sumC}`);
});

it('En Modelo C, el intervalo [0.80, 0.90) debe contener exactamente 7 observaciones reales', () => {
  const bin80 = commonSubset.modelC.calibrationBins.find(b => b.bin === '[0.80, 0.90)');
  assert.strictEqual(bin80.sampleSize, 7, `Esperadas 7 observaciones en [0.80, 0.90), obtenidas ${bin80.sampleSize}`);
  assert.strictEqual(bin80.actualHitRatePct, 28.6); // 2 de 7 aciertos
});

it('En Modelo C, el intervalo [0.70, 0.80) debe contener exactamente 5 observaciones reales', () => {
  const bin70 = commonSubset.modelC.calibrationBins.find(b => b.bin === '[0.70, 0.80)');
  assert.strictEqual(bin70.sampleSize, 5, `Esperadas 5 observaciones en [0.70, 0.80), obtenidas ${bin70.sampleSize}`);
  assert.strictEqual(bin70.actualHitRatePct, 60.0); // 3 de 5 aciertos
});

// =========================================================================
// 3. INMUTABILIDAD HISTÓRICA DE PROBABILIDADES PRE-MATCH
// =========================================================================
console.log('\n--- 3. Inmutabilidad Histórica de Probabilidades Pre-Match ---');

const registryPath = path.resolve(__dirname, '..', 'storage_data', 'model_observation_registry.json');
const candidatesPath = path.resolve(__dirname, '..', 'storage_data', 'research_candidates.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));

it('Bruno Gomes debe conservar probModelB = 0.70 y probModelC = 0.60 según StatsHub MCP raw', () => {
  const pick = registry.find(p => p.pickId === 'cand_1795110774831_6k1oex');
  const cand = candidates.find(c => c.id === 'cand_1795110774831_6k1oex');
  assert(pick, 'Pick Bruno Gomes debe existir');
  assert.strictEqual(cand.rawSourceData.hitRateL10, 70);
  assert.strictEqual(cand.rawSourceData.hitRateL15, 60);
  assert.strictEqual(pick.probModelB, 0.70, 'probModelB de Bruno Gomes debe ser 0.70');
  assert.strictEqual(pick.probModelC, 0.60, 'probModelC de Bruno Gomes debe ser 0.60');
});

it('Bragantino Córners debe conservar probModelB = 0.80 y probModelC = 0.87 según StatsHub MCP raw', () => {
  const pick = registry.find(p => p.pickId === 'cand_1795110774831_kqoizj');
  const cand = candidates.find(c => c.id === 'cand_1795110774831_kqoizj');
  assert(pick, 'Pick Bragantino Córners debe existir');
  assert.strictEqual(cand.rawSourceData.hitRateL10, 80);
  assert.strictEqual(cand.rawSourceData.hitRateL15, 87);
  assert.strictEqual(pick.probModelB, 0.80, 'probModelB de Bragantino Córners debe ser 0.80');
  assert.strictEqual(pick.probModelC, 0.87, 'probModelC de Bragantino Córners debe ser 0.87');
});

it('Internacional Remates al Arco debe conservar probModelB = 0.70 y probModelC = 0.47 según StatsHub MCP raw', () => {
  const pick = registry.find(p => p.pickId === 'cand_1795110774831_6rsb2k');
  const cand = candidates.find(c => c.id === 'cand_1795110774831_6rsb2k');
  assert(pick, 'Pick Internacional Remates al Arco debe existir');
  assert.strictEqual(cand.rawSourceData.hitRateL10, 70);
  assert.strictEqual(cand.rawSourceData.hitRateL15, 47);
  assert.strictEqual(pick.probModelB, 0.70, 'probModelB de Internacional Remates debe ser 0.70');
  assert.strictEqual(pick.probModelC, 0.47, 'probModelC de Internacional Remates debe ser 0.47');
});

it('USM Alger Goles debe conservar probModelB = 0.80 y probModelC = 0.73 (pertenece a [0.70, 0.80))', () => {
  const pick = registry.find(p => p.pickId === 'cand_1795110774831_fa98d7');
  const cand = candidates.find(c => c.id === 'cand_1795110774831_fa98d7');
  assert(pick, 'Pick USM Alger debe existir');
  assert.strictEqual(cand.rawSourceData.hitRateL10, 80);
  assert.strictEqual(cand.rawSourceData.hitRateL15, 73);
  assert.strictEqual(pick.probModelB, 0.80);
  assert.strictEqual(pick.probModelC, 0.73);
  assert.strictEqual(tracker.getBinForProbability(pick.probModelC), '[0.70, 0.80)');
});

it('IntegrityGuard debe certificar que los 42 registros oficiales actuales coinciden con el ledger SHA-256', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0, 'No debe haber alteraciones en registros existentes');
  assert.strictEqual(audit.intactCount, 42);
});

it('IntegrityGuard debe detectar activamente cualquier alteración retrospectiva en probabilidades', () => {
  const integrityGuard = require('../audit/integrityGuard');
  const realPick = registry.find(p => p.pickId === 'cand_1795110774831_6k1oex');
  // Simular alteración retrospectiva
  const tamperedPick = { ...realPick, probModelB: 0.85 };
  const testAudit = integrityGuard.verifyIntegrity([tamperedPick]);
  assert.strictEqual(testAudit.alteredCount, 1, 'Debe detectar 1 alteración');
  assert.strictEqual(testAudit.violations.length, 1);
  assert.strictEqual(testAudit.violations[0].pickId, 'cand_1795110774831_6k1oex');
  assert.strictEqual(testAudit.violations[0].preMatchAltered, true);
  // Limpiar el log de prueba para no dejar incidentes espurios
  const tamperLogPath = path.resolve(__dirname, '..', 'storage_data', 'tampering_log.json');
  fs.writeFileSync(tamperLogPath, JSON.stringify([], null, 2), 'utf-8');
});

// =========================================================================
// 4. RECONCILIACIÓN DEL UNIVERSO DE 42 CANDIDATOS
// =========================================================================
console.log('\n--- 4. Reconciliación del Universo de 42 Candidatos ---');

const nonTestObs = registry.filter(p => !p.isTestPick);

it('El registro no-test debe sumar exactamente 42 candidatos', () => {
  assert.strictEqual(nonTestObs.length, 42);
});

it('Cada candidato debe pertenecer a un único estado actual disjunto (Suma = 42)', () => {
  const approvedSettled = nonTestObs.filter(o => o.stage === 'APPROVED' && o.verificationStatus === 'RESULTADO_CONFIRMADO').length;
  const conditionalSettled = nonTestObs.filter(o => o.stage === 'ELIGIBLE' && o.elenaDecision === 'PENDIENTE' && o.verificationStatus === 'RESULTADO_CONFIRMADO').length;
  const rejected = nonTestObs.filter(o => o.stage === 'REJECTED').length;
  const discoveredUninvestigated = nonTestObs.filter(o => o.stage === 'DISCOVERED').length;
  const futurePending = nonTestObs.filter(o => o.stage === 'ELIGIBLE' && o.verificationStatus === 'PENDIENTE').length;

  assert.strictEqual(approvedSettled, 13, `Approved settled esperados 13, obtenidos ${approvedSettled}`);
  assert.strictEqual(conditionalSettled, 5, `Conditional settled esperados 5, obtenidos ${conditionalSettled}`);
  assert.strictEqual(rejected, 2, `Rejected esperados 2, obtenidos ${rejected}`);
  assert.strictEqual(discoveredUninvestigated, 2, `Discovered esperados 2, obtenidos ${discoveredUninvestigated}`);
  assert.strictEqual(futurePending, 20, `Future pending esperados 20, obtenidos ${futurePending}`);

  const totalDisjoint = approvedSettled + conditionalSettled + rejected + discoveredUninvestigated + futurePending;
  assert.strictEqual(totalDisjoint, 42, `Suma disjunta esperada 42, obtenida ${totalDisjoint}`);
});

it('El total de selecciones disputadas y liquidadas debe ser exactamente 18 (10 G / 8 P)', () => {
  const settled = nonTestObs.filter(o => o.verificationStatus === 'RESULTADO_CONFIRMADO');
  assert.strictEqual(settled.length, 18);
  const wins = settled.filter(o => o.finalResultConfirmed === 'GANADA').length;
  const losses = settled.filter(o => o.finalResultConfirmed === 'PERDIDA').length;
  assert.strictEqual(wins, 10);
  assert.strictEqual(losses, 8);
});

// =========================================================================
// 5. ESCENARIO CONTRAFACTUAL DIFERENCIADO
// =========================================================================
console.log('\n--- 5. Escenario Contrafactual Diferenciado ---');

it('Los 4 picks con EV_C < 7% fueron admitidos realmente y sumaron +1.18 u (No fueron descartes reales)', () => {
  const cf = tracker.evaluateCounterfactuals();
  const lowEvC = cf.discardedByLowEV_ModelC;
  assert.strictEqual(lowEvC.N, 4);
  assert.strictEqual(lowEvC.hits, 3);
  assert.strictEqual(lowEvC.losses, 1);
  assert.strictEqual(lowEvC.profitUnits, 1.18);
  assert.strictEqual(lowEvC.winRatePct, 75.0);
});

console.log('\n====================================================');
console.log(`🏁 RESULTADO FASE 10.1.1: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
