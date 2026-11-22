const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const results = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));
const historial = JSON.parse(fs.readFileSync(path.join(rootDir, 'historial_picks.json'), 'utf8'));

console.log('=== INSPECTION OF RESULTS ===');
console.log('Results in pick_results.json:', results.length);
console.log('Picks in historial_picks.json:', historial.picks.length);

const decided = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA' || r.status === 'ACERTADA' || r.status === 'FALLADA');
console.log('Decided in pick_results.json:', decided.length);

decided.forEach((d, idx) => {
  const reg = registry.find(r => r.pickId === d.pickId);
  const seal = ledger.seals ? ledger.seals[d.pickId] : null;
  console.log({
    index: idx + 1,
    pickId: d.pickId,
    player: d.player,
    match: d.match,
    date: d.date,
    status: d.status,
    d_realProb: d.realProb,
    d_fairOdds: d.fairOdds,
    d_odds: d.odds,
    reg_originalProb: reg ? reg.originalProb : null,
    reg_probModelB: reg ? reg.probModelB : null,
    reg_probModelC: reg ? reg.probModelC : null,
    reg_modelVersionB: reg ? reg.modelVersionB : null,
    reg_modelVersionC: reg ? reg.modelVersionC : null,
    seal_preMatchHash: seal ? seal.preMatchHash : null
  });
});
