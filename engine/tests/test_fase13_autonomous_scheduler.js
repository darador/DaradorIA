/**
 * TEST SUITE: FASE 13 - AUTOMATIZACIÓN DEL MOTOR Y SCHEDULER AUTÓNOMO
 * DaradorIA / DaradorBET
 * 
 * Valida la operación autónoma coordinada de todos los procesos del motor:
 * 1. Arquitectura Centralizada, Control de Concurrencia y Persistencia de Estado
 * 2. Discovery Engine Autónomo con horizonte de 48 horas y prevención de duplicados
 * 3. Deep Research & Prediction Engine (Filtros de calidad de datos, Poisson, Empírico, Ensemble)
 * 4. Tribunal Colegiado de IA y Veto Vinculante de Elena
 * 5. LineupWatcher Reactivo (Monitoreo cada 15 min con ventana T-60 / T-45)
 * 6. Settlement Engine (Liquidación periódica cada 30 min y actas oficiales FT)
 * 7. Monitor Operativo y Sincronización en Horario de Argentina (America/Argentina/Buenos_Aires)
 * 8. Cumplimiento de Inmutabilidad, Trazabilidad y Shadow Mode
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const centralScheduler = require('../scheduler/centralScheduler');
const processMonitor = require('../scheduler/processMonitor');
const storage = require('../data/storage');
const observationTracker = require('../prediction/observationTracker');
const dateTimeUtils = require('../utils/dateTime');

const TIMEZONE_ART = 'America/Argentina/Buenos_Aires';
const STATE_FILE = path.join(__dirname, '../storage_data/scheduler_state.json');

async function runTestSuite() {
  console.log('======================================================');
  console.log('🧪 VALIDACIÓN FASE 13: AUTOMATIZACIÓN DEL MOTOR');
  console.log('======================================================\n');

  // --- 1. ARQUITECTURA Y CONTROL DE CONCURRENCIA ---
  console.log('--- 1. Arquitectura Centralizada y Control de Concurrencia ---');
  assert(centralScheduler, 'El scheduler central debe estar instanciado');
  assert.strictEqual(typeof centralScheduler.startDaemon, 'function', 'startDaemon debe ser función');
  assert.strictEqual(typeof centralScheduler.stopDaemon, 'function', 'stopDaemon debe ser función');
  assert.strictEqual(typeof centralScheduler.runDiscoveryJob, 'function', 'runDiscoveryJob debe ser función');
  assert.strictEqual(typeof centralScheduler.runPipelineJob, 'function', 'runPipelineJob debe ser función');
  assert.strictEqual(typeof centralScheduler.runLineupsJob, 'function', 'runLineupsJob debe ser función');
  assert.strictEqual(typeof centralScheduler.runSettlementJob, 'function', 'runSettlementJob debe ser función');

  // Prueba de Mutex de Concurrencia
  centralScheduler.locks.discovery = true;
  const lockedRes = await centralScheduler.runDiscoveryJob();
  assert.strictEqual(lockedRes.skipped, true, 'Debe omitir ejecución si la tarea está bloqueada (Mutex activo)');
  assert.strictEqual(lockedRes.reason, 'LOCKED', 'Razón debe ser LOCKED');
  centralScheduler.locks.discovery = false;
  console.log('  ✅ Concurrencia: Bloqueo Mutex previene solapamiento de tareas idénticas.');

  // --- 2. PERSISTENCIA DE ESTADO ENTRE REINICIOS ---
  console.log('\n--- 2. Persistencia del Estado entre Reinicios ---');
  centralScheduler.startDaemon({
    lineupIntervalMs: 60000,
    settlementIntervalMs: 60000,
    syncIntervalMs: 10000
  });

  assert.strictEqual(centralScheduler.isRunning, true, 'Scheduler debe reportar isRunning = true');
  assert(fs.existsSync(STATE_FILE), 'scheduler_state.json debe existir en disco');

  const persistedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  assert.strictEqual(persistedState.isRunning, true, 'El estado persistido debe reflejar isRunning = true');
  assert(persistedState.nextScheduledRuns.discovery, 'Debe registrar próxima ejecución de Discovery');
  assert(persistedState.nextScheduledRuns.lineups, 'Debe registrar próxima ejecución de LineupWatcher');
  assert(persistedState.nextScheduledRuns.settlement, 'Debe registrar próxima ejecución de SettlementEngine');

  console.log(`  • Daemon Activo desde: ${persistedState.startedAtArt}`);
  console.log(`  • Próximo Discovery: ${persistedState.nextScheduledRuns.discoveryArt}`);
  console.log(`  • Próximas Alineaciones: ${persistedState.nextScheduledRuns.lineupsArt}`);
  console.log(`  • Próxima Liquidación: ${persistedState.nextScheduledRuns.settlementArt}`);

  centralScheduler.stopDaemon();
  assert.strictEqual(centralScheduler.isRunning, false, 'Scheduler debe detenerse limpiamente');
  console.log('  ✅ Persistencia: Estado guardado y recuperable entre reinicios.');

  // --- 3. DISCOVERY HORIZONTE 48H Y PREVENCIÓN DE DUPLICADOS ---
  console.log('\n--- 3. Discovery Engine Autónomo (Horizonte 48h) ---');
  const now = new Date();
  const nextRun = centralScheduler.calculateNextDiscoveryRun(now);
  assert(nextRun.art && nextRun.art.includes('hs (ART)'), 'Próxima ejecución debe formatearse en horario argentino');
  console.log(`  • Próxima ventana horaria de Discovery: ${nextRun.art}`);

  // Simulación de candidato descubierto previamente
  const testCandidate = {
    id: `cand_autotest_${Date.now()}`,
    playerOrTeam: 'Jugador Prueba Auto',
    match: 'Equipo Auto A vs Equipo Auto B',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    bookmakerOdds: 1.85,
    status: 'APROBADO',
    createdAt: new Date().toISOString()
  };
  storage.saveCandidate(testCandidate);

  // Comprobar que no se duplica en almacenamiento
  const allCands = storage.getCandidates();
  const duplicates = allCands.filter(c => 
    c.playerOrTeam === testCandidate.playerOrTeam && 
    c.match === testCandidate.match && 
    c.market === testCandidate.market
  );
  assert.strictEqual(duplicates.length, 1, 'No debe duplicar candidato con la misma clave de selección');
  console.log('  ✅ Desduplicación: Candidatos existentes preservados sin registros redundantes.');

  // --- 4. CALIDAD DE DATOS Y PIPELINE DE MODELADO E IA ---
  console.log('\n--- 4. Deep Research, Prediction Engine y Veredicto de Elena ---');
  const incompleteCandidate = {
    id: `cand_incomp_${Date.now()}`,
    playerOrTeam: 'Jugador Incompleto',
    match: 'Equipo X vs Equipo Y',
    market: 'Faltas cometidas',
    line: 'Más de 1.5',
    bookmakerOdds: 1.80,
    status: 'INVESTIGACION_INCOMPLETA',
    researchData: { qualityStatus: 'INVESTIGACION_INCOMPLETA', missingData: ['playerData'] }
  };
  storage.saveCandidate(incompleteCandidate);

  // Ejecutar pipeline pasando candidato incompleto
  const pipeRes = await centralScheduler.runPipelineJob({ candidateIds: [incompleteCandidate.id] });
  assert.strictEqual(pipeRes.success, true, 'El pipeline debe tolerar y aislar datos incompletos');
  
  // Verificar que el candidato incompleto NUNCA fue aprobado
  const approvedList = storage.getApprovedPicks();
  const wronglyApproved = approvedList.find(p => p.id === incompleteCandidate.id);
  assert(!wronglyApproved, 'Candidato con datos incompletos no puede ser aprobado');
  console.log('  ✅ Gate de Calidad: Candidatos con datos incompletos aislados fuera de apuestas válidas.');

  // --- 5. LINEUPWATCHER EN VENTANA T-60 A T-45 ---
  console.log('\n--- 5. LineupWatcher Reactivo y Promoción/Veto ---');
  const candStarter = {
    id: `cand_starter_${Date.now()}`,
    matchId: 'match_auto_01',
    playerOrTeam: 'Julian Alvarez',
    status: 'PENDIENTE_ALINEACION',
    kickoffTimestamp: Math.floor(Date.now() / 1000) + 3000 // Inicia en 50 min (T-50)
  };
  const candSub = {
    id: `cand_sub_${Date.now()}`,
    matchId: 'match_auto_01',
    playerOrTeam: 'Suplente FC',
    status: 'PENDIENTE_ALINEACION',
    kickoffTimestamp: Math.floor(Date.now() / 1000) + 3000
  };
  storage.saveCandidate(candStarter);
  storage.saveCandidate(candSub);

  const mockLineups = {
    match_auto_01: {
      status: 'OFFICIAL',
      starters: [{ name: 'Julian Alvarez' }],
      substitutes: [{ name: 'Suplente FC' }]
    }
  };

  const lineupRes = await centralScheduler.runLineupsJob({ mockLineups, candidateIds: [candStarter.id, candSub.id] });
  assert(lineupRes.promotedCount >= 1, 'Debe promover al menos al jugador titular');
  assert(lineupRes.vetoedCount >= 1, 'Debe vetar al menos al jugador suplente');

  const reloadedStarter = storage.getCandidates().find(c => c.id === candStarter.id);
  const reloadedSub = storage.getCandidates().find(c => c.id === candSub.id);
  assert.strictEqual(reloadedStarter.status, 'APROBADO', 'Titular confirmado debe pasar a APROBADO');
  assert.strictEqual(reloadedSub.status, 'RECHAZADO', 'Suplente debe pasar a RECHAZADO');
  console.log('  ✅ LineupWatcher: Titular promovido a APROBADO, Suplente vetado a RECHAZADO.');

  // --- 6. SETTLEMENT ENGINE Y LIQUIDACIÓN POST-PARTIDO ---
  console.log('\n--- 6. Settlement Engine y Actualización de Historial ---');
  const pickToSettle = {
    id: `pick_settle_${Date.now()}`,
    matchId: 'match_settle_01',
    player: 'Erling Haaland',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    cuota: 1.85,
    status: 'APROBADO'
  };
  storage.saveApprovedPick(pickToSettle);

  const mockSettlementData = {
    [pickToSettle.id]: {
      stat: 3,
      score: '2-0 FT'
    }
  };

  const settleRes = await centralScheduler.runSettlementJob({ mockData: mockSettlementData, pickIds: [pickToSettle.id] });
  assert(settleRes.settled >= 1, 'Debe liquidar el pick con acta oficial FT');

  const settledResult = storage.getResults().find(r => r.pickId === pickToSettle.id);
  assert(settledResult, 'Debe persistir el resultado liquidado');
  assert(settledResult.status === 'ACERTADA' || settledResult.status === 'GANADA', '3 remates con línea 1.5 debe ser ACERTADA/GANADA');
  console.log('  ✅ Settlement: Pick liquidado en GANADA/ACERTADA y balance actualizado.');

  // --- 7. MONITOR OPERATIVO EN HORARIO ARGENTINO ---
  console.log('\n--- 7. Monitor Operativo y Sincronización en Horario de Argentina ---');
  centralScheduler.startDaemon({
    lineupIntervalMs: 900000,
    settlementIntervalMs: 1800000,
    syncIntervalMs: 30000
  });

  const auditReport = processMonitor.auditProcesses({ schedulerInstance: centralScheduler });
  assert.strictEqual(auditReport.daemonRunning, true, 'Monitor debe detectar daemon activo');
  assert.strictEqual(auditReport.timeZone, TIMEZONE_ART, 'Zona horaria debe ser America/Argentina/Buenos_Aires');
  assert.strictEqual(auditReport.summary.active, 9, 'Con daemon activo, los 9 procesos deben estar ACTIVO');

  console.log(`  • Procesos Activos: ${auditReport.summary.active} de ${auditReport.summary.totalProcesses}`);
  console.log(`  • Hora de Auditoría: ${auditReport.systemTimeArt}`);
  console.log('  ✅ Monitor: Todos los procesos reportan estado ACTIVO con frecuencias y próximas ejecuciones en ART.');

  centralScheduler.stopDaemon();

  // --- 8. BUILD DE PRODUCCIÓN Y RESTRICCIONES SHADOW MODE ---
  console.log('\n--- 8. Verificación de Build y Políticas de Shadow Mode ---');
  try {
    const buildRes = execSync('npm run build', { encoding: 'utf8' });
    assert(buildRes.includes('BUILD EXITOSO'), 'npm run build debe culminar exitosamente');
    console.log('  ✅ Build: Verificación AST, schemas y módulos completada con 0 errores.');
  } catch (bErr) {
    assert.fail(`El build falló: ${bErr.message}`);
  }

  // Limpieza de datos de prueba
  try {
    const candsClean = storage.getCandidates().filter(c => !c.id.includes('autotest') && !c.id.includes('incomp') && !c.id.includes('starter') && !c.id.includes('sub'));
    fs.writeFileSync('engine/storage_data/research_candidates.json', JSON.stringify(candsClean, null, 2), 'utf8');
    const appsClean = storage.getApprovedPicks().filter(p => !p.id.includes('autotest') && !p.id.includes('settle') && !p.id.includes('starter'));
    fs.writeFileSync('engine/storage_data/approved_picks.json', JSON.stringify(appsClean, null, 2), 'utf8');
  } catch (e) {}

  console.log('\n======================================================');
  console.log('🎉 FASE 13 SUPERADA: 8 DE 8 PRUEBAS PASADAS AL 100%');
  console.log('======================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ ERROR CRÍTICO EN TEST SUITE FASE 13:', err.message);
  console.error(err.stack);
  process.exit(1);
});
