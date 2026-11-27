const fs = require('fs');

const cohortPath = 'engine/storage_data/shadow_lab_cohort_v2_2.json';
const cohortData = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const evaluable = (cohortData.predictions || []).filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA FORENSE FASE 2.7: CLUSTER BOOTSTRAP Y ROBUSTEZ ===\n');

function runClusterBootstrap(items, replications = 5000) {
  const clustersMap = new Map();
  items.forEach(p => {
    const k = p.match || p.candidateId;
    if (!clustersMap.has(k)) clustersMap.set(k, []);
    clustersMap.get(k).push(p);
  });

  const clusters = Array.from(clustersMap.values());
  const numClusters = clusters.length;

  console.log(`Universo de remuestreo: ${items.length} predicciones distribuidas en ${numClusters} partidos (clusters) independientes.`);

  const brierDiffs = [];
  const logLossDiffs = [];

  for (let r = 0; r < replications; r++) {
    const resampled = [];
    for (let c = 0; c < numClusters; c++) {
      const randIdx = Math.floor(Math.random() * numClusters);
      resampled.push(...clusters[randIdx]);
    }

    let brierV1 = 0;
    let brierV2 = 0;
    let logLossV1 = 0;
    let logLossV2 = 0;
    const nR = resampled.length;

    resampled.forEach(p => {
      const y = p.result.isWon ? 1 : 0;
      const p1 = Math.min(0.9999, Math.max(0.0001, p.pV1 || 0.5));
      const p2 = Math.min(0.9999, Math.max(0.0001, p.pV2 || 0.5));

      brierV1 += Math.pow(p1 - y, 2);
      brierV2 += Math.pow(p2 - y, 2);
      logLossV1 -= (y * Math.log(p1) + (1 - y) * Math.log(1 - p1));
      logLossV2 -= (y * Math.log(p2) + (1 - y) * Math.log(1 - p2));
    });

    brierDiffs.push((brierV2 - brierV1) / nR);
    logLossDiffs.push((logLossV2 - logLossV1) / nR);
  }

  brierDiffs.sort((a,b)=>a-b);
  logLossDiffs.sort((a,b)=>a-b);

  const lowIdx = Math.floor(replications * 0.025);
  const highIdx = Math.floor(replications * 0.975);

  const brierCi = [Number(brierDiffs[lowIdx].toFixed(4)), Number(brierDiffs[highIdx].toFixed(4))];
  const logLossCi = [Number(logLossDiffs[lowIdx].toFixed(4)), Number(logLossDiffs[highIdx].toFixed(4))];

  return {
    numClusters,
    sampleSize: items.length,
    brierCi,
    logLossCi,
    isBrierSig: brierCi[1] < 0,
    isLogLossSig: logLossCi[1] < 0
  };
}

// 1. Cluster Bootstrap sobre el universo completo (114)
console.log('--- 1. Cluster Bootstrap Global (N=114, 5.000 Réplicas) ---');
const globalBoot = runClusterBootstrap(evaluable, 5000);
console.log('ΔBrier 95% CI:', globalBoot.brierCi, '| ¿Significativo?:', globalBoot.isBrierSig);
console.log('ΔLogLoss 95% CI:', globalBoot.logLossCi, '| ¿Significativo?:', globalBoot.isLogLossSig);

// 2. Cluster Bootstrap excluyendo mercados con alta dependencia del prior (sensibilidad > 12 p.p.)
const highDepIds = new Set([
  'cand_real_statshub_20261126_cska_sofia_shotsontarget_over',
  'cand_real_statshub_20261126_fk_crvena_zvezda_shotsontarget_over',
  'cand_real_statshub_20261125_vfb_stuttgart_shotsontarget_over',
  'cand_real_statshub_20261126_marseille_sot',
  'cand_real_statshub_20261124_mancity_sot_under'
]);
const robustSubset = evaluable.filter(p => !highDepIds.has(p.candidateId));
console.log('\n--- 2. Cluster Bootstrap de Robustez (Excluyendo outliers de prior extremo, N=' + robustSubset.length + ') ---');
const robustBoot = runClusterBootstrap(robustSubset, 5000);
console.log('ΔBrier 95% CI:', robustBoot.brierCi, '| ¿Significativo?:', robustBoot.isBrierSig);
console.log('ΔLogLoss 95% CI:', robustBoot.logLossCi, '| ¿Significativo?:', robustBoot.isLogLossSig);
