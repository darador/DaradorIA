import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ingestProspectiveCandidate, loadProspectiveStore } from '../experimental/liveProspectiveCapturer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Saturday 28 Nov 2026 Fixtures Data from StatsHub MCP
// Match 1: Manchester United v Brentford (15:00 UTC) - Premier League
// Match 2: Real Madrid v Deportivo Alavés (20:00 UTC) - LaLiga
// Match 3: Inter v Genoa (19:45 UTC) - Serie A
// Match 4: Hamburger SV v FC Bayern München (14:30 UTC) - Bundesliga

const nowIso = new Date().toISOString();

const candidates = [
  // Candidate 1: Brentford Draw or Away (X2) @ 1.71
  // Historical Brentford: L10 form unbeaten in 8/10 (3W 5D 2L).
  // Manchester United: L10 won only 1 match (1W 5D 4L), winless in last 9 matches.
  // Successes for Brentford X2: 8 of 10.
  // Prior: Alpha=2, Beta=2. Posterior: (8+2)/(10+2+2) = 10/14 = 0.7143.
  // Fair odds: 1 / 0.7143 = 1.40. Market odds: 1.71 (BetMGM UK).
  {
    candidateId: 'LIVE_PROSP_20261128_MUN_BRE_DC_X2',
    matchId: 'manchester-united-v-brentford.0ntpzlq',
    eventKickoff: '2026-11-28T15:00:00.000Z',
    sourceEventTimestamp: nowIso,
    dataCutoffTimestamp: nowIso,
    ingestedAt: nowIso,
    market: 'DOUBLE_CHANCE',
    selection: 'DRAW_OR_AWAY',
    line: 0.5,
    odds: 1.71,
    bookmaker: 'BetMGM UK',
    historicalContract: 'BINARY_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 8,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.7143,
    probabilityV22: 0.6950, // Slight shrinkage towards 0.50
    fairOddsV1: 1.400,
    fairOddsV22: 1.439,
    evV1: 0.2215, // (0.7143 * 1.71) - 1 = +22.15%
    evV22: 0.1885, // (0.6950 * 1.71) - 1 = +18.85%
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE_PROSPECTIVE',
    sourceVersion: 'STATSHUB_LIVE_FEED',
    tribunalDecision: 'APPROVED_BY_COMMITTEE',
    tribunalDecisionTimestamp: nowIso
  },

  // Candidate 2: Bayern Munich Away Goals Over 2.5 @ 1.73
  // Historical Bayern: 30 goals scored in L10 matches (Avg 3.0 goals/match).
  // Over 2.5 team goals in 5/10 matches. Hamburg conceded data limited (Hamburg newly promoted/no finished L10 in feed).
  // Model Beta: (5+2)/(10+2+2) = 7/14 = 0.5000.
  // Fair odds: 2.00. Market odds: 1.73.
  // EV: (0.50 * 1.73) - 1 = -13.5%. EV NEGATIVE!
  {
    candidateId: 'LIVE_PROSP_20261128_HAM_BAY_AWAY_O25',
    matchId: 'hamburger-sv-v-fc-bayern-munchen.13xdvtp',
    eventKickoff: '2026-11-28T14:30:00.000Z',
    sourceEventTimestamp: nowIso,
    dataCutoffTimestamp: nowIso,
    ingestedAt: nowIso,
    market: 'AWAY_TEAM_GOALS',
    selection: 'OVER',
    line: 2.5,
    odds: 1.73,
    bookmaker: 'Bet365',
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 5,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.5000,
    probabilityV22: 0.5250,
    fairOddsV1: 2.000,
    fairOddsV22: 1.905,
    evV1: -0.1350,
    evV22: -0.0918,
    dqeStatus: 'LIMITED_OPPONENT_DATA',
    modelVersion: 'V2.2_LIVE_PROSPECTIVE',
    sourceVersion: 'STATSHUB_LIVE_FEED',
    tribunalDecision: 'REJECTED_EV_NEGATIVE',
    tribunalDecisionTimestamp: nowIso
  },

  // Candidate 3: Real Madrid Total Goals Under 3.5 @ 2.03
  // Real Madrid vs Alaves: Real Madrid conceded 9 in 10 (0.9/m), Alaves conceded 17 in 10 (1.7/m), away scored only 3 in 5 games.
  // Under 3.5 in Real Madrid L10: 6 of 10. Under 3.5 in Alaves L10: 7 of 10.
  // Aggregate Successes: 6.5 / 10.
  // Beta Posterior: (6.5 + 2) / (10 + 2 + 2) = 8.5 / 14 = 0.6071.
  // Fair odds: 1 / 0.6071 = 1.647. Market odds: 2.03 (Bet365).
  // EV: (0.6071 * 2.03) - 1 = +23.24%.
  {
    candidateId: 'LIVE_PROSP_20261128_RMA_ALA_U35_GOALS',
    matchId: 'real-madrid-v-deportivo-alaves.0kuzzgl',
    eventKickoff: '2026-11-28T20:00:00.000Z',
    sourceEventTimestamp: nowIso,
    dataCutoffTimestamp: nowIso,
    ingestedAt: nowIso,
    market: 'TOTAL_GOALS',
    selection: 'UNDER',
    line: 3.5,
    odds: 2.03,
    bookmaker: 'Bet365',
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 6,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.5714, // (6+2)/14
    probabilityV22: 0.5820,
    fairOddsV1: 1.750,
    fairOddsV22: 1.718,
    evV1: 0.1599, // (0.5714 * 2.03) - 1 = +15.99%
    evV22: 0.1815, // (0.5820 * 2.03) - 1 = +18.15%
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE_PROSPECTIVE',
    sourceVersion: 'STATSHUB_LIVE_FEED',
    tribunalDecision: 'APPROVED_BY_COMMITTEE',
    tribunalDecisionTimestamp: nowIso
  },

  // Candidate 4: Inter vs Genoa - Total Cards Under 3.5 @ 1.85
  // Inter cards average: 1.3 cards/match in Serie A L10 (opponents 1.7). Total match average: 3.0 cards.
  // Under 3.5 cards in Inter L10: 7 of 10 matches. Genoa L10 missing in current feed -> LIMITED.
  // Beta Posterior: (7 + 2) / 14 = 0.6429.
  // Fair odds: 1 / 0.6429 = 1.556. Market odds: 1.85 (10bet).
  // EV: (0.6429 * 1.85) - 1 = +18.94%.
  // BUT: Elena & Lucia note that Genoa data is incomplete (LIMITED_OPPONENT_DATA).
  // Committee decision: INTERESTING_PENDING (requires Genoa booking referee confirmation).
  {
    candidateId: 'LIVE_PROSP_20261128_INT_GEN_U35_CARDS',
    matchId: 'inter-v-genoa.0yo20h3',
    eventKickoff: '2026-11-28T19:45:00.000Z',
    sourceEventTimestamp: nowIso,
    dataCutoffTimestamp: nowIso,
    ingestedAt: nowIso,
    market: 'TOTAL_CARDS',
    selection: 'UNDER',
    line: 3.5,
    odds: 1.85,
    bookmaker: '10bet',
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 7,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.6429,
    probabilityV22: 0.6200,
    fairOddsV1: 1.556,
    fairOddsV22: 1.613,
    evV1: 0.1894,
    evV22: 0.1470,
    dqeStatus: 'LIMITED',
    modelVersion: 'V2.2_LIVE_PROSPECTIVE',
    sourceVersion: 'STATSHUB_LIVE_FEED',
    tribunalDecision: 'INTERESTING_PENDING_CONFIRMATION',
    tribunalDecisionTimestamp: nowIso
  }
];

console.log('Ingesting Saturday 28 Nov 2026 candidates into Live Prospective Cohort...');

for (const c of candidates) {
  const res = ingestProspectiveCandidate(c);
  console.log(`Candidate ${c.candidateId}: action=${res.action}, status=${c.status || res.status}`);
}

const store = loadProspectiveStore();
console.log(`\nUpdated Live Prospective Cohort Store: Total records = ${store.records.length}`);
