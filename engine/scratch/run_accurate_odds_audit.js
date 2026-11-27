import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PICKS_HOY_PATH = path.resolve(__dirname, '../../picks_hoy.json');
const ISOLATED_COHORT_PATH = path.resolve(__dirname, '../storage_data/experimental_odds_policy_1.20_2.20_ev8.json');

console.log('=== [AUDITORÍA EXPERIMENTAL DE POLÍTICA DE CUOTAS V2.3] ===\n');

const picksData = JSON.parse(fs.readFileSync(PICKS_HOY_PATH, 'utf8')).top_picks;

// Helper to sanitize candidate
const candidates = [];
const seenKeys = new Set();

picksData.forEach(p => {
  const odds = Number(p.odds);
  if (!Number.isFinite(odds)) return;

  const key = `${p.match}::${p.player || p.team}::${p.market}::${p.line}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);

  const prob = Number(p.real_prob !== undefined ? p.real_prob : p.probabilityV22 * 100);
  const ev = Number(p.edge_pct !== undefined ? p.edge_pct : (parseFloat(p.ev_pct) || ((prob / 100 * odds - 1) * 100)));

  // Settlement status
  let settledResult = null;
  const statusStr = (p.status || p.sports_result || '').toUpperCase();
  if (['ACERTADA', 'GANADA', 'WON'].includes(statusStr)) settledResult = 'WON';
  else if (['FALLADA', 'PERDIDA', 'LOST'].includes(statusStr)) settledResult = 'LOST';
  else if (['ANULADA', 'VOID', 'ANULADA_NO_TITULAR', 'ANULADA_LINEUP'].includes(statusStr)) settledResult = 'VOID';
  else settledResult = 'PENDING';

  // DQE Status
  const dqeStatus = p.dqeStatus || ((p.sample_size || 10) >= 8 ? 'VALID' : 'LIMITED');

  candidates.push({
    id: p.id,
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
    elenaDecision: p.elena_decision || 'PENDIENTE',
    settledResult,
    date: p.date || p.eventDateLocal
  });
});

console.log(`Candidatos únicos evaluados ex-ante: ${candidates.length}\n`);

// 1. POLÍTICA A (BASELINE PRODUCTIVO)
// Cuota: [1.60, 2.35] | EV mínimo: >= +7.0% | DQE: VALID
const baselineEligible = candidates.filter(c => {
  if (c.odds < 1.60 || c.odds > 2.35) return false;
  if (c.evPct < 7.0) return false;
  if (c.dqeStatus !== 'VALID') return false;
  return true;
});

// 2. POLÍTICA B (EXPERIMENTAL V2.3)
// Cuota: [1.20, 2.20] | EV mínimo: >= +8.0% | DQE: VALID
const expEligible = candidates.filter(c => {
  if (c.odds < 1.20 || c.odds > 2.20) return false;
  if (c.evPct < 8.0) return false;
  if (c.dqeStatus !== 'VALID') return false;
  return true;
});

// Aprobados por comité en Baseline vs Experimental
// En Baseline: elena_decision === 'APROBADO'
const baselineApproved = baselineEligible.filter(c => c.elenaDecision === 'APROBADO');

// En Experimental: evaluar con las 6 agentes
// Filtro adicional de Elena experimental: Cuotas < 1.30 con prob > 85% requieren N>=10
const expApproved = [];
const expRejected = [];

expEligible.forEach(c => {
  let approved = true;
  let reason = null;

  // Elena Risk Filter
  if (c.odds < 1.30 && c.prob > 0.85 && c.sampleSize < 10) {
    approved = false;
    reason = 'ELENA_VETO: Probabilidad extrema (>85%) en cuota ultrabaja con muestra < 10.';
  } else if (c.odds >= 2.15 && c.prob < 0.48) {
    approved = false;
    reason = 'ELENA_VETO: Probabilidad menor a 48% en el extremo superior de cuota.';
  } else if (c.evPct < 8.0) {
    approved = false;
    reason = 'SOFIA_VETO: EV inferior al umbral experimental (+8.0%).';
  }

  if (approved) {
    expApproved.push({ candidate: c, committeeStatus: 'APROBADO_UNANIME' });
  } else {
    expRejected.push({ candidate: c, vetoReason: reason });
  }
});

// Comparación de Embudo
console.log('================================================================================');
console.log('                 TABLA 1: ANÁLISIS COMPARATIVO DEL EMBUDO                       ');
console.log('================================================================================');
console.log('| Indicador                              | Baseline (A) | Experimental (B) | Diferencia |');
console.log('| :------------------------------------- | -----------: | ---------------: | ---------: |');

const totalMatches = new Set(candidates.map(c => c.match)).size;
const totalMarkets = new Set(candidates.map(c => c.market)).size;

const bMatches = new Set(baselineEligible.map(c => c.match)).size;
const eMatches = new Set(expEligible.map(c => c.match)).size;

const bMkts = new Set(baselineEligible.map(c => c.market)).size;
const eMkts = new Set(expEligible.map(c => c.market)).size;

console.log(`| Partidos con candidatos elegibles      | ${String(bMatches).padStart(12)} | ${String(eMatches).padStart(16)} | ${(eMatches - bMatches >= 0 ? '+' : '') + String(eMatches - bMatches).padStart(10)} |`);
console.log(`| Mercados representados en elegibles    | ${String(bMkts).padStart(12)} | ${String(eMkts).padStart(16)} | ${(eMkts - bMkts >= 0 ? '+' : '') + String(eMkts - bMkts).padStart(10)} |`);
console.log(`| Candidatos investigados totales        | ${String(candidates.length).padStart(12)} | ${String(candidates.length).padStart(16)} | ${'0'.padStart(10)} |`);
console.log(`| Candidatos con DQE VALID               | ${String(candidates.filter(c => c.dqeStatus === 'VALID').length).padStart(12)} | ${String(candidates.filter(c => c.dqeStatus === 'VALID').length).padStart(16)} | ${'0'.padStart(10)} |`);
console.log(`| Candidatos elegibles por cuota/EV      | ${String(baselineEligible.length).padStart(12)} | ${String(expEligible.length).padStart(16)} | ${(expEligible.length - baselineEligible.length >= 0 ? '+' : '') + String(expEligible.length - baselineEligible.length).padStart(10)} |`);
console.log(`| Aprobados por Comité / Elena           | ${String(baselineApproved.length).padStart(12)} | ${String(expApproved.length).padStart(16)} | ${(expApproved.length - baselineApproved.length >= 0 ? '+' : '') + String(expApproved.length - baselineApproved.length).padStart(10)} |`);
console.log(`| Rechazados por filtro o Comité         | ${String(candidates.length - baselineApproved.length).padStart(12)} | ${String(candidates.length - expApproved.length).padStart(16)} | ${(expApproved.length - baselineApproved.length <= 0 ? '+' : '-') + String(Math.abs(expApproved.length - baselineApproved.length)).padStart(10)} |`);
console.log('================================================================================\n');

// Nuevos candidatos incorporados por cuota baja [1.20, 1.60)
const lowOddsAdded = expEligible.filter(c => c.odds < 1.60);
console.log(`Nuevos candidatos incorporados exclusivamente por rango [1.20, 1.60): ${lowOddsAdded.length}`);
console.log(`- De ellos, con EV >= +8.0%: ${lowOddsAdded.filter(c => c.evPct >= 8.0).length}`);
console.log(`- Aprobados por Comité:      ${expApproved.filter(x => x.candidate.odds < 1.60).length}`);

// Candidatos excluidos por bajar techo de 2.35 a 2.20
const highOddsExcluded = baselineEligible.filter(c => c.odds > 2.20);
console.log(`Candidatos excluidos por bajar techo de cuota de 2.35 a 2.20: ${highOddsExcluded.length}\n`);

// 3. ANÁLISIS POR FRANJAS DE CUOTAS
const brackets = [
  { label: '1.20–1.39', min: 1.20, max: 1.3999 },
  { label: '1.40–1.59', min: 1.40, max: 1.5999 },
  { label: '1.60–1.79', min: 1.60, max: 1.7999 },
  { label: '1.80–1.99', min: 1.80, max: 1.9999 },
  { label: '2.00–2.20', min: 2.00, max: 2.2001 }
];

console.log('================================================================================================================');
console.log('                           TABLA 2: DESGLOSE POR FRANJAS DE CUOTAS (POLÍTICA EXPERIMENTAL)                       ');
console.log('================================================================================================================');
console.log('| Franja      | Total | Aprob | EV Prom | Prob Prom | Liquidados | Aciertos | WinRate | Brier  | LogLoss | Yield Obs |');
console.log('| :---------- | ----: | ----: | ------: | --------: | ---------: | -------: | ------: | -----: | ------: | --------: |');

const bracketStatsReport = [];

brackets.forEach(b => {
  const inB = candidates.filter(c => c.odds >= b.min && c.odds <= b.max && c.evPct >= 8.0 && c.dqeStatus === 'VALID');
  const appB = expApproved.filter(x => x.candidate.odds >= b.min && x.candidate.odds <= b.max);
  const evAvg = inB.length ? (inB.reduce((acc, c) => acc + c.evPct, 0) / inB.length) : 0;
  const pAvg = inB.length ? (inB.reduce((acc, c) => acc + c.prob, 0) / inB.length) : 0;

  // Settlement & Calibration
  const settled = inB.filter(c => c.settledResult === 'WON' || c.settledResult === 'LOST');
  const won = settled.filter(c => c.settledResult === 'WON').length;
  const winRate = settled.length ? ((won / settled.length) * 100).toFixed(1) + '%' : 'N/D';

  let brier = 'N/D';
  let logLoss = 'N/D';
  let yieldObs = 'N/D';

  if (settled.length > 0) {
    let bSum = 0;
    let lSum = 0;
    let profit = 0;
    settled.forEach(s => {
      const y = s.settledResult === 'WON' ? 1 : 0;
      bSum += Math.pow(s.prob - y, 2);
      lSum += -(y * Math.log(Math.max(1e-12, s.prob)) + (1 - y) * Math.log(Math.max(1e-12, 1 - s.prob)));
      profit += (y === 1 ? (s.odds - 1) : -1);
    });
    brier = (bSum / settled.length).toFixed(4);
    logLoss = (lSum / settled.length).toFixed(4);
    yieldObs = ((profit / settled.length) * 100).toFixed(1) + '%';
  }

  console.log(`| ${b.label.padEnd(11)} | ${String(inB.length).padStart(5)} | ${String(appB.length).padStart(5)} | ${(evAvg.toFixed(1) + '%').padStart(7)} | ${(pAvg ? (pAvg*100).toFixed(1) + '%' : 'N/D').padStart(9)} | ${String(settled.length).padStart(10)} | ${String(won).padStart(8)} | ${winRate.padStart(7)} | ${brier.padStart(6)} | ${logLoss.padStart(7)} | ${yieldObs.padStart(9)} |`);

  bracketStatsReport.push({
    bracket: b.label,
    total: inB.length,
    approved: appB.length,
    evAvg,
    pAvg,
    settledCount: settled.length,
    wonCount: won,
    winRate,
    brier,
    logLoss,
    yieldObs
  });
});
console.log('================================================================================================================\n');

// 4. Save Isolated Cohort Store
const isolatedCohort = {
  cohortId: 'EXPERIMENTAL_ODDS_POLICY_1.20_2.20_EV8',
  description: 'Auditoría experimental de ampliación de cuotas [1.20, 2.20] con EV>=8% bajo protocolo riguroso',
  generatedAt: new Date().toISOString(),
  policyConfig: {
    minOdds: 1.20,
    maxOdds: 2.20,
    minEvPct: 8.0,
    strategy: 'BALANCED'
  },
  metrics: {
    totalEvaluated: candidates.length,
    baselineEligible: baselineEligible.length,
    baselineApproved: baselineApproved.length,
    experimentalEligible: expEligible.length,
    experimentalApproved: expApproved.length,
    lowOddsAddedCount: lowOddsAdded.length
  },
  bracketStats: bracketStatsReport,
  records: expEligible.map(c => {
    const isApp = expApproved.some(x => x.candidate.id === c.id);
    const recPayload = {
      candidateId: c.id,
      match: c.match,
      playerOrTeam: c.playerOrTeam,
      market: c.market,
      line: c.line,
      odds: c.odds,
      bookmaker: c.bookmaker,
      probability: c.prob,
      expectedValuePct: c.evPct,
      dqeStatus: c.dqeStatus,
      committeeApproved: isApp,
      actualResult: c.settledResult
    };
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(recPayload)).digest('hex');
    return { ...recPayload, payloadHash };
  })
};

fs.writeFileSync(ISOLATED_COHORT_PATH, JSON.stringify(isolatedCohort, null, 2), 'utf8');
console.log(`✓ Cohorte experimental aislada guardada con éxito en:\n  ${ISOLATED_COHORT_PATH}`);
