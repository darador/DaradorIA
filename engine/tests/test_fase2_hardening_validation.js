const assert = require('assert');
const CalibratedProbabilityModel = require('../quality/calibratedProbabilityModel');
const ValueEngine = require('../value/valueEngine');
const ShadowLabStore = require('../experimental/shadowLabStore');
const ShadowLabEvaluator = require('../experimental/shadowLabEvaluator');
const fs = require('fs');
const path = require('path');

console.log('=== TEST SUITE: FASE 2 HARDENING & VALIDACIÓN ESTADÍSTICA ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Error: ${err.message}\n`);
  }
}

// =========================================================================
// 1. AUDITORÍA Y CLARIFICACIÓN DE FÓRMULA BETA-BINOMIAL Y P_CALIBRADA
// =========================================================================

runTest('1.1 Beta-Binomial: Distinción estricta de successes, failures, sampleSize y threshold', () => {
  const model = new CalibratedProbabilityModel();
  
  // Parámetros: successes = 8, sampleSize = 10 -> failures = 2.
  // Con prior default (alpha=4.0, beta=4.0):
  // P = (8 + 4) / (10 + 4 + 4) = 12 / 18 = 0.6667
  const res = model.calculateBetaBinomialShrinkage(8, 10, 'default');
  
  assert.strictEqual(res.successes, 8);
  assert.strictEqual(res.sampleSize, 10);
  assert.strictEqual(res.failures, 2);
  assert.strictEqual(res.alpha, 4.0);
  assert.strictEqual(res.beta, 4.0);
  assert.strictEqual(res.pPosterior.toFixed(4), '0.6667');
  assert.strictEqual(res.rawHitRate.toFixed(4), '0.8000');
  assert.strictEqual(res.shrinkageApplied.toFixed(4), '0.1333');
});

runTest('1.2 Reproducibilidad exacta de los 4 casos históricos (Braga, Juventus, CSKA, Lillestrøm)', () => {
  const model = new CalibratedProbabilityModel();
  const valueEngine = new ValueEngine();

  // 1. Sporting Braga Under 2.5 @2.18
  // n = 10, successes = 9, failures = 1, threshold = 2.5, betType = UNDER, market = 'goles de equipo'
  const bragaBeta = model.calculateBetaBinomialShrinkage(9, 10, 'goles de equipo');
  assert.strictEqual(bragaBeta.pPosterior.toFixed(4), '0.7111');
  
  // Histórico representativo con media lambda = 1.0 gol y 9/10 aciertos Under 2.5
  const bragaHist = [0, 0, 1, 1, 1, 1, 1, 1, 1, 3]; // 9 under 2.5, 1 over (3), sum = 10, mean = 1.0
  const bragaCount = model.calculateCountDistribution(bragaHist, 2.5, 'UNDER');
  assert.strictEqual(bragaCount.pWin.toFixed(4), '0.9197');

  const bragaEval = model.evaluateCalibratedProbability({
    historicalValues: bragaHist,
    threshold: 2.5,
    betType: 'UNDER',
    marketName: 'goles de equipo'
  });
  // w_beta = 0.65, w_count = 0.35 -> 0.71111 * 0.65 + 0.91970 * 0.35 = 0.46222 + 0.32189 = 0.7841
  assert.strictEqual(bragaEval.pCalibrated.toFixed(4), '0.7841');
  
  const bragaEV = valueEngine.evaluateValue({
    pCalibrated: bragaEval.pCalibrated,
    uncertaintyIndex: bragaEval.uncertaintyIndex,
    odds: 2.18
  });
  // EV bruto = (0.7841 * 2.18 - 1) = +70.9%
  assert.strictEqual(bragaEV.grossEvPct.toFixed(1), '70.9');

  // 2. Juventus Under 2.5 @2.00
  const juveEval = model.evaluateCalibratedProbability({
    historicalValues: bragaHist,
    threshold: 2.5,
    betType: 'UNDER',
    marketName: 'goles de equipo'
  });
  assert.strictEqual(juveEval.pCalibrated.toFixed(4), '0.7841');
  const juveEV = valueEngine.evaluateValue({
    pCalibrated: juveEval.pCalibrated,
    uncertaintyIndex: juveEval.uncertaintyIndex,
    odds: 2.00
  });
  assert.strictEqual(juveEV.grossEvPct.toFixed(1), '56.8');

  // 3. CSKA Sofia Over 3.5 SOT @1.61
  // successes = 10, sampleSize = 10, threshold = 3.5, betType = OVER, market = 'remates al arco de equipo'
  const cskaHist = [4, 5, 4, 5, 5, 4, 5, 4, 5, 5.7]; // mean = 4.67, 10/10 over 3.5
  const cskaBeta = model.calculateBetaBinomialShrinkage(10, 10, 'remates al arco de equipo');
  assert.strictEqual(cskaBeta.pPosterior.toFixed(4), '0.7474');

  const cskaEval = model.evaluateCalibratedProbability({
    historicalValues: cskaHist,
    threshold: 3.5,
    betType: 'OVER',
    marketName: 'remates al arco de equipo'
  });
  // w_beta = 0.65 (0.7474) + w_count = 0.35 (0.6856) = 0.7258
  assert.strictEqual(cskaEval.pCalibrated.toFixed(4), '0.7258');
  const cskaEV = valueEngine.evaluateValue({
    pCalibrated: cskaEval.pCalibrated,
    uncertaintyIndex: cskaEval.uncertaintyIndex,
    odds: 1.61
  });
  // EV bruto = (0.7258 * 1.61 - 1) = +16.9%
  assert.strictEqual(cskaEV.grossEvPct.toFixed(1), '16.9');

  // 4. Lillestrøm SK Over 2.5 Córners @1.83
  // successes = 9, sampleSize = 10, threshold = 2.5, betType = OVER, market = 'córners de equipo'
  const lilHist = [4, 4, 4, 4, 4, 4, 4, 4, 5, 2]; // 9 over 2.5, 1 under (2), mean = 3.90
  const lilBeta = model.calculateBetaBinomialShrinkage(9, 10, 'córners de equipo');
  assert.strictEqual(lilBeta.pPosterior.toFixed(4), '0.7778');

  const lilEval = model.evaluateCalibratedProbability({
    historicalValues: lilHist,
    threshold: 2.5,
    betType: 'OVER',
    marketName: 'córners de equipo'
  });
  // w_beta = 0.65 (0.7778) + w_count = 0.35 (0.7469) = 0.7670
  assert.strictEqual(lilEval.pCalibrated.toFixed(4), '0.7670');
  const lilEV = valueEngine.evaluateValue({
    pCalibrated: lilEval.pCalibrated,
    uncertaintyIndex: lilEval.uncertaintyIndex,
    odds: 1.83
  });
  assert.strictEqual(lilEV.grossEvPct.toFixed(1), '40.4');
});

// =========================================================================
// 2. HARDENING DE OVER/UNDER: LÍNEAS ENTERAS, VOID Y SUMA = 1.0
// =========================================================================

runTest('2.1 Líneas decimales (0.5, 1.5, 2.5, 3.5): P(win) + P(loss) = 1.0, P(void) = 0.0', () => {
  const model = new CalibratedProbabilityModel();
  const thresholds = [0.5, 1.5, 2.5, 3.5];
  const hist = [2, 2, 3, 1, 2, 2, 3, 2, 2, 2]; // mean = 2.1

  for (const th of thresholds) {
    const overDist = model.calculateCountDistribution(hist, th, 'OVER');
    assert.strictEqual(overDist.pVoid, 0.0);
    assert.ok(Math.abs((overDist.pWin + overDist.pLoss) - 1.0) < 1e-4);

    const underDist = model.calculateCountDistribution(hist, th, 'UNDER');
    assert.strictEqual(underDist.pVoid, 0.0);
    assert.ok(Math.abs((underDist.pWin + underDist.pLoss) - 1.0) < 1e-4);

    // Complementariedad exacta
    assert.ok(Math.abs(overDist.pWin - underDist.pLoss) < 1e-4);
  }
});

runTest('2.2 Líneas enteras (1.0, 2.0, 3.0): P(win) + P(loss) + P(void) = 1.0 exactamente', () => {
  const model = new CalibratedProbabilityModel();
  const thresholds = [1, 2, 3];
  const hist = [2, 3, 2, 3, 2, 2, 3, 2, 3, 2]; // mean = 2.4

  for (const th of thresholds) {
    const overDist = model.calculateCountDistribution(hist, th, 'OVER');
    
    assert.ok(overDist.pVoid > 0, `pVoid debe ser mayor a 0 en línea entera ${th}`);
    const sumOver = overDist.pWin + overDist.pLoss + overDist.pVoid;
    assert.ok(Math.abs(sumOver - 1.0) < 1e-4, `Suma Over debe ser 1.0, dio: ${sumOver}`);

    const underDist = model.calculateCountDistribution(hist, th, 'UNDER');
    
    assert.ok(underDist.pVoid > 0, `pVoid debe ser mayor a 0 en línea entera ${th}`);
    const sumUnder = underDist.pWin + underDist.pLoss + underDist.pVoid;
    assert.ok(Math.abs(sumUnder - 1.0) < 1e-4, `Suma Under debe ser 1.0, dio: ${sumUnder}`);

    // En línea entera, P(void) para Over y Under es exactamente P(X == th)
    assert.ok(Math.abs(overDist.pVoid - underDist.pVoid) < 1e-4);
  }
});

// =========================================================================
// 3. ROBUSTEZ DE SHADOW LAB STORE (CANONICAL JSON Y SHA-256 VERIFICADO)
// =========================================================================

runTest('3.1 Canonical JSON determinista y hash SHA-256 insensible al orden de atributos', () => {
  const store = new ShadowLabStore();
  
  const objA = {
    candidateId: 'test-1',
    odds: 2.10,
    market: 'team_goals',
    grossEvV2: 0.15,
    sampleSize: 10
  };
  
  const objB = {
    sampleSize: 10,
    market: 'team_goals',
    candidateId: 'test-1',
    grossEvV2: 0.15,
    odds: 2.10
  };

  const hashA = store.computeCanonicalHash(objA);
  const hashB = store.computeCanonicalHash(objB);
  assert.strictEqual(hashA, hashB);
  assert.strictEqual(hashA.length, 64); // SHA-256 hex string
});

runTest('3.2 Detección de Tampering al leer predicción modificada', () => {
  const testStorePath = path.join(__dirname, 'temp_shadow_test_store.json');
  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);

  const store = new ShadowLabStore(testStorePath);
  
  const entry = {
    candidateId: 'cand-tamper-01',
    match: 'Team A vs Team B',
    odds: 1.95,
    pV2: 0.65,
    grossEvV2: 26.75
  };
  
  const saved = store.freezePrediction(entry);
  assert.ok(saved.entry.frozenHash);

  // Lectura normal intacta
  const retrievedValid = store.getPredictionById('cand-tamper-01');
  assert.strictEqual(retrievedValid.tamperCheck.isValid, true);

  // Alteramos maliciosamente el archivo en disco simulando corrupción o modificación externa
  const rawDisk = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
  rawDisk.predictions[0].odds = 2.50; // Se alteró la cuota
  fs.writeFileSync(testStorePath, JSON.stringify(rawDisk, null, 2), 'utf8');

  // Lectura con tamperCheck
  const retrievedTampered = store.getPredictionById('cand-tamper-01');
  assert.strictEqual(retrievedTampered.tamperCheck.isValid, false);
  assert.notStrictEqual(retrievedTampered.tamperCheck.recordedHash, retrievedTampered.tamperCheck.recalculatedHash);

  // Cleanup
  if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);
});

// =========================================================================
// 4. CLUSTER BOOTSTRAP Y EVALUADOR SHADOW LAB
// =========================================================================

runTest('4.1 Cluster Bootstrap pareado (resampling por partido) con IC 95%', () => {
  const evaluator = new ShadowLabEvaluator();

  // Generamos un dataset sintético pareado con 10 partidos y múltiples mercados por partido
  const mockPredictions = [];
  for (let matchIdx = 1; matchIdx <= 10; matchIdx++) {
    const matchId = `match_${matchIdx}`;
    // 2 mercados por partido (mismo cluster)
    for (let m = 1; m <= 2; m++) {
      const outcome = (matchIdx + m) % 2 === 0;
      mockPredictions.push({
        candidateId: `cand_${matchIdx}_${m}`,
        match: matchId,
        league: 'Test League',
        market: `market_${m}`,
        pV1: 0.85,
        pV2: 0.65,
        odds: 1.85,
        result: {
          isWon: outcome,
          isVoid: false,
          pnl: outcome ? 0.85 : -1.0
        }
      });
    }
  }

  const result = evaluator._clusterBootstrapComparison(mockPredictions, 200);
  
  assert.ok(result !== null);
  assert.ok(Array.isArray(result.brierDiffCi95));
  assert.strictEqual(result.brierDiffCi95.length, 2);
  assert.ok(result.brierDiffCi95[0] <= result.brierDiffCi95[1]);
  assert.ok(Array.isArray(result.logLossDiffCi95));
  assert.strictEqual(result.logLossDiffCi95.length, 2);
  assert.ok(result.logLossDiffCi95[0] <= result.logLossDiffCi95[1]);
  assert.strictEqual(typeof result.isBrierSignificant, 'boolean');
});

runTest('4.2 Calibration Curve y ECE (Expected Calibration Error) con distribución de probabilidades', () => {
  const evaluator = new ShadowLabEvaluator();

  // Dataset que abarca varios deciles
  const mockItems = [];
  for (let decile = 1; decile <= 9; decile++) {
    const prob = decile / 10;
    for (let i = 0; i < 10; i++) {
      const isWon = (i / 10) < prob;
      mockItems.push({
        pV2: prob,
        result: { isWon, isVoid: false }
      });
    }
  }

  const metrics = evaluator._calculateProbabilisticMetrics(mockItems, 'pV2');
  assert.ok(metrics.calibrationCurve.length > 5);
  assert.ok(typeof metrics.calibrationError === 'number');
  assert.ok(metrics.calibrationError < 0.15, `ECE esperado < 0.15, obtenido: ${metrics.calibrationError}`);
});

console.log(`\n=======================================================`);
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log(`=======================================================\n`);

if (totalTests !== passedTests) {
  process.exit(1);
}
