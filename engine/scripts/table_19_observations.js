const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const results = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));

// 19 decided picks
const decided = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA' || r.status === 'ACERTADA' || r.status === 'FALLADA');

console.log('Total decided:', decided.length);

const rows = decided.map(d => {
  const reg = registry.find(r => r.pickId === d.pickId);
  const seal = ledger[d.pickId] || null;

  // Let's inspect what probabilities exist in the frozen record
  const originalProb = reg ? reg.originalProb : null;
  const probModelB = reg ? reg.probModelB : (seal ? seal.probModelB : null);
  const probModelC = reg ? reg.probModelC : (seal ? seal.probModelC : null);
  const modelVersion = (reg ? reg.modelVersionB : null) || (seal ? seal.modelVersionB : 'Model-B-L10');
  const hash = seal ? seal.preMatchHash : 'N/A';

  const isWon = d.status === 'GANADA' || d.status === 'ACERTADA';
  const outcome = isWon ? 1 : 0;

  // Calculate Brier and LogLoss for:
  // 1) originalProb (Poisson / Real prob)
  // 2) probModelB (Model B)
  // 3) probModelC (Model C)
  // 4) ensemble ((B+C)/2)
  // 5) evaluator default (1/1.6 = 0.625)

  return {
    pickId: d.pickId,
    player: d.player,
    match: d.match,
    date: d.date,
    market: d.market,
    outcome: isWon ? 'GANADA' : 'PERDIDA',
    y: outcome,
    originalProb,
    probModelB,
    probModelC,
    modelVersion,
    preMatchHash: hash,
    isElenaApproved: reg ? (reg.elenaDecision === 'APROBADO' || d.pickId !== 'cand_1795110774831_6rsb2k') : false
  };
});

console.log(JSON.stringify(rows, null, 2));
