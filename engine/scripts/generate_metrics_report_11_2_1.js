const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const results = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));

const decided = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA' || r.status === 'ACERTADA' || r.status === 'FALLADA');

console.log('Total Decided Observations:', decided.length);

const table = decided.map((d, index) => {
  const reg = registry.find(r => r.pickId === d.pickId);
  const seal = ledger[d.pickId] || {};

  const isWon = d.status === 'GANADA' || d.status === 'ACERTADA';
  const y = isWon ? 1 : 0;

  // Frozen probabilities from registry and ledger
  const probModelB = seal.probModelB !== undefined ? seal.probModelB : (reg ? reg.probModelB : 0.8);
  const probModelC = seal.probModelC !== undefined ? seal.probModelC : (reg ? reg.probModelC : 0.8);
  const originalPoissonProb = reg ? reg.originalProb : null;
  const ensembleProb = Number(((probModelB + probModelC) / 2).toFixed(4));
  const evaluatorBenchmarkProb = 0.625; // 1 / 1.60

  const modelVersion = seal.modelVersionB || (reg ? reg.modelVersionB : 'Model-B-L10');
  const preMatchHash = seal.preMatchHash || 'N/A';

  // Calculations for Model B
  const brierModelB = Math.pow(probModelB - y, 2);
  const clampedB = Math.max(0.001, Math.min(0.999, probModelB));
  const logLossModelB = -(y * Math.log(clampedB) + (1 - y) * Math.log(1 - clampedB));

  // Calculations for Ensemble
  const brierEnsemble = Math.pow(ensembleProb - y, 2);
  const clampedEns = Math.max(0.001, Math.min(0.999, ensembleProb));
  const logLossEnsemble = -(y * Math.log(clampedEns) + (1 - y) * Math.log(1 - clampedEns));

  // Calculations for Benchmark Evaluator (62.5%)
  const brierBenchmark = Math.pow(evaluatorBenchmarkProb - y, 2);
  const logLossBenchmark = -(y * Math.log(evaluatorBenchmarkProb) + (1 - y) * Math.log(1 - evaluatorBenchmarkProb));

  const isElenaApproved = d.pickId !== 'cand_1795110774831_6rsb2k';

  return {
    index: index + 1,
    pickId: d.pickId,
    player: d.player,
    match: d.match,
    date: d.date,
    result: isWon ? 'GANADA' : 'PERDIDA',
    y,
    odds: d.odds,
    isElenaApproved,
    probModelB,
    probModelC,
    ensembleProb,
    originalPoissonProb,
    modelVersion,
    preMatchHash,
    brierModelB: Number(brierModelB.toFixed(4)),
    logLossModelB: Number(logLossModelB.toFixed(4)),
    brierEnsemble: Number(brierEnsemble.toFixed(4)),
    logLossEnsemble: Number(logLossEnsemble.toFixed(4)),
    brierBenchmark: Number(brierBenchmark.toFixed(4)),
    logLossBenchmark: Number(logLossBenchmark.toFixed(4))
  };
});

// A. Universe A: All 19 decided
const universeA_all19 = table;
const meanBrierA_bench = universeA_all19.reduce((a, b) => a + b.brierBenchmark, 0) / 19;
const meanLogLossA_bench = universeA_all19.reduce((a, b) => a + b.logLossBenchmark, 0) / 19;
const meanBrierA_modelB = universeA_all19.reduce((a, b) => a + b.brierModelB, 0) / 19;
const meanLogLossA_modelB = universeA_all19.reduce((a, b) => a + b.logLossModelB, 0) / 19;
const meanBrierA_ens = universeA_all19.reduce((a, b) => a + b.brierEnsemble, 0) / 19;
const meanLogLossA_ens = universeA_all19.reduce((a, b) => a + b.logLossEnsemble, 0) / 19;

// B. Universe B: Elena Approved (18 decided)
const universeB_elena18 = table.filter(t => t.isElenaApproved);
const meanBrierB_bench = universeB_elena18.reduce((a, b) => a + b.brierBenchmark, 0) / 18;
const meanLogLossB_bench = universeB_elena18.reduce((a, b) => a + b.logLossBenchmark, 0) / 18;
const meanBrierB_modelB = universeB_elena18.reduce((a, b) => a + b.brierModelB, 0) / 18;
const meanLogLossB_modelB = universeB_elena18.reduce((a, b) => a + b.logLossModelB, 0) / 18;
const meanBrierB_ens = universeB_elena18.reduce((a, b) => a + b.brierEnsemble, 0) / 18;
const meanLogLossB_ens = universeB_elena18.reduce((a, b) => a + b.logLossEnsemble, 0) / 18;

// C. Universe C: Discarded by Elena (1 decided: Internacional)
const universeC_discarded = table.filter(t => !t.isElenaApproved);

console.log('\n=== UNIVERSE A: TODAS LAS PREDICCIONES AUDITABLES (19 OBS) ===');
console.log('Evaluator Benchmark: Brier =', meanBrierA_bench.toFixed(4), '| LogLoss =', meanLogLossA_bench.toFixed(4));
console.log('Model B (L10):       Brier =', meanBrierA_modelB.toFixed(4), '| LogLoss =', meanLogLossA_modelB.toFixed(4));
console.log('Ensemble (B+C):      Brier =', meanBrierA_ens.toFixed(4), '| LogLoss =', meanLogLossA_ens.toFixed(4));

console.log('\n=== UNIVERSE B: PICKS APROBADOS POR ELENA (18 OBS) ===');
console.log('Evaluator Benchmark: Brier =', meanBrierB_bench.toFixed(4), '| LogLoss =', meanLogLossB_bench.toFixed(4));
console.log('Model B (L10):       Brier =', meanBrierB_modelB.toFixed(4), '| LogLoss =', meanLogLossB_modelB.toFixed(4));
console.log('Ensemble (B+C):      Brier =', meanBrierB_ens.toFixed(4), '| LogLoss =', meanLogLossB_ens.toFixed(4));

console.log('\n=== INDIVIDUAL TABLE (JSON FORMAT) ===');
console.log(JSON.stringify(table, null, 2));
