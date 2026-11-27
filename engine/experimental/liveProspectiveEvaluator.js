import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  loadProspectiveStore,
  computeCanonicalPayloadHash
} from './liveProspectiveCapturer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTCOMES_STORE_PATH = path.resolve(__dirname, '../storage_data/shadow_lab_live_outcomes.json');

/**
 * Initializes the outcomes store if not present.
 */
export function initOutcomesStore(storePath = OUTCOMES_STORE_PATH) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    const initial = {
      description: 'Official verified outcomes for live prospective evaluation',
      updatedAt: new Date().toISOString(),
      outcomes: []
    };
    fs.writeFileSync(storePath, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

/**
 * Loads outcomes store.
 */
export function loadOutcomesStore(storePath = OUTCOMES_STORE_PATH) {
  initOutcomesStore(storePath);
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  } catch (e) {
    return { outcomes: [] };
  }
}

/**
 * Registers an official match outcome for settlement.
 * Strict match on matchId, market, selection, line.
 */
export function registerMatchOutcome(outcome, storePath = OUTCOMES_STORE_PATH) {
  const store = loadOutcomesStore(storePath);
  
  // Mandatory fields
  if (!outcome.matchId || !outcome.market || !outcome.selection || !outcome.status || !outcome.settledAt) {
    throw new Error('Outcome missing required fields (matchId, market, selection, status, settledAt)');
  }

  const validStatuses = ['WON', 'LOST', 'PUSH', 'VOID_NO_PARTICIPATION', 'VOID_SUSPENDED'];
  if (!validStatuses.includes(outcome.status)) {
    throw new Error(`Invalid outcome status: ${outcome.status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  // Deduplication / Update
  const normLine = outcome.line !== undefined && outcome.line !== null ? Number(outcome.line) : null;
  const existingIdx = store.outcomes.findIndex(o => 
    o.matchId === outcome.matchId &&
    o.market === outcome.market &&
    o.selection === outcome.selection &&
    (normLine === null ? (o.line === null || o.line === undefined) : Number(o.line) === normLine)
  );

  const outcomeRecord = {
    ...outcome,
    line: normLine,
    registeredAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    store.outcomes[existingIdx] = outcomeRecord;
  } else {
    store.outcomes.push(outcomeRecord);
  }

  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
  return outcomeRecord;
}

/**
 * LiveProspectiveEvaluator
 * Evaluates candidates from shadow_lab_live_prospective.json.
 * 
 * Snapshot policies:
 * - FIRST_CAPTURE: snapshotVersion = 1
 * - LAST_VALID_PRE_KICKOFF: latest valid snapshot prior to kickoff (not superseded)
 */
export class LiveProspectiveEvaluator {
  constructor(options = {}) {
    this.prospectiveStorePath = options.prospectiveStorePath;
    this.outcomesStorePath = options.outcomesStorePath || OUTCOMES_STORE_PATH;
  }

  /**
   * Audits prospective records for snapshot integrity, hash tampering, and family grouping.
   */
  auditSnapshotIntegrity() {
    const store = loadProspectiveStore(this.prospectiveStorePath);
    const records = store.records || [];

    const integrityReport = {
      totalRecords: records.length,
      tamperedRecords: [],
      validHashRecords: 0,
      uniqueCandidateCount: 0,
      candidateFamilies: new Map(), // candidateKey -> list of snapshots
      supersededCount: 0,
      violationsCount: 0,
      activeSnapshotsCount: 0
    };

    for (const record of records) {
      // 1. Verify SHA-256
      const computedHash = computeCanonicalPayloadHash(record);
      if (computedHash !== record.payloadHash) {
        integrityReport.tamperedRecords.push({
          candidateId: record.candidateId,
          snapshotVersion: record.snapshotVersion,
          expectedHash: computedHash,
          storedHash: record.payloadHash
        });
      } else {
        integrityReport.validHashRecords++;
      }

      // 2. Group by canonical candidate identity (matchId, market, selection, line)
      const normLine = record.line !== undefined && record.line !== null ? Number(record.line) : null;
      const key = `${record.matchId}::${record.market}::${record.selection}::${normLine}`;

      if (!integrityReport.candidateFamilies.has(key)) {
        integrityReport.candidateFamilies.set(key, []);
      }
      integrityReport.candidateFamilies.get(key).push(record);

      if (record.status === 'SUPERSEDED_BY_ODDS_CHANGE') {
        integrityReport.supersededCount++;
      } else if (record.status === 'TEMPORAL_VIOLATION') {
        integrityReport.violationsCount++;
      } else {
        integrityReport.activeSnapshotsCount++;
      }
    }

    integrityReport.uniqueCandidateCount = integrityReport.candidateFamilies.size;
    return integrityReport;
  }

  /**
   * Resolves evaluations under a given policy ('FIRST_CAPTURE' | 'LAST_VALID_PRE_KICKOFF').
   */
  resolveEvaluations(policy = 'LAST_VALID_PRE_KICKOFF') {
    const audit = this.auditSnapshotIntegrity();
    const outcomesStore = loadOutcomesStore(this.outcomesStorePath);
    const outcomes = outcomesStore.outcomes || [];

    const resolvedCandidates = [];

    for (const [candidateKey, family] of audit.candidateFamilies.entries()) {
      // Filter out records with TEMPORAL_VIOLATION
      const validTemporal = family.filter(r => r.status !== 'TEMPORAL_VIOLATION');
      if (validTemporal.length === 0) {
        // All snapshots for this candidate were temporal violations
        const violRecord = family[0];
        resolvedCandidates.push({
          candidateKey,
          candidateId: violRecord.candidateId,
          matchId: violRecord.matchId,
          market: violRecord.market,
          selection: violRecord.selection,
          line: violRecord.line,
          status: 'TEMPORAL_VIOLATION',
          selectedSnapshot: violRecord,
          policy,
          outcome: null
        });
        continue;
      }

      // Sort by snapshotVersion ascending
      validTemporal.sort((a, b) => (a.snapshotVersion || 1) - (b.snapshotVersion || 1));

      let selectedSnapshot = null;
      if (policy === 'FIRST_CAPTURE') {
        selectedSnapshot = validTemporal[0];
      } else if (policy === 'LAST_VALID_PRE_KICKOFF') {
        // Latest snapshot that is not superseded, or highest snapshotVersion if all superseded
        const active = validTemporal.filter(r => r.status !== 'SUPERSEDED_BY_ODDS_CHANGE');
        selectedSnapshot = active.length > 0 ? active[active.length - 1] : validTemporal[validTemporal.length - 1];
      } else {
        throw new Error(`Unsupported snapshot policy: ${policy}`);
      }

      // Link outcome strictly
      const normLine = selectedSnapshot.line !== undefined && selectedSnapshot.line !== null ? Number(selectedSnapshot.line) : null;
      const matchedOutcome = outcomes.find(o => 
        o.matchId === selectedSnapshot.matchId &&
        o.market === selectedSnapshot.market &&
        o.selection === selectedSnapshot.selection &&
        (normLine === null ? (o.line === null || o.line === undefined) : Number(o.line) === normLine)
      );

      let finalStatus = 'PENDING';
      let outcomeDetails = null;

      if (matchedOutcome) {
        finalStatus = matchedOutcome.status;
        outcomeDetails = {
          status: matchedOutcome.status,
          settledAt: matchedOutcome.settledAt,
          source: matchedOutcome.source || 'OFFICIAL_MATCH_FEED',
          actualScore: matchedOutcome.actualScore || null
        };
      }

      // Check closing odds for CLV
      const closingOdds = matchedOutcome && matchedOutcome.closingOdds ? Number(matchedOutcome.closingOdds) : null;
      const candidateOdds = Number(selectedSnapshot.odds);
      const clv = closingOdds ? ((candidateOdds / closingOdds) - 1) : null;

      resolvedCandidates.push({
        candidateKey,
        candidateId: selectedSnapshot.candidateId,
        matchId: selectedSnapshot.matchId,
        market: selectedSnapshot.market,
        selection: selectedSnapshot.selection,
        line: normLine,
        policy,
        snapshotVersion: selectedSnapshot.snapshotVersion,
        totalFamilySnapshots: family.length,
        odds: candidateOdds,
        closingOdds,
        clv,
        probabilityV1: Number(selectedSnapshot.probabilityV1),
        probabilityV22: Number(selectedSnapshot.probabilityV22),
        evV1: Number(selectedSnapshot.evV1),
        evV22: Number(selectedSnapshot.evV22),
        dqeStatus: selectedSnapshot.dqeStatus,
        status: finalStatus,
        outcome: outcomeDetails,
        selectedSnapshot
      });
    }

    return resolvedCandidates;
  }

  /**
   * Computes comparative statistical and financial metrics between V1 and V2.2.
   * Compares identical valid samples.
   */
  computeComparativeMetrics(policy = 'LAST_VALID_PRE_KICKOFF') {
    const candidates = this.resolveEvaluations(policy);
    
    // Only evaluable records: WON or LOST.
    // PUSH & VOID are handled separately per documented rules.
    const evaluable = candidates.filter(c => c.status === 'WON' || c.status === 'LOST');
    const pushList = candidates.filter(c => c.status === 'PUSH');
    const voidList = candidates.filter(c => c.status.startsWith('VOID'));
    const pendingList = candidates.filter(c => c.status === 'PENDING');
    const violationList = candidates.filter(c => c.status === 'TEMPORAL_VIOLATION');

    const N = evaluable.length;
    const isSampleSufficient = N >= 30; // Rule: no statistical superiority claims under N < 30

    if (N === 0) {
      return {
        policy,
        isSampleSufficient: false,
        warning: 'MUESTRA_INSUFICIENTE_SIN_RESULTADOS_LIQUIDADOS',
        sampleSize: 0,
        evaluableCount: 0,
        pendingCount: pendingList.length,
        pushCount: pushList.length,
        voidCount: voidList.length,
        violationCount: violationList.length,
        v1: null,
        v22: null
      };
    }

    // Brier Score & Log Loss (identical sample)
    let brierV1 = 0;
    let brierV22 = 0;
    let logLossV1 = 0;
    let logLossV22 = 0;
    const eps = 1e-15;

    let profitV1 = 0;
    let profitV22 = 0;
    let betsV1 = 0;
    let betsV22 = 0;
    let winsV1 = 0;
    let winsV22 = 0;

    // Filter by EV > 0 threshold for bets
    evaluable.forEach(c => {
      const y = c.status === 'WON' ? 1 : 0;
      const p1 = Math.max(eps, Math.min(1 - eps, c.probabilityV1));
      const p2 = Math.max(eps, Math.min(1 - eps, c.probabilityV22));

      brierV1 += Math.pow(p1 - y, 2);
      brierV22 += Math.pow(p2 - y, 2);

      logLossV1 += -(y * Math.log(p1) + (1 - y) * Math.log(1 - p1));
      logLossV22 += -(y * Math.log(p2) + (1 - y) * Math.log(1 - p2));

      // Financials (Unit stakes on EV > 0)
      if (c.evV1 > 0) {
        betsV1++;
        if (y === 1) {
          profitV1 += (c.odds - 1);
          winsV1++;
        } else {
          profitV1 -= 1;
        }
      }

      if (c.evV22 > 0) {
        betsV22++;
        if (y === 1) {
          profitV22 += (c.odds - 1);
          winsV22++;
        } else {
          profitV22 -= 1;
        }
      }
    });

    // PUSH financial handling: return stake (profit += 0, bets++)
    pushList.forEach(c => {
      if (c.evV1 > 0) betsV1++;
      if (c.evV22 > 0) betsV22++;
    });

    const meanBrierV1 = brierV1 / N;
    const meanBrierV22 = brierV22 / N;
    const meanLogLossV1 = logLossV1 / N;
    const meanLogLossV22 = logLossV22 / N;

    // Expected Calibration Error (ECE) with 5 bins
    const eceV1 = this._calculateECE(evaluable.map(c => ({ p: c.probabilityV1, y: c.status === 'WON' ? 1 : 0 })));
    const eceV22 = this._calculateECE(evaluable.map(c => ({ p: c.probabilityV22, y: c.status === 'WON' ? 1 : 0 })));

    // CLV analysis
    const withCLV = candidates.filter(c => c.clv !== null);
    const avgClv = withCLV.length > 0 ? withCLV.reduce((acc, c) => acc + c.clv, 0) / withCLV.length : null;

    // Cluster bootstrap p-value if N >= 30
    let clusterBootstrapResult = null;
    if (isSampleSufficient) {
      clusterBootstrapResult = this._pairedClusterBootstrap(evaluable);
    }

    return {
      policy,
      isSampleSufficient,
      warning: !isSampleSufficient ? 'ADVERTENCIA: Muestra insuficiente (< 30 evaluables). Prohibido inferir superioridad estadística.' : null,
      sampleSize: candidates.length,
      evaluableCount: N,
      pendingCount: pendingList.length,
      pushCount: pushList.length,
      voidCount: voidList.length,
      violationCount: violationList.length,
      clv: {
        analyzedCount: withCLV.length,
        avgClv: avgClv !== null ? Number((avgClv * 100).toFixed(2)) : null
      },
      v1: {
        brierScore: Number(meanBrierV1.toFixed(4)),
        logLoss: Number(meanLogLossV1.toFixed(4)),
        ece: Number((eceV1 * 100).toFixed(2)),
        betsCount: betsV1,
        winsCount: winsV1,
        winRate: betsV1 > 0 ? Number(((winsV1 / betsV1) * 100).toFixed(2)) : 0,
        profitUnits: Number(profitV1.toFixed(2)),
        yieldPercent: betsV1 > 0 ? Number(((profitV1 / betsV1) * 100).toFixed(2)) : 0
      },
      v22: {
        brierScore: Number(meanBrierV22.toFixed(4)),
        logLoss: Number(meanLogLossV22.toFixed(4)),
        ece: Number((eceV22 * 100).toFixed(2)),
        betsCount: betsV22,
        winsCount: winsV22,
        winRate: betsV22 > 0 ? Number(((winsV22 / betsV22) * 100).toFixed(2)) : 0,
        profitUnits: Number(profitV22.toFixed(2)),
        yieldPercent: betsV22 > 0 ? Number(((profitV22 / betsV22) * 100).toFixed(2)) : 0
      },
      diff: {
        deltaBrier: Number((meanBrierV22 - meanBrierV1).toFixed(4)), // negative is better for V2.2
        deltaLogLoss: Number((meanLogLossV22 - meanLogLossV1).toFixed(4)),
        clusterBootstrap: clusterBootstrapResult
      }
    };
  }

  _calculateECE(data, numBins = 5) {
    if (!data.length) return 0;
    const bins = Array.from({ length: numBins }, () => ({ count: 0, sumP: 0, sumY: 0 }));

    data.forEach(d => {
      const binIdx = Math.min(numBins - 1, Math.floor(d.p * numBins));
      bins[binIdx].count++;
      bins[binIdx].sumP += d.p;
      bins[binIdx].sumY += d.y;
    });

    let totalECE = 0;
    bins.forEach(b => {
      if (b.count > 0) {
        const conf = b.sumP / b.count;
        const acc = b.sumY / b.count;
        totalECE += (b.count / data.length) * Math.abs(acc - conf);
      }
    });

    return totalECE;
  }

  _pairedClusterBootstrap(evaluable, iterations = 1000) {
    // Group by matchId
    const clusters = new Map();
    evaluable.forEach(c => {
      if (!clusters.has(c.matchId)) clusters.set(c.matchId, []);
      clusters.get(c.matchId).push(c);
    });

    const clusterKeys = Array.from(clusters.keys());
    const K = clusterKeys.length;
    if (K < 5) return { pValue: null, note: 'Clústeres insuficientes (< 5 partidos)' };

    let v2Wins = 0;
    for (let iter = 0; iter < iterations; iter++) {
      let brierV1 = 0;
      let brierV22 = 0;
      let count = 0;

      for (let k = 0; k < K; k++) {
        const randKey = clusterKeys[Math.floor(Math.random() * K)];
        const clusterItems = clusters.get(randKey);
        for (const c of clusterItems) {
          const y = c.status === 'WON' ? 1 : 0;
          brierV1 += Math.pow(c.probabilityV1 - y, 2);
          brierV22 += Math.pow(c.probabilityV22 - y, 2);
          count++;
        }
      }

      if (brierV22 < brierV1) {
        v2Wins++;
      }
    }

    return {
      pValue: Number((1 - (v2Wins / iterations)).toFixed(4)),
      v2WinRateInBootstrap: Number(((v2Wins / iterations) * 100).toFixed(1)),
      iterations,
      clustersCount: K
    };
  }
}
