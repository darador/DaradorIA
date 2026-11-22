const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '../..');

// Load current files
const picksHoy = JSON.parse(fs.readFileSync(path.join(rootDir, 'picks_hoy.json'), 'utf8')).top_picks || [];
const candidates = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/research_candidates.json'), 'utf8'));
const approvedStorage = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/approved_picks.json'), 'utf8'));
const rejectedStorage = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/rejected_picks.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/model_observation_registry.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json'), 'utf8'));
const quarantine = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/quarantine_candidates.json'), 'utf8')).quarantinedCandidates || [];
const historial = JSON.parse(fs.readFileSync(path.join(rootDir, 'historial_picks.json'), 'utf8')).picks || [];

// Load 11:55 midday snapshot
let middayTopPicks = [];
try {
  const rawMidday = execSync('git show 7e25ece:picks_hoy.json', { maxBuffer: 15 * 1024 * 1024 }).toString('utf8');
  middayTopPicks = JSON.parse(rawMidday).top_picks || [];
} catch (e) {
  console.error('Error reading git 7e25ece:', e.message);
}

console.log('=== DATA COUNTS IN STORAGE ===');
console.log('Current picks_hoy.json top_picks:', picksHoy.length);
console.log('Midday picks_hoy.json (7e25ece):', middayTopPicks.length);
console.log('Current quarantine_candidates:', quarantine.length);
console.log('Current research_candidates:', candidates.length);
console.log('Current approved_picks.json:', approvedStorage.length);
console.log('Current rejected_picks.json:', rejectedStorage.length);
console.log('Current model_observation_registry:', registry.length);
console.log('Current historial_picks.json:', historial.length);

// Map of all known candidate IDs associated with 21/11 activity or present in system
const allCandidateIds = new Set();

// 1. All in picks_hoy
picksHoy.forEach(p => allCandidateIds.add(p.id));
// 2. All in midday top picks
middayTopPicks.forEach(p => allCandidateIds.add(p.id));
// 3. All in quarantine
quarantine.forEach(q => allCandidateIds.add(q.originalCandidate ? q.originalCandidate.id : q.id));
// 4. All in research candidates
candidates.forEach(c => allCandidateIds.add(c.id));
// 5. All in approved storage
approvedStorage.forEach(a => allCandidateIds.add(a.id || a.candidateId));
// 6. All in registry
registry.forEach(r => allCandidateIds.add(r.pickId));

console.log('Total unique IDs across all historical and current files:', allCandidateIds.size);

// Build individual traceability table
const traceabilityTable = [];

allCandidateIds.forEach(id => {
  const inPicksHoy = picksHoy.find(p => p.id === id);
  const inMidday = middayTopPicks.find(p => p.id === id);
  const inQuar = quarantine.find(q => (q.originalCandidate && q.originalCandidate.id === id) || q.id === id);
  const inCand = candidates.find(c => c.id === id);
  const inAppStorage = approvedStorage.find(a => (a.id === id || a.candidateId === id));
  const inRejStorage = rejectedStorage.find(r => (r.id === id || r.candidateId === id));
  const inReg = registry.find(r => r.pickId === id);
  const inHist = historial.find(h => h.id === id);
  const inLedger = ledger[id] || null;

  // Source object
  const src = inPicksHoy || inMidday || (inQuar ? inQuar.originalCandidate : null) || inCand || inAppStorage || inRejStorage || inReg || inHist;

  const match = src.match || src.event || 'N/A';
  const player = src.player || src.playerOrTeam || src.target || src.team || 'N/A';
  const market = src.market || 'N/A';
  const selection = src.selection || `${player} ${src.line || ''}`;
  const odds = src.odds || (inCand ? inCand.odds : null) || 'N/A';
  const date = src.date || src.eventDateLocal || (inCand ? inCand.date : 'N/A');

  // Decision & Reason
  let riskDecision = 'N/A';
  let riskReason = 'N/A';

  if (src.risk_verdict) {
    riskDecision = src.risk_verdict.finalStatus;
    riskReason = src.risk_verdict.finalReason;
  } else if (src.riskVerdict) {
    riskDecision = src.riskVerdict.finalStatus;
    riskReason = src.riskVerdict.finalReason;
  } else if (inReg && inReg.elenaDecision) {
    riskDecision = inReg.elenaDecision;
    riskReason = (inReg.elenaVetoReasons && inReg.elenaVetoReasons.join('; ')) || inReg.elenaVetoRule || 'Evaluado por Elena';
  } else if (src.status === 'APROBADO') {
    riskDecision = 'APPROVED';
    riskReason = src.rationale || 'Aprobado matemáticamente';
  } else if (src.status === 'PENDIENTE_ALINEACION' || src.status === 'PENDIENTE') {
    riskDecision = 'PENDING';
    riskReason = 'Alineación pendiente';
  }

  // Storage status
  const storageLocations = [];
  if (inCand) storageLocations.push('research_candidates.json');
  if (inAppStorage) storageLocations.push('approved_picks.json');
  if (inRejStorage) storageLocations.push('rejected_picks.json');
  if (inQuar) storageLocations.push('quarantine_candidates.json');
  if (inReg) storageLocations.push('model_observation_registry.json');
  if (inHist) storageLocations.push('historial_picks.json');
  if (inPicksHoy) storageLocations.push('picks_hoy.json');

  const storageStatus = storageLocations.length > 0 ? storageLocations.join(', ') : 'NO_ALMACENADO';
  const dailyBoardStatus = inPicksHoy ? 'ACTUALMENTE_VISIBLE' : (inMidday ? 'VISIBLE_AL_MEDIODIA_PERO_RETIRADO' : 'NO_INCLUIDO');
  const historyStatus = inHist ? 'PRESENTE' : 'NO_APLICA_PRE_MATCH';
  const observationStatus = inReg ? 'REGISTRADO' : 'NO_REGISTRADO';
  const settlementStatus = inHist ? inHist.status : (inReg && inReg.verificationStatus ? inReg.verificationStatus : 'NO_LIQUIDADO_PRE_MATCH');
  const integrityStatus = inLedger ? 'SELLADO_SHA256' : 'SIN_SELLO';

  // Final classification
  let finalClassification = 'DESCONOCIDO';
  if (inQuar) {
    finalClassification = 'EN_CUARENTENA';
  } else if (inPicksHoy && inPicksHoy.provenance && inPicksHoy.provenance.type === 'REAL_VERIFIED') {
    if (inReg && inCand) {
      finalClassification = 'PRESENTE_Y_CORRECTO';
    } else {
      finalClassification = 'APROBADO_PERO_AUSENTE_DEL_OBSERVATION_TRACKER';
    }
  } else if (inHist) {
    finalClassification = 'PRESENTE_Y_CORRECTO';
  } else if (inRejStorage || (inReg && inReg.elenaDecision === 'RECHAZADO') || (inCand && inCand.status === 'RECHAZADO')) {
    finalClassification = 'RECHAZADO_CORRECTAMENTE';
  } else if (inCand && inCand.status === 'INVESTIGACION_INCOMPLETA') {
    finalClassification = 'INVESTIGACION_INCOMPLETA';
  } else if (inCand && (inCand.status === 'DETECTADO' || inCand.status === 'DISCOVERED')) {
    finalClassification = 'PENDIENTE';
  } else if (inMidday && !inPicksHoy && !inQuar) {
    finalClassification = 'PERDIDO_NO_ENCONTRADO';
  }

  traceabilityTable.push({
    candidate_id: id,
    match,
    player,
    market,
    selection,
    odds,
    date,
    discovered_at: src.discoveredAt || src.createdAt || '2026-11-21',
    researched_at: src.researchedAt || src.investigatedAt || 'N/A',
    risk_decision: riskDecision,
    risk_reason: riskReason,
    storage_status: storageStatus,
    daily_board_status: dailyBoardStatus,
    history_status: historyStatus,
    observation_status: observationStatus,
    settlement_status: settlementStatus,
    integrity_status: integrityStatus,
    final_classification: finalClassification
  });
});

console.log('\n=== CLASSIFICATION SUMMARY ===');
const summary = {};
traceabilityTable.forEach(t => {
  summary[t.final_classification] = (summary[t.final_classification] || 0) + 1;
});
console.log(JSON.stringify(summary, null, 2));

// Save full table to disk for report
fs.writeFileSync(path.join(rootDir, 'engine/storage_data/audit_traceability_table.json'), JSON.stringify(traceabilityTable, null, 2), 'utf8');
console.log(`\n✅ Tabla de trazabilidad completa generada: ${traceabilityTable.length} candidatos auditados.`);
