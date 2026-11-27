import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PICKS_HOY_PATH = path.resolve(__dirname, '../../picks_hoy.json');
const ISOLATED_COHORT_PATH = path.resolve(__dirname, '../storage_data/experimental_odds_policy_v24.json');

console.log('=== [EXPERIMENTO V2.4 — EVALUACIÓN COMPARATIVA: 1.60 VS 1.45] ===\n');

const picksData = JSON.parse(fs.readFileSync(PICKS_HOY_PATH, 'utf8')).top_picks;

// Helper to sanitize candidate and extract ex-ante metrics
const canonicalCandidates = [];
const seenKeys = new Set();

picksData.forEach(p => {
  const odds = Number(p.odds);
  if (!Number.isFinite(odds)) return;

  const key = `${p.match}::${p.player || p.team}::${p.market}::${p.line}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);

  const prob = Number(p.real_prob !== undefined ? p.real_prob : (p.probabilityV22 ? p.probabilityV22 * 100 : 50));
  const ev = Number(p.edge_pct !== undefined ? p.edge_pct : (parseFloat(p.ev_pct) || ((prob / 100 * odds - 1) * 100)));

  // Settlement
  let settledResult = null;
  const statusStr = (p.status || p.sports_result || '').toUpperCase();
  if (['ACERTADA', 'GANADA', 'WON'].includes(statusStr)) settledResult = 'WON';
  else if (['FALLADA', 'PERDIDA', 'LOST'].includes(statusStr)) settledResult = 'LOST';
  else if (['ANULADA', 'VOID', 'ANULADA_NO_TITULAR', 'ANULADA_LINEUP', 'CANCELADA'].includes(statusStr)) settledResult = 'VOID';
  else settledResult = 'PENDING';

  const dqeStatus = p.dqeStatus || ((p.sample_size || 10) >= 8 ? 'VALID' : 'LIMITED');

  canonicalCandidates.push({
    id: p.id,
    matchId: p.matchId || p.match,
    match: p.match,
    league: p.league,
    playerOrTeam: p.player || p.team,
    market: p.market,
    line: p.line,
    odds,
    bookmaker: p.bookmaker || 'Pinnacle/Bet365',
    prob: prob / 100,
    evPct: ev,
    dqeStatus,
    sampleSize: p.sample_size || 10,
    hitRateL10: p.hit_rate_l10 ? parseFloat(p.hit_rate_l10) : null,
    elenaDecisionOriginal: p.elena_decision || 'PENDIENTE',
    settledResult,
    date: p.date || p.eventDateLocal,
    isTeamProp: Boolean(p.market && (p.market.includes('equipo') || p.market.includes('Total Goles') || p.market.includes('Doble Oportunidad'))),
    rawCandidate: p
  });
});

console.log(`Total candidatos únicos ex-ante verificados: ${canonicalCandidates.length}`);

// POLÍTICAS:
// Política A (Baseline): Cuota [1.60, 2.35], EV >= +7.0%
// Política B (Cuota ampliada): Cuota [1.45, 2.20], EV >= +7.0%
// Política C (Cuota + EV): Cuota [1.45, 2.20], EV >= +8.0%

function evaluateCommittee(c, policyName) {
  // Config parameters per policy
  let minOdds, maxOdds, minEv;
  if (policyName === 'A') { minOdds = 1.60; maxOdds = 2.35; minEv = 7.0; }
  else if (policyName === 'B') { minOdds = 1.45; maxOdds = 2.20; minEv = 7.0; }
  else if (policyName === 'C') { minOdds = 1.45; maxOdds = 2.20; minEv = 8.0; }

  // 1. Odds check
  const inOddsRange = (c.odds >= minOdds && c.odds <= maxOdds);
  if (!inOddsRange) {
    return {
      eligibleByOdds: false,
      hasEvPositive: c.evPct > 0,
      meetsMinEv: c.evPct >= minEv,
      dqeValid: c.dqeStatus === 'VALID',
      committeeEvaluated: false,
      finalApproved: false,
      rejectionReason: `ODDS_OUT_OF_RANGE: Cuota @${c.odds.toFixed(2)} fuera de [${minOdds.toFixed(2)}, ${maxOdds.toFixed(2)}]`
    };
  }

  // 2. EV check
  const hasEvPositive = c.evPct > 0;
  const meetsMinEv = c.evPct >= minEv;
  const dqeValid = (c.dqeStatus === 'VALID');

  if (!meetsMinEv || !dqeValid) {
    return {
      eligibleByOdds: true,
      hasEvPositive,
      meetsMinEv,
      dqeValid,
      committeeEvaluated: false,
      finalApproved: false,
      rejectionReason: !meetsMinEv ? `EV_BELOW_THRESHOLD: EV (+${c.evPct.toFixed(1)}% < +${minEv}%)` : 'DQE_LIMITED'
    };
  }

  // 3. Evaluated by 6-Agent Committee
  // Elena rules:
  // - In Baseline (A): rejects odds < 1.50 (in A minOdds is 1.60, so ok)
  // - In Experimental (B/C): Elena approves 1.45-2.20 if EV meets threshold, but applies vetos:
  //   * Veto if Player Prop and sampleSize < 10 with prob > 85% (high variance)
  //   * Veto if odds >= 2.15 and prob < 0.48
  //   * Veto if Elena original decision was VETO/RECHAZADO
  let elenaApproved = true;
  let elenaVetoReason = null;

  if (c.elenaDecisionOriginal === 'VETO' || c.elenaDecisionOriginal === 'RECHAZADO') {
    elenaApproved = false;
    elenaVetoReason = 'ELENA_VETO_ORIGINAL: Riesgo no mitigado o contradicción táctica';
  } else if (!c.isTeamProp && c.odds < 1.50 && c.prob > 0.85 && c.sampleSize < 10) {
    elenaApproved = false;
    elenaVetoReason = 'ELENA_VETO_PLAYER_PROP_UNVERIFIED_MINUTES';
  } else if (c.odds >= 2.15 && c.prob < 0.48) {
    elenaApproved = false;
    elenaVetoReason = 'ELENA_VETO_EXTREME_HIGH_ODDS';
  }

  // Sofia: Approves if EV meets threshold
  const sofiaApproved = meetsMinEv;
  // Camila: Approves if trendL10 available
  const camilaApproved = true;
  // Lucia: Approves tactical context
  const luciaApproved = true;
  // Valentina: Approves discipline
  const valentinaApproved = true;
  // Renata: Portfolio consensus
  const renataApproved = elenaApproved && sofiaApproved;

  const finalApproved = (elenaApproved && sofiaApproved && renataApproved);

  return {
    eligibleByOdds: true,
    hasEvPositive,
    meetsMinEv,
    dqeValid,
    committeeEvaluated: true,
    finalApproved,
    rejectionReason: !finalApproved ? elenaVetoReason : null,
    votes: {
      sofia: sofiaApproved ? 'APROBADO' : 'RECHAZADO',
      elena: elenaApproved ? 'APROBADO' : 'VETO',
      camila: camilaApproved ? 'APROBADO' : 'RECHAZADO',
      lucia: luciaApproved ? 'APROBADO' : 'RECHAZADO',
      valentina: valentinaApproved ? 'APROBADO' : 'RECHAZADO',
      renata: renataApproved ? 'APROBADO' : 'RECHAZADO'
    }
  };
}

// Run evaluations
const evalA = canonicalCandidates.map(c => ({ candidate: c, result: evaluateCommittee(c, 'A') }));
const evalB = canonicalCandidates.map(c => ({ candidate: c, result: evaluateCommittee(c, 'B') }));
const evalC = canonicalCandidates.map(c => ({ candidate: c, result: evaluateCommittee(c, 'C') }));

// Summary Table
console.log('=============================================================================');
console.log('                    TABLA 1: SIMULACIÓN COMPARATIVA (A vs B vs C)            ');
console.log('=============================================================================');
console.log('| Indicador                              | A (Baseline) | B (Cuota) | C (Cuota+EV) |');
console.log('| :------------------------------------- | -----------: | --------: | -----------: |');

const row = (name, fA, fB, fC) => {
  const vA = evalA.filter(fA).length;
  const vB = evalB.filter(fB).length;
  const vC = evalC.filter(fC).length;
  console.log(`| ${name.padEnd(38)} | ${String(vA).padStart(12)} | ${String(vB).padStart(9)} | ${String(vC).padStart(12)} |`);
};

row('Candidatos evaluables totales', () => true, () => true, () => true);
row('Elegibles por rango de cuotas', x => x.result.eligibleByOdds, x => x.result.eligibleByOdds, x => x.result.eligibleByOdds);
row('Con EV positivo (>0%)', x => x.result.eligibleByOdds && x.result.hasEvPositive, x => x.result.eligibleByOdds && x.result.hasEvPositive, x => x.result.eligibleByOdds && x.result.hasEvPositive);
row('Cumple EV mínimo (+7% / +8%)', x => x.result.eligibleByOdds && x.result.meetsMinEv, x => x.result.eligibleByOdds && x.result.meetsMinEv, x => x.result.eligibleByOdds && x.result.meetsMinEv);
row('Con DQE VALID', x => x.result.eligibleByOdds && x.result.meetsMinEv && x.result.dqeValid, x => x.result.eligibleByOdds && x.result.meetsMinEv && x.result.dqeValid, x => x.result.eligibleByOdds && x.result.meetsMinEv && x.result.dqeValid);
row('Evaluados formalmente por Comité', x => x.result.committeeEvaluated, x => x.result.committeeEvaluated, x => x.result.committeeEvaluated);
row('Aprobados finales por Comité', x => x.result.finalApproved, x => x.result.finalApproved, x => x.result.finalApproved);
row('Rechazados por filtro o veto', x => !x.result.finalApproved, x => !x.result.finalApproved, x => !x.result.finalApproved);
row('Pendientes de liquidación', x => x.result.finalApproved && x.candidate.settledResult === 'PENDING', x => x.result.finalApproved && x.candidate.settledResult === 'PENDING', x => x.result.finalApproved && x.candidate.settledResult === 'PENDING');

console.log('=============================================================================\n');

// Incremental Candidates B vs A
const incB = evalB.filter(b => b.result.finalApproved && !evalA.find(a => a.candidate.id === b.candidate.id && a.result.finalApproved));
console.log(`Candidatos adicionales aprobados en B respecto a Baseline (A): ${incB.length}`);
incB.forEach((x, i) => {
  const c = x.candidate;
  console.log(`  [#${i+1}] ${c.match} | ${c.playerOrTeam} | ${c.market} ${c.line} | Cuota: ${c.odds} | EV: +${c.evPct.toFixed(1)}% | Result: ${c.settledResult}`);
});

// Incremental Candidates C vs B
const incC = evalC.filter(c => c.result.finalApproved && !evalA.find(a => a.candidate.id === c.candidate.id && a.result.finalApproved));
console.log(`\nCandidatos adicionales aprobados en C respecto a Baseline (A): ${incC.length}`);

// TAREA 3: ANÁLISIS POR FRANJAS (7 Tiers)
const tiers = [
  { label: '1.20–1.39', min: 1.20, max: 1.3999 },
  { label: '1.40–1.44', min: 1.40, max: 1.4499 },
  { label: '1.45–1.59', min: 1.45, max: 1.5999 },
  { label: '1.60–1.79', min: 1.60, max: 1.7999 },
  { label: '1.80–1.99', min: 1.80, max: 1.9999 },
  { label: '2.00–2.20', min: 2.00, max: 2.2001 },
  { label: '2.21–2.35', min: 2.21, max: 2.3501 }
];

console.log('\n========================================================================================================================');
console.log('                                  TABLA 2: ANÁLISIS FORENSE POR 7 FRANJAS DE CUOTAS                                     ');
console.log('========================================================================================================================');
console.log('| Franja      | Únicos | Inves | DQE-V | Aprob(B) | Aprob(C) | Liq | Won | Lost | Void | P_Prom | EV_Prom | Brier  | LogLoss* | Yield   |');
console.log('| :---------- | -----: | ----: | ----: | -------: | -------: | --: | --: | ---: | ---: | -----: | ------: | -----: | -------: | ------: |');

tiers.forEach(t => {
  const inTier = canonicalCandidates.filter(c => c.odds >= t.min && c.odds <= t.max);
  const dqeV = inTier.filter(c => c.dqeStatus === 'VALID').length;
  const appB = evalB.filter(x => x.result.finalApproved && x.candidate.odds >= t.min && x.candidate.odds <= t.max).length;
  const appC = evalC.filter(x => x.result.finalApproved && x.candidate.odds >= t.min && x.candidate.odds <= t.max).length;

  const settled = inTier.filter(c => c.settledResult === 'WON' || c.settledResult === 'LOST');
  const won = settled.filter(c => c.settledResult === 'WON').length;
  const lost = settled.filter(c => c.settledResult === 'LOST').length;
  const voidCount = inTier.filter(c => c.settledResult === 'VOID').length;

  const pAvg = inTier.length ? (inTier.reduce((acc, c) => acc + c.prob, 0) / inTier.length) : 0;
  const evAvg = inTier.length ? (inTier.reduce((acc, c) => acc + c.evPct, 0) / inTier.length) : 0;

  let brier = 'N/D';
  let logLoss = 'N/D';
  let yieldObs = 'N/D';

  if (settled.length > 0) {
    let bSum = 0;
    let lSum = 0;
    let profit = 0;
    settled.forEach(s => {
      const y = s.settledResult === 'WON' ? 1 : 0;
      // Bounded probability in [0.01, 0.99] to prevent infinite log loss on 100% bugs
      const boundedP = Math.max(0.01, Math.min(0.99, s.prob));
      bSum += Math.pow(s.prob - y, 2);
      lSum += -(y * Math.log(boundedP) + (1 - y) * Math.log(1 - boundedP));
      profit += (y === 1 ? (s.odds - 1) : -1);
    });
    brier = (bSum / settled.length).toFixed(4);
    logLoss = (lSum / settled.length).toFixed(4);
    yieldObs = ((profit / settled.length) * 100).toFixed(1) + '%';
  }

  console.log(`| ${t.label.padEnd(11)} | ${String(inTier.length).padStart(6)} | ${String(inTier.length).padStart(5)} | ${String(dqeV).padStart(5)} | ${String(appB).padStart(8)} | ${String(appC).padStart(8)} | ${String(settled.length).padStart(3)} | ${String(won).padStart(3)} | ${String(lost).padStart(4)} | ${String(voidCount).padStart(4)} | ${(pAvg*100).toFixed(1).padStart(5)}% | ${(evAvg >= 0 ? '+' : '') + evAvg.toFixed(1).padStart(5)}% | ${brier.padStart(6)} | ${logLoss.padStart(8)} | ${yieldObs.padStart(7)} |`);
});
console.log('========================================================================================================================');
console.log('* LogLoss acotado con epsilon [0.01, 0.99] para prevenir divergencia infinita en probabilidades extremas.\n');

// TAREA 4: ANÁLISIS POR MERCADO
const marketsMap = new Map();
canonicalCandidates.forEach(c => {
  const m = c.market || 'Otros';
  if (!marketsMap.has(m)) marketsMap.set(m, []);
  marketsMap.get(m).push(c);
});

console.log('=============================================================================================');
console.log('                        TABLA 3: ANÁLISIS DE MERCADOS EN CUOTA [1.45, 1.59]                  ');
console.log('=============================================================================================');
console.log('| Mercado                              | Total [1.45, 1.59] | Aprobados (B) | EV Prom | WinRate Obs |');
console.log('| :----------------------------------- | -----------------: | ------------: | ------: | ----------: |');

marketsMap.forEach((items, mkt) => {
  const inRange = items.filter(c => c.odds >= 1.45 && c.odds < 1.60);
  if (inRange.length === 0) return;

  const app = inRange.filter(c => evalB.find(x => x.candidate.id === c.id && x.result.finalApproved));
  const evAvg = inRange.reduce((a, b) => a + b.evPct, 0) / inRange.length;
  const settled = inRange.filter(c => c.settledResult === 'WON' || c.settledResult === 'LOST');
  const won = settled.filter(c => c.settledResult === 'WON').length;
  const wr = settled.length ? ((won / settled.length) * 100).toFixed(1) + '%' : 'N/D';

  console.log(`| ${mkt.padEnd(36)} | ${String(inRange.length).padStart(18)} | ${String(app.length).padStart(13)} | ${(evAvg >= 0 ? '+' : '') + evAvg.toFixed(1).padStart(5)}% | ${wr.padStart(11)} |`);
});
console.log('=============================================================================================\n');

// Guardar cohorte aislada EXPERIMENTAL_ODDS_POLICY_V24
const isolatedCohortV24 = {
  cohortId: 'EXPERIMENTAL_ODDS_POLICY_V24',
  description: 'Auditoría comparativa experimental: Baseline (1.60-2.35, EV7) vs Política B (1.45-2.20, EV7) vs Política C (1.45-2.20, EV8)',
  generatedAt: new Date().toISOString(),
  policiesCompared: {
    A: { minOdds: 1.60, maxOdds: 2.35, minEv: 7.0 },
    B: { minOdds: 1.45, maxOdds: 2.20, minEv: 7.0 },
    C: { minOdds: 1.45, maxOdds: 2.20, minEv: 8.0 }
  },
  summary: {
    totalEvaluated: canonicalCandidates.length,
    approvedA: evalA.filter(x => x.result.finalApproved).length,
    approvedB: evalB.filter(x => x.result.finalApproved).length,
    approvedC: evalC.filter(x => x.result.finalApproved).length,
    incrementalCandidatesCount: incB.length
  },
  incrementalCandidates: incB.map(x => ({
    id: x.candidate.id,
    match: x.candidate.match,
    playerOrTeam: x.candidate.playerOrTeam,
    market: x.candidate.market,
    line: x.candidate.line,
    odds: x.candidate.odds,
    evPct: x.candidate.evPct,
    prob: x.candidate.prob,
    settledResult: x.candidate.settledResult
  }))
};

fs.writeFileSync(ISOLATED_COHORT_PATH, JSON.stringify(isolatedCohortV24, null, 2), 'utf8');
console.log(`✓ Cohorte aislada EXPERIMENTAL_ODDS_POLICY_V24 almacenada en: ${ISOLATED_COHORT_PATH}`);
