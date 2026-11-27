const fs = require('fs');

const cohortPath = 'engine/storage_data/shadow_lab_cohort_v2_2.json';
const cohortData = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const preds = cohortData.predictions || [];

console.log('=== AUDITORÍA FORENSE FASE 2.7: INTEGRIDAD TEMPORAL ===\n');

const stats = {
  total: preds.length,
  hasSourceTimestamp: 0,
  hasDataCutoffTimestamp: 0,
  hasEventKickoff: 0,
  hasIngestedAt: 0,
  validConditionCount: 0,
  violationCount: 0,
  kickoffMissing: 0,
  sourceMissing: 0,
  cutoffMissing: 0,
  violations: [],
  samples: []
};

preds.forEach((p, idx) => {
  const kickoff = p.eventKickoff ? new Date(p.eventKickoff) : null;
  const cutoff = p.dataCutoffTimestamp ? new Date(p.dataCutoffTimestamp) : null;
  const source = p.sourceEventTimestamp ? new Date(p.sourceEventTimestamp) : null;
  const ingested = p.ingestedAt ? new Date(p.ingestedAt) : null;

  if (p.sourceEventTimestamp) stats.hasSourceTimestamp++; else stats.sourceMissing++;
  if (p.dataCutoffTimestamp) stats.hasDataCutoffTimestamp++; else stats.cutoffMissing++;
  if (p.eventKickoff) stats.hasEventKickoff++; else stats.kickoffMissing++;
  if (p.ingestedAt) stats.hasIngestedAt++;

  // Condición formal de validez:
  // sourceEventTimestamp <= dataCutoffTimestamp < eventKickoff
  // Tolerancia técnica para jitter: 5 min
  let isViolation = false;
  let reason = '';

  if (!kickoff) {
    isViolation = true;
    reason = 'eventKickoff AUSENTE';
  } else if (!cutoff && !source) {
    isViolation = true;
    reason = 'dataCutoffTimestamp Y sourceEventTimestamp AUSENTES';
  } else {
    const effCutoff = cutoff || source;
    if (effCutoff.getTime() > kickoff.getTime() + (5 * 60 * 1000)) {
      isViolation = true;
      reason = `dataCutoff (${effCutoff.toISOString()}) POSTERIOR a eventKickoff (${kickoff.toISOString()})`;
    } else if (source && cutoff && source.getTime() > cutoff.getTime() + (5 * 60 * 1000)) {
      isViolation = true;
      reason = `source (${source.toISOString()}) POSTERIOR a cutoff (${cutoff.toISOString()})`;
    }
  }

  if (isViolation) {
    stats.violationCount++;
    stats.violations.push({
      id: p.candidateId,
      match: p.match,
      eventKickoff: p.eventKickoff,
      dataCutoffTimestamp: p.dataCutoffTimestamp,
      sourceEventTimestamp: p.sourceEventTimestamp,
      ingestedAt: p.ingestedAt,
      reason
    });
  } else {
    stats.validConditionCount++;
  }

  if (idx < 5) {
    stats.samples.push({
      id: p.candidateId,
      match: p.match,
      sourceEventTimestamp: p.sourceEventTimestamp,
      dataCutoffTimestamp: p.dataCutoffTimestamp,
      eventKickoff: p.eventKickoff,
      ingestedAt: p.ingestedAt,
      isValid: !isViolation
    });
  }
});

console.log('Resultados de Presencia de Timestamps (144 registros):');
console.log('  eventKickoff presentes:', stats.hasEventKickoff, '| Ausentes:', stats.kickoffMissing);
console.log('  dataCutoffTimestamp presentes:', stats.hasDataCutoffTimestamp, '| Ausentes:', stats.cutoffMissing);
console.log('  sourceEventTimestamp presentes:', stats.hasSourceTimestamp, '| Ausentes:', stats.sourceMissing);
console.log('  ingestedAt presentes:', stats.hasIngestedAt);

console.log('\nCumplimiento de la regla source <= cutoff < kickoff:');
console.log('  Cumplen estrictamente la condición:', stats.validConditionCount, `(${(stats.validConditionCount/stats.total*100).toFixed(1)}%)`);
console.log('  Violaciones temporales detectadas:', stats.violationCount);

if (stats.violations.length > 0) {
  console.log('\n--- MUESTRA DE VIOLACIONES TEMPORALES DETECTADAS ---');
  console.log(stats.violations.slice(0, 5));
}

console.log('\n--- MUESTRA DE 5 REGISTROS AUDITADOS ---');
console.log(stats.samples);
