const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];

console.log('Total de predicciones en store:', preds.length);

const evaluable = preds.filter(p => p.isSettled && p.result && !p.result.isVoid);
console.log('Total evaluables (no nulas):', evaluable.length);

// 1. Estadísticas descriptivas de pV2 y pV1
const v2Vals = evaluable.map(p => Number(p.pV2));
const v1Vals = evaluable.map(p => Number(p.pV1)).filter(Number.isFinite);

function getStats(arr, name) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const sum = arr.reduce((a, b) => a + b, 0);
  const mean = sum / arr.length;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance = arr.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / arr.length;
  const stdDev = Math.sqrt(variance);

  const exact050 = arr.filter(v => v === 0.50).length;
  const between49and51 = arr.filter(v => v >= 0.49 && v <= 0.51).length;
  const outside49and51 = arr.filter(v => v < 0.49 || v > 0.51).length;

  return {
    name,
    count: arr.length,
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    mean: Number(mean.toFixed(4)),
    median: Number(median.toFixed(4)),
    stdDev: Number(stdDev.toFixed(4)),
    exact050,
    between49and51,
    outside49and51
  };
}

console.log('\n--- DISTRIBUCIÓN DE PROBABILIDADES V2 VS V1 ---');
console.log(getStats(v2Vals, 'MODELO V2'));
console.log(getStats(v1Vals, 'MODELO V1'));

// 2. Revisión de campos de entrada en las predicciones congeladas
let countEmptyHistory = 0;
let countSampleZero = 0;
let countDqeInvalid = 0;
let countDqeLimited = 0;
let countDqeValid = 0;
const dqeReasons = {};

evaluable.forEach(p => {
  const histLen = Array.isArray(p.historicalSample) ? p.historicalSample.length : 0;
  if (histLen === 0) countEmptyHistory++;
  if (p.sampleSize === 0 || p.sampleSize === undefined) countSampleZero++;

  if (p.dqeStatus === 'INVALID') countDqeInvalid++;
  else if (p.dqeStatus === 'LIMITED') countDqeLimited++;
  else if (p.dqeStatus === 'VALID') countDqeValid++;

  if (p.dqeIssues && p.dqeIssues.length > 0) {
    p.dqeIssues.forEach(iss => {
      dqeReasons[iss] = (dqeReasons[iss] || 0) + 1;
    });
  }
});

console.log('\n--- DIAGNÓSTICO DE ENTRADAS CONGELADAS (114 EVALUABLES) ---');
console.log('Series históricas vacías (historicalSample.length === 0):', countEmptyHistory);
console.log('sampleSize === 0:', countSampleZero);
console.log('Estado DQE: VALID:', countDqeValid, '| LIMITED:', countDqeLimited, '| INVALID:', countDqeInvalid);
console.log('Principales motivos de DQE Issues:', dqeReasons);

// Muestra de los primeros 5 registros
console.log('\n--- MUESTRA DE 5 REGISTROS EVALUABLES DE V2 ---');
evaluable.slice(0, 5).forEach(p => {
  console.log({
    id: p.candidateId,
    match: p.match,
    market: p.market,
    selection: p.selection,
    odds: p.odds,
    pV1: p.pV1,
    pV2: p.pV2,
    pShrinkage: p.pShrinkage,
    pCountDistribution: p.pCountDistribution,
    dqeStatus: p.dqeStatus,
    dqeIssues: p.dqeIssues,
    historicalSampleSize: p.historicalSample?.length
  });
});
