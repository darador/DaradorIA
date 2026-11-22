const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const results = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/research_candidates.json'), 'utf8'));

const decided = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA' || r.status === 'ACERTADA' || r.status === 'FALLADA');

console.log('Decided count:', decided.length);

// Enrich each observation
const enriched = decided.map(d => {
  const reg = registry.find(r => r.pickId === d.pickId) || {};
  const seal = ledger[d.pickId] || {};
  const cand = candidates.find(c => c.id === d.pickId) || {};

  const isWon = d.status === 'GANADA' || d.status === 'ACERTADA';
  const y = isWon ? 1 : 0;
  const stake = d.stakedUnits || 1.0;
  const profit = d.profitUnits !== undefined ? d.profitUnits : (isWon ? (d.odds - 1) * stake : -stake);

  const odds = d.odds;
  const pMarketImplied = Number((1 / odds).toFixed(4));
  const pB = seal.probModelB !== undefined ? seal.probModelB : (reg.probModelB || 0.8);
  const pC = seal.probModelC !== undefined ? seal.probModelC : (reg.probModelC || 0.8);
  const pEns = Number(((pB + pC) / 2).toFixed(4));
  const pBench = 0.625;

  const competition = reg.competition || cand.tournament || cand.league || 'Otras Ligas';
  const market = d.market || 'Otros';

  return {
    pickId: d.pickId,
    player: d.player,
    match: d.match,
    competition,
    market,
    date: d.date,
    odds,
    y,
    stake,
    profit,
    pMarketImplied,
    pB,
    pC,
    pEns,
    pBench,
    brierB: Math.pow(pB - y, 2),
    brierC: Math.pow(pC - y, 2),
    brierEns: Math.pow(pEns - y, 2),
    brierMarket: Math.pow(pMarketImplied - y, 2),
    brierBench: Math.pow(pBench - y, 2)
  };
});

// Breakdown by Market
const marketMap = {};
enriched.forEach(e => {
  if (!marketMap[e.market]) {
    marketMap[e.market] = { total: 0, won: 0, lost: 0, staked: 0, profit: 0, brierB: 0, brierEns: 0, brierMkt: 0 };
  }
  const m = marketMap[e.market];
  m.total++;
  if (e.y === 1) m.won++; else m.lost++;
  m.staked += e.stake;
  m.profit += e.profit;
  m.brierB += e.brierB;
  m.brierEns += e.brierEns;
  m.brierMkt += e.brierMarket;
});

const marketBreakdown = Object.keys(marketMap).map(k => {
  const m = marketMap[k];
  return {
    market: k,
    total: m.total,
    won: m.won,
    lost: m.lost,
    winRate: Number(((m.won / m.total) * 100).toFixed(1)),
    profit: Number(m.profit.toFixed(2)),
    yieldPct: Number(((m.profit / m.staked) * 100).toFixed(1)),
    avgBrierModelB: Number((m.brierB / m.total).toFixed(4)),
    avgBrierEnsemble: Number((m.brierEns / m.total).toFixed(4)),
    avgBrierMarket: Number((m.brierMkt / m.total).toFixed(4))
  };
});

// Breakdown by Competition
const compMap = {};
enriched.forEach(e => {
  if (!compMap[e.competition]) {
    compMap[e.competition] = { total: 0, won: 0, lost: 0, staked: 0, profit: 0, brierB: 0, brierEns: 0, brierMkt: 0 };
  }
  const c = compMap[e.competition];
  c.total++;
  if (e.y === 1) c.won++; else c.lost++;
  c.staked += e.stake;
  c.profit += e.profit;
  c.brierB += e.brierB;
  c.brierEns += e.brierEns;
  c.brierMkt += e.brierMarket;
});

const compBreakdown = Object.keys(compMap).map(k => {
  const c = compMap[k];
  return {
    competition: k,
    total: c.total,
    won: c.won,
    lost: c.lost,
    winRate: Number(((c.won / c.total) * 100).toFixed(1)),
    profit: Number(c.profit.toFixed(2)),
    yieldPct: Number(((c.profit / c.staked) * 100).toFixed(1)),
    avgBrierModelB: Number((c.brierB / c.total).toFixed(4)),
    avgBrierEnsemble: Number((c.brierEns / c.total).toFixed(4)),
    avgBrierMarket: Number((c.brierMkt / c.total).toFixed(4))
  };
});

// Calibration Bins for Model B & Ensemble
function calcBins(probKey) {
  const bins = [
    { label: '50% - 60%', min: 0.50, max: 0.60, count: 0, sumProb: 0, hits: 0 },
    { label: '60% - 70%', min: 0.60, max: 0.70, count: 0, sumProb: 0, hits: 0 },
    { label: '70% - 80%', min: 0.70, max: 0.80, count: 0, sumProb: 0, hits: 0 },
    { label: '80% - 90%', min: 0.80, max: 0.90, count: 0, sumProb: 0, hits: 0 },
    { label: '90% - 100%', min: 0.90, max: 1.01, count: 0, sumProb: 0, hits: 0 }
  ];

  enriched.forEach(e => {
    const p = e[probKey];
    const bin = bins.find(b => p >= b.min && p < b.max) || bins[bins.length - 1];
    bin.count++;
    bin.sumProb += p;
    if (e.y === 1) bin.hits++;
  });

  return bins.map(b => ({
    rango: b.label,
    n: b.count,
    probEsperadaPromedio: b.count > 0 ? Number(((b.sumProb / b.count) * 100).toFixed(1)) : 0,
    aciertoRealPct: b.count > 0 ? Number(((b.hits / b.count) * 100).toFixed(1)) : 0,
    brechaCalibracion: b.count > 0 ? Number((((b.hits / b.count) - (b.sumProb / b.count)) * 100).toFixed(1)) : 0
  }));
}

console.log('=== MARKET BREAKDOWN ===');
console.log(JSON.stringify(marketBreakdown, null, 2));

console.log('\n=== COMPETITION BREAKDOWN ===');
console.log(JSON.stringify(compBreakdown, null, 2));

console.log('\n=== CALIBRATION BINS MODEL B ===');
console.log(JSON.stringify(calcBins('pB'), null, 2));

console.log('\n=== CALIBRATION BINS ENSEMBLE ===');
console.log(JSON.stringify(calcBins('pEns'), null, 2));
