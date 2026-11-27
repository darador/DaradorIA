const fs = require('fs');
const storeData = JSON.parse(fs.readFileSync('engine/storage_data/shadow_lab_frozen_predictions.json', 'utf8'));
const preds = storeData.predictions || [];

const voidList = preds.filter(p => p.isSettled && p.result && p.result.isVoid);

console.log('Total picks VOID auditados:', voidList.length);

const byMarket = {};
const byLeague = {};
const byOddsRange = {
  '1.10 - 1.40': { total: 0, void: 0 },
  '1.41 - 1.70': { total: 0, void: 0 },
  '1.71 - 2.00': { total: 0, void: 0 },
  '> 2.00': { total: 0, void: 0 }
};
const byReason = {};

// Contabilizar universo total de liquidados (141) para calcular tasas de void
const settledAll = preds.filter(p => p.isSettled && p.result);

settledAll.forEach(p => {
  const m = p.market || 'Otros';
  const l = p.competition || 'Otras Ligas';
  const odds = Number(p.odds || 1.80);
  const isVoid = p.result.isVoid;

  if (!byMarket[m]) byMarket[m] = { total: 0, void: 0, won: 0, lost: 0 };
  byMarket[m].total++;
  if (isVoid) byMarket[m].void++;
  else if (p.result.isWon) byMarket[m].won++;
  else byMarket[m].lost++;

  if (!byLeague[l]) byLeague[l] = { total: 0, void: 0 };
  byLeague[l].total++;
  if (isVoid) byLeague[l].void++;

  let oddsBracket = '> 2.00';
  if (odds <= 1.40) oddsBracket = '1.10 - 1.40';
  else if (odds <= 1.70) oddsBracket = '1.41 - 1.70';
  else if (odds <= 2.00) oddsBracket = '1.71 - 2.00';
  byOddsRange[oddsBracket].total++;
  if (isVoid) byOddsRange[oddsBracket].void++;

  if (isVoid) {
    let reason = 'NO_PARTICIPACION / SUPLENTE';
    if (p.result.status?.includes('LINEUP') || p.selection?.includes('Brian Brobbey') || p.result.status === 'ANULADA_LINEUP') {
      reason = 'T-60 VETO: Suplente Confirmado (No Participación)';
    } else if (p.line && !p.line.includes('.5')) {
      reason = 'PUSH_LINEA_ENTERA';
    } else {
      reason = 'ANULACION_ADMINISTRATIVA_O_SUSPENSION';
    }
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
});

console.log('\n--- DESGLOSE DE VOID POR MERCADO Y TASA DE VOID ---');
for (const [m, data] of Object.entries(byMarket)) {
  const voidRate = ((data.void / data.total) * 100).toFixed(1) + '%';
  console.log(`- ${m.padEnd(28)}: Total ${data.total} | VOID: ${data.void} (${voidRate}) | Won: ${data.won} | Lost: ${data.lost}`);
}

console.log('\n--- DESGLOSE POR MOTIVO DE VOID ---');
console.log(byReason);

console.log('\n--- DESGLOSE POR RANGO DE CUOTAS Y TASA DE VOID ---');
for (const [range, data] of Object.entries(byOddsRange)) {
  const voidRate = data.total > 0 ? ((data.void / data.total) * 100).toFixed(1) + '%' : '0.0%';
  console.log(`- Cuota [${range.padEnd(11)}]: Total ${data.total} | VOID: ${data.void} (${voidRate})`);
}

// Muestra de picks VOID
console.log('\n--- LISTADO DE PICKS VOID AUDITADOS (Primeros 10) ---');
voidList.slice(0, 10).forEach(p => {
  console.log(`[${p.candidateId}] ${p.match} | ${p.selection} | ${p.market} | @${p.odds} | Status: ${p.result.status}`);
});
