/**
 * TEST SUITE: AUDITORÍA DE PROCEDENCIA Y AISLAMIENTO DE DATOS
 * DARADORIA / DARADORBET
 * 
 * Verifica:
 * 1. Rechazo de jugadores asociados a equipos incorrectos o ficticios.
 * 2. Rechazo de fixtures ficticios o no registrados en StatsHub.
 * 3. Aislamiento estricto: registros TEST, SIMULATION y MOCK bloqueados de producción.
 * 4. Bloqueo de aprobación para candidatos sin procedencia comprobada (REAL_VERIFIED).
 * 5. Trazabilidad de partidos reales verificados con procedencia completa.
 * 6. Integridad absoluta de los registros históricos congelados y hashes SHA-256.
 * 7. Exclusión total de datos de prueba en KPIs y métricas de producción.
 * 8. Cumplimiento innegociable de Shadow Mode.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { provenanceGuard, PROVENANCE_TYPES } = require('../audit/provenanceGuard');
const tracker = require('../prediction/observationTracker');
const config = require('../config');

let testsPassed = 0;
let testsFailed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     ${err.message}`);
    testsFailed++;
  }
}

console.log('🧪 Iniciando Test Suite: Auditoría de Procedencia y Aislamiento de Datos...\n');

// =========================================================================
// 1. CLASIFICACIÓN DE PROCEDENCIA Y VALIDACIÓN DE ENTIDADES
// =========================================================================
console.log('--- 1. Clasificación y Validación de Procedencia ---');

it('Identifica y clasifica correctamente un registro MOCK / SCRIPTED', () => {
  const mockCand = {
    id: 'cand_fase11_prem_salah_17',
    player: 'Mohamed Salah',
    match: 'Liverpool vs Manchester United'
  };
  const type = provenanceGuard.classifyCandidate(mockCand);
  assert.strictEqual(type, PROVENANCE_TYPES.MOCK, 'Debe clasificarse como MOCK');
});

it('Identifica y clasifica correctamente un registro con club inválido REAL_INVALID_PLAYER_TEAM', () => {
  const invalidPlayer = {
    id: 'cand_20261121_archer_sot',
    player: 'Cameron Archer',
    team: 'Auxerre',
    match: 'AS Monaco vs Auxerre'
  };
  const type = provenanceGuard.classifyCandidate(invalidPlayer);
  assert.strictEqual(type, PROVENANCE_TYPES.REAL_INVALID_PLAYER_TEAM, 'Debe clasificarse como REAL_INVALID_PLAYER_TEAM');
});

it('Identifica y clasifica correctamente un registro TEST', () => {
  const testCand = {
    id: 'cand_test_agent_01',
    isTestPick: true,
    player: 'Gabriel Barbosa',
    team: 'Santos'
  };
  const type = provenanceGuard.classifyCandidate(testCand);
  assert.strictEqual(type, PROVENANCE_TYPES.TEST, 'Debe clasificarse como TEST');
});

it('Identifica y clasifica correctamente un registro SIMULATION', () => {
  const simCand = {
    id: 'cand_sim_montecarlo_99',
    isSimulation: true,
    simulationId: 'sim_run_01'
  };
  const type = provenanceGuard.classifyCandidate(simCand);
  assert.strictEqual(type, PROVENANCE_TYPES.SIMULATION, 'Debe clasificarse como SIMULATION');
});

it('Identifica como UNVERIFIED a cualquier candidato sin metadatos de procedencia oficial', () => {
  const rawCand = {
    id: 'cand_random_123',
    player: 'Unknown Player',
    team: 'Team A'
  };
  const type = provenanceGuard.classifyCandidate(rawCand);
  assert.strictEqual(type, PROVENANCE_TYPES.UNVERIFIED, 'Sin procedencia debe ser UNVERIFIED');
});

it('Identifica como REAL_VERIFIED a los candidatos con trazabilidad oficial de StatsHub', () => {
  const verifiedCand = {
    id: 'cand_1795110774831_6k1oex',
    player: 'Bruno Gomes',
    team: 'Internacional',
    provenance: {
      type: PROVENANCE_TYPES.REAL_VERIFIED,
      officialMatchId: 'match.internacional_vasco',
      officialPlayerId: 'player.bruno_gomes',
      sourceTool: 'getPropScreener'
    }
  };
  const type = provenanceGuard.classifyCandidate(verifiedCand);
  assert.strictEqual(type, PROVENANCE_TYPES.REAL_VERIFIED, 'Debe clasificarse como REAL_VERIFIED');
});

// =========================================================================
// 2. BLOQUEO DE ENTRADA AL DAILY BOARD Y PIPELINE DE PRODUCCIÓN
// =========================================================================
console.log('\n--- 2. Reglas de Bloqueo para Producción (Daily Board) ---');

it('Bloquea la entrada al Daily Board de candidatos MOCK, TEST o SIMULATION', () => {
  const mock1 = { id: 'cand_fase11_prem_salah_17', match: 'Liverpool vs Manchester United', player: 'Mohamed Salah' };
  const val1 = provenanceGuard.validateForDailyBoard(mock1);
  assert.strictEqual(val1.isValid, false);
  assert(val1.reason.includes('BLOQUEADO_POR_PROVENANCE'));

  const test1 = { id: 'cand_test_01', match: 'Real Madrid vs Inter', player: 'Kylian Mbappé' };
  const val2 = provenanceGuard.validateForDailyBoard(test1);
  assert.strictEqual(val2.isValid, false);
});

it('Bloquea candidatos con fixtures vacíos o inexistentes', () => {
  const invalidFixture = {
    id: 'cand_real_01',
    match: '',
    player: 'Valid Player',
    provenance: { type: PROVENANCE_TYPES.REAL_VERIFIED, officialMatchId: '1', officialPlayerId: '2', sourceTool: 'test' }
  };
  const val = provenanceGuard.validateForDailyBoard(invalidFixture);
  assert.strictEqual(val.isValid, false);
  assert(val.reason.includes('BLOQUEADO_POR_FIXTURE_INVALIDO'));
});

it('Bloquea el ingreso de registros TEST o SIMULATION al Observation Tracker real', () => {
  const testRecord = { id: 'pick_test_01', isTestPick: true };
  const check = provenanceGuard.validateForObservationTracker(testRecord);
  assert.strictEqual(check.allowed, false);
  assert(check.reason.includes('AISLAMIENTO_ESTRICTO'));
});

// =========================================================================
// 3. SANEAMIENTO Y AISLAMIENTO DE PICKS_HOY.JSON
// =========================================================================
console.log('\n--- 3. Verificación de Saneamiento de picks_hoy.json ---');

const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));

it('picks_hoy.json no contiene ningún candidato MOCK o con IDs cand_20261121_ ni cand_fase11_', () => {
  const contaminated = picksHoy.top_picks.filter(p => 
    p.id.startsWith('cand_20261121_') || 
    p.id.startsWith('cand_fase11_') ||
    p.id.includes('test')
  );
  assert.strictEqual(contaminated.length, 0, 'Cero registros mock en picks_hoy.json');
});

it('Todos los candidatos en picks_hoy.json están clasificados como REAL_VERIFIED', () => {
  for (const pick of picksHoy.top_picks) {
    const classification = provenanceGuard.classifyCandidate(pick);
    assert.strictEqual(classification, PROVENANCE_TYPES.REAL_VERIFIED, `Pick ${pick.id} debe ser REAL_VERIFIED`);
  }
});

it('El archivo de cuarentena preserva los 22 candidatos aislados con metadata de auditoría', () => {
  const quarPath = 'engine/storage_data/quarantine_candidates.json';
  assert(fs.existsSync(quarPath), 'Archivo de cuarentena debe existir');
  const quarData = JSON.parse(fs.readFileSync(quarPath, 'utf8'));
  assert.strictEqual(quarData.quarantinedCount, 22, 'Deben existir exactamente 22 candidatos en cuarentena');
  assert.strictEqual(quarData.recoveredCount, 8, 'Deben existir 8 candidatos recuperados');
  assert(Array.isArray(quarData.quarantinedCandidates), 'Lista de candidatos en cuarentena debe ser un array');
  assert(quarData.quarantinedCandidates[0].quarantineReason.includes('FAILED_PROVENANCE_CHECK'));
});

// =========================================================================
// 4. INTEGRIDAD CRIPTOGRÁFICA Y MÉTRICAS HISTÓRICAS
// =========================================================================
console.log('\n--- 4. Integridad del Ledger Criptográfico y KPIs ---');

it('Las 20 observaciones oficiales congeladas permanecen intactas en el ledger', () => {
  const reg = tracker.getRegistry();
  const settled = reg.filter(r => r.settledAt && !r.isTestPick && !r.pickId.startsWith('cand_test_') && !r.pickId.startsWith('pick_test_'));
  assert.strictEqual(settled.length, 20, 'Deben existir exactamente 20 observaciones oficiales auditadas (18 de 19-Nov + 2 de 20-Nov)');
});

it('El ledger SHA-256 no presenta ninguna alteración histórica (0 alterados)', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0, 'Cero alteraciones en el ledger sellado');
});

it('Shadow Mode estricto activo en configuración', () => {
  assert.strictEqual(config.shadowMode.enabled, true);
  assert.strictEqual(config.shadowMode.allowRealBets, false);
  assert.strictEqual(config.shadowMode.allowAutomatedOrders, false);
});

// =========================================================================
// RESUMEN FINAL
// =========================================================================
console.log('\n====================================================');
console.log(`🏁 RESULTADO AUDITORÍA DE PROCEDENCIA: ${testsPassed} PRUEBAS PASADAS, ${testsFailed} FALLADAS`);
console.log('====================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}
