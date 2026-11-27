const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];

console.log('Total registros en store:', preds.length);

const summary = {
  total: preds.length,
  settled: 0,
  unsettled: 0,
  won: 0,
  lost: 0,
  void: 0,
  unsettledList: []
};

preds.forEach((p, idx) => {
  if (p.isSettled && p.result) {
    summary.settled++;
    if (p.result.isWon) summary.won++;
    else if (p.result.isVoid) summary.void++;
    else summary.lost++;
  } else {
    summary.unsettled++;
    summary.unsettledList.push({
      index: idx,
      id: p.candidateId,
      match: p.match,
      competition: p.competition,
      selection: p.selection,
      odds: p.odds,
      isSettled: p.isSettled,
      result: p.result
    });
  }
});

console.log(JSON.stringify(summary, null, 2));
