const fs = require('fs');

const cohortPath = 'engine/storage_data/shadow_lab_cohort_v2_2.json';
const cohortData = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const evaluable = (cohortData.predictions || []).filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA FORENSE FASE 2.7: CALIBRACIÓN POR DECILOS Y POR MERCADO ===\n');

function runCalibrationAudit(items, label) {
  console.log(`--- TABLA DE CALIBRACIÓN: ${label} (N=${items.length}) ---`);
  console.log('Decil      | Picks | Prob V1 | Hit Rate V1 | Gap V1  | Prob V2.2 | Hit Rate V2.2 | Gap V2.2 | IC 95% Wilson Hit Rate');
  console.log('-----------------------------------------------------------------------------------------------------------------');

  const binsV1 = Array.from({ length: 10 }, (_, i) => ({
    min: i * 0.10, max: (i + 1) * 0.10, label: `${i * 10}%-${(i + 1) * 10}%`,
    count: 0, sumProb: 0, hits: 0
  }));
  const binsV2 = Array.from({ length: 10 }, (_, i) => ({
    min: i * 0.10, max: (i + 1) * 0.10, label: `${i * 10}%-${(i + 1) * 10}%`,
    count: 0, sumProb: 0, hits: 0
  }));

  let brierV1 = 0;
  let brierV2 = 0;
  let logLossV1 = 0;
  let logLossV2 = 0;

  items.forEach(p => {
    const y = p.result.isWon ? 1 : 0;
    const p1 = Math.min(0.9999, Math.max(0.0001, p.pV1 || 0.5));
    const p2 = Math.min(0.9999, Math.max(0.0001, p.pV2 || 0.5));

    brierV1 += Math.pow(p1 - y, 2);
    brierV2 += Math.pow(p2 - y, 2);
    logLossV1 -= (y * Math.log(p1) + (1 - y) * Math.log(1 - p1));
    logLossV2 -= (y * Math.log(p2) + (1 - y) * Math.log(1 - p2));

    const idx1 = Math.min(9, Math.floor(p1 * 10));
    binsV1[idx1].count++;
    binsV1[idx1].sumProb += p1;
    binsV1[idx1].hits += y;

    const idx2 = Math.min(9, Math.floor(p2 * 10));
    binsV2[idx2].count++;
    binsV2[idx2].sumProb += p2;
    binsV2[idx2].hits += y;
  });

  let eceV1 = 0;
  let eceV2 = 0;
  const N = items.length;

  for (let i = 0; i < 10; i++) {
    const b1 = binsV1[i];
    const b2 = binsV2[i];

    const count2 = b2.count;
    const pMean2 = count2 > 0 ? b2.sumProb / count2 : 0;
    const rate2 = count2 > 0 ? b2.hits / count2 : 0;
    const gap2 = count2 > 0 ? Math.abs(rate2 - pMean2) : 0;
    if (count2 > 0) eceV2 += (count2 / N) * gap2;

    const count1 = b1.count;
    const pMean1 = count1 > 0 ? b1.sumProb / count1 : 0;
    const rate1 = count1 > 0 ? b1.hits / count1 : 0;
    const gap1 = count1 > 0 ? Math.abs(rate1 - pMean1) : 0;
    if (count1 > 0) eceV1 += (count1 / N) * gap1;

    // Wilson interval para el bin de V2.2
    let ciStr = '[- , -]';
    if (count2 > 0) {
      const z = 1.96;
      const denom = 1 + (z * z) / count2;
      const center = (rate2 + (z * z) / (2 * count2)) / denom;
      const half = (z * Math.sqrt((rate2 * (1 - rate2)) / count2 + (z * z) / (4 * count2 * count2))) / denom;
      ciStr = `[${(Math.max(0, center - half) * 100).toFixed(1)}%, ${(Math.min(1, center + half) * 100).toFixed(1)}%]`;
    }

    if (count1 > 0 || count2 > 0) {
      const lbl = b2.label.padEnd(10);
      const cStr = String(count2).padStart(5);
      const p1Str = count1 > 0 ? (pMean1 * 100).toFixed(1) + '%' : '-';
      const r1Str = count1 > 0 ? (rate1 * 100).toFixed(1) + '%' : '-';
      const g1Str = count1 > 0 ? (gap1 * 100).toFixed(1) + '%' : '-';
      const p2Str = count2 > 0 ? (pMean2 * 100).toFixed(1) + '%' : '-';
      const r2Str = count2 > 0 ? (rate2 * 100).toFixed(1) + '%' : '-';
      const g2Str = count2 > 0 ? (gap2 * 100).toFixed(1) + '%' : '-';

      console.log(`${lbl} | ${cStr} | ${p1Str.padStart(7)} | ${r1Str.padStart(11)} | ${g1Str.padStart(7)} | ${p2Str.padStart(9)} | ${r2Str.padStart(13)} | ${g2Str.padStart(8)} | ${ciStr}`);
    }
  }

  console.log('-----------------------------------------------------------------------------------------------------------------');
  console.log(`Brier Score V1: ${(brierV1 / N).toFixed(4)} | V2.2: ${(brierV2 / N).toFixed(4)} (Δ: ${((brierV2 - brierV1) / N).toFixed(4)})`);
  console.log(`Log Loss V1:    ${(logLossV1 / N).toFixed(4)} | V2.2: ${(logLossV2 / N).toFixed(4)} (Δ: ${((logLossV2 - logLossV1) / N).toFixed(4)})`);
  console.log(`ECE V1: ${(eceV1 * 100).toFixed(2)}% | V2.2: ${(eceV2 * 100).toFixed(2)}% (Δ: ${((eceV2 - eceV1) * 100).toFixed(2)} p.p.)\n`);
}

// 1. Evaluación global
runCalibrationAudit(evaluable, 'UNIVERSO GLOBAL EVALUABLE');

// 2. Desglose por mercados principales
const markets = ['Remates totales', 'Goles de equipo', 'Córners de equipo', 'Remates al arco de equipo', 'Faltas cometidas'];
markets.forEach(m => {
  const subset = evaluable.filter(p => (p.market || '').toLowerCase().includes(m.toLowerCase()));
  if (subset.length >= 8) {
    runCalibrationAudit(subset, `MERCADO: ${m.toUpperCase()}`);
  }
});
