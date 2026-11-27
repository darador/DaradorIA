const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];
const settledNonVoid = preds.filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA DETALLADA DE CALIBRACIÓN (10 DECILOS) ===\n');

function buildCalibrationTable(probKey, name) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    min: i * 0.10,
    max: (i + 1) * 0.10,
    label: (i * 10) + '% - ' + ((i + 1) * 10) + '%',
    count: 0,
    sumProb: 0,
    hits: 0
  }));

  settledNonVoid.forEach(item => {
    const p = Math.min(0.9999, Math.max(0.0001, item[probKey] || 0.5));
    const y = item.result.isWon ? 1 : 0;
    const binIdx = Math.min(9, Math.floor(p * 10));
    bins[binIdx].count++;
    bins[binIdx].sumProb += p;
    bins[binIdx].hits += y;
  });

  console.log('TABLA DE CALIBRACIÓN: ' + name);
  console.log('Intervalo | Picks | Prob Media Est. | Tasa Real Hits | Gap Error | IC 95% Wilson Hit Rate');
  console.log('-----------------------------------------------------------------------------------------');

  let ece = 0;
  const total = settledNonVoid.length;

  bins.forEach(b => {
    if (b.count > 0) {
      const pMean = b.sumProb / b.count;
      const hitRate = b.hits / b.count;
      const gap = Math.abs(hitRate - pMean);
      ece += (b.count / total) * gap;

      // Wilson Score Interval 95%
      const z = 1.96;
      const denom = 1 + (z * z) / b.count;
      const center = (hitRate + (z * z) / (2 * b.count)) / denom;
      const half = (z * Math.sqrt((hitRate * (1 - hitRate)) / b.count + (z * z) / (4 * b.count * b.count))) / denom;
      const ciLower = Math.max(0, center - half);
      const ciUpper = Math.min(1, center + half);

      const pMeanPct = (pMean * 100).toFixed(1) + '%';
      const hitRatePct = (hitRate * 100).toFixed(1) + '%';
      const gapPct = (gap * 100).toFixed(1) + '%';
      const ciStr = '[' + (ciLower * 100).toFixed(1) + '%, ' + (ciUpper * 100).toFixed(1) + '%]';

      console.log(b.label.padEnd(10) + '| ' + String(b.count).padStart(5) + ' | ' + pMeanPct.padStart(15) + ' | ' + hitRatePct.padStart(14) + ' | ' + gapPct.padStart(9) + ' | ' + ciStr);
    } else {
      console.log(b.label.padEnd(10) + '|     0 |               - |              - |         - | [-, -]');
    }
  });

  console.log('Expected Calibration Error (ECE) Global: ' + (ece * 100).toFixed(2) + '%\n');
}

buildCalibrationTable('pV1', 'MODELO V1 (PRODUCCIÓN ACTUAL)');
buildCalibrationTable('pV2', 'MODELO V2 (SHADOW LAB CALIBRADO)');
