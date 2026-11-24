/**
 * TEST SUITE OBLIGATORIA — THE LADDER (REGLAS OPERATIVAS SECUENCIALES)
 * Verifica los 12 escenarios críticos exigidos:
 *  1. Día sin oportunidades: escalera intacta ($ 50.000 ARS).
 *  2. Una oportunidad aprobada y ejecutada: se compromete un único escalón.
 *  3. Dos oportunidades consecutivas en el mismo día: la segunda espera hasta liquidación de la primera.
 *  4. Dos eventos con horarios superpuestos: no se permite ejecutar ambos.
 *  5. Dos eventos sin superposición: el segundo puede evaluarse después de liberar el primero.
 *  6. Evento suspendido: no se libera automáticamente el capital.
 *  7. Liquidación pendiente: no se habilita el siguiente escalón.
 *  8. Resultado ganado: se actualiza el capital una sola vez (idempotente).
 *  9. Resultado perdido: se registra la pérdida y se detiene la progresión.
 * 10. Oportunidad en espera cuya cuota cambia: se debe reevaluar (y descartar si no revalida).
 * 11. Dos procesos intentan comprometer el mismo capital: solo uno puede tener éxito.
 * 12. Oportunidad rechazada por Risk Manager: no puede ejecutarse aunque Elena la haya aprobado.
 */

const assert = require('assert');
const { LadderEngine } = require('../ladder/ladderEngine');
const { computeEventWindow, windowsOverlap } = require('../ladder/ladderRiskGuard');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

function makeOpp(overrides = {}) {
  return {
    id: 'opp_1',
    match: 'Equipo A vs Equipo B',
    competition: 'UEFA Champions League',
    sport: 'football',
    market: 'Remates totales',
    selection: 'Más de 0.5',
    kickoffUtc: '2026-11-24T17:00:00.000Z',
    timeZone: 'UTC',
    canHaveOvertime: false,
    eventStatus: 'SCHEDULED',
    odds: 1.20,
    estimatedProb: 0.96,
    evPct: 15.2,
    sampleSize: 20,
    elenaDecision: 'APROBADO',
    riskManagerVeto: false,
    ...overrides
  };
}

console.log('🧪 Iniciando Test Suite: THE LADDER — Reglas Operativas Secuenciales (12 Escenarios)...\n');

// 1. Día sin oportunidades: la escalera permanece intacta
runTest('1. Día sin oportunidades: capital y escalera permanecen intactos', () => {
  const eng = new LadderEngine();
  const res = eng.recordNoOpportunityDay('2026-11-24');
  const st = eng.getState();
  assert.strictEqual(res.recorded, true);
  assert.strictEqual(st.activeSession.availableCapitalArs, 50000);
  assert.strictEqual(st.activeSession.committedCapitalArs, 0);
  assert.strictEqual(st.activeSession.ladderState, 'DISPONIBLE');
  assert.strictEqual(st.activeSession.daysWithoutBet, 1);
  assert.strictEqual(st.rules.maxDailySelections, null);
});

// 2. Una oportunidad aprobada y ejecutada: se compromete un único escalón
runTest('2. Una oportunidad aprobada y ejecutada manualmente compromete un único escalón', () => {
  const eng = new LadderEngine();
  const ev = eng.evaluateOpportunity(makeOpp({ id: 'opp_s2' }));
  assert.strictEqual(ev.status, 'APROBADA');
  // Aprobación NO cuenta como ejecutada
  assert.strictEqual(eng.getState().metrics.approved, 1);
  assert.strictEqual(eng.getState().metrics.executed, 0);

  const ex = eng.executeStepManual('opp_s2', { expectedVersion: 1, idempotencyKey: 'exec_s2' });
  assert.strictEqual(ex.executed, true);
  const st = eng.getState();
  assert.strictEqual(st.activeSession.availableCapitalArs, 0);
  assert.strictEqual(st.activeSession.committedCapitalArs, 50000);
  assert.strictEqual(st.activeSession.ladderState, 'APUESTA_ACTIVA');
  assert.strictEqual(st.steps.length, 1);
  assert.strictEqual(st.metrics.executed, 1);
});

// 3. Dos oportunidades consecutivas en el mismo día: la segunda espera hasta la liquidación de la primera
runTest('3. Dos oportunidades consecutivas mismo día: 2ª queda EN_ESPERA hasta liquidación de la 1ª', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_3a', kickoffUtc: '2026-11-24T14:00:00.000Z' }));
  const ex1 = eng.executeStepManual('opp_3a');
  assert.strictEqual(ex1.executed, true);

  // 2ª oportunidad más tarde el mismo día (sin superposición horaria, pero 1ª aún abierta)
  const ev2 = eng.evaluateOpportunity(makeOpp({ id: 'opp_3b', kickoffUtc: '2026-11-24T20:00:00.000Z' }));
  assert.strictEqual(ev2.status, 'EN_ESPERA');
  assert.strictEqual(ev2.code, 'ACTIVE_BET_OPEN');
  // No puede ejecutarse mientras está EN_ESPERA
  const ex2Blocked = eng.executeStepManual('opp_3b');
  assert.strictEqual(ex2Blocked.executed, false);
});

// 4. Dos eventos con horarios superpuestos: no se permite ejecutar ambos
runTest('4. Dos eventos con ventanas horarias superpuestas (incl. duración + prórroga): bloquea 2º', () => {
  const win1 = computeEventWindow({ kickoffUtc: '2026-11-24T17:00:00.000Z', sport: 'football', canHaveOvertime: true });
  const win2 = computeEventWindow({ kickoffUtc: '2026-11-24T19:15:00.000Z', sport: 'football', canHaveOvertime: false });
  // 17:00 + 180min (con prórroga y buffer) = 20:00 > 19:15 => se superponen!
  assert.strictEqual(windowsOverlap(win1, win2), true);

  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_4a', kickoffUtc: '2026-11-24T17:00:00.000Z', canHaveOvertime: true }));
  eng.executeStepManual('opp_4a');

  const ev2 = eng.evaluateOpportunity(makeOpp({ id: 'opp_4b', kickoffUtc: '2026-11-24T19:15:00.000Z' }));
  assert.strictEqual(ev2.status, 'EN_ESPERA');
  assert.strictEqual(ev2.code, 'TIME_WINDOW_OVERLAP');
});

// 5. Dos eventos sin superposición: el segundo puede evaluarse y ejecutarse después de liberar el primero
runTest('5. Dos eventos sin superposición el mismo día: 2º avanza tras liquidar y liberar el 1º', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_5a', kickoffUtc: '2026-11-24T13:00:00.000Z' }));
  const ex1 = eng.executeStepManual('opp_5a');

  const ev2 = eng.evaluateOpportunity(makeOpp({ id: 'opp_5b', kickoffUtc: '2026-11-24T19:00:00.000Z' }));
  assert.strictEqual(ev2.status, 'EN_ESPERA');

  // Liquidación confirmada del 1º
  const set1 = eng.confirmSettlement(ex1.step.stepId, { outcome: 'WON', settledOdds: 1.20 });
  assert.strictEqual(set1.settled, true);
  assert.strictEqual(set1.availableCapitalArs, 60000);

  // Reevaluación obligatoria del 2º y ejecución manual
  const reeval = eng.reevaluateWaitingOpportunity('opp_5b', { currentOdds: 1.20, elenaDecision: 'APROBADO' });
  assert.strictEqual(reeval.state, 'APROBADA');

  const ex2 = eng.executeStepManual('opp_5b');
  assert.strictEqual(ex2.executed, true);
  assert.strictEqual(ex2.step.startCapitalArs, 60000);
  assert.strictEqual(ex2.step.stepNumber, 2);
});

// 6. Evento suspendido: no se libera automáticamente el capital
runTest('6. Evento suspendido bloquea progresión y NO libera automáticamente el capital', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_6a' }));
  eng.executeStepManual('opp_6a');

  const upd = eng.updateActiveEventStatus('SUSPENDED', 'Partido suspendido por tormenta eléctrica');
  assert.strictEqual(upd.ladderState, 'LIQUIDACION_PENDIENTE');
  assert.strictEqual(upd.committedCapitalArs, 50000);
  assert.strictEqual(upd.availableCapitalArs, 0);

  const evNext = eng.evaluateOpportunity(makeOpp({ id: 'opp_6b', kickoffUtc: '2026-11-25T17:00:00.000Z' }));
  assert.strictEqual(evNext.status, 'EN_ESPERA');
  assert.strictEqual(evNext.code, 'PENDING_SETTLEMENT_BLOCK');
});

// 7. Liquidación pendiente: no se habilita el siguiente escalón
runTest('7. Liquidación pendiente (incluso tras horario estimado de fin) NO habilita siguiente escalón', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_7a', kickoffUtc: '2026-11-24T12:00:00.000Z' }));
  eng.executeStepManual('opp_7a');
  eng.updateActiveEventStatus('FINISHED_UNSETTLED', 'Partido terminado, esperando acta oficial de StatsHub');

  const evNext = eng.evaluateOpportunity(makeOpp({ id: 'opp_7b', kickoffUtc: '2026-11-24T20:00:00.000Z' }));
  assert.strictEqual(evNext.status, 'EN_ESPERA');
  assert.strictEqual(evNext.code, 'PENDING_SETTLEMENT_BLOCK');
});

// 8. Resultado ganado: se actualiza el capital una sola vez (idempotencia)
runTest('8. Resultado ganado actualiza capital UNA SOLA VEZ (idempotente ante reintentos)', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_8a' }));
  const ex = eng.executeStepManual('opp_8a');

  const s1 = eng.confirmSettlement(ex.step.stepId, { outcome: 'WON', settledOdds: 1.20, idempotencyKey: 'settle_8a' });
  assert.strictEqual(s1.settled, true);
  assert.strictEqual(s1.availableCapitalArs, 60000);

  // Segundo intento con misma clave o mismo stepId NO debe multiplicar otra vez
  const s2 = eng.confirmSettlement(ex.step.stepId, { outcome: 'WON', settledOdds: 1.20, idempotencyKey: 'settle_8a' });
  const s3 = eng.confirmSettlement(ex.step.stepId, { outcome: 'WON', settledOdds: 1.20, idempotencyKey: 'settle_8a_retry' });
  assert.strictEqual(s2.settled, false);
  assert.strictEqual(s3.settled, false);
  assert.strictEqual(eng.getState().activeSession.availableCapitalArs, 60000);
});

// 9. Resultado perdido: se registra la pérdida y se detiene la progresión
runTest('9. Resultado perdido registra la pérdida y detiene la progresión (DETENIDA)', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_9a' }));
  const ex = eng.executeStepManual('opp_9a');

  const sLost = eng.confirmSettlement(ex.step.stepId, { outcome: 'LOST', settledOdds: 1.20 });
  assert.strictEqual(sLost.settled, true);
  assert.strictEqual(sLost.stepStatus, 'PERDIDO');
  assert.strictEqual(sLost.ladderState, 'DETENIDA');
  assert.strictEqual(sLost.availableCapitalArs, 0);

  const nextAttempt = eng.evaluateOpportunity(makeOpp({ id: 'opp_9b', kickoffUtc: '2026-11-25T17:00:00.000Z' }));
  assert.strictEqual(nextAttempt.status, 'RECHAZADA');
  assert.strictEqual(nextAttempt.code, 'LADDER_HALTED');
});

// 10. Oportunidad en espera cuya cuota cambia: se debe reevaluar
runTest('10. Oportunidad EN_ESPERA cuya cuota cambia exige reevaluación (se descarta si no revalida)', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_10a', kickoffUtc: '2026-11-24T13:00:00.000Z' }));
  const ex1 = eng.executeStepManual('opp_10a');

  eng.evaluateOpportunity(makeOpp({ id: 'opp_10b', kickoffUtc: '2026-11-24T20:00:00.000Z', odds: 1.20 }));
  eng.confirmSettlement(ex1.step.stepId, { outcome: 'WON', settledOdds: 1.20 });

  // Cuota cae de 1.20 a 1.08 (10% drift > 5%) sin revalidación -> DESCARTADA
  const reeval = eng.reevaluateWaitingOpportunity('opp_10b', { currentOdds: 1.08, revalidatedAfterOddsChange: false });
  assert.strictEqual(reeval.state, 'DESCARTADA');
  assert.strictEqual(reeval.code, 'ODDS_CHANGED_UNREVALIDATED');
  assert.strictEqual(eng.getState().metrics.discardedByConditionChange, 1);
});

// 11. Dos procesos intentan comprometer el mismo capital: solo uno puede tener éxito
runTest('11. Concurrencia: dos procesos intentando comprometer el mismo capital -> solo 1 tiene éxito', () => {
  const eng = new LadderEngine();
  eng.evaluateOpportunity(makeOpp({ id: 'opp_11a' }));
  const snapshotVersion = eng.getState().stateVersion; // ambos procesos leen version 1

  const procA = eng.executeStepManual('opp_11a', { expectedVersion: snapshotVersion, idempotencyKey: 'procA' });
  const procB = eng.executeStepManual('opp_11a', { expectedVersion: snapshotVersion, idempotencyKey: 'procB' });

  assert.strictEqual(procA.executed, true);
  assert.strictEqual(procB.executed, false);
  assert.strictEqual(procB.code, 'CONCURRENCY_LOCK_CONFLICT');
  assert.strictEqual(eng.getState().steps.length, 1);
  assert.strictEqual(eng.getState().activeSession.committedCapitalArs, 50000);
});

// 12. Oportunidad rechazada por Risk Manager: no puede ejecutarse aunque Elena la haya aprobado
runTest('12. Veto de Risk Manager prevalece sobre aprobación de Elena (no puede ejecutarse)', () => {
  const eng = new LadderEngine();
  const ev = eng.evaluateOpportunity(makeOpp({
    id: 'opp_12a',
    elenaDecision: 'APROBADO',
    riskManagerVeto: true,
    riskManagerReason: 'Exposición bloqueada por inconsistencia de liquidez en bookmaker.'
  }));
  assert.strictEqual(ev.status, 'RECHAZADA');
  assert.strictEqual(ev.code, 'RISK_MANAGER_VETO');

  const ex = eng.executeStepManual('opp_12a');
  assert.strictEqual(ex.executed, false);
  assert.strictEqual(eng.getState().activeSession.committedCapitalArs, 0);
});

console.log(`\n====================================================`);
console.log(`🏁 RESULTADO THE LADDER SECUENCIAL: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
console.log(`====================================================`);

if (failed > 0) process.exit(1);
