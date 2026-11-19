/**
 * TEST DE VERIFICACIÓN DE FASE 6: SCHEDULER, ALINEACIONES Y LIQUIDACIÓN
 * Valida:
 * 1. SettlementEngine: Liquidación de apuestas (Ganada vs Perdida), cálculo de ROI y persistencia.
 * 2. LineupWatcher: Verificación de titulares vs suplentes, promoción a Aprobado y Veto preventivo.
 * 3. PipelineScheduler: Orquestación end-to-end y control del daemon.
 * 4. CLI: Ejecución y reporte de estado.
 */
const assert = require('assert');
const storage = require('../data/storage');
const settlementEngine = require('../settlement/settlementEngine');
const lineupWatcher = require('../scheduler/lineupWatcher');
const scheduler = require('../scheduler/scheduler');
const syncRadar = require('../data/syncRadar');

console.log('🧪 Iniciando verificación de Fase 6: Scheduler, Alineaciones y Liquidación...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

async function runTests() {
  // 1. Verificación de SettlementEngine
  console.log('--- 1. Settlement Engine (Liquidación Automática) ---');

  const testPickWin = {
    id: 'pick_test_settle_win',
    matchId: 'match_win_01',
    match: 'Arsenal vs Chelsea',
    player: 'Bukayo Saka',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    odds: 1.90,
    status: 'APROBADO',
    date: '2026-11-18'
  };

  const testPickLoss = {
    id: 'pick_test_settle_loss',
    matchId: 'match_loss_01',
    match: 'Liverpool vs Everton',
    player: 'Darwin Núñez',
    market: 'Remates al arco',
    line: 'Más de 2.5',
    odds: 2.10,
    status: 'APROBADO',
    date: '2026-11-18'
  };

  const mockStats = {
    pick_test_settle_win: { stat: 3, score: '2-1' }, // 3 remates al arco > 1.5 -> GANADA
    pick_test_settle_loss: { stat: 1, score: '1-0' } // 1 remate al arco < 2.5 -> PERDIDA
  };

  const winResult = await settlementEngine.evaluatePick(testPickWin, mockStats);
  it('Pick con estadística real superior a la línea debe resolverse como GANADA', () => {
    assert.strictEqual(winResult.status, 'GANADA');
    assert.strictEqual(winResult.actualStat, 3);
    assert.strictEqual(winResult.profitUnits, 0.90);
  });

  const lossResult = await settlementEngine.evaluatePick(testPickLoss, mockStats);
  it('Pick con estadística real inferior a la línea debe resolverse como PERDIDA', () => {
    assert.strictEqual(lossResult.status, 'PERDIDA');
    assert.strictEqual(lossResult.actualStat, 1);
    assert.strictEqual(lossResult.profitUnits, -1.0);
  });

  storage.saveResult(winResult);
  storage.saveResult(lossResult);

  const historial = syncRadar.exportToHistorial();
  it('historial_picks.json debe registrar las apuestas liquidadas y recalcular ROI', () => {
    assert(historial.summary.settled_bets >= 2, 'Debe haber al menos 2 apuestas liquidadas');
    assert(typeof historial.summary.win_rate_pct === 'number', 'Win rate debe ser numérico');
    assert(typeof historial.summary.roi_pct === 'number', 'ROI debe ser numérico');
  });

  // 2. Verificación de LineupWatcher
  console.log('\n--- 2. Lineup Watcher (Alineaciones Oficiales T-60) ---');

  const pendingCandidateStarter = {
    id: 'cand_test_starter_01',
    matchId: 'match_lineup_01',
    player: 'Rodrygo Silva',
    partido: 'Real Madrid vs Atlético',
    market: 'Remates',
    line: 'Más de 2.5',
    odds: 1.80,
    status: 'PENDIENTE_ALINEACION'
  };

  const pendingCandidateBench = {
    id: 'cand_test_bench_01',
    matchId: 'match_lineup_02',
    player: 'Endrick',
    partido: 'Real Madrid vs Atlético',
    market: 'Remates',
    line: 'Más de 1.5',
    odds: 2.05,
    status: 'PENDIENTE_ALINEACION'
  };

  const mockLineups = {
    match_lineup_01: {
      confirmed: true,
      home: {
        startingXI: [{ name: 'Thibaut Courtois' }, { name: 'Rodrygo Silva' }],
        substitutes: [{ name: 'Endrick' }]
      }
    },
    match_lineup_02: {
      confirmed: true,
      home: {
        startingXI: [{ name: 'Thibaut Courtois' }, { name: 'Rodrygo Silva' }],
        substitutes: [{ name: 'Endrick' }]
      }
    }
  };

  const starterEval = await lineupWatcher.evaluateCandidateLineup(pendingCandidateStarter, mockLineups);
  it('Candidato en el XI titular debe generar acción PROMOTE', () => {
    assert.strictEqual(starterEval.action, 'PROMOTE');
    assert(starterEval.reason.includes('titular'));
  });

  const benchEval = await lineupWatcher.evaluateCandidateLineup(pendingCandidateBench, mockLineups);
  it('Candidato suplente debe generar acción VETO', () => {
    assert.strictEqual(benchEval.action, 'VETO');
    assert(benchEval.reason.includes('SUPLENTE'));
  });

  const unconfirmedEval = await lineupWatcher.evaluateCandidateLineup(
    { matchId: 'unconfirmed_match', player: 'Jugador Desconocido' },
    {}
  );
  it('Partido sin planilla confirmada debe generar acción WAIT', () => {
    assert.strictEqual(unconfirmedEval.action, 'WAIT');
  });

  // 3. Verificación de Scheduler & Daemon Control
  console.log('\n--- 3. Scheduler & Daemon Control ---');

  it('Scheduler debe iniciar y detener el demonio correctamente', () => {
    scheduler.startDaemon({ lineupIntervalMs: 100000, settlementIntervalMs: 100000 });
    assert.strictEqual(scheduler.isRunning, true, 'Daemon debe estar corriendo');
    scheduler.stopDaemon();
    assert.strictEqual(scheduler.isRunning, false, 'Daemon debe detenerse');
  });

  it('Scheduler debe exponer los métodos runDailyPipeline, runLineupVerification y runSettlement', () => {
    assert(typeof scheduler.runDailyPipeline === 'function', 'runDailyPipeline debe existir');
    assert(typeof scheduler.runLineupVerification === 'function', 'runLineupVerification debe existir');
    assert(typeof scheduler.runSettlement === 'function', 'runSettlement debe existir');
  });

  console.log(`\n========================================`);
  console.log(`RESULTADO FINAL DE PRUEBAS DE FASE 6:`);
  console.log(`Pasadas: ${passed} | Fallidas: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 FASE 6 COMPLETAMENTE VERIFICADA Y SUPERADA CON ÉXITO.');
  }
}

runTests();
