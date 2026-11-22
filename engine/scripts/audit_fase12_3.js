const fs = require('fs');
const path = require('path');
const tracker = require('../prediction/observationTracker');

const rootDir = path.resolve(__dirname, '../..');
const reg = tracker._readRegistry().filter(o => !o.isTestPick);
const settled = reg.filter(o => o.verificationStatus === 'RESULTADO_CONFIRMADO' && (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));

// 1. Universo Global (19)
const univA = settled;

// 2. Universo Portfolio Elena (18)
const univB = settled.filter(o => o.pickId !== 'cand_1795110774831_6rsb2k');

function calcAll(list, label) {
  const N = list.length;
  let hits = 0;
  let sumBrierB = 0, sumLogLossB = 0;
  let sumBrierC = 0, sumLogLossC = 0;
  let sumProbB = 0, sumProbC = 0;
  let sumOdds = 0, sumInvOdds = 0;
  let profitUnits = 0;

  list.forEach(item => {
    const y = item.finalResultConfirmed === 'GANADA' ? 1 : 0;
    if (y === 1) hits++;
    const pB = item.probModelB;
    const pC = item.probModelC;
    const odds = item.odds;
    const invOdds = 1 / odds;
    const profit = item.profitUnits !== undefined && item.profitUnits !== null ? item.profitUnits : (y === 1 ? odds - 1 : -1);

    profitUnits += profit;
    sumProbB += pB;
    sumProbC += pC;
    sumOdds += odds;
    sumInvOdds += invOdds;

    sumBrierB += Math.pow(pB - y, 2);
    sumLogLossB += -(y * Math.log(pB) + (1 - y) * Math.log(1 - pB));
    sumBrierC += Math.pow(pC - y, 2);
    sumLogLossC += -(y * Math.log(pC) + (1 - y) * Math.log(1 - pC));
  });

  const meanOdds = sumOdds / N;
  const meanMktProb = sumInvOdds / N;
  const winRate = hits / N;
  const yieldPct = profitUnits / N;

  console.log('=== ' + label + ' ===');
  console.log('N:', N, 'Hits:', hits, 'Losses:', N - hits);
  console.log('WinRate: ' + (winRate * 100).toFixed(1) + '% (' + winRate.toFixed(4) + ')');
  console.log('Stake: ' + N.toFixed(1) + ' U');
  console.log('Profit: ' + (profitUnits >= 0 ? '+' : '') + profitUnits.toFixed(2) + ' U');
  console.log('Yield: ' + (yieldPct >= 0 ? '+' : '') + (yieldPct * 100).toFixed(2) + '% (' + (yieldPct * 100).toFixed(1) + '%)');
  console.log('Brier B: ' + (sumBrierB / N).toFixed(4));
  console.log('LogLoss B: ' + (sumLogLossB / N).toFixed(4));
  console.log('Brier C: ' + (sumBrierC / N).toFixed(4));
  console.log('LogLoss C: ' + (sumLogLossC / N).toFixed(4));
  console.log('Prob Media B: ' + ((sumProbB / N) * 100).toFixed(1) + '%');
  console.log('Prob Media C: ' + ((sumProbC / N) * 100).toFixed(1) + '%');
  console.log('Cuota Media: ' + meanOdds.toFixed(4));
  console.log('1 / Cuota Media: ' + ((1 / meanOdds) * 100).toFixed(2) + '% (' + (1 / meanOdds).toFixed(4) + ')');
  console.log('Media Prob Implicitas: ' + (meanMktProb * 100).toFixed(2) + '% (' + meanMktProb.toFixed(4) + ')');
  console.log('Brecha Descriptiva: ' + ((winRate - meanMktProb) >= 0 ? '+' : '') + ((winRate - meanMktProb) * 100).toFixed(2) + '%');

  // Wilson 95%
  const z = 1.96;
  const p = winRate;
  const denominator = 1 + (z * z) / N;
  const center = p + (z * z) / (2 * N);
  const spread = z * Math.sqrt((p * (1 - p)) / N + (z * z) / (4 * N * N));
  const lower = Math.max(0, (center - spread) / denominator);
  const upper = Math.min(1, (center + spread) / denominator);
  console.log('IC Wilson 95%: [' + (lower * 100).toFixed(1) + '%, ' + (upper * 100).toFixed(1) + '%]');

  console.log('\n--- TABLA DE CALIBRACION B ---');
  const bins = ['[0.00, 0.50)', '[0.50, 0.60)', '[0.60, 0.70)', '[0.70, 0.80)', '[0.80, 0.90)', '[0.90, 1.00]'];
  bins.forEach(b => {
    const subset = list.filter(item => tracker.getBinForProbability(item.probModelB) === b);
    const nB = subset.length;
    const kB = subset.filter(item => item.finalResultConfirmed === 'GANADA').length;
    const pSumB = subset.reduce((acc, item) => acc + item.probModelB, 0);
    const meanPB = nB > 0 ? pSumB / nB : 0;
    const hrB = nB > 0 ? kB / nB : 0;
    console.log(b + ': n=' + nB + ', k=' + kB + ' (' + (hrB * 100).toFixed(1) + '%), meanProb=' + (meanPB * 100).toFixed(1) + '%');
  });

  console.log('\n--- TABLA DE CALIBRACION C ---');
  bins.forEach(b => {
    const subset = list.filter(item => tracker.getBinForProbability(item.probModelC) === b);
    const nC = subset.length;
    const kC = subset.filter(item => item.finalResultConfirmed === 'GANADA').length;
    const pSumC = subset.reduce((acc, item) => acc + item.probModelC, 0);
    const meanPC = nC > 0 ? pSumC / nC : 0;
    const hrC = nC > 0 ? kC / nC : 0;
    console.log(b + ': n=' + nC + ', k=' + kC + ' (' + (hrC * 100).toFixed(1) + '%), meanProb=' + (meanPC * 100).toFixed(1) + '%');
  });
}

calcAll(univA, 'UNIVERSO A: GLOBAL DE PREDICCIONES (19 OBSERVACIONES DECIDIDAS)');
console.log('\n' + '='.repeat(60) + '\n');
calcAll(univB, 'UNIVERSO B: PORTFOLIO ELENA (18 OBSERVACIONES DECIDIDAS)');
