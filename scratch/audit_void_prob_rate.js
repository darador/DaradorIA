const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];
const settledAll = preds.filter(p => p.isSettled && p.result);

const probBrackets = {
  '50% - 60%': { total: 0, void: 0 },
  '60% - 70%': { total: 0, void: 0 },
  '70% - 80%': { total: 0, void: 0 },
  '> 80%':     { total: 0, void: 0 }
};

settledAll.forEach(p => {
  const prob = (p.pV2 || 0.5) * 100;
  let b = '> 80%';
  if (prob < 60) b = '50% - 60%';
  else if (prob < 70) b = '60% - 70%';
  else if (prob < 80) b = '70% - 80%';

  probBrackets[b].total++;
  if (p.result.isVoid) probBrackets[b].void++;
});

console.log('Tasa de VOID por Rango de Probabilidad Estimada V2:');
for (const [k, v] of Object.entries(probBrackets)) {
  const rate = v.total > 0 ? ((v.void / v.total) * 100).toFixed(1) + '%' : '0.0%';
  console.log('- Prob ' + k + ': Total ' + v.total + ' | VOID ' + v.void + ' (' + rate + ')');
}
