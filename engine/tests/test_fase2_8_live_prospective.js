import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initProspectiveStore,
  loadProspectiveStore,
  validateTemporalIntegrity,
  computeCanonicalPayloadHash,
  ingestProspectiveCandidate
} from '../experimental/liveProspectiveCapturer.js';
import { LiveProspectiveScheduler } from '../experimental/liveProspectiveScheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_STORE_PATH = path.resolve(__dirname, '../storage_data/test_shadow_lab_live_prospective.json');

function cleanup() {
  if (fs.existsSync(TEST_STORE_PATH)) {
    fs.unlinkSync(TEST_STORE_PATH);
  }
}

async function runTestSuite() {
  console.log('=== [PHASE 2.8 TEST SUITE: LIVE PROSPECTIVE VALIDATION] ===\n');
  cleanup();

  // Test 1: Store Initialization
  console.log('Test 1: Store initialization & structure...');
  initProspectiveStore(TEST_STORE_PATH);
  const initialStore = loadProspectiveStore(TEST_STORE_PATH);
  assert.strictEqual(initialStore.cohortId, 'SHADOW_V2.2_LIVE_PROSPECTIVE');
  assert.strictEqual(initialStore.records.length, 0);
  console.log('✓ Store created with cohortId SHADOW_V2.2_LIVE_PROSPECTIVE');

  // Test 2: Valid pre-kickoff prospective candidate
  console.log('\nTest 2: Valid candidate captured before kickoff...');
  const futureKickoff = new Date(Date.now() + 10 * 3600 * 1000).toISOString(); // +10h
  const sourceTime = new Date(Date.now() - 1000).toISOString();
  const cutoffTime = new Date().toISOString();
  const ingestedTime = new Date().toISOString();

  const validCandidate = {
    candidateId: 'TEST_PROSP_VALID_001',
    matchId: 'match_nottingham_chelsea_01',
    eventKickoff: futureKickoff,
    sourceEventTimestamp: sourceTime,
    dataCutoffTimestamp: cutoffTime,
    ingestedAt: ingestedTime,
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.5,
    odds: 1.81,
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 7,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.6429,
    probabilityV22: 0.6550,
    fairOddsV1: 1.556,
    fairOddsV22: 1.527,
    evV1: 0.1636,
    evV22: 0.1856,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: ingestedTime
  };

  const res1 = ingestProspectiveCandidate(validCandidate, TEST_STORE_PATH);
  assert.strictEqual(res1.action, 'INGESTED_SUCCESSFULLY');
  assert.strictEqual(res1.status, 'FROZEN_PENDING');
  console.log('✓ Valid prospective candidate ingested and marked FROZEN_PENDING');

  // Test 3: Idempotent duplication
  console.log('\nTest 3: Idempotent duplication (same candidate, unchanged odds)...');
  const resDup = ingestProspectiveCandidate(validCandidate, TEST_STORE_PATH);
  assert.strictEqual(resDup.action, 'IGNORED_DUPLICATE');
  console.log('✓ Unchanged duplicate candidate safely ignored without creating duplicate');

  // Test 4: Pre-kickoff Odds change creates new snapshot version
  console.log('\nTest 4: Pre-kickoff odds change snapshot evolution...');
  const updatedCandidate = {
    ...validCandidate,
    odds: 1.88,
    ingestedAt: new Date(Date.now() + 100).toISOString()
  };
  const resUpdate = ingestProspectiveCandidate(updatedCandidate, TEST_STORE_PATH);
  assert.strictEqual(resUpdate.action, 'UPDATED_SNAPSHOT');
  assert.strictEqual(resUpdate.snapshotVersion, 2);
  
  const currentStore = loadProspectiveStore(TEST_STORE_PATH);
  const oldRec = currentStore.records.find(r => r.candidateId === validCandidate.candidateId && r.snapshotVersion === 1);
  const newRec = currentStore.records.find(r => r.candidateId === validCandidate.candidateId && r.snapshotVersion === 2);
  assert.strictEqual(oldRec.status, 'SUPERSEDED_BY_ODDS_CHANGE');
  assert.strictEqual(newRec.status, 'FROZEN_PENDING');
  assert.strictEqual(newRec.odds, 1.88);
  console.log('✓ Prior snapshot preserved as SUPERSEDED_BY_ODDS_CHANGE, new version frozen as FROZEN_PENDING');

  // Test 5: Temporal Violations (Rejections & Audit Flagging)
  console.log('\nTest 5: Temporal Violations...');
  
  // 5a. Match already started / captured after kickoff
  const pastKickoff = new Date(Date.now() - 3600 * 1000).toISOString(); // -1h
  const postKickoffCandidate = {
    ...validCandidate,
    candidateId: 'TEST_PROSP_POST_KICKOFF',
    matchId: 'match_past_01',
    eventKickoff: pastKickoff,
    sourceEventTimestamp: new Date(Date.now() - 7200 * 1000).toISOString(),
    dataCutoffTimestamp: new Date(Date.now() - 3000 * 1000).toISOString(), // After kickoff!
    ingestedAt: new Date().toISOString()
  };
  const resPost = ingestProspectiveCandidate(postKickoffCandidate, TEST_STORE_PATH);
  assert.strictEqual(resPost.action, 'RECORDED_VIOLATION');
  const violRec1 = loadProspectiveStore(TEST_STORE_PATH).records.find(r => r.candidateId === 'TEST_PROSP_POST_KICKOFF');
  assert.strictEqual(violRec1.status, 'TEMPORAL_VIOLATION');
  assert.ok(violRec1.violationReasons.some(r => r.includes('CUTOFF_AT_OR_AFTER_KICKOFF') || r.includes('INGESTED_AT_OR_AFTER_KICKOFF')));
  console.log('✓ Candidate captured after kickoff flagged as TEMPORAL_VIOLATION');

  // 5b. Source timestamp after cutoff timestamp
  const invertedCandidate = {
    ...validCandidate,
    candidateId: 'TEST_PROSP_INVERTED',
    matchId: 'match_inv_01',
    sourceEventTimestamp: new Date(Date.now() + 5000).toISOString(),
    dataCutoffTimestamp: new Date(Date.now()).toISOString()
  };
  const resInv = ingestProspectiveCandidate(invertedCandidate, TEST_STORE_PATH);
  assert.strictEqual(resInv.action, 'RECORDED_VIOLATION');
  const violRec2 = loadProspectiveStore(TEST_STORE_PATH).records.find(r => r.candidateId === 'TEST_PROSP_INVERTED');
  assert.strictEqual(violRec2.status, 'TEMPORAL_VIOLATION');
  assert.ok(violRec2.violationReasons.some(r => r.includes('SOURCE_AFTER_CUTOFF')));
  console.log('✓ Candidate with sourceTimestamp > cutoffTimestamp flagged as TEMPORAL_VIOLATION');

  // 5c. Missing eventKickoff
  const missingKickoffCandidate = {
    ...validCandidate,
    candidateId: 'TEST_PROSP_MISSING_KICKOFF',
    matchId: 'match_miss_01',
    eventKickoff: null
  };
  const resMiss = ingestProspectiveCandidate(missingKickoffCandidate, TEST_STORE_PATH);
  assert.strictEqual(resMiss.action, 'RECORDED_VIOLATION');
  const violRec3 = loadProspectiveStore(TEST_STORE_PATH).records.find(r => r.candidateId === 'TEST_PROSP_MISSING_KICKOFF');
  assert.strictEqual(violRec3.status, 'TEMPORAL_VIOLATION');
  assert.ok(violRec3.violationReasons.includes('INVALID_OR_MISSING_EVENT_KICKOFF'));
  console.log('✓ Candidate with missing kickoff flagged as TEMPORAL_VIOLATION');

  // Test 6: Payload Hash Determinism
  console.log('\nTest 6: Canonical SHA-256 payload hash verification...');
  const hash1 = computeCanonicalPayloadHash(validCandidate);
  const hash2 = computeCanonicalPayloadHash({ ...validCandidate });
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(typeof hash1, 'string');
  assert.strictEqual(hash1.length, 64);
  console.log(`✓ Hash deterministic: ${hash1}`);

  // Test 7: Scheduler Polling Simulation
  console.log('\nTest 7: Scheduler simulation...');
  const scheduler = new LiveProspectiveScheduler({ storePath: TEST_STORE_PATH });
  const mockFetcher = async () => [
    {
      matchInfo: { id: 'mock_match_02', kickoff: futureKickoff },
      oddsList: [
        { market: 'TOTAL_GOALS', selection: 'UNDER', line: 2.5, odds: 1.95, sourceTimestamp: sourceTime }
      ],
      historicalData: {
        TOTAL_GOALS: {
          contractType: 'COUNT_HISTORY',
          sampleSize: 10,
          counts: [1, 2, 0, 3, 1, 2, 1, 0, 2, 1]
        }
      }
    }
  ];
  await scheduler.pollOnce(mockFetcher);
  assert.strictEqual(scheduler.stats.candidatesCaptured, 1);
  assert.strictEqual(scheduler.stats.pollsCount, 1);
  console.log('✓ Scheduler polled and captured candidates seamlessly');

  cleanup();
  console.log('\n=== ALL PHASE 2.8 PROSPECTIVE TESTS PASSED SUCCESSFULLY! ===\n');
}

runTestSuite();
