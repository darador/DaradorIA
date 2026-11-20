/**
 * TEST DE AUDITORÍA FASE 10.1.3.1: CONSISTENCIA DEL PROTOCOLO DE OBSERVACIÓN
 * 
 * Verifica rigurosamente:
 * 1. Reconciliación exacta de calibración para Modelos B y C directamente del registro primario.
 * 2. Mínimos metodológicos de investigación (8 para jugadores, 10 para equipos).
 * 3. Integridad de la máquina de estados del ciclo de vida y rechazo de transiciones inválidas.
 * 4. Integridad criptográfica SHA-256 del registro y detección de alteraciones.
 */

const assert = require('assert');
const fs = require('fs');
const tracker = require('../prediction/observationTracker');
const config = require('../config');
const guard = require('../audit/integrityGuard');
const deepResearchEngine = require('../research/deepResearchEngine');
const predictionEngine = require('../prediction/predictionEngine');

console.log('🧪 Iniciando verificación de Fase 10.1.3.1: Auditoría Final de Consistencia...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// =========================================================================
// 1. RECONCILIACIÓN EXACTA DE CALIBRACIÓN DE MODELO B Y C (N = 18)
// =========================================================================
console.log('--- 1. Reconciliación de Calibración del Registro Primario ---');

const registry = tracker.getRegistry();
const settledPicks = registry.filter(r => 
  r.settledAt && 
  !r.isTestPick && 
  !r.pickId.startsWith('cand_test_') && 
  !r.pickId.startsWith('pick_test_')
);

it('Debe haber exactamente 18 picks liquidados oficiales en el registro primario', () => {
  assert.strictEqual(settledPicks.length, 18);
});

const binsB = {
  '[0.00, 0.50)': { total: 0, wins: 0, losses: 0 },
  '[0.50, 0.60)': { total: 0, wins: 0, losses: 0 },
  '[0.60, 0.70)': { total: 0, wins: 0, losses: 0 },
  '[0.70, 0.80)': { total: 0, wins: 0, losses: 0 },
  '[0.80, 0.90)': { total: 0, wins: 0, losses: 0 },
  '[0.90, 1.00]': { total: 0, wins: 0, losses: 0 }
};

const binsC = {
  '[0.00, 0.50)': { total: 0, wins: 0, losses: 0 },
  '[0.50, 0.60)': { total: 0, wins: 0, losses: 0 },
  '[0.60, 0.70)': { total: 0, wins: 0, losses: 0 },
  '[0.70, 0.80)': { total: 0, wins: 0, losses: 0 },
  '[0.80, 0.90)': { total: 0, wins: 0, losses: 0 },
  '[0.90, 1.00]': { total: 0, wins: 0, losses: 0 }
};

settledPicks.forEach(pick => {
  const bB = tracker.getBinForProbability(pick.probModelB);
  const bC = tracker.getBinForProbability(pick.probModelC);
  assert(bB !== null, `Bin nulo para probModelB ${pick.probModelB} en pick ${pick.pickId}`);
  assert(bC !== null, `Bin nulo para probModelC ${pick.probModelC} en pick ${pick.pickId}`);

  binsB[bB].total++;
  binsC[bC].total++;

  if (pick.finalResultConfirmed === 'GANADA') {
    binsB[bB].wins++;
    binsC[bC].wins++;
  } else if (pick.finalResultConfirmed === 'PERDIDA') {
    binsB[bB].losses++;
    binsC[bC].losses++;
  }
});

it('Modelo B: [0.60, 0.70) debe tener exactamente 0 observaciones', () => {
  assert.strictEqual(binsB['[0.60, 0.70)'].total, 0);
});

it('Modelo B: [0.70, 0.80) debe tener exactamente 7 observaciones (5 G / 2 P)', () => {
  assert.strictEqual(binsB['[0.70, 0.80)'].total, 7);
  assert.strictEqual(binsB['[0.70, 0.80)'].wins, 5);
  assert.strictEqual(binsB['[0.70, 0.80)'].losses, 2);
});

it('Modelo B: [0.80, 0.90) debe tener exactamente 6 observaciones (3 G / 3 P)', () => {
  assert.strictEqual(binsB['[0.80, 0.90)'].total, 6);
  assert.strictEqual(binsB['[0.80, 0.90)'].wins, 3);
  assert.strictEqual(binsB['[0.80, 0.90)'].losses, 3);
});

it('Modelo B: [0.90, 1.00] debe tener exactamente 5 observaciones (2 G / 3 P)', () => {
  assert.strictEqual(binsB['[0.90, 1.00]'].total, 5);
  assert.strictEqual(binsB['[0.90, 1.00]'].wins, 2);
  assert.strictEqual(binsB['[0.90, 1.00]'].losses, 3);
});

it('Modelo B: la suma de todos los intervalos debe ser exactamente 18 (10 G / 8 P)', () => {
  const sumTotal = Object.values(binsB).reduce((acc, b) => acc + b.total, 0);
  const sumWins = Object.values(binsB).reduce((acc, b) => acc + b.wins, 0);
  const sumLosses = Object.values(binsB).reduce((acc, b) => acc + b.losses, 0);
  assert.strictEqual(sumTotal, 18);
  assert.strictEqual(sumWins, 10);
  assert.strictEqual(sumLosses, 8);
});

it('Modelo C: debe reconciliar exactamente los 18 picks (1, 1, 4, 5, 7, 0)', () => {
  assert.strictEqual(binsC['[0.00, 0.50)'].total, 1); // Pick 18 (0.47)
  assert.strictEqual(binsC['[0.50, 0.60)'].total, 1); // Pick 3 (0.53)
  assert.strictEqual(binsC['[0.60, 0.70)'].total, 4); // Picks 2, 4, 13, 17
  assert.strictEqual(binsC['[0.70, 0.80)'].total, 5); // Picks 1, 8, 11, 12, 16
  assert.strictEqual(binsC['[0.80, 0.90)'].total, 7); // Picks 5, 6, 7, 9, 10, 14, 15
  assert.strictEqual(binsC['[0.90, 1.00]'].total, 0);
});

// =========================================================================
// 2. MÍNIMOS METODOLÓGICOS DE INVESTIGACIÓN (8 JUGADORES, 10 EQUIPOS)
// =========================================================================
console.log('\n--- 2. Mínimos Metodológicos de Investigación ---');

it('Configuración debe exigir minPlayerValidMatches = 8 y minTeamValidMatches = 10', () => {
  assert.strictEqual(config.sampling.minPlayerValidMatches, 8);
  assert.strictEqual(config.sampling.minTeamValidMatches, 10);
});

it('DeepResearchEngine debe marcar INVESTIGACION_INCOMPLETA a jugador con 7 observaciones', () => {
  const mockPlayerData = {
    playerData: { observations: new Array(7).fill({ minutes: 90, stat: 1 }) }
  };
  const quality = deepResearchEngine._assessDataQuality(mockPlayerData, false);
  assert.strictEqual(quality.qualityStatus, 'INVESTIGACION_INCOMPLETA');
});

it('DeepResearchEngine debe marcar calidad PARCIAL/COMPLETA a jugador con >= 8 observaciones', () => {
  const mockPlayerData = {
    playerData: { observations: new Array(8).fill({ minutes: 90, stat: 1 }) }
  };
  const quality = deepResearchEngine._assessDataQuality(mockPlayerData, false);
  assert.strictEqual(quality.qualityStatus, 'PARCIAL');
});

it('DeepResearchEngine debe marcar INVESTIGACION_INCOMPLETA a equipo con 9 observaciones', () => {
  const mockTeamData = {
    teamData: { observations: new Array(9).fill({ stat: 5 }) }
  };
  const quality = deepResearchEngine._assessDataQuality(mockTeamData, true);
  assert.strictEqual(quality.qualityStatus, 'INVESTIGACION_INCOMPLETA');
});

it('DeepResearchEngine debe marcar calidad PARCIAL/COMPLETA a equipo con >= 10 observaciones', () => {
  const mockTeamData = {
    teamData: { observations: new Array(10).fill({ stat: 5 }) }
  };
  const quality = deepResearchEngine._assessDataQuality(mockTeamData, true);
  assert.strictEqual(quality.qualityStatus, 'PARCIAL');
});

it('PredictionEngine debe rechazar props de jugador con sampleSize < 8 por muestra insuficiente', () => {
  const decision = predictionEngine._evaluateDecision({
    ev: 0.12,
    uncertainty: 0.10,
    minutesExpected: 85,
    sampleSize: 7,
    bookmakerOdds: 1.85,
    lineupStatus: 'CONFIRMADA',
    isTeamProp: false
  });
  assert.strictEqual(decision.status, 'RECHAZADO');
  assert(decision.reason.includes('Muestra estadística insuficiente'));
  assert(decision.reason.includes('8 mínimos requeridos'));
});

it('PredictionEngine debe rechazar props de equipo con sampleSize < 10 por muestra insuficiente', () => {
  const decision = predictionEngine._evaluateDecision({
    ev: 0.15,
    uncertainty: 0.10,
    minutesExpected: 90,
    sampleSize: 9,
    bookmakerOdds: 1.90,
    lineupStatus: 'CONFIRMADA',
    isTeamProp: true
  });
  assert.strictEqual(decision.status, 'RECHAZADO');
  assert(decision.reason.includes('Muestra estadística insuficiente'));
  assert(decision.reason.includes('10 mínimos requeridos'));
});

// =========================================================================
// 3. ESTADOS DEL CICLO DE VIDA Y MÁQUINA DE TRANSICIÓN
// =========================================================================
console.log('\n--- 3. Estados del Ciclo de Vida y Transiciones ---');

it('Cada candidato en el registro debe poseer un currentState único e inequívoco', () => {
  const nonTest = registry.filter(r => !r.isTestPick && !r.pickId.startsWith('cand_test_') && !r.pickId.startsWith('pick_test_'));
  const officialAuditRecords = nonTest.slice(0, 42);
  assert.strictEqual(officialAuditRecords.length, 42);
  officialAuditRecords.forEach(c => {
    assert(typeof c.currentState === 'string');
    assert(c.currentState.length > 0);
  });
});

it('transitionCandidateState debe permitir transiciones válidas y registrar en stateHistory sin duplicar candidatos', () => {
  const testPickId = 'cand_test_transition_unit_01';
  const dummyCand = {
    id: testPickId,
    match: 'Unit Test A vs Unit Test B',
    playerOrTeam: 'Jugador Test',
    market: 'Remates',
    line: 'Más de 0.5',
    bookmakerOdds: 1.80,
    createdAt: new Date().toISOString()
  };

  // 1. Inicialización en DISCOVERED
  tracker.freezeObservation(dummyCand, {}, {});
  let current = tracker.getRegistry().find(r => r.pickId === testPickId);
  assert.strictEqual(current.currentState, 'DISCOVERED');

  // 2. Transición DISCOVERED -> RESEARCHED
  tracker.transitionCandidateState(testPickId, 'RESEARCHED', {
    reason: 'Investigación completa con StatsHub MCP',
    source: 'DeepResearchEngine'
  });
  current = tracker.getRegistry().find(r => r.pickId === testPickId);
  assert.strictEqual(current.currentState, 'RESEARCHED');

  // 3. Transición RESEARCHED -> ELIGIBLE
  tracker.transitionCandidateState(testPickId, 'ELIGIBLE', {
    reason: 'EV >= +7.0%',
    source: 'PredictionEngine'
  });
  current = tracker.getRegistry().find(r => r.pickId === testPickId);
  assert.strictEqual(current.currentState, 'ELIGIBLE');

  // 4. Transición ELIGIBLE -> APPROVED_BY_ELENA
  tracker.transitionCandidateState(testPickId, 'APPROVED_BY_ELENA', {
    reason: 'Aprobación cualitativa de Elena',
    source: 'RiskManager_Elena'
  });
  current = tracker.getRegistry().find(r => r.pickId === testPickId);
  assert.strictEqual(current.currentState, 'APPROVED_BY_ELENA');

  // Verificar que el historial acumuló las 4 transiciones y que sigue siendo un único candidato
  assert.strictEqual(current.stateHistory.length, 4);
  assert.strictEqual(current.stateHistory[3].toState, 'APPROVED_BY_ELENA');
});

it('transitionCandidateState debe rechazar transiciones inválidas con excepción', () => {
  const testPickId = 'cand_test_transition_unit_01';
  // Intentar saltar de APPROVED_BY_ELENA a DISCOVERED (Inválido)
  assert.throws(() => {
    tracker.transitionCandidateState(testPickId, 'DISCOVERED');
  }, /Transición inválida/);

  // Intentar transicionar desde un estado terminal REJECTED
  const rejectedPickId = 'cand_test_transition_rejected_01';
  tracker.freezeObservation({
    id: rejectedPickId,
    match: 'Team A vs Team B',
    playerOrTeam: 'Jugador Rechazado',
    market: 'Goles',
    bookmakerOdds: 2.10,
    createdAt: new Date().toISOString()
  }, {}, {});
  tracker.transitionCandidateState(rejectedPickId, 'REJECTED', { reason: 'Descarte' });

  assert.throws(() => {
    tracker.transitionCandidateState(rejectedPickId, 'APPROVED_BY_ELENA');
  }, /Transición inválida/);
});

// =========================================================================
// 4. VALIDACIÓN DEL SELLADO CRIPTOGRÁFICO
// =========================================================================
console.log('\n--- 4. Validación del Sellado Criptográfico SHA-256 ---');

it('IntegrityGuard debe verificar que los 42 registros oficiales coinciden con el ledger', () => {
  const nonTest = tracker.getRegistry().filter(r => !r.isTestPick && !r.pickId.startsWith('cand_test_') && !r.pickId.startsWith('pick_test_'));
  const officialAuditRecords = nonTest.slice(0, 42);
  const check = guard.verifyIntegrity(officialAuditRecords);
  assert.strictEqual(check.alteredCount, 0, 'No debe haber alteraciones');
  assert.strictEqual(check.intactCount, 42, 'Los 42 registros oficiales deben estar intactos');
});

console.log('\n====================================================');
console.log(`🏁 RESULTADO FASE 10.1.3.1: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
console.log('====================================================\n');

// Limpiar los picks de prueba
const cleaned = tracker.getRegistry().filter(p => !p.pickId.startsWith('cand_test_transition_'));
fs.writeFileSync(tracker.registryPath, JSON.stringify(cleaned, null, 2), 'utf-8');

if (failed > 0) {
  process.exit(1);
}
