const fs = require('fs');
const path = require('path');
const tracker = require('../prediction/observationTracker');

const rootDir = path.resolve(__dirname, '../..');
const reg = tracker._readRegistry().filter(o => !o.isTestPick);
const settled = reg.filter(o => o.verificationStatus === 'RESULTADO_CONFIRMADO' && (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));

console.log('=== AUDITORIA FASE 12.2 - REPRODUCCION EXACTA ===');
console.log('Total observaciones liquidadas auditadas:', settled.length);

let sumBrierB = 0, sumLogLossB = 0;
let sumBrierC = 0, sumLogLossC = 0;
let sumProbB = 0, sumProbC = 0;
let sumOdds = 0, sumInvOdds = 0;
let hits = 0;

const rows = settled.map((s, i) => {
  const seal = ledger[s.pickId];
  const y = s.finalResultConfirmed === 'GANADA' ? 1 : 0;
  if (y === 1) hits++;

  const pB = s.probModelB;
  const pC = s.probModelC;
  const odds = s.odds;
  const invOdds = 1 / odds;

  sumProbB += pB;
  sumProbC += pC;
  sumOdds += odds;
  sumInvOdds += invOdds;

  const brierB = Math.pow(pB - y, 2);
  const logLossB = -(y * Math.log(pB) + (1 - y) * Math.log(1 - pB));
  const brierC = Math.pow(pC - y, 2);
  const logLossC = -(y * Math.log(pC) + (1 - y) * Math.log(1 - pC));

  sumBrierB += brierB;
  sumLogLossB += logLossB;
  sumBrierC += brierC;
  sumLogLossC += logLossC;

  return {
    index: i + 1,
    pickId: s.pickId,
    event: s.event,
    playerOrTeam: s.playerOrTeam,
    market: s.market,
    line: s.line,
    odds,
    invOdds,
    y,
    outcome: s.finalResultConfirmed,
    pB,
    pC,
    brierB,
    logLossB,
    brierC,
    logLossC,
    binB: tracker.getBinForProbability(pB),
    binC: tracker.getBinForProbability(pC),
    sealHashMatch: seal && seal.probModelB === pB && seal.probModelC === pC
  };
});

const N = settled.length;

console.log('\n--- METRICAS GLOBALES ---');
console.log('N:', N);
console.log('Hits (Ganadas):', hits, `(${((hits/N)*100).toFixed(1)}%)`);
console.log('Brier B:', (sumBrierB / N).toFixed(4));
console.log('LogLoss B:', (sumLogLossB / N).toFixed(4));
console.log('Brier C:', (sumBrierC / N).toFixed(4));
console.log('LogLoss C:', (sumLogLossC / N).toFixed(4));
console.log('Prob Media B:', ((sumProbB / N) * 100).toFixed(2) + '%', `(${(sumProbB / N).toFixed(4)})`);
console.log('Prob Media C:', ((sumProbC / N) * 100).toFixed(2) + '%', `(${(sumProbC / N).toFixed(4)})`);
console.log('Cuota Media:', (sumOdds / N).toFixed(4));
console.log('1 / Cuota Media:', (1 / (sumOdds / N)).toFixed(4), `(${((1 / (sumOdds / N)) * 100).toFixed(2)}%)`);
console.log('Media Probabilidades Implicitas Individuales:', (sumInvOdds / N).toFixed(4), `(${((sumInvOdds / N) * 100).toFixed(2)}%)`);

console.log('\n--- TABLA DE CALIBRACION MODELO B ---');
const binsBDef = ['[0.00, 0.50)', '[0.50, 0.60)', '[0.60, 0.70)', '[0.70, 0.80)', '[0.80, 0.90)', '[0.90, 1.00]'];
binsBDef.forEach(b => {
  const matches = rows.filter(r => r.binB === b);
  const n = matches.length;
  const k = matches.filter(r => r.y === 1).length;
  const pSum = matches.reduce((acc, r) => acc + r.pB, 0);
  const meanP = n > 0 ? (pSum / n) : 0;
  const hitRate = n > 0 ? (k / n) : 0;
  console.log(`${b}: n=${n}, k=${k}, hitRate=${(hitRate*100).toFixed(1)}%, meanProb=${(meanP*100).toFixed(1)}%`);
});

console.log('\n--- TABLA DE CALIBRACION MODELO C ---');
binsBDef.forEach(b => {
  const matches = rows.filter(r => r.binC === b);
  const n = matches.length;
  const k = matches.filter(r => r.y === 1).length;
  const pSum = matches.reduce((acc, r) => acc + r.pC, 0);
  const meanP = n > 0 ? (pSum / n) : 0;
  const hitRate = n > 0 ? (k / n) : 0;
  console.log(`${b}: n=${n}, k=${k}, hitRate=${(hitRate*100).toFixed(1)}%, meanProb=${(meanP*100).toFixed(1)}%`);
});
