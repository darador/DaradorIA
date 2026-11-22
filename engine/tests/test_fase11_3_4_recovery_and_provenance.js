/**
 * TEST SUITE: FASE 11.3.4 - RECUPERACIÓN HISTÓRICA Y CORRECCIÓN DE PROVENANCEGUARD
 * DARADORIA / DARADORBET
 * 
 * Verifica los 12 requisitos mandatorios especificados en la Fase 11.3.4.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { provenanceGuard, PROVENANCE_TYPES } = require('../audit/provenanceGuard');
const tracker = require('../prediction/observationTracker');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

console.log('🧪 Iniciando Test Suite: Validación Integral Fase 11.3.4...\n');

// =========================================================================
// 1. REGLAS DE CLASIFICACIÓN DE PROVENANCEGUARD
// =========================================================================
console.log('--- 1. Validación de Clasificación en ProvenanceGuard ---');

it('1. Candidato antiguo sin officialMatchId pero con fixture y agentes verificables no termina como sintético', () => {
  const cand = {
    id: 'cand_legacy_20261121_sample',
    match: 'Manchester City vs Fulham',
    playerOrTeam: 'Fulham',
    date: '2026-11-21',
    agent_reports: { playerAnalyst: {}, teamAnalyst: {}, matchContext: {}, oddsAnalyst: {}, matchIntel: {} },
    risk_verdict: { finalStatus: 'APROBADO' }
  };
  const type = provenanceGuard.classifyCandidate(cand);
  assert.strictEqual(type, PROVENANCE_TYPES.VERIFIED_PROVENANCE, 'Debe ser VERIFIED_PROVENANCE');
});

it('2. Candidato sin evidencia suficiente queda como UNKNOWN_PROVENANCE (nunca MOCK)', () => {
  const ambiguous = {
    id: 'cand_unknown_999',
    match: null,
    player: 'Random Unknown'
  };
  const type = provenanceGuard.classifyCandidate(ambiguous);
  assert.strictEqual(type, PROVENANCE_TYPES.UNKNOWN_PROVENANCE, 'Debe ser UNKNOWN_PROVENANCE');
});

it('3. Jugador asignado a club incorrecto queda como REAL_INVALID_PLAYER_TEAM', () => {
  const invalidPlayer = {
    id: 'cand_20261121_archer_sot',
    player: 'Cameron Archer',
    team: 'Auxerre',
    match: 'AS Monaco vs Auxerre'
  };
  const type = provenanceGuard.classifyCandidate(invalidPlayer);
  assert.strictEqual(type, PROVENANCE_TYPES.REAL_INVALID_PLAYER_TEAM, 'Debe ser REAL_INVALID_PLAYER_TEAM');
});

it('4. Plantilla sintética demostrada queda como SYNTHETIC_UI_TEMPLATE', () => {
  const templateCand = {
    id: 'cand_fase11_prem_salah_17',
    match: 'Liverpool vs Manchester United',
    player: 'Mohamed Salah'
  };
  const type = provenanceGuard.classifyCandidate(templateCand);
  assert.strictEqual(type, PROVENANCE_TYPES.SYNTHETIC_UI_TEMPLATE, 'Debe ser SYNTHETIC_UI_TEMPLATE');
});

it('5. ProvenanceGuard es idempotente: múltiples ejecuciones devuelven idéntica clasificación sin duplicar', () => {
  const item = { id: 'cand_20261121_fulham_sot', match: 'Man City vs Fulham' };
  const res1 = provenanceGuard.classifyCandidate(item);
  const res2 = provenanceGuard.classifyCandidate(item);
  assert.strictEqual(res1, res2, 'La clasificación debe ser exactamente la misma en múltiples corridas');
});

// =========================================================================
// 2. RECUPERACIÓN HISTÓRICA: FULHAM Y LEEDS
// =========================================================================
console.log('\n--- 2. Liquidación y Aprobación Histórica (Grupo A) ---');

const histApprovedFile = 'engine/storage_data/historical_approved_picks.json';
assert(fs.existsSync(histApprovedFile), 'historical_approved_picks.json debe existir');
const histApprovedData = JSON.parse(fs.readFileSync(histApprovedFile, 'utf8'));

it('6. Fulham se recupera como aprobado histórico y WON con 4 remates al arco', () => {
  const fulham = histApprovedData.picks.find(p => p.id === 'cand_20261121_fulham_sot');
  assert(fulham, 'Fulham debe estar en historical_approved_picks.json');
  assert.strictEqual(fulham.historical_status, 'HISTORICAL_APPROVED');
  assert.strictEqual(fulham.risk_verdict.finalStatus, 'APROBADO');
  assert.strictEqual(fulham.settlement_historical.status, 'WON');
  assert.strictEqual(fulham.settlement_historical.actual_stat, 4);
  assert.strictEqual(fulham.settlement_historical.line, 2.5);
  assert.strictEqual(fulham.odds, 1.64);
});

it('7. Leeds se recupera como aprobado histórico y LOST con 2 córners (sin asumir victoria por marcador)', () => {
  const leeds = histApprovedData.picks.find(p => p.id === 'cand_20261121_leeds_corners');
  assert(leeds, 'Leeds debe estar en historical_approved_picks.json');
  assert.strictEqual(leeds.historical_status, 'HISTORICAL_APPROVED');
  assert.strictEqual(leeds.risk_verdict.finalStatus, 'APROBADO');
  assert.strictEqual(leeds.settlement_historical.status, 'LOST');
  assert.strictEqual(leeds.settlement_historical.actual_stat, 2);
  assert.strictEqual(leeds.settlement_historical.line, 3.5);
  assert.strictEqual(leeds.odds, 1.73);
});

// =========================================================================
// 3. INVESTIGACIONES PENDIENTES PRESERVADAS (GRUPO B)
// =========================================================================
console.log('\n--- 3. Investigaciones con Dictamen Pendiente Preservadas (Grupo B) ---');

const histResearchFile = 'engine/storage_data/historical_research_archive.json';
assert(fs.existsSync(histResearchFile), 'historical_research_archive.json debe existir');
const histResearchData = JSON.parse(fs.readFileSync(histResearchFile, 'utf8'));

it('8. Los seis pendientes conservan su dictamen original PENDIENTE y sus 5 informes de agentes', () => {
  const expectedPendingIds = [
    'cand_20261121_ruibal_fouls',
    'cand_20261121_abde_sot',
    'cand_20261121_neto_sot',
    'cand_20261121_nuamah_shots',
    'cand_20261121_castaneda_shots',
    'cand_20261121_romano_shots'
  ];

  assert.strictEqual(histResearchData.totalPending, 6, 'Deben existir exactamente 6 pendientes');
  expectedPendingIds.forEach(id => {
    const p = histResearchData.candidates.find(c => c.id === id);
    assert(p, `Candidato ${id} debe existir en historical_research_archive.json`);
    assert.strictEqual(p.historical_status, 'HISTORICAL_PENDING');
    assert.strictEqual(p.risk_verdict.finalStatus, 'PENDIENTE');
    assert(p.agent_reports, 'Debe preservar agent_reports');
    assert.strictEqual(Object.keys(p.agent_reports).length, 5, 'Deben existir los 5 informes de agentes');
    assert.strictEqual(p.settlement_historical.status, 'PENDING_VERIFICATION');
  });
});

// =========================================================================
// 4. AISLAMIENTO OPERATIVO Y PROTECCIÓN DE MÉTRICAS
// =========================================================================
console.log('\n--- 4. Aislamiento Operativo y Protección de Métricas ---');

it('9. Ninguno de los 8 registros aparece como pick operativo en Daily Board (is_operative_recommendation: false)', () => {
  const allRecovered = [...histApprovedData.picks, ...histResearchData.candidates];
  allRecovered.forEach(p => {
    assert.strictEqual(p.is_operative_recommendation, false, `Pick ${p.id} no debe ser operativo`);
    const val = provenanceGuard.validateForDailyBoard(p);
    assert.strictEqual(val.isValid, false, `Pick ${p.id} debe ser bloqueado del Daily Board operativo`);
    assert(val.reason.includes('BLOQUEADO_POR_ESTADO_HISTORICO'));
  });
});

it('10. Las métricas actuales permanecen idénticas (ledger de sellos prepartido inalterado)', () => {
  const audit = tracker.verifyIntegrity();
  assert(audit.intactCount >= 57, 'Al menos 57 sellos prepartido originales deben permanecer intactos');
  assert.strictEqual(audit.alteredCount, 0, 'Cero alteraciones en el ledger sellado prepartido');
  assert.strictEqual(audit.violations.length, 0, 'Cero violaciones en el registro');
  assert(audit.ledgerEntries >= 65, 'Al menos 65 entradas en el ledger (57 originales + 8 sellos de recuperación histórica)');
});

// =========================================================================
// 5. VERIFICACIÓN DE CUARENTENA Y BACKUPS
// =========================================================================
console.log('\n--- 5. Cuarentena y Respaldo Inmutable ---');

it('11. Los 22 registros restantes siguen estrictamente en cuarentena', () => {
  const quarFile = 'engine/storage_data/quarantine_candidates.json';
  const qData = JSON.parse(fs.readFileSync(quarFile, 'utf8'));
  assert.strictEqual(qData.quarantinedCount, 22, 'Deben quedar exactamente 22 registros en cuarentena');
  assert.strictEqual(qData.quarantinedCandidates.length, 22);
  assert.strictEqual(qData.recoveredCount, 8);
  
  // Ninguno de los 8 recuperados debe estar en quarantinedCandidates
  const qIds = new Set(qData.quarantinedCandidates.map(c => c.originalCandidate.id));
  histApprovedData.picks.forEach(p => assert(!qIds.has(p.id), `Pick ${p.id} no debe estar en cuarentena`));
  histResearchData.candidates.forEach(p => assert(!qIds.has(p.id), `Pick ${p.id} no debe estar en cuarentena`));
});

it('12. Los backups y hashes SHA-256 permiten verificar la integridad de los archivos originales', () => {
  const backupDir = 'backups/backup_fase11_3_4_pre_recovery_20261121';
  assert(fs.existsSync(backupDir), 'Directorio de backup debe existir');
  const files = fs.readdirSync(backupDir);
  assert.strictEqual(files.length, 8, 'Deben existir los 8 archivos de backup');
  
  files.forEach(f => {
    const fPath = path.join(backupDir, f);
    const content = fs.readFileSync(fPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    assert(hash && hash.length === 64, `El hash SHA-256 del backup ${f} debe ser válido`);
  });
});

console.log('\n====================================================');
console.log(`🏁 RESULTADO SUITE FASE 11.3.4: ${passed} PASADAS, ${failed} FALLADAS`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
