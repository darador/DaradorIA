/**
 * DARADORBET — FASE 2 POST-AUDITORÍA: AUDITORÍA ESPECÍFICA DE CALIBRACIÓN DE MERCADOS
 *
 * Módulo estrictamente analítico (solo lectura sobre datos existentes, exporta
 * api/calibration_audit_report.json). No modifica filtros ni probabilidades productivas.
 *
 * Prioriza el diagnóstico de props de equipo (especialmente "Remates al arco de equipo")
 * frente a props de jugador: Brier Score, Log Loss, ECE (Expected Calibration Error),
 * sesgo de sobreconfianza y penalizaciones extremas.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const EXPORT_PATH = path.join(ROOT, 'api', 'calibration_audit_report.json');

const TEAM_MARKETS = new Set([
  'Remates al arco de equipo',
  'Goles de equipo',
  'Remates de equipo',
  'Córners de equipo',
  'Tarjetas de equipo'
]);

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function clampProb(p) {
  return Math.min(Math.max(p, 1e-6), 1 - 1e-6);
}

function computeCalibrationStats(items) {
  if (items.length === 0) {
    return { n: 0, won: 0, lost: 0, observedWinRate: null, meanPredProb: null, overconfidenceGap: null, brier: null, brierBaseline: null, logLoss: null, logLossBaseline: null, ece: null, extremeLossPenalties: 0 };
  }
  let won = 0, sumP = 0, brier = 0, brierB = 0, ll = 0, llB = 0, extremeLosses = 0;

  for (const it of items) {
    const y = it.outcome === 'WON' ? 1 : 0;
    if (y === 1) won++;
    const p = clampProb(it.prob);
    const pb = clampProb(1 / it.odds);
    sumP += p;
    brier += (p - y) ** 2;
    brierB += (pb - y) ** 2;
    ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    llB += -(y * Math.log(pb) + (1 - y) * Math.log(1 - pb));
    if (y === 0 && p >= 0.75) extremeLosses++;
  }

  // ECE con 5 bins [0.5-0.6, 0.6-0.7, 0.7-0.8, 0.8-0.9, 0.9-1.0]
  const bins = [
    { label: '<60%', min: 0, max: 0.6, items: [] },
    { label: '60-69%', min: 0.6, max: 0.7, items: [] },
    { label: '70-79%', min: 0.7, max: 0.8, items: [] },
    { label: '80-89%', min: 0.8, max: 0.9, items: [] },
    { label: '>=90%', min: 0.9, max: 1.01, items: [] }
  ];
  for (const it of items) {
    const b = bins.find(x => it.prob >= x.min && it.prob < x.max) || bins[bins.length - 1];
    b.items.push(it);
  }
  let ece = 0;
  const binSummary = [];
  for (const b of bins) {
    if (b.items.length === 0) continue;
    const obs = b.items.filter(x => x.outcome === 'WON').length / b.items.length;
    const pred = b.items.reduce((a, x) => a + x.prob, 0) / b.items.length;
    ece += (b.items.length / items.length) * Math.abs(pred - obs);
    binSummary.push({
      bucket: b.label,
      n: b.items.length,
      meanPredPct: +(pred * 100).toFixed(1),
      observedWinPct: +(obs * 100).toFixed(1),
      gapPct: +((pred - obs) * 100).toFixed(1)
    });
  }

  const obsWR = won / items.length;
  const meanP = sumP / items.length;
  return {
    n: items.length,
    won,
    lost: items.length - won,
    observedWinRate: +(obsWR * 100).toFixed(1),
    meanPredProb: +(meanP * 100).toFixed(1),
    overconfidenceGapPct: +((meanP - obsWR) * 100).toFixed(1),
    brier: +(brier / items.length).toFixed(4),
    brierBaseline: +(brierB / items.length).toFixed(4),
    logLoss: +(ll / items.length).toFixed(4),
    logLossBaseline: +(llB / items.length).toFixed(4),
    ece: +ece.toFixed(4),
    extremeLossPenalties: extremeLosses,
    bins: binSummary
  };
}

class MarketCalibrationAuditor {
  constructor(options = {}) {
    this.exportPath = options.exportPath || EXPORT_PATH;
  }

  run() {
    const historial = readJson(path.join(ROOT, 'historial_picks.json'), { picks: [] });
    const picksHoy = readJson(path.join(ROOT, 'picks_hoy.json'), { top_picks: [] });
    const phMap = new Map((picksHoy.top_picks || []).map(p => [p.id, p]));

    const dataset = [];
    for (const h of (historial.picks || [])) {
      const st = String(h.status || '').toUpperCase();
      if (st !== 'ACERTADA' && st !== 'GANADA' && st !== 'FALLADA' && st !== 'PERDIDA') continue;
      const ph = phMap.get(h.id) || {};
      const odds = Number(h.odds ?? ph.odds ?? NaN);
      const rawProb = ph.real_prob != null ? Number(ph.real_prob) / 100 : (h.real_prob != null ? Number(h.real_prob) / 100 : null);
      if (!Number.isFinite(odds) || odds <= 1.01 || rawProb === null || !Number.isFinite(rawProb) || rawProb <= 0 || rawProb >= 1) continue;

      const market = h.market || ph.market || 'Sin mercado';
      dataset.push({
        id: h.id,
        match: h.match,
        market,
        group: TEAM_MARKETS.has(market) ? 'TEAM_PROPS' : 'PLAYER_PROPS',
        odds,
        prob: rawProb,
        outcome: (st === 'ACERTADA' || st === 'GANADA') ? 'WON' : 'LOST'
      });
    }

    const teamProps = dataset.filter(d => d.group === 'TEAM_PROPS');
    const playerProps = dataset.filter(d => d.group === 'PLAYER_PROPS');

    const byMarket = {};
    for (const d of dataset) {
      if (!byMarket[d.market]) byMarket[d.market] = [];
      byMarket[d.market].push(d);
    }
    const marketReports = {};
    for (const [m, arr] of Object.entries(byMarket)) {
      marketReports[m] = computeCalibrationStats(arr);
    }

    // Diagnóstico específico de los fallos con mayor penalización de Log Loss
    const worstPenalties = dataset
      .filter(d => d.outcome === 'LOST')
      .map(d => ({
        id: d.id,
        match: d.match,
        market: d.market,
        group: d.group,
        odds: d.odds,
        predProbPct: +(d.prob * 100).toFixed(1),
        logLossContribution: +(-Math.log(clampProb(1 - d.prob))).toFixed(3)
      }))
      .sort((a, b) => b.logLossContribution - a.logLossContribution)
      .slice(0, 10);

    const report = {
      generatedAtUtc: new Date().toISOString(),
      mode: 'READ_ONLY_CALIBRATION_AUDIT',
      overall: computeCalibrationStats(dataset),
      byGroup: {
        TEAM_PROPS: computeCalibrationStats(teamProps),
        PLAYER_PROPS: computeCalibrationStats(playerProps)
      },
      byMarket: marketReports,
      worstLogLossPenalties: worstPenalties
    };

    const dir = path.dirname(this.exportPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.exportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = { MarketCalibrationAuditor, computeCalibrationStats, TEAM_MARKETS };
