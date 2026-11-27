const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];
const evaluable = preds.filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA DEL TRIBUNAL: 79 APROBADOS VS 35 SHADOW MODE ===\n');

const approved = evaluable.filter(p => p.isExecutedInProduction);
const shadow = evaluable.filter(p => !p.isExecutedInProduction);

function analyzeGroup(items, label) {
  const count = items.length;
  let won = 0;
  let lost = 0;
  let staked = 0;
  let profit = 0;
  let sumOdds = 0;
  let sumV1 = 0;
  let sumV2 = 0;

  const oddsRanges = {
    '1.10 - 1.40': 0,
    '1.41 - 1.70': 0,
    '1.71 - 2.00': 0,
    '> 2.00': 0
  };

  const markets = {};
  const leagues = {};

  items.forEach(p => {
    const odds = Number(p.odds || 1.80);
    staked += 1.0;
    sumOdds += odds;
    sumV1 += (p.pV1 || 0) * 100;
    sumV2 += (p.pV2 || 0) * 100;

    if (p.result.isWon) {
      won++;
      profit += (odds - 1.0);
    } else {
      lost++;
      profit -= 1.0;
    }

    if (odds <= 1.40) oddsRanges['1.10 - 1.40']++;
    else if (odds <= 1.70) oddsRanges['1.41 - 1.70']++;
    else if (odds <= 2.00) oddsRanges['1.71 - 2.00']++;
    else oddsRanges['> 2.00']++;

    const m = p.market || 'Otros';
    markets[m] = (markets[m] || 0) + 1;

    const l = p.competition || 'Otras Ligas';
    leagues[l] = (leagues[l] || 0) + 1;
  });

  const winRate = (won / count) * 100;
  const roi = (profit / staked) * 100;
  const avgOdds = sumOdds / count;
  const avgV1 = sumV1 / count;
  const avgV2 = sumV2 / count;

  console.log('GRUPO: ' + label + ' (N=' + count + ')');
  console.log('  Win Rate: ' + winRate.toFixed(1) + '% (' + won + '/' + count + ')');
  console.log('  ROI / Yield: ' + (roi >= 0 ? '+' : '') + roi.toFixed(1) + '% | Beneficio Neto: ' + (profit >= 0 ? '+' : '') + profit.toFixed(2) + 'U');
  console.log('  Cuota Promedio: @' + avgOdds.toFixed(2));
  console.log('  Probabilidad Estimada Media V1: ' + avgV1.toFixed(1) + '%');
  console.log('  Probabilidad Estimada Media V2: ' + avgV2.toFixed(1) + '%');
  console.log('  Distribución de Cuotas:', oddsRanges);
  
  // Top 3 Mercados
  const topMarkets = Object.entries(markets).sort((a,b) => b[1] - a[1]).slice(0, 3);
  console.log('  Top Mercados:', topMarkets.map(x => x[0] + ' (' + x[1] + ')').join(', '));

  // Top 3 Ligas
  const topLeagues = Object.entries(leagues).sort((a,b) => b[1] - a[1]).slice(0, 3);
  console.log('  Top Ligas:', topLeagues.map(x => x[0] + ' (' + x[1] + ')').join(', '));
  console.log('------------------------------------------------------------\n');
}

analyzeGroup(approved, '79 APUESTAS APROBADAS POR EL TRIBUNAL (ELENA)');
analyzeGroup(shadow, '35 CANDIDATOS DESCARTADOS / SHADOW MODE');
