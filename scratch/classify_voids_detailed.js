const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const picksMap = new Map(picksHoy.top_picks.map(p => [p.id, p]));

const preds = storeData.predictions || [];
const voidList = preds.filter(p => p.isSettled && p.result && p.result.isVoid);

const classifiedVoid = {
  suplente_no_inicia: 0,
  push_linea_entera: 0,
  partido_suspendido_o_cancelado: 0,
  detalles: []
};

voidList.forEach(p => {
  const orig = picksMap.get(p.candidateId);
  const statusOrig = orig?.status || orig?.sports_result || p.result.status || '';
  const notes = orig?.notes || orig?.rationale || '';
  const isLineup = statusOrig.includes('NO_TITULAR') || statusOrig.includes('LINEUP') || notes.includes('no figura en el XI') || notes.includes('suplente');
  const isIntegerLine = p.line && !p.line.includes('.5');

  let category = 'OTRO';
  if (isLineup) {
    classifiedVoid.suplente_no_inicia++;
    category = 'NO_PARTICIPACION (Suplente no inicia T-60)';
  } else if (isIntegerLine) {
    classifiedVoid.push_linea_entera++;
    category = 'PUSH (Línea entera igualada)';
  } else {
    classifiedVoid.partido_suspendido_o_cancelado++;
    category = 'PARTIDO_SUSPENDIDO_O_CANCELADO';
  }

  classifiedVoid.detalles.push({
    candidateId: p.candidateId,
    selection: p.selection,
    match: p.match,
    competition: p.competition,
    market: p.market,
    line: p.line,
    odds: p.odds,
    category,
    statusOrig
  });
});

console.log('Resumen de clasificación VOID (27 registros):');
console.log('  Suplente no inicia (T-60 Veto):', classifiedVoid.suplente_no_inicia);
console.log('  Push en línea entera:', classifiedVoid.push_linea_entera);
console.log('  Suspendido / Cancelado:', classifiedVoid.partido_suspendido_o_cancelado);
console.log('\nPrimeros 5 registros clasificados:');
console.log(classifiedVoid.detalles.slice(0, 5));
