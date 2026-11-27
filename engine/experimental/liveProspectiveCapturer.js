import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROSPECTIVE_STORE_PATH = path.resolve(__dirname, '../storage_data/shadow_lab_live_prospective.json');

/**
 * Ensures the prospective storage file exists with valid structure.
 */
export function initProspectiveStore(storePath = PROSPECTIVE_STORE_PATH) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    const initialData = {
      cohortId: 'SHADOW_V2.2_LIVE_PROSPECTIVE',
      description: 'Prospective live shadow candidates frozen strictly before event kickoff.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      records: []
    };
    fs.writeFileSync(storePath, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

/**
 * Loads the prospective store.
 */
export function loadProspectiveStore(storePath = PROSPECTIVE_STORE_PATH) {
  initProspectiveStore(storePath);
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[LiveProspectiveCapturer] Error reading store:', err);
    return {
      cohortId: 'SHADOW_V2.2_LIVE_PROSPECTIVE',
      records: []
    };
  }
}

/**
 * Canonical SHA-256 payload hash calculation.
 * Covers all essential fields in a deterministic order.
 */
export function computeCanonicalPayloadHash(c) {
  const payloadToHash = {
    candidateId: c.candidateId || null,
    matchId: c.matchId || null,
    eventKickoff: c.eventKickoff || null,
    sourceEventTimestamp: c.sourceEventTimestamp || null,
    dataCutoffTimestamp: c.dataCutoffTimestamp || null,
    ingestedAt: c.ingestedAt || null,
    market: c.market || null,
    selection: c.selection || null,
    line: c.line !== undefined ? Number(c.line) : null,
    odds: c.odds !== undefined ? Number(c.odds) : null,
    historicalContract: c.historicalContract || null,
    historicalSampleSize: c.historicalSampleSize !== undefined ? Number(c.historicalSampleSize) : null,
    historicalSuccesses: c.historicalSuccesses !== undefined ? Number(c.historicalSuccesses) : null,
    priorAlpha: c.priorAlpha !== undefined ? Number(c.priorAlpha) : null,
    priorBeta: c.priorBeta !== undefined ? Number(c.priorBeta) : null,
    probabilityV1: c.probabilityV1 !== undefined ? Number(c.probabilityV1) : null,
    probabilityV22: c.probabilityV22 !== undefined ? Number(c.probabilityV22) : null,
    fairOddsV1: c.fairOddsV1 !== undefined ? Number(c.fairOddsV1) : null,
    fairOddsV22: c.fairOddsV22 !== undefined ? Number(c.fairOddsV22) : null,
    evV1: c.evV1 !== undefined ? Number(c.evV1) : null,
    evV22: c.evV22 !== undefined ? Number(c.evV22) : null,
    dqeStatus: c.dqeStatus || null,
    modelVersion: c.modelVersion || null,
    sourceVersion: c.sourceVersion || null,
    tribunalDecision: c.tribunalDecision || null,
    tribunalDecisionTimestamp: c.tribunalDecisionTimestamp || null
  };

  const jsonStr = JSON.stringify(payloadToHash, Object.keys(payloadToHash).sort());
  return crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
}

/**
 * Validates temporal integrity according to strict prospective guidelines:
 * 1. eventKickoff must be valid ISO.
 * 2. sourceEventTimestamp <= dataCutoffTimestamp < eventKickoff.
 * 3. ingestedAt < eventKickoff.
 * 4. Missing required timestamps is an automatic violation.
 * 
 * Returns { valid: boolean, errors: string[] }
 */
export function validateTemporalIntegrity(candidate) {
  const errors = [];
  const { sourceEventTimestamp, dataCutoffTimestamp, ingestedAt, eventKickoff } = candidate;

  if (!eventKickoff || isNaN(Date.parse(eventKickoff))) {
    errors.push('INVALID_OR_MISSING_EVENT_KICKOFF');
  }
  if (!dataCutoffTimestamp || isNaN(Date.parse(dataCutoffTimestamp))) {
    errors.push('INVALID_OR_MISSING_DATA_CUTOFF');
  }
  if (!ingestedAt || isNaN(Date.parse(ingestedAt))) {
    errors.push('INVALID_OR_MISSING_INGESTED_AT');
  }
  if (!sourceEventTimestamp || isNaN(Date.parse(sourceEventTimestamp))) {
    errors.push('INVALID_OR_MISSING_SOURCE_EVENT_TIMESTAMP');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const tSource = new Date(sourceEventTimestamp).getTime();
  const tCutoff = new Date(dataCutoffTimestamp).getTime();
  const tIngested = new Date(ingestedAt).getTime();
  const tKickoff = new Date(eventKickoff).getTime();

  // Condition 1: sourceEventTimestamp <= dataCutoffTimestamp
  if (tSource > tCutoff) {
    errors.push(`SOURCE_AFTER_CUTOFF: source (${sourceEventTimestamp}) > cutoff (${dataCutoffTimestamp})`);
  }

  // Condition 2: dataCutoffTimestamp < eventKickoff
  if (tCutoff >= tKickoff) {
    errors.push(`CUTOFF_AT_OR_AFTER_KICKOFF: cutoff (${dataCutoffTimestamp}) >= kickoff (${eventKickoff})`);
  }

  // Condition 3: ingestedAt < eventKickoff
  if (tIngested >= tKickoff) {
    errors.push(`INGESTED_AT_OR_AFTER_KICKOFF: ingested (${ingestedAt}) >= kickoff (${eventKickoff})`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Ingests a candidate into the live prospective store.
 * 
 * Rules:
 * - If temporal check fails: mark status = 'TEMPORAL_VIOLATION' (do not reject silently, preserve record for audit).
 * - Deduplication:
 *   If record with same candidateId or (matchId + market + selection + line) exists:
 *   - Check if odds changed: if identical, ignore duplicate.
 *   - If odds changed prior to kickoff: archive previous snapshot as 'SUPERSEDED_BY_ODDS_CHANGE' or record with snapshotVersion.
 */
export function ingestProspectiveCandidate(candidateInput, storePath = PROSPECTIVE_STORE_PATH) {
  const store = loadProspectiveStore(storePath);

  const ingestedAt = candidateInput.ingestedAt || new Date().toISOString();
  const candidate = {
    ...candidateInput,
    ingestedAt
  };

  const temporalCheck = validateTemporalIntegrity(candidate);

  let status = 'FROZEN_PENDING';
  let violationReasons = [];

  if (!temporalCheck.valid) {
    status = 'TEMPORAL_VIOLATION';
    violationReasons = temporalCheck.errors;
  }

  // Ensure canonical payload hash
  const payloadHash = computeCanonicalPayloadHash(candidate);
  candidate.payloadHash = payloadHash;
  candidate.status = status;
  if (violationReasons.length > 0) {
    candidate.violationReasons = violationReasons;
  }

  // Deduplication check: find existing active (or latest) record
  const matchingRecords = store.records.filter(r => 
    r.candidateId === candidate.candidateId ||
    (r.matchId === candidate.matchId &&
     r.market === candidate.market &&
     r.selection === candidate.selection &&
     Number(r.line) === Number(candidate.line))
  );

  if (matchingRecords.length > 0) {
    // Sort to get latest snapshot
    matchingRecords.sort((a, b) => (b.snapshotVersion || 1) - (a.snapshotVersion || 1));
    const latest = matchingRecords[0];

    // Check if odds or data changed
    if (Number(latest.odds) === Number(candidate.odds) &&
        latest.status === candidate.status &&
        latest.payloadHash === candidate.payloadHash) {
      return {
        action: 'IGNORED_DUPLICATE',
        candidateId: candidate.candidateId,
        existingId: latest.candidateId
      };
    }

    // Odds or snapshot update before kickoff
    if (new Date(candidate.ingestedAt).getTime() < new Date(candidate.eventKickoff).getTime()) {
      latest.status = 'SUPERSEDED_BY_ODDS_CHANGE';
      latest.supersededAt = candidate.ingestedAt;
      latest.supersededByHash = payloadHash;
      candidate.snapshotVersion = (latest.snapshotVersion || 1) + 1;
      store.records.push(candidate);
      store.updatedAt = new Date().toISOString();
      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
      return {
        action: 'UPDATED_SNAPSHOT',
        candidateId: candidate.candidateId,
        snapshotVersion: candidate.snapshotVersion
      };
    } else {
      candidate.status = 'TEMPORAL_VIOLATION';
      candidate.violationReasons = ['ODDS_UPDATE_AFTER_KICKOFF'];
      store.records.push(candidate);
      store.updatedAt = new Date().toISOString();
      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
      return {
        action: 'RECORDED_VIOLATION',
        candidateId: candidate.candidateId,
        reasons: candidate.violationReasons
      };
    }
  }

  // New record
  candidate.snapshotVersion = 1;
  store.records.push(candidate);
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');

  return {
    action: status === 'TEMPORAL_VIOLATION' ? 'RECORDED_VIOLATION' : 'INGESTED_SUCCESSFULLY',
    candidateId: candidate.candidateId,
    status: candidate.status,
    payloadHash
  };
}
