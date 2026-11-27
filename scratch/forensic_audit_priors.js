const fs = require('fs');

const cohortPath = 'engine/storage_data/shadow_lab_cohort_v2_2.json';
const cohortData = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const evaluable = (cohortData.predictions || []).filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA FORENSE FASE 2.7: CONTRATOS, PRIORS Y SENSIBILIDAD ===\n');

// 1. Desglose de contratos
const contractCounts = {};
evaluable.forEach(p => {
  const c = p.contractType || 'UNKNOWN';
  contractCounts[c] = (contractCounts[c] || 0) + 1;
});
console.log('Distribución de Contratos en la muestra evaluable (N=114):', contractCounts);

// 2. Análisis de Priors aplicados y Sensibilidad
// Fórmula Beta: P = (s + alpha) / (n + alpha + beta)
// Si modificamos la fuerza del prior (strength = alpha + beta):
// Caso A: Prior Actual (fuerza 7.5 - 9.0)
// Caso B: Prior Débil (alpha=1, beta=1, fuerza 2.0 -> regla de Laplace)
// Caso C: Prior Fuerte (alpha*2, beta*2, fuerza 16.0)

const priorsConfig = {
  'remates totales': { alpha: 4.5, beta: 3.0 },
  'remates al arco': { alpha: 3.8, beta: 3.2 },
  'faltas cometidas': { alpha: 4.8, beta: 3.2 },
  'faltas ganadas': { alpha: 4.2, beta: 3.8 },
  'entradas (tackles)': { alpha: 4.0, beta: 3.5 },
  'córners de equipo': { alpha: 5.0, beta: 3.0 },
  'remates de equipo': { alpha: 4.8, beta: 4.0 },
  'remates al arco de equipo': { alpha: 4.2, beta: 4.8 },
  'goles de equipo': { alpha: 3.8, beta: 4.2 },
  'goles totales': { alpha: 4.2, beta: 3.8 },
  'default': { alpha: 4.0, beta: 4.0 }
};

let highPriorSensitivityCount = 0;
const sensitivityReport = [];

evaluable.forEach(p => {
  const mKey = (p.market || '').toLowerCase();
  const prior = priorsConfig[mKey] || priorsConfig['default'];
  const n = p.historicalSampleSize || 10;
  
  // Reconstruir s a partir de pV2 y el prior
  // pV2 = (s + alpha) / (n + alpha + beta) -> s = pV2 * (n + alpha + beta) - alpha
  const priorStrength = prior.alpha + prior.beta;
  const s = Math.round(p.pV2 * (n + priorStrength) - prior.alpha);
  const rawHitRate = s / n;

  // Variación A: Prior débil (Laplace Uniforme: alpha=1, beta=1)
  const pWeakPrior = (s + 1.0) / (n + 2.0);

  // Variación B: Prior fuerte (Doble peso del prior: alpha*2, beta*2)
  const pStrongPrior = (s + prior.alpha * 2) / (n + priorStrength * 2);

  const deltaWeak = Math.abs(p.pV2 - pWeakPrior);
  const deltaStrong = Math.abs(p.pV2 - pStrongPrior);

  // Sensibilidad alta si el cambio de prior mueve más de 6 puntos porcentuales la probabilidad
  const isHighSensitivity = deltaWeak > 0.06 || deltaStrong > 0.06;
  if (isHighSensitivity) highPriorSensitivityCount++;

  sensitivityReport.push({
    id: p.candidateId,
    market: p.market,
    selection: p.selection,
    n,
    successes: s,
    rawHitRate: Number((rawHitRate * 100).toFixed(1)),
    priorAlpha: prior.alpha,
    priorBeta: prior.beta,
    priorMean: Number(((prior.alpha / priorStrength) * 100).toFixed(1)),
    pV2: Number((p.pV2 * 100).toFixed(1)),
    pWeakPrior: Number((pWeakPrior * 100).toFixed(1)),
    pStrongPrior: Number((pStrongPrior * 100).toFixed(1)),
    deltaWeakPct: Number((deltaWeak * 100).toFixed(1)),
    isHighSensitivity
  });
});

console.log('Resultados de Sensibilidad a los Priors:');
console.log('  Total de candidatos evaluados:', sensitivityReport.length);
console.log('  Candidatos con alta sensibilidad al prior (delta > 6 p.p.):', highPriorSensitivityCount, `(${(highPriorSensitivityCount/sensitivityReport.length*100).toFixed(1)}%)`);

console.log('\n--- MUESTRA DE 5 CANDIDATOS CON MAYOR DEPENDENCIA DEL PRIOR ---');
sensitivityReport.sort((a,b) => b.deltaWeakPct - a.deltaWeakPct);
console.table(sensitivityReport.slice(0, 5));
