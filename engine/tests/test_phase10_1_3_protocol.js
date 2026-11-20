/**
 * TEST DE VERIFICACIÓN FASE 10.1.3: PROTOCOLO DE OPERACIÓN Y RECOLECCIÓN EN SHADOW MODE
 * Valida:
 * 1. Congelamiento estricto de modelos, ponderaciones, fórmulas de EV y umbral +7.0%.
 * 2. Registro exhaustivo de candidatos con los 8 estados estandarizados y trazabilidad en stateHistory.
 * 3. Congelamiento pre-partido e inmunidad contra sobreescrituras retrospectivas.
 * 4. Liquidación oficial con transición a SETTLED y preservación de auditoría.
 * 5. Separación inequívoca entre Candidatos (42), Eventos Únicos (8) y Picks Liquidados (18).
 * 6. Garantías operativas de Shadow Mode (cero apuestas, cero telegram, cero órdenes).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tracker = require('../prediction/observationTracker');
const config = require('../config');
const guard = require('../audit/integrityGuard');

console.log('🧪 Iniciando verificación de Fase 10.1.3: Protocolo de Operación en Shadow Mode...\n');

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
// 1. CONGELAMIENTO DEL SISTEMA
// =========================================================================
console.log('--- 1. Congelamiento del Sistema y Parámetros ---');

it('Umbral de EV debe permanecer congelado en exactamente +7.0%', () => {
  assert.strictEqual(config.prediction.minEV, 0.07);
});

it('Modelos monitoreados deben ser Model-B-L10 y Model-C-L15-L20 sin calibradores nuevos', () => {
  assert.deepStrictEqual(config.shadowMode.modelsTracked, ['Model-B-L10', 'Model-C-L15-L20']);
});

it('Criterio de divergencia máxima paramétrica vs empírica debe permanecer en 15%', () => {
  assert.strictEqual(config.prediction.maxModelDivergence, 0.15);
});

// =========================================================================
// 2. REGISTRO EXHAUSTIVO Y TRAZABILIDAD DE ESTADOS
// =========================================================================
console.log('\n--- 2. Registro Exhaustivo y Trazabilidad de Estados ---');

const VALID_STATES = new Set([
  'DISCOVERED',
  'RESEARCHED',
  'RESEARCH_INCOMPLETE',
  'ELIGIBLE',
  'APPROVED_BY_ELENA',
  'PENDING_LINEUP',
  'REJECTED',
  'SETTLED'
]);

const registry = tracker.getRegistry();
const nonTestObs = registry.filter(o => !o.isTestPick);

it('Cada candidato registrado debe tener un currentState válido del ciclo de vida oficial', () => {
  nonTestObs.forEach(obs => {
    assert(VALID_STATES.has(obs.currentState), `Estado no válido: ${obs.currentState} en pick ${obs.pickId}`);
  });
});

it('Cada candidato debe conservar su historial completo de transiciones en stateHistory', () => {
  nonTestObs.forEach(obs => {
    assert(Array.isArray(obs.stateHistory), `stateHistory debe ser array en ${obs.pickId}`);
    assert(obs.stateHistory.length >= 1, `Debe haber al menos 1 transición en ${obs.pickId}`);
    // La última transición debe reflejar el currentState
    const lastEntry = obs.stateHistory[obs.stateHistory.length - 1];
    assert.strictEqual(lastEntry.toState, obs.currentState);
    // Cada entrada debe tener timestamp, motivo y fuente
    obs.stateHistory.forEach(entry => {
      assert(VALID_STATES.has(entry.toState));
      assert(typeof entry.timestamp === 'string');
      assert(typeof entry.reason === 'string');
      assert(typeof entry.source === 'string');
    });
  });
});

it('Un candidato recién descubierto debe inicializarse con estado DISCOVERED y su primera transición', () => {
  const dummyCandidate = {
    id: 'cand_test_lifecycle_probe_01',
    match: 'Test Team A vs Test Team B',
    playerOrTeam: 'Jugador Prueba',
    market: 'Remates',
    line: 'Más de 1.5',
    bookmakerOdds: 1.85,
    createdAt: new Date().toISOString()
  };
  const obs = tracker.freezeObservation(dummyCandidate, {}, {});
  assert.strictEqual(obs.currentState, 'DISCOVERED');
  assert.strictEqual(obs.stateHistory[0].toState, 'DISCOVERED');
  assert.strictEqual(obs.stateHistory[0].fromState, null);
});

// =========================================================================
// 3. CONGELAMIENTO PRE-PARTIDO E INMUNIDAD ANTE SOBREESCRITURAS
// =========================================================================
console.log('\n--- 3. Congelamiento Pre-Partido e Inmunidad ---');

it('freezeObservation no debe sobrescribir probabilidades ya congeladas de un pick existente', () => {
  const probePickId = 'cand_test_immutability_probe_02';
  const initialCand = {
    id: probePickId,
    match: 'Team Alpha vs Team Beta',
    playerOrTeam: 'Jugador Alpha',
    market: 'Goles',
    line: 'Más de 0.5',
    bookmakerOdds: 1.80,
    createdAt: new Date().toISOString()
  };
  const initialPred = {
    models: {
      modelB: { pProjected: 0.65 },
      modelC: { pProjected: 0.55 }
    },
    pProjected: 0.60
  };
  tracker.freezeObservation(initialCand, initialPred, {});

  // Intentar sobreescribir con valores falsos
  const fakeCandidate = {
    id: probePickId,
    match: 'Team Alpha vs Team Beta',
    playerOrTeam: 'Jugador Alpha',
    market: 'Goles',
    bookmakerOdds: 1.80
  };
  const fakePrediction = {
    models: {
      modelB: { pProjected: 0.99 },
      modelC: { pProjected: 0.99 }
    },
    pProjected: 0.99
  };

  const updatedObs = tracker.freezeObservation(fakeCandidate, fakePrediction, {});
  assert.strictEqual(updatedObs.probModelB, 0.65, 'Debe preservar el probModelB original congelado');
  assert.strictEqual(updatedObs.probModelC, 0.55, 'Debe preservar el probModelC original congelado');
});

it('IntegrityGuard debe confirmar que el libro criptográfico SHA-256 permanece 100% íntegro en registros oficiales', () => {
  const check = guard.verifyIntegrity(tracker.getRegistry().filter(o => !o.isTestPick));
  assert.strictEqual(check.alteredCount, 0, 'No debe haber alteraciones');
  assert(check.intactCount >= 42, 'Todos los registros oficiales deben estar intactos');
});

// =========================================================================
// 4. LIQUIDACIÓN Y TRANSICIÓN A SETTLED
// =========================================================================
console.log('\n--- 4. Liquidación y Transición a SETTLED ---');

it('recordSettlement debe transicionar currentState a SETTLED y registrar la fuente oficial', () => {
  const probePickId = 'cand_test_lifecycle_probe_01';
  const settlement = {
    status: 'GANADA',
    actualStat: 2,
    profitUnits: 0.85,
    verificationStatus: 'RESULTADO_CONFIRMADO',
    verificationSource: 'StatsHub MCP Oficial FT',
    verificationReason: 'Prueba de transición a SETTLED',
    settledAt: new Date().toISOString()
  };

  tracker.recordSettlement(probePickId, settlement);
  const updated = tracker.getRegistry().find(p => p.pickId === probePickId);
  assert.strictEqual(updated.currentState, 'SETTLED');
  assert.strictEqual(updated.finalResultConfirmed, 'GANADA');
  const lastTransition = updated.stateHistory[updated.stateHistory.length - 1];
  assert.strictEqual(lastTransition.toState, 'SETTLED');
  assert.strictEqual(lastTransition.source, 'StatsHub MCP Oficial FT');
});

// =========================================================================
// 5. CONTROL DE MUESTRA Y SEPARACIÓN DE UNIVERSOS
// =========================================================================
console.log('\n--- 5. Control de Muestra y Separación de Denominadores ---');

it('Debe separar inequívocamente Candidatos, Eventos Únicos y Picks Confirmados', () => {
  const report = tracker.generateCheckpointReport();
  const candidatesDiscovered = report.universesCount.discovered;
  const picksSettled = report.checkpoint.confirmedCount;
  const uniqueEvents = report.eventCorrelationAudit.uniqueEvents;

  assert(candidatesDiscovered >= 42, `Candidatos descubiertos esperados >= 42, obtenidos ${candidatesDiscovered}`);
  assert.strictEqual(picksSettled, 18, `Picks liquidados esperados 18, obtenidos ${picksSettled}`);
  assert.strictEqual(uniqueEvents, 8, `Eventos únicos esperados 8, obtenidos ${uniqueEvents}`);
  assert(picksSettled > uniqueEvents, 'Picks liquidados debe ser mayor que eventos únicos por correlación');
});

// =========================================================================
// 6. SEGURIDAD OPERATIVA Y FLAGS DE SHADOW MODE
// =========================================================================
console.log('\n--- 6. Seguridad Operativa de Shadow Mode ---');

it('Shadow Mode debe estar activo con todos los flags de ejecución prohibidos', () => {
  assert.strictEqual(config.shadowMode.enabled, true);
  assert.strictEqual(config.shadowMode.allowRealBets, false);
  assert.strictEqual(config.shadowMode.allowTelegramPicks, false);
  assert.strictEqual(config.shadowMode.allowAutomatedOrders, false);
});

it('Todas las observaciones congeladas deben marcar isOperativeRecommendation en false', () => {
  nonTestObs.forEach(obs => {
    assert.strictEqual(obs.isOperativeRecommendation, false);
    assert.strictEqual(obs.shadowMode, true);
  });
});

console.log('\n====================================================');
console.log(`🏁 RESULTADO FASE 10.1.3: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
console.log('====================================================\n');

// Limpiar los probe picks de prueba
const cleanedRegistry = tracker.getRegistry().filter(p => !p.pickId.startsWith('cand_test_lifecycle_probe_') && !p.pickId.startsWith('cand_test_immutability_probe_'));
fs.writeFileSync(tracker.registryPath, JSON.stringify(cleanedRegistry, null, 2), 'utf-8');

if (failed > 0) {
  process.exit(1);
}
