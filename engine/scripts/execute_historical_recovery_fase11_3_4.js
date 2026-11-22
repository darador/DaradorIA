/**
 * DARADORBET — FASE 11.3.4: RECUPERACIÓN HISTÓRICA CONTROLADA
 * Script de ejecución determinista e idempotente.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🚀 Iniciando script de recuperación histórica Fase 11.3.4...\n');

const quarPath = path.resolve('engine/storage_data/quarantine_candidates.json');
const histApprovedPath = path.resolve('engine/storage_data/historical_approved_picks.json');
const histResearchPath = path.resolve('engine/storage_data/historical_research_archive.json');
const researchPath = path.resolve('engine/storage_data/research_candidates.json');
const ledgerPath = path.resolve('engine/storage_data/audit_integrity_ledger.json');

const quarData = JSON.parse(fs.readFileSync(quarPath, 'utf8'));

const recoveredIdsGroupA = new Set([
  'cand_20261121_fulham_sot',
  'cand_20261121_leeds_corners'
]);

const recoveredIdsGroupB = new Set([
  'cand_20261121_ruibal_fouls',
  'cand_20261121_abde_sot',
  'cand_20261121_neto_sot',
  'cand_20261121_nuamah_shots',
  'cand_20261121_castaneda_shots',
  'cand_20261121_romano_shots'
]);

const allRecoveredIds = new Set([...recoveredIdsGroupA, ...recoveredIdsGroupB]);

const nowUtc = new Date().toISOString();

const recoveredGroupA = [];
const recoveredGroupB = [];
const remainingQuarantine = [];

quarData.quarantinedCandidates.forEach(item => {
  const c = item.originalCandidate;
  if (recoveredIdsGroupA.has(c.id)) {
    // Grupo A: Aprobados históricos
    const isFulham = c.id === 'cand_20261121_fulham_sot';
    const isLeeds = c.id === 'cand_20261121_leeds_corners';
    
    const recoveredObj = {
      ...c,
      is_historical_recovery: true,
      is_operative_recommendation: false,
      historical_status: 'HISTORICAL_APPROVED',
      recovery_metadata: {
        recovery_phase: '11.3.4',
        recovery_source: 'engine/storage_data/quarantine_candidates.json (commit 0aab50c / commit 469ddd1)',
        source_created_at: c.risk_verdict ? c.risk_verdict.decidedAt : (c.date + 'T23:30:00.000Z'),
        original_decided_at: c.risk_verdict ? c.risk_verdict.decidedAt : '2026-11-20T23:30:00.000Z',
        recovered_at: nowUtc,
        integrity_sealed_at: nowUtc,
        is_historical_recovery: true,
        recovery_classification: 'HISTORICAL_APPROVED',
        original_risk_verdict: c.risk_verdict
      },
      settlement_historical: {
        status: isFulham ? 'WON' : 'LOST',
        result_label: isFulham ? 'ACERTADA' : 'FALLADA',
        official_market: isFulham ? 'Remates al arco de equipo (Fulham)' : 'Córners de equipo (Leeds United)',
        line: isFulham ? 2.5 : 3.5,
        actual_stat: isFulham ? 4 : 2,
        official_match_id: isFulham ? 'manchester-city-v-fulham.0td7e63' : 'chelsea-v-leeds-united.0mslo6c',
        official_match_score: isFulham ? 'Manchester City 1-1 Fulham' : 'Chelsea 1-4 Leeds United',
        settled_at: nowUtc,
        odds_frozen: isFulham ? 1.64 : 1.73,
        evidence_source: 'StatsHub MCP (getTeamPerformance / getMatchDetails)'
      }
    };
    recoveredGroupA.push(recoveredObj);
  } else if (recoveredIdsGroupB.has(c.id)) {
    // Grupo B: Investigaciones con dictamen pendiente
    const recoveredObj = {
      ...c,
      is_historical_recovery: true,
      is_operative_recommendation: false,
      historical_status: 'HISTORICAL_PENDING',
      recovery_metadata: {
        recovery_phase: '11.3.4',
        recovery_source: 'engine/storage_data/quarantine_candidates.json (commit 0aab50c / commit cccf772)',
        source_created_at: c.risk_verdict ? c.risk_verdict.decidedAt : (c.date + 'T00:10:00.000Z'),
        original_decided_at: c.risk_verdict ? c.risk_verdict.decidedAt : '2026-11-21T00:10:00.000Z',
        recovered_at: nowUtc,
        integrity_sealed_at: nowUtc,
        is_historical_recovery: true,
        recovery_classification: 'HISTORICAL_PENDING',
        original_risk_verdict: c.risk_verdict
      },
      settlement_historical: {
        status: 'PENDING_VERIFICATION',
        result_label: 'NO_LIQUIDADO_EN_CARTERA_ACTIVA',
        note: 'Preservado con dictamen histórico PENDIENTE (T-60 min). No computa en portfolio aprobado ni en métricas de rentabilidad.'
      }
    };
    recoveredGroupB.push(recoveredObj);
  } else {
    remainingQuarantine.push(item);
  }
});

console.log(`✅ Recuperados Grupo A (Aprobados): ${recoveredGroupA.length}`);
console.log(`✅ Recuperados Grupo B (Pendientes): ${recoveredGroupB.length}`);
console.log(`✅ Restantes en cuarentena: ${remainingQuarantine.length}`);

if (recoveredGroupA.length !== 2 || recoveredGroupB.length !== 6 || remainingQuarantine.length !== 22) {
  throw new Error(`Conteo inconsistente: Grupo A=${recoveredGroupA.length}, Grupo B=${recoveredGroupB.length}, Cuarentena=${remainingQuarantine.length}`);
}

// 1. Escribir historical_approved_picks.json
fs.writeFileSync(histApprovedPath, JSON.stringify({
  version: '1.0.0',
  description: 'DARADORBET - Repositorio de Picks Aprobados Históricamente (Recuperación Fase 11.3.4)',
  updatedAt: nowUtc,
  totalApproved: recoveredGroupA.length,
  picks: recoveredGroupA
}, null, 2), 'utf8');
console.log(`💾 Escrito: ${histApprovedPath}`);

// 2. Escribir historical_research_archive.json
fs.writeFileSync(histResearchPath, JSON.stringify({
  version: '1.0.0',
  description: 'DARADORBET - Archivo Histórico de Investigaciones con Dictamen Pendiente (Fase 11.3.4)',
  updatedAt: nowUtc,
  totalPending: recoveredGroupB.length,
  candidates: recoveredGroupB
}, null, 2), 'utf8');
console.log(`💾 Escrito: ${histResearchPath}`);

// 3. Actualizar quarantine_candidates.json con 22 registros restantes
const updatedQuar = {
  version: '1.1.0',
  description: 'DARADORBET - Repositorio de Cuarentena (Fase 11.3.4: 8 candidatos reales recuperados a repositorios históricos; 22 registros confinados)',
  updatedAt: nowUtc,
  quarantinedCount: remainingQuarantine.length,
  recoveredCount: recoveredGroupA.length + recoveredGroupB.length,
  recoveryPhase: '11.3.4',
  recoveredCandidates: [...recoveredGroupA, ...recoveredGroupB].map(c => ({
    id: c.id,
    match: c.match,
    player: c.player || c.team,
    historical_status: c.historical_status,
    destination: c.historical_status === 'HISTORICAL_APPROVED' ? 'engine/storage_data/historical_approved_picks.json' : 'engine/storage_data/historical_research_archive.json',
    recovered_at: nowUtc
  })),
  quarantinedCandidates: remainingQuarantine
};
fs.writeFileSync(quarPath, JSON.stringify(updatedQuar, null, 2), 'utf8');
console.log(`💾 Actualizado: ${quarPath}`);

// 4. Actualizar research_candidates.json (incorporación no destructiva e idempotente)
const researchData = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
const existingResearchIds = new Set(researchData.map(c => c.id));
let addedToResearch = 0;

[...recoveredGroupA, ...recoveredGroupB].forEach(c => {
  if (!existingResearchIds.has(c.id)) {
    researchData.push(c);
    addedToResearch++;
  }
});
fs.writeFileSync(researchPath, JSON.stringify(researchData, null, 2), 'utf8');
console.log(`💾 Actualizado: ${researchPath} (+${addedToResearch} nuevos registros, total ${researchData.length})`);

// 5. Actualizar audit_integrity_ledger.json con sellos de integridad de recuperación
const ledgerData = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existingLedgerPickIds = new Set((ledgerData.seals || []).map(s => s.pickId));
let addedSeals = 0;

if (!ledgerData.seals) ledgerData.seals = [];

[...recoveredGroupA, ...recoveredGroupB].forEach(c => {
  if (!existingLedgerPickIds.has(c.id)) {
    const rawContent = JSON.stringify(c);
    const contentHash = crypto.createHash('sha256').update(rawContent).digest('hex');
    ledgerData.seals.push({
      sealId: `seal_hist_rec_${Date.now()}_${c.id}`,
      pickId: c.id,
      candidateId: c.id,
      match: c.match,
      selection: c.selection || `${c.player || c.team} ${c.line}`,
      odds: c.odds,
      contentHash: contentHash,
      sealed_at: nowUtc,
      is_historical_recovery: true,
      recovery_phase: '11.3.4',
      historical_status: c.historical_status,
      note: 'Sello de integridad forense generado en la recuperación histórica Fase 11.3.4 (no es firma pre-match)'
    });
    addedSeals++;
  }
});

ledgerData.totalSeals = ledgerData.seals.length;
ledgerData.lastAuditTimestamp = nowUtc;
fs.writeFileSync(ledgerPath, JSON.stringify(ledgerData, null, 2), 'utf8');
console.log(`💾 Actualizado: ${ledgerPath} (+${addedSeals} nuevos sellos de recuperación, total ${ledgerData.totalSeals})`);

console.log('\n🎉 Recuperación histórica Fase 11.3.4 completada exitosamente.');
