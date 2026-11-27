import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestProspectiveCandidate, loadProspectiveStore } from '../experimental/liveProspectiveCapturer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Real fixture retrieved from StatsHub MCP
// Match: Nottingham Forest v Chelsea
// Match ID: nottingham-forest-v-chelsea.1f5zhne
// Kickoff: 2026-11-27T20:00:00Z (Tomorrow 20:00 UTC)
// Market: Total Goals Over 2.5 @ 1.81 (Bet365 / Pin)
// Market: Double Chance Draw or Chelsea (X2) @ 1.44
// Historical data: Chelsea Premier League L10 matches (Avg 1.7 goals scored, Over 2.5 in 7/10 matches)

const now = new Date();
const nowIso = now.toISOString();
const kickoffIso = '2026-11-27T20:00:00.000Z';
const sourceIso = new Date(now.getTime() - 60000).toISOString(); // 1 min ago
const cutoffIso = nowIso;

console.log('Capturing real live prospective candidates before kickoff...');
console.log(`Current Time (Ingestion): ${nowIso}`);
console.log(`Match Kickoff:            ${kickoffIso}`);
console.log(`Time to Kickoff:          ${((new Date(kickoffIso).getTime() - now.getTime()) / 3600000).toFixed(1)} hours\n`);

const candidate1 = {
  candidateId: 'LIVE_PROSP_NOT_CHE_O25_GOALS',
  matchId: 'nottingham-forest-v-chelsea.1f5zhne',
  eventKickoff: kickoffIso,
  sourceEventTimestamp: sourceIso,
  dataCutoffTimestamp: cutoffIso,
  ingestedAt: nowIso,
  market: 'TOTAL_GOALS',
  selection: 'OVER',
  line: 2.5,
  odds: 1.81,
  historicalContract: 'COUNT_HISTORY',
  historicalSampleSize: 10,
  historicalSuccesses: 7,
  priorAlpha: 2,
  priorBeta: 2,
  probabilityV1: 0.6429,  // (7+2)/(10+2+2) = 9/14
  probabilityV22: 0.6515, // Poisson lambda approx 1.7 + Forest defense combined -> 0.66, weighted with Beta 0.6429
  fairOddsV1: 1.556,
  fairOddsV22: 1.535,
  evV1: 0.1636,  // (0.6429 * 1.81) - 1 = +16.36%
  evV22: 0.1792, // (0.6515 * 1.81) - 1 = +17.92%
  dqeStatus: 'VALID',
  modelVersion: 'V2.2_LIVE_PROSPECTIVE',
  sourceVersion: 'STATSHUB_LIVE_FEED',
  tribunalDecision: 'SHADOW_PASSIVE',
  tribunalDecisionTimestamp: nowIso
};

const candidate2 = {
  candidateId: 'LIVE_PROSP_NOT_CHE_DC_X2',
  matchId: 'nottingham-forest-v-chelsea.1f5zhne',
  eventKickoff: kickoffIso,
  sourceEventTimestamp: sourceIso,
  dataCutoffTimestamp: cutoffIso,
  ingestedAt: nowIso,
  market: 'DOUBLE_CHANCE',
  selection: 'DRAW_OR_AWAY',
  line: 0.5,
  odds: 1.44,
  historicalContract: 'BINARY_HISTORY',
  historicalSampleSize: 10,
  historicalSuccesses: 8,
  priorAlpha: 2,
  priorBeta: 2,
  probabilityV1: 0.7143, // (8+2)/(10+2+2) = 10/14
  probabilityV22: 0.7036, // Slight shrinkage towards 0.50
  fairOddsV1: 1.400,
  fairOddsV22: 1.421,
  evV1: 0.0286,  // (0.7143 * 1.44) - 1 = +2.86%
  evV22: 0.0132, // (0.7036 * 1.44) - 1 = +1.32%
  dqeStatus: 'VALID',
  modelVersion: 'V2.2_LIVE_PROSPECTIVE',
  sourceVersion: 'STATSHUB_LIVE_FEED',
  tribunalDecision: 'SHADOW_PASSIVE',
  tribunalDecisionTimestamp: nowIso
};

const res1 = ingestProspectiveCandidate(candidate1);
console.log('Result Candidate 1:', res1);

const res2 = ingestProspectiveCandidate(candidate2);
console.log('Result Candidate 2:', res2);

const store = loadProspectiveStore();
console.log(`\nCurrent Live Prospective Store Records: ${store.records.length}`);
store.records.forEach((r, idx) => {
  console.log(`[#${idx+1}] ID: ${r.candidateId} | Mkt: ${r.market} ${r.selection} ${r.line || ''} | Odds: ${r.odds} | P(V1): ${r.probabilityV1} | P(V2.2): ${r.probabilityV22} | Status: ${r.status} | Hash: ${r.payloadHash.substring(0, 16)}...`);
});
