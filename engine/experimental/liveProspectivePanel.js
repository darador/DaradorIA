import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LiveProspectiveEvaluator } from './liveProspectiveEvaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * LiveProspectivePanel
 * Complete reporting and monitoring console for the prospective cohort.
 */
export class LiveProspectivePanel {
  constructor(options = {}) {
    this.evaluator = new LiveProspectiveEvaluator(options);
  }

  render(policy = 'LAST_VALID_PRE_KICKOFF') {
    const audit = this.evaluator.auditSnapshotIntegrity();
    const metrics = this.evaluator.computeComparativeMetrics(policy);
    const candidates = this.evaluator.resolveEvaluations(policy);

    // Grouping by matchId for dependency inspection
    const matchesMap = new Map();
    candidates.forEach(c => {
      if (!matchesMap.has(c.matchId)) matchesMap.set(c.matchId, []);
      matchesMap.get(c.matchId).push(c);
    });

    console.log('========================================================================================================');
    console.log('                           DARADOR IA 2.0 — LIVE PROSPECTIVE SHADOW LAB PANEL                           ');
    console.log('========================================================================================================');
    console.log(`Evaluator Policy:         ${policy}`);
    console.log(`Unique Matches:           ${matchesMap.size}`);
    console.log(`Unique Candidates:        ${audit.uniqueCandidateCount}`);
    console.log(`Total Snapshots:          ${audit.totalRecords}`);
    console.log(`Superseded Snapshots:     ${audit.supersededCount} (odds changes before kickoff)`);
    console.log(`Temporal Violations:      ${audit.violationsCount} (isolated from prospective evaluation)`);
    console.log(`Tampered Hashes:          ${audit.tamperedRecords.length === 0 ? '0 (ALL CANONICAL SHA-256 VERIFIED)' : audit.tamperedRecords.length}`);
    console.log('--------------------------------------------------------------------------------------------------------');
    console.log(`Evaluation Status:        Pending: ${metrics.pendingCount} | Settled: ${metrics.evaluableCount} (Push: ${metrics.pushCount}, Void: ${metrics.voidCount})`);

    if (metrics.warning) {
      console.log('--------------------------------------------------------------------------------------------------------');
      console.log(`[!] ${metrics.warning}`);
      console.log('--------------------------------------------------------------------------------------------------------');
    }

    console.log('\n--- COMPARATIVE MODEL METRICS (V1 vs V2.2) ---');
    console.log('| Metric                    | V1 Baseline     | V2.2 Experimental | Delta (V2.2 - V1)      |');
    console.log('| :------------------------ | :-------------- | :---------------- | :--------------------- |');
    
    if (metrics.evaluableCount > 0) {
      console.log(`| Brier Score               | ${metrics.v1.brierScore.toFixed(4).padEnd(15)} | ${metrics.v22.brierScore.toFixed(4).padEnd(17)} | ${(metrics.diff.deltaBrier < 0 ? '' : '+') + metrics.diff.deltaBrier.toFixed(4).padEnd(22)} |`);
      console.log(`| Log Loss                  | ${metrics.v1.logLoss.toFixed(4).padEnd(15)} | ${metrics.v22.logLoss.toFixed(4).padEnd(17)} | ${(metrics.diff.deltaLogLoss < 0 ? '' : '+') + metrics.diff.deltaLogLoss.toFixed(4).padEnd(22)} |`);
      console.log(`| ECE (Expected Calib Err)  | ${(metrics.v1.ece.toFixed(2) + '%').padEnd(15)} | ${(metrics.v22.ece.toFixed(2) + '%').padEnd(17)} | -                      |`);
      console.log(`| Bets Count (EV > 0)       | ${String(metrics.v1.betsCount).padEnd(15)} | ${String(metrics.v22.betsCount).padEnd(17)} | -                      |`);
      console.log(`| Win Rate                  | ${(metrics.v1.winRate.toFixed(2) + '%').padEnd(15)} | ${(metrics.v22.winRate.toFixed(2) + '%').padEnd(17)} | -                      |`);
      console.log(`| Yield (ROI on Stake)      | ${(metrics.v1.yieldPercent.toFixed(2) + '%').padEnd(15)} | ${(metrics.v22.yieldPercent.toFixed(2) + '%').padEnd(17)} | -                      |`);
      console.log(`| Profit (Units)            | ${metrics.v1.profitUnits.toFixed(2).padEnd(15)} | ${metrics.v22.profitUnits.toFixed(2).padEnd(17)} | -                      |`);
    } else {
      console.log('| Brier / LogLoss / ROI     | [PENDIENTE]     | [PENDIENTE]       | Sin resultados aún     |');
    }

    if (metrics.clv && metrics.clv.analyzedCount > 0) {
      console.log(`| Average CLV               | ${(metrics.clv.avgClv + '%').padEnd(15)} | ${(metrics.clv.avgClv + '%').padEnd(17)} | -                      |`);
    }

    console.log('\n--- CANDIDATE STATUS & DEPENDENCY BREAKDOWN ---');
    console.log('| Candidate ID                 | Match ID              | Market / Sel / Line | Odds | P(V1)  | P(V2.2)| Status         |');
    console.log('--------------------------------------------------------------------------------------------------------');
    
    candidates.forEach(c => {
      const cid = (c.candidateId || '').padEnd(28).substring(0, 28);
      const mid = (c.matchId || '').padEnd(21).substring(0, 21);
      const mkt = `${c.market || ''} ${c.selection || ''} ${c.line !== null ? c.line : ''}`.padEnd(19).substring(0, 19);
      const odds = (c.odds !== undefined ? Number(c.odds).toFixed(2) : '-').padStart(5);
      const pv1 = (c.probabilityV1 !== undefined ? (Number(c.probabilityV1) * 100).toFixed(1) + '%' : '-').padStart(6);
      const pv2 = (c.probabilityV22 !== undefined ? (Number(c.probabilityV22) * 100).toFixed(1) + '%' : '-').padStart(6);
      const st = (c.status || '').padEnd(14).substring(0, 14);

      console.log(`| ${cid} | ${mid} | ${mkt} | ${odds} | ${pv1} | ${pv2} | ${st} |`);
    });
    console.log('========================================================================================================\n');

    return {
      audit,
      metrics,
      matchesCount: matchesMap.size,
      candidates
    };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const panel = new LiveProspectivePanel();
  panel.render();
}
