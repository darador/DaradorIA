const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];
const settledNonVoid = preds.filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA FINANCIERA SEGMENTADA (V1 VS V2) ===\n');

// 1. Apuestas ejecutadas en producción (status === APROBADO) vs Shadow Mode
const executedPicks = settledNonVoid.filter(p => p.isExecutedInProduction);
const shadowOnlyPicks = settledNonVoid.filter(p => !p.isExecutedInProduction);

function calcFinancials(items, name) {
  let won = 0;
  let lost = 0;
  let staked = 0;
  let profit = 0;
  let peak = 0;
  let maxDD = 0;
  let sumOdds = 0;
  let sumEvV1 = 0;
  let sumEvV2 = 0;

  items.forEach(p => {
    const odds = Number(p.odds || 1.80);
    const stake = 1.0;
    staked += stake;
    sumOdds += odds;
    sumEvV1 += Number(p.evV1 || 0);
    sumEvV2 += Number(p.grossEvV2 || 0);

    if (p.result.isWon) {
      won++;
      profit += (odds - 1.0) * stake;
    } else {
      lost++;
      profit -= stake;
    }

    if (profit > peak) peak = profit;
    const dd = peak - profit;
    if (dd > maxDD) maxDD = dd;
  });

  const total = won + lost;
  const winRate = total > 0 ? (won / total) * 100 : 0;
  const roi = staked > 0 ? (profit / staked) * 100 : 0;
  const avgOdds = total > 0 ? sumOdds / total : 0;
  const avgEvV1 = total > 0 ? sumEvV1 / total : 0;
  const avgEvV2 = total > 0 ? sumEvV2 / total : 0;

  console.log('--- ' + name + ' (N=' + total + ') ---');
  console.log('  Win Rate: ' + winRate.toFixed(1) + '% (' + won + '/' + total + ')');
  console.log('  Cuota Promedio: @' + avgOdds.toFixed(2));
  console.log('  Staked: ' + staked.toFixed(2) + 'U | Net Profit: ' + (profit >= 0 ? '+' : '') + profit.toFixed(2) + 'U');
  console.log('  ROI / Yield: ' + (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%');
  console.log('  Max Drawdown: -' + maxDD.toFixed(2) + 'U');
  console.log('  EV Promedio Estimado V1: +' + avgEvV1.toFixed(1) + '% | Discrepancia vs ROI: ' + (roi - avgEvV1).toFixed(1) + ' p.p.');
  console.log('  EV Promedio Estimado V2: ' + (avgEvV2 >= 0 ? '+' : '') + avgEvV2.toFixed(1) + '% | Discrepancia vs ROI: ' + (roi - avgEvV2).toFixed(1) + ' p.p.\n');
}

calcFinancials(settledNonVoid, 'UNIVERSO TOTAL EVALUABLE (114 PICKS)');
calcFinancials(executedPicks, 'APUESTAS EJECUTADAS EN PRODUCCIÓN (APROBADAS)');
calcFinancials(shadowOnlyPicks, 'SELECCIONES PURAS EN SHADOW MODE');
