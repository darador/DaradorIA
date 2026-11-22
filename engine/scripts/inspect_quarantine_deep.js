const fs = require('fs');

const qPath = 'engine/storage_data/quarantine_candidates.json';
const q = JSON.parse(fs.readFileSync(qPath, 'utf8'));
const candidates = q.quarantinedCandidates.map(c => c.originalCandidate);

console.log('Total quarantined candidates:', candidates.length);

candidates.forEach((c, i) => {
  console.log('=== CANDIDATE ' + (i + 1) + ' ===');
  console.log('ID: ' + c.id);
  console.log('Match: ' + c.match + ' | League: ' + c.league);
  console.log('Subject: ' + (c.player || c.team) + ' | Team: ' + c.team + ' | Opponent: ' + c.opponent);
  console.log('Market: ' + c.market + ' | Line: ' + c.line + ' | Odds: ' + c.odds + ' | Fair: ' + c.fair_odds + ' | EV: ' + c.ev_pct);
  console.log('Date: ' + c.date + ' | Time: ' + c.time);
  console.log('Status: ' + c.status + ' | RiskVerdict: ' + (c.risk_verdict ? c.risk_verdict.finalStatus : 'NONE'));
  console.log('DecidedAt: ' + (c.risk_verdict ? c.risk_verdict.decidedAt : 'NONE'));
  console.log('FinalReason: ' + (c.risk_verdict ? c.risk_verdict.finalReason : 'NONE'));
  console.log('HasAgentReports: ' + (c.agent_reports ? Object.keys(c.agent_reports).join(', ') : 'NONE'));
  console.log('Sample/Min/Uncertainty: sample=' + c.sample_size + ' min=' + c.minutes_expected + ' unc=' + c.uncertainty_index);
  console.log('Rationale: ' + (c.rationale || 'NONE'));
  console.log('');
});
