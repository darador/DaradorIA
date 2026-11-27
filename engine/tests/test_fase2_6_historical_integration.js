const assert = require('assert');
const HistoricalDataResolver = require('../quality/historicalDataResolver');
const CalibratedProbabilityModel = require('../quality/calibratedProbabilityModel');
const ShadowLabRunnerV2_2 = require('../experimental/shadowLabRunnerV2_2');
const ShadowLabStore = require('../experimental/shadowLabStore');
const fs = require('fs');
const path = require('path');

console.log('=== TEST SUITE: FASE 2.6 HISTORICAL DATA INTEGRATION & CONTRACTS ===\n');

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

// 1. Serie histórica completa (COUNT_HISTORY)
runTest('1. Serie histórica completa genera contrato COUNT_HISTORY y status VALID/LIMITED', () => {
  const resolver = new HistoricalDataResolver();
  const cand = {
    id: 'test_cand_count_01',
    market: 'Remates totales',
    line: 'Más de 2.5',
    historicalValues: [3, 2, 4, 3, 1, 4, 3, 2, 4, 3, 2, 4, 3, 2, 5] // n=15
  };

  const res = resolver.resolveHistory(cand);
  assert.strictEqual(res.contractType, 'COUNT_HISTORY');
  assert.strictEqual(res.status, 'VALID');
  assert.strictEqual(res.predictionEligible, true);
  assert.strictEqual(res.countHistory.sampleSize, 15);
  assert.ok(res.countHistory.mean > 0);
  assert.ok(res.eligibleModels.includes('POISSON'));
  assert.ok(res.eligibleModels.includes('BETA_BINOMIAL'));
});

// 2. Solo hit_rate_l10 9/10 (BINARY_HISTORY)
runTest('2. hit_rate_l10 ("9/10") genera contrato BINARY_HISTORY con Poisson prohibido', () => {
  const resolver = new HistoricalDataResolver();
  const cand = {
    id: 'test_cand_binary_01',
    market: 'Faltas ganadas',
    line: 'Más de 0.5',
    hit_rate_l10: '9/10 (90%)',
    sample_size: 10
  };

  const res = resolver.resolveHistory(cand);
  assert.strictEqual(res.contractType, 'BINARY_HISTORY');
  assert.strictEqual(res.status, 'LIMITED');
  assert.strictEqual(res.predictionEligible, true);
  assert.strictEqual(res.binaryHistory.successes, 9);
  assert.strictEqual(res.binaryHistory.failures, 1);
  assert.strictEqual(res.binaryHistory.sampleSize, 10);
  assert.strictEqual(res.countHistory, null);
  assert.ok(res.eligibleModels.includes('BETA_BINOMIAL'));
  assert.ok(res.ineligibleModels.includes('POISSON'));
  assert.ok(res.ineligibleReason.includes('POISSON_REQUIRES_COUNT_HISTORY'));
});

// 3. Promedio y varianza sin observaciones individuales (prohibido imputar Poisson)
runTest('3. Prohibido imputar Poisson sin array de observaciones', () => {
  const model = new CalibratedProbabilityModel();
  const binaryContract = {
    contractType: 'BINARY_HISTORY',
    status: 'LIMITED',
    predictionEligible: true,
    binaryHistory: {
      successes: 8,
      sampleSize: 10,
      threshold: 1.5,
      betType: 'OVER',
      market: 'remates de equipo'
    }
  };

  const evalRes = model.evaluateCalibratedProbabilityFromContract(binaryContract);
  assert.strictEqual(evalRes.modelApplied, 'V2.2_BETA_BINOMIAL_SHRINKAGE_ONLY');
  assert.strictEqual(evalRes.countDistributionDetails, null);
  assert.strictEqual(evalRes.weightsUsed.weightBeta, 1.0);
  assert.strictEqual(evalRes.weightsUsed.weightCount, 0.0);
});

// 4. Identificadores incorrectos y datos insuficientes
runTest('4. Candidato sin ID o sin historial genera status INVALID y predictionEligible false', () => {
  const resolver = new HistoricalDataResolver();
  const candNoId = { market: 'Goles de equipo' };
  const resNoId = resolver.resolveHistory(candNoId);
  assert.strictEqual(resNoId.status, 'INVALID');
  assert.strictEqual(resNoId.predictionEligible, false);

  const candEmpty = { id: 'test_empty_01', market: 'Tarjetas' };
  const resEmpty = resolver.resolveHistory(candEmpty);
  assert.strictEqual(resEmpty.status, 'INVALID');
  assert.strictEqual(resEmpty.contractType, 'INSUFFICIENT');
  assert.strictEqual(resEmpty.predictionEligible, false);
});

// 5. Rechazo de datos posteriores al kickoff (Integridad Temporal)
runTest('5. Rechazo estricto de datos capturados con posterioridad al kickoff', () => {
  const resolver = new HistoricalDataResolver();
  const candPost = {
    id: 'test_temporal_violation',
    market: 'Remates totales',
    line: 'Más de 1.5',
    historicalValues: [2, 3, 1, 2],
    eventDateUtc: '2026-11-20T18:00:00Z',
    discoveredAt: '2026-11-20T19:30:00Z' // 1h 30m después del kickoff!
  };

  const res = resolver.resolveHistory(candPost);
  assert.strictEqual(res.status, 'INVALID');
  assert.strictEqual(res.predictionEligible, false);
  assert.ok(res.reason.includes('TEMPORAL_VIOLATION'));
});

// 6. Predicciones individualizadas no constantes
runTest('6. Predicciones V2.2 individualizadas no son artificialmente constantes a 0.50', () => {
  const runner = new ShadowLabRunnerV2_2();

  const candA = {
    id: 'cand_test_indiv_A',
    market: 'remates totales',
    line: 'Más de 1.5',
    odds: 1.80,
    hit_rate_l10: '9/10 (90%)',
    sample_size: 10
  };

  const candB = {
    id: 'cand_test_indiv_B',
    market: 'faltas cometidas',
    line: 'Más de 1.5',
    odds: 1.85,
    hit_rate_l10: '6/10 (60%)',
    sample_size: 10
  };

  const resA = runner.processCandidate(candA);
  const resB = runner.processCandidate(candB);

  assert.strictEqual(resA.predictionEligible, true);
  assert.strictEqual(resB.predictionEligible, true);
  assert.ok(resA.pV2 !== null && resA.pV2 !== 0.50);
  assert.ok(resB.pV2 !== null && resB.pV2 !== 0.50);
  assert.notStrictEqual(resA.pV2, resB.pV2);
  assert.ok(resA.pV2 > resB.pV2, 'Candidato con 90% hit rate debe tener mayor pV2 que el de 60%');
});

console.log(`\n=======================================================`);
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log(`=======================================================\n`);

if (totalTests !== passedTests) {
  process.exit(1);
}
