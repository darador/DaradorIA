const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const results = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));

const decided = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA' || r.status === 'ACERTADA' || r.status === 'FALLADA');

console.log('Observations count:', decided.length);

const items = decided.map((d, i) => {
  const reg = registry.find(r => r.pickId === d.pickId);
  const seal = ledger[d.pickId] || {};

  const isWon = d.status === 'GANADA' || d.status === 'ACERTADA';
  const y = isWon ? 1 : 0;

  const odds = d.odds;
  const pMarketImplied = Number((1 / odds).toFixed(4));

  const pB = seal.probModelB !== undefined ? seal.probModelB : (reg ? reg.probModelB : 0.8);
  const pC = seal.probModelC !== undefined ? seal.probModelC : (reg ? reg.probModelC : 0.8);
  const pEns = Number(((pB + pC) / 2).toFixed(4));
  const pBench = 0.625; // Benchmark naive fijo

  function brier(p, target) {
    return Math.pow(p - target, 2);
  }

  function logLoss(p, target) {
    const clamped = Math.max(0.0001, Math.min(0.9999, p));
    return -(target * Math.log(clamped) + (1 - target) * Math.log(1 - clamped));
  }

  return {
    index: i + 1,
    pickId: d.pickId,
    player: d.player,
    match: d.match,
    date: d.date,
    market: d.market,
    odds,
    outcome: isWon ? 'GANADA' : 'PERDIDA',
    y,
    isElenaApproved: d.pickId !== 'cand_1795110774831_6rsb2k',
    pBench,
    pMarketImplied,
    pB,
    pC,
    pEns,
    brierBench: brier(pBench, y),
    logLossBench: logLoss(pBench, y),
    brierMarket: brier(pMarketImplied, y),
    logLossMarket: logLoss(pMarketImplied, y),
    brierB: brier(pB, y),
    logLossB: logLoss(pB, y),
    brierC: brier(pC, y),
    logLossC: logLoss(pC, y),
    brierEns: brier(pEns, y),
    logLossEns: logLoss(pEns, y),
    preMatchHash: seal.preMatchHash || 'N/A'
  };
});

function summarize(list, label) {
  const n = list.length;
  const avg = (fn) => list.reduce((acc, x) => acc + fn(x), 0) / n;

  return {
    label,
    n,
    won: list.filter(x => x.y === 1).length,
    lost: list.filter(x => x.y === 0).length,
    winRate: Number(((list.filter(x => x.y === 1).length / n) * 100).toFixed(1)),
    brierBench: Number(avg(x => x.brierBench).toFixed(4)),
    logLossBench: Number(avg(x => x.logLossBench).toFixed(4)),
    brierMarket: Number(avg(x => x.brierMarket).toFixed(4)),
    logLossMarket: Number(avg(x => x.logLossMarket).toFixed(4)),
    brierB: Number(avg(x => x.brierB).toFixed(4)),
    logLossB: Number(avg(x => x.logLossB).toFixed(4)),
    brierC: Number(avg(x => x.brierC).toFixed(4)),
    logLossC: Number(avg(x => x.logLossC).toFixed(4)),
    brierEns: Number(avg(x => x.brierEns).toFixed(4)),
    logLossEns: Number(avg(x => x.logLossEns).toFixed(4))
  };
}

console.log('=== SUMMARY: UNIVERSO A (TODAS LAS 19 OBSERVACIONES) ===');
console.log(summarize(items, 'Universo A: Global Auditado (19 Obs)'));

console.log('\n=== SUMMARY: UNIVERSO B (ELENA APPROVED - 18 OBSERVACIONES) ===');
console.log(summarize(items.filter(x => x.isElenaApproved), 'Universo B: Elena Approved (18 Obs)'));

console.log('\n=== DETAILED ITEM TABLE ===');
items.forEach(it => {
  console.log(`${it.index}. [${it.outcome}] ${it.pickId} | Odds: ${it.odds} (pMkt: ${it.pMarketImplied}) | pB: ${it.pB} | pC: ${it.pC} | pEns: ${it.pEns}`);
  console.log(`   Brier -> Mkt: ${it.brierMarket.toFixed(4)}, ModB: ${it.brierB.toFixed(4)}, ModC: ${it.brierC.toFixed(4)}, Ens: ${it.brierEns.toFixed(4)}, Bench: ${it.brierBench.toFixed(4)}`);
  console.log(`   LogLoss -> Mkt: ${it.logLossMarket.toFixed(4)}, ModB: ${it.logLossB.toFixed(4)}, ModC: ${it.logLossC.toFixed(4)}, Ens: ${it.logLossEns.toFixed(4)}, Bench: ${it.logLossBench.toFixed(4)}`);
});
