/**
 * SETTLE DERMANE AND PUADO (IDEMPOTENTE Y CONTROLADO)
 * DARADORIA / DARADORBET - FASE 11.2
 * 
 * Sincroniza los resultados oficiales de la jornada 20-Nov:
 * 1. Karim Dermane: GANADA / ACERTADA (3 tackles vs línea 1.5 @ 1.80, +0.80 U)
 * 2. Javi Puado: ANULADA_NO_TITULAR (suplente, Elena veto, 0.00 U, stake devuelto)
 * 
 * Operación 100% idempotente: no duplica registros ni beneficios si se ejecuta repetidamente.
 */

const fs = require('fs');
const path = require('path');

const storage = require('../data/storage');
const observationTracker = require('../prediction/observationTracker');
const syncRadar = require('../data/syncRadar');
const integrityGuard = require('../audit/integrityGuard');

function settleNov20() {
  console.log('🔄 Iniciando sincronización idempotente de Dermane y Puado...');

  const resultsPath = path.resolve(__dirname, '..', 'storage_data', 'pick_results.json');
  let results = [];
  if (fs.existsSync(resultsPath)) {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  // 1. Karim Dermane
  const dermaneId = 'cand_1795187331561_zeldy6';
  const dermaneExisting = results.find(r => r.pickId === dermaneId);

  const dermaneSettlement = {
    pickId: dermaneId,
    date: '2026-11-20',
    match: 'Troyes vs Le Havre',
    player: 'Karim Dermane',
    market: 'Entradas (Tackles)',
    line: 'Más de 1.5',
    odds: 1.80,
    targetLine: 1.5,
    actualStat: 3,
    matchScore: '1-0',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.80,
    settledAt: '2026-11-20T23:00:00.000Z',
    verificationSource: 'StatsHub MCP Oficial FT',
    verificationReason: 'Titular confirmado (90 min), 3 entradas completadas superando la línea de Más de 1.5.',
    id: `res_${dermaneId}`
  };

  if (!dermaneExisting) {
    results.push(dermaneSettlement);
    console.log('  ➕ [pick_results] Agregado Karim Dermane (GANADA, +0.80 U)');
  } else {
    console.log('  ℹ️ [pick_results] Karim Dermane ya existe. Preservando.');
  }

  // 2. Javi Puado
  const puadoId = 'cand_1795187331561_xmcbes';
  const puadoExisting = results.find(r => r.pickId === puadoId);

  const puadoSettlement = {
    pickId: puadoId,
    date: '2026-11-20',
    match: 'Espanyol vs Athletic Club',
    player: 'Javi Puado',
    market: 'Remates al arco',
    line: 'Más de 0.5',
    odds: 1.75,
    targetLine: 0.5,
    actualStat: 0,
    matchScore: '0-1',
    status: 'ANULADA_NO_TITULAR',
    stakedUnits: 1,
    profitUnits: 0.00,
    settledAt: '2026-11-20T23:00:00.000Z',
    verificationSource: 'StatsHub MCP Oficial FT',
    verificationReason: 'Elena Risk Veto: Suplente (ingresó min 81, jugó 9 min). Condición de titularidad T-60 min no cumplida.',
    id: `res_${puadoId}`
  };

  if (!puadoExisting) {
    results.push(puadoSettlement);
    console.log('  ➕ [pick_results] Agregado Javi Puado (ANULADA_NO_TITULAR, 0.00 U)');
  } else {
    console.log('  ℹ️ [pick_results] Javi Puado ya existe. Preservando.');
  }

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');

  // 3. Actualizar Observation Tracker y sellar settlement
  observationTracker.recordSettlement(dermaneId, dermaneSettlement);
  observationTracker.recordSettlement(puadoId, puadoSettlement);
  console.log('  ✅ [ObservationTracker] Observaciones actualizadas a SETTLED.');

  // 4. Exportar a historial_picks.json
  const historial = syncRadar.exportToHistorial();
  console.log('  ✅ [historial_picks.json] Historial sincronizado:');
  console.log(`     Total bets: ${historial.summary.total_bets}`);
  console.log(`     Ganadas: ${historial.summary.won_bets}, Perdidas: ${historial.summary.lost_bets}, Anuladas: ${historial.summary.void_bets}`);
  console.log(`     Win Rate: ${historial.summary.win_rate_pct}%`);
  console.log(`     PnL: ${historial.summary.net_profit_units} U`);
  console.log(`     ROI/Yield: ${historial.summary.roi_pct}%`);

  // 5. Sincronizar embebidos en dashboard.html e index.html
  const histStr = JSON.stringify(historial);
  ['dashboard.html', 'index.html'].forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    const startIdx = content.indexOf('window.EMBEDDED_HISTORY_DATA = ');
    if (startIdx !== -1) {
      let endIdx = content.indexOf(';\n  window.EMBEDDED_AGENTS_DATA', startIdx);
      if (endIdx === -1) endIdx = content.indexOf(';\r\n  window.EMBEDDED_AGENTS_DATA', startIdx);
      if (endIdx !== -1) {
        content = content.slice(0, startIdx + 'window.EMBEDDED_HISTORY_DATA = '.length) + histStr + content.slice(endIdx);
        fs.writeFileSync(f, content, 'utf8');
        console.log(`  ✅ [Frontend] window.EMBEDDED_HISTORY_DATA sincronizado en ${f}`);
      }
    }
  });

  // 6. Verificar integridad SHA-256
  const audit = observationTracker.verifyIntegrity();
  console.log(`  🔒 [IntegrityGuard] 0 alteraciones históricas: intactCount=${audit.intactCount}, alteredCount=${audit.alteredCount}`);
  if (audit.alteredCount > 0) {
    console.error('ALERTA: Se detectó alteración en el ledger:', audit.violations);
    process.exit(1);
  }

  return historial;
}

if (require.main === module) {
  settleNov20();
}

module.exports = settleNov20;
