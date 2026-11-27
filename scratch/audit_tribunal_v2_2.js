const fs = require('fs');
const path = require('path');
const storeData = JSON.parse(fs.readFileSync(path.join(__dirname, '../engine/storage_data/shadow_lab_cohort_v2_2.json'), 'utf8'));
const evaluable = (storeData.predictions || []).filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== EVALUACIÓN DEL TRIBUNAL SOBRE V2.2 (79 APROBADOS VS 35 SHADOW) ===\n');

const approved = evaluable.filter(p => p.isExecutedInProduction);
const shadow = evaluable.filter(p => !p.isExecutedInProduction);

function evaluateTribunalSegment(items, label) {
  let brierV1 = 0;
  let brierV2 = 0;
  let logLossV1 = 0;
  let logLossV2 = 0;
  let won = 0;
  let total = items.length;
  let staked = 0;
  let profit = 0;
  let sumEvV1 = 0;
  let sumEvV2 = 0;

  items.forEach(p => {
    const y = p.result.isWon ? 1 : 0;
    const p1 = Math.min(0.9999, Math.max(0.0001, p.pV1 || 0.5));
    const p2 = Math.min(0.9999, Math.max(0.0001, p.pV2 || 0.5));
    const odds = Number(p.odds || 1.80);

    brierV1 += Math.pow(p1 - y, 2);
    brierV2 += Math.pow(p2 - y, 2);
    logLossV1 -= (y * Math.log(p1) + (1 - y) * Math.log(1 - p1));
    logLossV2 -= (y * Math.log(p2) + (1 - y) * Math.log(1 - p2));

    staked += 1.0;
    sumEvV1 += Number(p.evV1 || 0);
    sumEvV2 += Number(p.grossEvV2 || 0);

    if (y === 1) {
      won++;
      profit += (odds - 1.0);
    } else {
      profit -= 1.0;
    }
  });

  console.log('SEGMENTO: ' + label + ' (N=' + total + ')');
  console.log('  Win Rate: ' + ((won / total) * 100).toFixed(1) + '% (' + won + '/' + total + ')');
  console.log('  ROI: ' + ((profit / staked) * 100).toFixed(1) + '% | PnL: ' + (profit >= 0 ? '+' : '') + profit.toFixed(2) + 'U');
  console.log('  Brier Score V1 vs V2.2: ' + (brierV1 / total).toFixed(4) + ' vs ' + (brierV2 / total).toFixed(4) + ' (Dif: ' + ((brierV2 - brierV1) / total).toFixed(4) + ')');
  console.log('  Log Loss V1 vs V2.2:    ' + (logLossV1 / total).toFixed(4) + ' vs ' + (logLossV2 / total).toFixed(4) + ' (Dif: ' + ((logLossV2 - logLossV1) / total).toFixed(4) + ')');
  console.log('  EV Medio Estimado V1:   +' + (sumEvV1 / total).toFixed(1) + '%');
  console.log('  EV Medio Estimado V2.2: ' + (sumEvV2 / total >= 0 ? '+' : '') + (sumEvV2 / total).toFixed(1) + '%\n');
}

evaluateTribunalSegment(approved, 'APROBADAS POR EL TRIBUNAL (ELENA)');
evaluateTribunalSegment(shadow, 'DESCARTADAS / PURAS SHADOW MODE');
