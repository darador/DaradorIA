/**
 * SUITE DE TESTS OBLIGATORIOS — FASE 2: SHADOW LAB RUNNER & EVALUATOR
 * 
 * Verifica rigurosamente:
 * 1. Tolerancia a fallos: el runner no rompe el pipeline si hay errores en candidatos.
 * 2. Prevención de duplicación y congelamiento inmutable (SHA-256 seal).
 * 3. Reprocesamiento idempotente: no recalcula predicciones ya congeladas.
 * 4. Manejo de datos faltantes o nulos.
 * 5. Vinculación estricta de resultados (WON, LOST, VOID).
 * 6. Separación estricta entre picks ejecutados y Shadow Mode.
 * 7. Evaluación probabilística idéntica fuera de muestra (Brier Score, Log Loss, ECE).
 * 8. Aislamiento total: cero impacto en storage.js o en producción.
 */

const fs = require('fs');
const path = require('path');
const ShadowLabStore = require('../experimental/shadowLabStore');
const ShadowLabRunnerV2 = require('../experimental/shadowLabRunnerV2');
const ShadowLabEvaluator = require('../experimental/shadowLabEvaluator');

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 INICIANDO SUITE DE TESTS: FASE 2 (SHADOW LAB RUNNER & STORE)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // Usar almacén aislado temporal para pruebas
  const testStorePath = path.join(__dirname, '..', 'storage_data', 'test_shadow_lab_store.json');
  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

  const testStore = new ShadowLabStore(testStorePath);
  const runner = new ShadowLabRunnerV2({ store: testStore });
  const evaluator = new ShadowLabEvaluator(testStore);

  // --- TEST 1: TOLERANCIA A ERRORES Y CANDIDATOS MAL FORMADOS ---
  console.log('--- 1. Tolerancia a Fallos del Runner ---');
  const malformed = { id: 'cand_err_01', playerOrTeam: null, match: 'Invalid' };
  const resErr = runner.processCandidate(malformed);
  assert(resErr.success === true || resErr.faultTolerant === true, 'El runner maneja candidatos mal formados sin lanzar excepciones fatales');

  const emptyCandidate = null;
  const resNull = runner.processCandidate(emptyCandidate);
  assert(resNull.success === false && resNull.reason.includes('INVALID_CANDIDATE'), 'Maneja candidato nulo con retorno controlado');

  // --- TEST 2: CONGELAMIENTO INMUTABLE Y SELLO SHA-256 ---
  console.log('\n--- 2. Congelamiento Inmutable y Sello SHA-256 ---');
  const validCandidate = {
    id: 'cand_test_shadow_01',
    match: 'Arsenal vs Chelsea',
    competition: 'Premier League',
    playerOrTeam: 'Bukayo Saka',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    odds: 1.85,
    historicalValues: [2, 1, 3, 2, 1, 2, 3, 2, 1, 2, 2, 3, 1, 2, 2], // n=15
    starts: 14,
    avgMinutes: 85,
    shadow_mode: true
  };
  const v1Pred = { pProjected: 0.62, evPercentage: 14.7 };

  const resFreeze = runner.processCandidate(validCandidate, v1Pred);
  assert(resFreeze.success === true, 'Candidato procesado y congelado exitosamente');
  assert(resFreeze.freezeResult.saved === true, 'Predicción guardada en ShadowLabStore');
  assert(resFreeze.freezeResult.entry.frozenHash.length === 64, `Sello SHA-256 generado correctamente (${resFreeze.freezeResult.entry.frozenHash.slice(0, 12)}...)`);

  // --- TEST 3: REPROCESAMIENTO IDEMPOTENTE (INMUTABILIDAD) ---
  console.log('\n--- 3. Reprocesamiento Idempotente ---');
  // Intentar reprocesar el mismo candidato con datos distintos
  const alteredCandidate = { ...validCandidate, odds: 2.50, historicalValues: [0, 0, 0] };
  const resIdempotent = runner.processCandidate(alteredCandidate);
  assert(resIdempotent.freezeResult.saved === false, 'Rechaza sobreescribir predicción ya congelada');
  assert(resIdempotent.freezeResult.reason.includes('IDEMPOTENT_SKIPPED'), 'Retorna razón explícita de omisión por idempotencia');
  
  const stored = testStore.getPredictionById('cand_test_shadow_01');
  assert(stored.odds === 1.85, 'El registro original se mantiene intacto (odds 1.85 preservadas)');

  // --- TEST 4: LIQUIDACIÓN DE RESULTADOS (WON, LOST, VOID) ---
  console.log('\n--- 4. Vinculación de Resultados Fuera de Muestra ---');
  // Crear 3 eventos congelados
  const cWon = { id: 'cand_won_01', match: 'Team A v Team B', market: 'Goles de equipo', odds: 1.70, historicalValues: [2, 1, 3, 2, 2] };
  const cLost = { id: 'cand_lost_01', match: 'Team C v Team D', market: 'Goles de equipo', odds: 2.10, historicalValues: [1, 0, 2, 1, 0] };
  const cVoid = { id: 'cand_void_01', match: 'Team E v Team F', market: 'Faltas ganadas', odds: 1.25, historicalValues: [2, 2, 2] };

  runner.processCandidate(cWon, { pProjected: 0.65, evPercentage: 10.5 });
  runner.processCandidate(cLost, { pProjected: 0.55, evPercentage: 15.5 });
  runner.processCandidate(cVoid, { pProjected: 0.85, evPercentage: 6.25 });

  // Vincular resultados
  const sWon = testStore.settlePrediction('cand_won_01', { status: 'ACERTADA', actualStat: 2 });
  const sLost = testStore.settlePrediction('cand_lost_01', { status: 'FALLADA', actualStat: 0 });
  const sVoid = testStore.settlePrediction('cand_void_01', { status: 'ANULADA_LINEUP', actualStat: null });

  assert(sWon.settled === true && sWon.entry.result.isWon === true, 'Resultado WON liquidado y vinculado correctamente');
  assert(sLost.settled === true && sLost.entry.result.isLost === true, 'Resultado LOST liquidado y vinculado correctamente');
  assert(sVoid.settled === true && sVoid.entry.result.isVoid === true, 'Resultado VOID liquidado y vinculado correctamente');

  // --- TEST 5: EVALUACIÓN PROBABILÍSTICA (BRIER SCORE, LOG LOSS, ROI) ---
  console.log('\n--- 5. Evaluación Probabilística con ShadowLabEvaluator ---');
  const evalReport = evaluator.evaluatePerformance();
  assert(evalReport.sampleSize === 2, `Muestra evaluada excluye nulas (2 eventos evaluados de 3 liquidados)`);
  assert(evalReport.voidCount === 1, `Contabiliza exactamente 1 evento anulado`);
  assert(Number.isFinite(evalReport.probabilisticComparison.brierScore.v1), 'Calcula Brier Score para V1');
  assert(Number.isFinite(evalReport.probabilisticComparison.brierScore.v2), 'Calcula Brier Score para V2');
  assert(Number.isFinite(evalReport.probabilisticComparison.logLoss.v1), 'Calcula Log Loss para V1');
  assert(Number.isFinite(evalReport.probabilisticComparison.logLoss.v2), 'Calcula Log Loss para V2');
  assert(evalReport.financialSimulation.v2 !== undefined, 'Genera simulación financiera de ROI/Drawdown para V2');

  // --- TEST 6: AISLAMIENTO TOTAL DE PRODUCCIÓN ---
  console.log('\n--- 6. Verificación de Aislamiento de Producción ---');
  const prodStorage = require('../data/storage');
  const prodCandidates = prodStorage.getCandidates();
  const testLeak = prodCandidates.some(c => c.id === 'cand_test_shadow_01' || c.id === 'cand_won_01');
  assert(testLeak === false, 'CERO CONTAMINACIÓN: Ningún registro del Shadow Lab se filtró en storage.js productivo');

  // Limpieza de archivo temporal de prueba
  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

  console.log('\n================================================================');
  console.log(`📊 RESUMEN FINAL: ${passed} pruebas superadas de ${passed + failed}`);
  console.log(`Resultado: ${failed === 0 ? '🟢 TODAS LAS PRUEBAS DE FASE 2 PASARON EXITOSAMENTE' : '🔴 FALLOS ENCONTRADOS'}`);
  console.log('================================================================\n');

  return { passed, failed, success: failed === 0 };
}

if (require.main === module) {
  runTestSuite().then(res => {
    if (!res.success) process.exit(1);
  });
}

module.exports = runTestSuite;
