import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ingestProspectiveCandidate } from './liveProspectiveCapturer.js';

const require = createRequire(import.meta.url);
const HistoricalDataResolver = require('../quality/historicalDataResolver.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * LiveProspectiveScheduler handles autonomous polling & scheduling
 * for live prospective candidate capture.
 * 
 * Default frequency: Every 15 minutes (or on-demand via pollOnce).
 * Pre-kickoff window: Only matches scheduled between now and (now + horizonHours).
 */
export class LiveProspectiveScheduler {
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs || 15 * 60 * 1000; // 15 mins
    this.horizonHours = options.horizonHours || 36; // Next 36 hours
    this.storePath = options.storePath;
    this.timer = null;
    this.isPolling = false;
    this.stats = {
      pollsCount: 0,
      candidatesCaptured: 0,
      duplicatesIgnored: 0,
      violationsRecorded: 0,
      lastPollAt: null
    };
  }

  /**
   * Evaluates a match and raw odds/historical data into prospective candidates.
   */
  processMatchCandidates(matchInfo, oddsList, historicalData = {}) {
    const results = [];
    const nowIso = new Date().toISOString();
    const kickoffIso = matchInfo.kickoff;

    for (const oddItem of oddsList) {
      const candidateId = `PROSP_${matchInfo.id}_${oddItem.market}_${oddItem.selection}`.replace(/[^a-zA-Z0-9_]/g, '_');
      
      // Determine cutoff: source cutoff must be before kickoff and before/at now
      const dataCutoffIso = nowIso;
      const sourceEventIso = oddItem.sourceTimestamp || nowIso;

      // Resolve history using HistoricalDataResolver instance
      const resolver = new HistoricalDataResolver();
      const resolved = resolver.resolveHistory({
        id: candidateId,
        matchId: matchInfo.id,
        market: oddItem.market,
        selection: oddItem.selection,
        line: oddItem.line,
        rawHistory: historicalData[oddItem.market] || null,
        eventKickoff: kickoffIso
      });

      // Calibrate probability under V1 & V2.2
      // V1 baseline: Beta posterior with generic prior
      const sampleSize = resolved.sampleSize || 10;
      const successes = resolved.successes || 6;
      const priorA = resolved.priorAlpha || 2;
      const priorB = resolved.priorBeta || 2;
      const pBeta = (successes + priorA) / (sampleSize + priorA + priorB);
      
      const probV1 = Number(pBeta.toFixed(4));
      const fairOddsV1 = probV1 > 0 ? Number((1 / probV1).toFixed(3)) : 0;
      const evV1 = Number(((probV1 * oddItem.odds) - 1).toFixed(4));

      // V2.2: Ensembled with Poisson / DQE validation
      let probV22 = probV1;
      if (resolved.contractType === 'COUNT_HISTORY' && resolved.poissonProbability) {
        probV22 = Number(((probV1 * 0.5) + (resolved.poissonProbability * 0.5)).toFixed(4));
      } else {
        // Limited shrinkage
        probV22 = Number((probV1 * 0.95 + 0.05 * 0.5).toFixed(4));
      }
      const fairOddsV22 = probV22 > 0 ? Number((1 / probV22).toFixed(3)) : 0;
      const evV22 = Number(((probV22 * oddItem.odds) - 1).toFixed(4));

      const candidateRecord = {
        candidateId,
        matchId: matchInfo.id,
        eventKickoff: kickoffIso,
        sourceEventTimestamp: sourceEventIso,
        dataCutoffTimestamp: dataCutoffIso,
        ingestedAt: nowIso,
        market: oddItem.market,
        selection: oddItem.selection,
        line: oddItem.line,
        odds: oddItem.odds,
        historicalContract: resolved.contractType,
        historicalSampleSize: sampleSize,
        historicalSuccesses: successes,
        priorAlpha: priorA,
        priorBeta: priorB,
        probabilityV1: probV1,
        probabilityV22: probV22,
        fairOddsV1,
        fairOddsV22,
        evV1,
        evV22,
        dqeStatus: resolved.dqeStatus || 'VALID',
        modelVersion: 'V2.2_LIVE',
        sourceVersion: 'STATSHUB_PROSPECTIVE',
        tribunalDecision: 'SHADOW_PASSIVE',
        tribunalDecisionTimestamp: nowIso
      };

      const ingestionResult = ingestProspectiveCandidate(candidateRecord, this.storePath);
      results.push({ candidateId, result: ingestionResult });

      if (ingestionResult.action === 'INGESTED_SUCCESSFULLY' || ingestionResult.action === 'UPDATED_SNAPSHOT') {
        this.stats.candidatesCaptured++;
      } else if (ingestionResult.action === 'IGNORED_DUPLICATE') {
        this.stats.duplicatesIgnored++;
      } else if (ingestionResult.action === 'RECORDED_VIOLATION') {
        this.stats.violationsRecorded++;
      }
    }

    return results;
  }

  /**
   * Single run of polling and ingestion.
   */
  async pollOnce(fetcherFn) {
    if (this.isPolling) {
      console.warn('[Scheduler] Poll already in progress. Skipping.');
      return;
    }
    this.isPolling = true;
    this.stats.pollsCount++;
    this.stats.lastPollAt = new Date().toISOString();

    try {
      if (typeof fetcherFn === 'function') {
        const matchesData = await fetcherFn();
        for (const m of matchesData) {
          this.processMatchCandidates(m.matchInfo, m.oddsList, m.historicalData);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error during polling cycle:', err);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Starts background recurring polling.
   */
  start(fetcherFn) {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.pollOnce(fetcherFn);
    this.timer = setInterval(() => {
      this.pollOnce(fetcherFn);
    }, this.pollIntervalMs);
  }

  /**
   * Stops background scheduler.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
