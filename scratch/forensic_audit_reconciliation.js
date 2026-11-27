const fs = require('fs');
const path = require('path');

const cohortPath = 'engine/storage_data/shadow_lab_cohort_v2_2.json';
const picksPath = 'picks_hoy.json';

const cohortData = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const picksData = JSON.parse(fs.readFileSync(picksPath, 'utf8'));

const preds = cohortData.predictions || [];
const picks = picksData.top_picks || [];

console.log('=== AUDITORÍA FORENSE FASE 2.7: RECONCILIACIÓN DE COHORTES ===\n');
console.log('Total en picks_hoy.json:', picks.length);
console.log('Total en shadow_lab_cohort_v2_2.json:', preds.length);

// Mapa de picks_hoy por ID
const picksMap = new Map(picks.map(p => [p.id, p]));

// Clasificación de cada registro de preds
const inventory = {
  total: preds.length,
  evaluable: 0,
  won: 0,
  lost: 0,
  push: 0,
  void_no_part: 0,
  void_susp: 0,
  void_other: 0,
  pending: 0,
  temporal_invalid: 0,
  unmatched_picks: [],
  evaluable_list: [],
  void_list: [],
  pending_list: []
};

preds.forEach((p, idx) => {
  const orig = picksMap.get(p.candidateId);
  const settled = p.isSettled;
  const res = p.result;

  // Verificación temporal
  const kickoff = p.eventKickoff ? new Date(p.eventKickoff) : null;
  const cutoff = p.dataCutoffTimestamp ? new Date(p.dataCutoffTimestamp) : null;
  const sourceTime = p.sourceEventTimestamp ? new Date(p.sourceEventTimestamp) : null;
  const ingested = p.ingestedAt ? new Date(p.ingestedAt) : null;

  let isTemporalViolation = false;
  if (kickoff && cutoff && cutoff.getTime() > kickoff.getTime() + (5 * 60 * 1000)) {
    isTemporalViolation = true;
    inventory.temporal_invalid++;
  }

  if (!settled || !res) {
    inventory.pending++;
    inventory.pending_list.push({
      id: p.candidateId,
      match: p.match,
      odds: p.odds,
      origStatus: orig?.status,
      origSportsResult: orig?.sports_result,
      isSettled: p.isSettled
    });
  } else if (res.isVoid) {
    const statusOrig = orig?.status || orig?.sports_result || res.status || '';
    const notes = orig?.notes || orig?.rationale || '';
    const isLineup = statusOrig.includes('NO_TITULAR') || statusOrig.includes('LINEUP') || notes.includes('no figura en el XI');
    const isInteger = p.line && !p.line.includes('.5');

    if (isLineup) {
      inventory.void_no_part++;
      inventory.void_list.push({ id: p.candidateId, type: 'NO_PARTICIPACION_T60', status: statusOrig });
    } else if (isInteger) {
      inventory.push++;
      inventory.void_list.push({ id: p.candidateId, type: 'PUSH_LINEA_ENTERA', status: statusOrig });
    } else {
      inventory.void_susp++;
      inventory.void_list.push({ id: p.candidateId, type: 'SUSPENSION_O_CANCELACION', status: statusOrig });
    }
  } else {
    // Es evaluable (Won o Lost)
    inventory.evaluable++;
    if (res.isWon) inventory.won++;
    else inventory.lost++;

    inventory.evaluable_list.push({
      id: p.candidateId,
      match: p.match,
      odds: p.odds,
      pV1: p.pV1,
      pV2: p.pV2,
      isWon: res.isWon,
      isTemporalViolation
    });
  }
});

console.log('\n--- CUADRO DE RECONCILIACIÓN EXACTA ---');
console.log('Total de candidatos congelados en Cohorte V2.2:', inventory.total);
console.log('  1. Candidatos evaluables (no nulos):', inventory.evaluable);
console.log('     - Ganados (Won):', inventory.won, `(${(inventory.won/inventory.evaluable*100).toFixed(1)}%)`);
console.log('     - Perdidos (Lost):', inventory.lost, `(${(inventory.lost/inventory.evaluable*100).toFixed(1)}%)`);
console.log('  2. Total VOID / Push:', inventory.void_no_part + inventory.void_susp + inventory.push);
console.log('     - Push (línea entera):', inventory.push);
console.log('     - VOID por no participación (T-60 suplente):', inventory.void_no_part);
console.log('     - VOID por suspensión / reprogramación:', inventory.void_susp);
console.log('  3. Pendientes de liquidación:', inventory.pending);
console.log('     - Suma de categorías:', inventory.evaluable + inventory.void_no_part + inventory.void_susp + inventory.push + inventory.pending);
console.log('     - Discrepancia con total 144:', inventory.total - (inventory.evaluable + inventory.void_no_part + inventory.void_susp + inventory.push + inventory.pending));

console.log('\n--- DETALLE DE LOS 3 REGISTROS PENDIENTES ---');
console.log(inventory.pending_list);
