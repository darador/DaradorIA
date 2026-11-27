import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadProspectiveStore } from './liveProspectiveCapturer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Renders an independent summary table of the Live Prospective Cohort.
 */
export function generateProspectiveMonitorReport() {
  const store = loadProspectiveStore();
  const records = store.records || [];

  const total = records.length;
  const pending = records.filter(r => r.status === 'FROZEN_PENDING').length;
  const violations = records.filter(r => r.status === 'TEMPORAL_VIOLATION').length;
  const superseded = records.filter(r => r.status === 'SUPERSEDED_BY_ODDS_CHANGE').length;
  const evaluated = records.filter(r => ['WON', 'LOST', 'PUSH', 'VOID'].includes(r.status)).length;

  console.log('========================================================================================');
  console.log('              DARADOR IA 2.0 — LIVE PROSPECTIVE SHADOW COHORT MONITOR                  ');
  console.log('========================================================================================');
  console.log(`Cohort ID:      ${store.cohortId}`);
  console.log(`Last Updated:   ${store.updatedAt || 'N/A'}`);
  console.log(`Total Records:  ${total} (Pending: ${pending} | Evaluated: ${evaluated} | Superseded: ${superseded} | Violations: ${violations})`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('| Candidate ID                 | Market / Sel / Line | Odds | P(V1)  | P(V2.2)| EV(V1) | EV(V2) | Status         |');
  console.log('----------------------------------------------------------------------------------------');

  for (const r of records) {
    const cid = (r.candidateId || '').padEnd(28).substring(0, 28);
    const mkt = `${r.market || ''} ${r.selection || ''} ${r.line !== null && r.line !== undefined ? r.line : ''}`.padEnd(21).substring(0, 21);
    const odds = (r.odds !== undefined ? Number(r.odds).toFixed(2) : '-').padStart(5);
    const pv1 = (r.probabilityV1 !== undefined ? (Number(r.probabilityV1) * 100).toFixed(1) + '%' : '-').padStart(6);
    const pv2 = (r.probabilityV22 !== undefined ? (Number(r.probabilityV22) * 100).toFixed(1) + '%' : '-').padStart(6);
    const ev1 = (r.evV1 !== undefined ? (Number(r.evV1) * 100).toFixed(1) + '%' : '-').padStart(6);
    const ev2 = (r.evV22 !== undefined ? (Number(r.evV22) * 100).toFixed(1) + '%' : '-').padStart(6);
    const st = (r.status || '').padEnd(14).substring(0, 14);

    console.log(`| ${cid} | ${mkt} | ${odds} | ${pv1} | ${pv2} | ${ev1} | ${ev2} | ${st} |`);
  }
  console.log('----------------------------------------------------------------------------------------\n');

  return {
    cohortId: store.cohortId,
    total,
    pending,
    violations,
    superseded,
    evaluated,
    records
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateProspectiveMonitorReport();
}
