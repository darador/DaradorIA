const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];
const settledNonVoid = preds.filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('Evaluando Multiclase WIN / LOSS / VOID sobre total liquidados (141):');
const allSettled = preds.filter(p => p.isSettled && p.result);

// Multiclase Brier Score:
// Para cada evento i: sum_c (P_ic - Y_ic)^2 donde c in {WIN, LOSS, VOID}
let multiclassBrierSumV1 = 0;
let multiclassBrierSumV2 = 0;
let multiclassLogLossSumV1 = 0;
let multiclassLogLossSumV2 = 0;

allSettled.forEach(item => {
  const yWin = item.result.isWon ? 1 : 0;
  const yVoid = item.result.isVoid ? 1 : 0;
  const yLoss = (!item.result.isWon && !item.result.isVoid) ? 1 : 0;

  // V1 nunca modeló VOID (P_void = 0):
  const pWinV1 = Math.min(0.999, Math.max(0.001, item.pV1 || 0.5));
  const pVoidV1 = 0.0;
  const pLossV1 = 1.0 - pWinV1;

  // V2:
  const isIntegerLine = item.line && !item.line.includes('.5');
  const pVoidV2 = isIntegerLine ? (item.pVoid || 0.15) : 0.0;
  const pWinV2 = Math.min(0.999, Math.max(0.001, item.pV2 || 0.5));
  const pLossV2 = Math.max(0.001, 1.0 - pWinV2 - pVoidV2);

  // Brier multiclase (suma de errores cuadráticos en las 3 clases):
  const brierV1 = Math.pow(pWinV1 - yWin, 2) + Math.pow(pLossV1 - yLoss, 2) + Math.pow(pVoidV1 - yVoid, 2);
  const brierV2 = Math.pow(pWinV2 - yWin, 2) + Math.pow(pLossV2 - yLoss, 2) + Math.pow(pVoidV2 - yVoid, 2);

  multiclassBrierSumV1 += brierV1;
  multiclassBrierSumV2 += brierV2;

  // LogLoss multiclase: - sum_c Y_ic * ln(P_ic)
  const logLossV1 = -(yWin * Math.log(pWinV1) + yLoss * Math.log(Math.max(0.001, pLossV1)) + (yVoid > 0 ? Math.log(0.001) : 0));
  const logLossV2 = -(yWin * Math.log(pWinV2) + yLoss * Math.log(Math.max(0.001, pLossV2)) + (yVoid > 0 ? Math.log(Math.max(0.001, pVoidV2)) : 0));

  multiclassLogLossSumV1 += logLossV1;
  multiclassLogLossSumV2 += logLossV2;
});

const N = allSettled.length;
console.log('Resultados Multiclase (N=' + N + '):');
console.log('  Brier Multiclase V1:', (multiclassBrierSumV1 / N).toFixed(4));
console.log('  Brier Multiclase V2:', (multiclassBrierSumV2 / N).toFixed(4));
console.log('  LogLoss Multiclase V1:', (multiclassLogLossSumV1 / N).toFixed(4));
console.log('  LogLoss Multiclase V2:', (multiclassLogLossSumV2 / N).toFixed(4));
