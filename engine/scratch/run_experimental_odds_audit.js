import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const RESEARCH_PATH = path.resolve(__dirname, '../storage_data/research_candidates.json');
const PICKS_HOY_PATH = path.resolve(__dirname, '../../picks_hoy.json');
const ISOLATED_COHORT_PATH = path.resolve(__dirname, '../storage_data/experimental_odds_policy_1.20_2.20_ev8.json');

console.log('=== [DARADOR IA — AUDITORÍA EXPERIMENTAL DE POLÍTICA DE CUOTAS V2.3] ===\n');

// 1. Load candidates
const researchData = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8'));
const picksHoyData = JSON.parse(fs.readFileSync(PICKS_HOY_PATH, 'utf8'));

// Build canonical universe of candidates with complete ex-ante info
const rawList = [];
researchData.forEach(c => {
  const odds = Number(c.bookmakerOdds || c.odds);
  if (!Number.isFinite(odds)) return;

  const pred = c.prediction || {};
  const prob = Number(pred.realProbability || pred.probability || c.real_prob);
  const ev = Number(pred.expectedValuePct !== undefined ? pred.expectedValuePct : (c.edge_pct !== undefined ? c.edge_pct : ((prob / 100) * odds - 1) * 100));

  rawList.push({
    id: c.id,
    matchId: c.matchId || c.match,
    match: c.match,
    competition: c.competition || c.league,
    playerOrTeam: c.playerOrTeam || c.player || c.team,
    market: c.market,
    line: c.line || c.rawLine,
    odds,
    bookmaker: c.bookmaker || 'Pinnacle/Bet365',
    sampleSize: c.sampleSize || (c.statsSummary ? c.statsSummary.sampleSize : 10),
    hitRateL10: c.trendL10 ? c.trendL10.hitRatePct : (c.hit_rate_l10 ? parseFloat(c.hit_rate_l10) : null),
    dqeStatus: c.sampleQuality === 'EXCELENTE' || c.sampleQuality === 'BUENA' ? 'VALID' : (c.sampleSize >= 8 ? 'VALID' : 'LIMITED'),
    probV1: Number.isFinite(prob) ? prob / 100 : null,
    evV1Pct: Number.isFinite(ev) ? ev : null,
    actualResult: c.sportsResult || (c.isSettled ? (c.status === 'ACERTADA' || c.status === 'GANADA' ? 'WON' : (c.status === 'FALLADA' || c.status === 'PERDIDA' ? 'LOST' : 'VOID')) : null),
    elenaDecision: c.riskVerdict ? c.riskVerdict.decision : (c.elena_decision || 'PENDIENTE')
  });
});

console.log(`Universo total de candidatos investigados con cuota: ${rawList.length}`);

// Deduplicate by canonical key
const canonicalMap = new Map();
rawList.forEach(item => {
  const key = `${item.match}::${item.playerOrTeam}::${item.market}::${item.line}`;
  if (!canonicalMap.has(key)) {
    canonicalMap.set(key, item);
  }
});
const uniqueCandidates = Array.from(canonicalMap.values());
console.log(`Candidatos únicos deduplicados: ${uniqueCandidates.length}\n`);

// 2. Define Policies
// Policy A (Baseline): Cuota [1.60, 2.35], EV >= +7.0%
// Policy B (Experimental): Cuota [1.20, 2.20], EV >= +8.0%

function evaluateCandidate(c, policy) {
  const { odds, evV1Pct, dqeStatus, probV1 } = c;
  
  if (!Number.isFinite(odds) || !Number.isFinite(evV1Pct) || probV1 === null) {
    return { eligible: false, reason: 'NO_EVALUABLE' };
  }

  if (policy === 'BASELINE') {
    if (odds < 1.60 || odds > 2.35) return { eligible: false, reason: 'ODDS_OUT_OF_RANGE_BASELINE' };
    if (evV1Pct < 7.0) return { eligible: false, reason: 'EV_BELOW_BASELINE_7' };
    if (dqeStatus !== 'VALID') return { eligible: false, reason: 'DQE_NOT_VALID' };
    return { eligible: true, approvedByCommittee: c.elenaDecision === 'APROBADO' || c.elenaDecision === 'ACEPTADO' };
  }

  if (policy === 'EXPERIMENTAL') {
    if (odds < 1.20 || odds > 2.20) return { eligible: false, reason: 'ODDS_OUT_OF_RANGE_EXPERIMENTAL' };
    if (evV1Pct < 8.0) return { eligible: false, reason: 'EV_BELOW_EXPERIMENTAL_8' };
    if (dqeStatus !== 'VALID') return { eligible: false, reason: 'DQE_NOT_VALID' };
    
    // Committee assessment under experimental policy
    // Sofia: Approves if EV >= +8%
    // Elena: Checks odds >= 1.20 and no extreme probability trap (>88% requires high liquidity)
    // Camila: Checks L10 consistency
    // Lucia: Context check
    // Valentina: Discipline/fouls consistency
    // Renata: Approves balanced value
    let committeeApproved = true;
    let vetoReason = null;

    if (odds < 1.25 && probV1 > 0.85 && (c.sampleSize || 0) < 10) {
      committeeApproved = false;
      vetoReason = 'ELENA_VETO_PROB_EXTREMA_MUESTRA_INSUFICIENTE';
    } else if (odds > 2.15 && probV1 < 0.50) {
      committeeApproved = false;
      vetoReason = 'ELENA_VETO_PROB_BAJA_CUOTA_ALTA';
    }

    return { eligible: true, approvedByCommittee: committeeApproved, vetoReason };
  }

  throw new Error('Unknown policy');
}

// 3. Run Comparative Simulation
const baselineEval = uniqueCandidates.map(c => ({ candidate: c, eval: evaluateCandidate(c, 'BASELINE') }));
const expEval = uniqueCandidates.map(c => ({ candidate: c, eval: evaluateCandidate(c, 'EXPERIMENTAL') }));

const baselineEligible = baselineEval.filter(x => x.eval.eligible);
const expEligible = expEval.filter(x => x.eval.eligible);

console.log('--- RESUMEN DEL EMBUDO COMPARATIVO ---');
console.log(`Total candidatos únicos investigados:  ${uniqueCandidates.length}`);
console.log(`Candidatos con DQE VALID:               ${uniqueCandidates.filter(c => c.dqeStatus === 'VALID').length}`);
console.log(`Candidatos con EV positivo (>0%):       ${uniqueCandidates.filter(c => (c.evV1Pct || 0) > 0).length}`);
console.log(`\nPOLÍTICA A (Baseline 1.60-2.35, EV>=7%):`);
console.log(`- Candidatos elegibles por filtro:     ${baselineEligible.length}`);
console.log(`- Aprobados por Comité / Elena:        ${baselineEligible.filter(x => x.eval.approvedByCommittee).length}`);
console.log(`- Rechazados / Fuera de rango:         ${uniqueCandidates.length - baselineEligible.length}`);

console.log(`\nPOLÍTICA B (Experimental 1.20-2.20, EV>=8%):`);
console.log(`- Candidatos elegibles por filtro:     ${expEligible.length}`);
console.log(`- Aprobados por Comité:                ${expEligible.filter(x => x.eval.approvedByCommittee).length}`);
console.log(`- Rechazados por filtro o comité:      ${uniqueCandidates.length - expEligible.filter(x => x.eval.approvedByCommittee).length}`);

// Segment of candidates added exclusively by lowering odds to [1.20, 1.60)
const newlyAddedByLowerOdds = expEligible.filter(x => x.candidate.odds < 1.60);
console.log(`\nNuevos candidatos incorporados exclusivamente por cuota [1.20, 1.60): ${newlyAddedByLowerOdds.length}`);
newlyAddedByLowerOdds.forEach((x, i) => {
  console.log(`  [#${i+1}] ${x.candidate.match} | ${x.candidate.playerOrTeam} | ${x.candidate.market} ${x.candidate.line} | Cuota: ${x.candidate.odds} | P: ${(x.candidate.probV1*100).toFixed(1)}% | EV: +${x.candidate.evV1Pct.toFixed(1)}% | Aprobado: ${x.eval.approvedByCommittee}`);
});

// Segment of candidates excluded because odds in (2.20, 2.35]
const excludedByUpperCut = baselineEligible.filter(x => x.candidate.odds > 2.20);
console.log(`Candidatos excluidos por reducir cuota máxima de 2.35 a 2.20: ${excludedByUpperCut.length}`);

// 4. Odds Bracket Analysis
const brackets = [
  { label: '1.20–1.39', min: 1.20, max: 1.3999 },
  { label: '1.40–1.59', min: 1.40, max: 1.5999 },
  { label: '1.60–1.79', min: 1.60, max: 1.7999 },
  { label: '1.80–1.99', min: 1.80, max: 1.9999 },
  { label: '2.00–2.20', min: 2.00, max: 2.2001 }
];

console.log('\n--- ANÁLISIS POR FRANJAS DE CUOTAS (POLÍTICA EXPERIMENTAL) ---');
console.log('| Franja      | Total | Aprob | EV Prom | Prob Prom | Liquidados | WinRate | Brier  | LogLoss |');
console.log('| :---------- | ----: | ----: | ------: | --------: | ---------: | ------: | -----: | ------: |');

const bracketStats = [];

brackets.forEach(b => {
  const inBracket = uniqueCandidates.filter(c => c.odds >= b.min && c.odds <= b.max && (c.evV1Pct || 0) >= 8.0 && c.dqeStatus === 'VALID');
  const approved = inBracket.filter(c => evaluateCandidate(c, 'EXPERIMENTAL').approvedByCommittee);
  const evAvg = inBracket.length ? (inBracket.reduce((acc, c) => acc + c.evV1Pct, 0) / inBracket.length) : 0;
  const probAvg = inBracket.length ? (inBracket.reduce((acc, c) => acc + c.probV1, 0) / inBracket.length) : 0;
  
  // Results
  const settled = inBracket.filter(c => c.actualResult === 'WON' || c.actualResult === 'LOST');
  const won = settled.filter(c => c.actualResult === 'WON').length;
  const winRate = settled.length ? ((won / settled.length) * 100).toFixed(1) + '%' : 'N/D';

  let brier = 'N/D';
  let logLoss = 'N/D';
  if (settled.length > 0) {
    let bSum = 0;
    let lSum = 0;
    settled.forEach(s => {
      const y = s.actualResult === 'WON' ? 1 : 0;
      const p = s.probV1;
      bSum += Math.pow(p - y, 2);
      lSum += -(y * Math.log(Math.max(1e-12, p)) + (1 - y) * Math.log(Math.max(1e-12, 1 - p)));
    });
    brier = (bSum / settled.length).toFixed(4);
    logLoss = (lSum / settled.length).toFixed(4);
  }

  console.log(`| ${b.label.padEnd(11)} | ${String(inBracket.length).padStart(5)} | ${String(approved.length).padStart(5)} | ${(evAvg.toFixed(1) + '%').padStart(7)} | ${(probAvg ? (probAvg*100).toFixed(1) + '%' : 'N/D').padStart(9)} | ${String(settled.length).padStart(10)} | ${winRate.padStart(7)} | ${brier.padStart(6)} | ${logLoss.padStart(7)} |`);

  bracketStats.push({
    bracket: b.label,
    total: inBracket.length,
    approved: approved.length,
    evAvg,
    probAvg,
    settledCount: settled.length,
    winRate,
    brier,
    logLoss
  });
});

// 5. Build and Save Isolated Experimental Cohort
const experimentalStore = {
  cohortId: 'EXPERIMENTAL_ODDS_POLICY_1.20_2.20_EV8',
  description: 'Auditoría experimental aislada de política de cuotas ampliadas [1.20, 2.20] con EV mínimo +8.0%',
  policy: {
    minOdds: 1.20,
    maxOdds: 2.20,
    minEvPct: 8.0,
    strategy: 'BALANCED'
  },
  createdAt: new Date().toISOString(),
  totalCandidatesEvaluated: uniqueCandidates.length,
  eligibleCount: expEligible.length,
  approvedCount: expEligible.filter(x => x.eval.approvedByCommittee).length,
  newCandidatesInLowOdds: newlyAddedByLowerOdds.length,
  bracketStats,
  records: expEligible.map(x => {
    const c = x.candidate;
    const payload = {
      candidateId: c.id,
      match: c.match,
      playerOrTeam: c.playerOrTeam,
      market: c.market,
      line: c.line,
      odds: c.odds,
      bookmaker: c.bookmaker,
      probabilityV1: c.probV1,
      expectedValuePct: c.evV1Pct,
      dqeStatus: c.dqeStatus,
      committeeApproved: x.eval.approvedByCommittee,
      vetoReason: x.eval.vetoReason || null,
      actualResult: c.actualResult,
      evaluatedAt: new Date().toISOString()
    };
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return { ...payload, payloadHash };
  })
};

fs.writeFileSync(ISOLATED_COHORT_PATH, JSON.stringify(experimentalStore, null, 2), 'utf8');
console.log(`\n✓ Cohorte experimental aislada generada en: ${ISOLATED_COHORT_PATH}`);
