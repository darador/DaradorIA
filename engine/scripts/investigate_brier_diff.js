const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const results = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));
const historial = JSON.parse(fs.readFileSync(path.join(rootDir, 'historial_picks.json'), 'utf8'));

// Decided items
const nov19_all18 = results.filter(r => r.date === '2026-11-19' && (r.status === 'GANADA' || r.status === 'PERDIDA'));
const nov19_elena17 = nov19_all18.filter(r => r.pickId !== 'cand_1795110774831_6rsb2k');
const all20_decided19 = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA');

function calcMetrics(bets, probSource = 'default') {
  let brierSum = 0;
  let logLossSum = 0;
  let count = 0;

  bets.forEach(b => {
    const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
    const y = isWon ? 1 : 0;
    const reg = registry.find(r => r.pickId === b.pickId);

    let p;
    if (probSource === 'default') {
      // Logic from evaluator.js:
      // b.realProb ? (b.realProb > 1 ? b.realProb / 100 : b.realProb) : (b.pProjected || (1 / (b.fairOdds || b.fair_odds || 1.6)))
      p = b.realProb ? (b.realProb > 1 ? b.realProb / 100 : b.realProb) : (b.pProjected || (1 / (b.fairOdds || b.fair_odds || 1.6)));
    } else if (probSource === 'reg_original') {
      p = reg ? reg.originalProb : 0.6;
    } else if (probSource === 'reg_modelB') {
      p = reg ? reg.probModelB : 0.6;
    } else if (probSource === 'reg_ensemble') {
      // Ensemble: weighted average or average of B and C
      p = reg ? (reg.probModelB + reg.probModelC) / 2 : 0.6;
    }

    if (p > 1) p = p / 100;
    const clampedP = Math.max(0.001, Math.min(0.999, p));
    brierSum += Math.pow(p - y, 2);
    logLossSum += -(y * Math.log(clampedP) + (1 - y) * Math.log(1 - clampedP));
    count++;
  });

  return {
    count,
    brier: count > 0 ? (brierSum / count) : 0,
    logLoss: count > 0 ? (logLossSum / count) : 0
  };
}

console.log('--- EVALUATION ON DIFFERENT SUBSETS AND PROB SOURCES ---');
console.log('1. nov19_all18 (default evaluator 1/1.6):', calcMetrics(nov19_all18, 'default'));
console.log('2. nov19_elena17 (default evaluator 1/1.6):', calcMetrics(nov19_elena17, 'default'));
console.log('3. all20_decided19 (default evaluator):', calcMetrics(all20_decided19, 'default'));

console.log('\n--- Using reg_original (Poisson Ajustado / Real Prob) ---');
console.log('4. nov19_all18 (reg_original):', calcMetrics(nov19_all18, 'reg_original'));
console.log('5. nov19_elena17 (reg_original):', calcMetrics(nov19_elena17, 'reg_original'));
console.log('6. all20_decided19 (reg_original):', calcMetrics(all20_decided19, 'reg_original'));

console.log('\n--- Using reg_modelB (Model-B-L10) ---');
console.log('7. nov19_all18 (reg_modelB):', calcMetrics(nov19_all18, 'reg_modelB'));
console.log('8. nov19_elena17 (reg_modelB):', calcMetrics(nov19_elena17, 'reg_modelB'));
console.log('9. all20_decided19 (reg_modelB):', calcMetrics(all20_decided19, 'reg_modelB'));

console.log('\n--- Using reg_ensemble (Model B & C avg) ---');
console.log('10. nov19_all18 (reg_ensemble):', calcMetrics(nov19_all18, 'reg_ensemble'));
console.log('11. nov19_elena17 (reg_ensemble):', calcMetrics(nov19_elena17, 'reg_ensemble'));
console.log('12. all20_decided19 (reg_ensemble):', calcMetrics(all20_decided19, 'reg_ensemble'));
