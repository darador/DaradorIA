/**
 * SHADOW LAB REPORTER (FASE 2.3 — DASHBOARD COMPARATIVO EXPERIMENTAL)
 * Genera métricas comparativas entre los 6 modelos + Baseline Sin Vig del Mercado:
 * - Cantidad de observaciones y progreso hacia meta inicial de 100 liquidaciones.
 * - Hit Rate, ROI (1U), Beneficio Neto, Brier Score, Log Loss, ECE, CLV, Drawdown Máximo.
 * - Desglose por mercado y rango de cuotas con advertencias explícitas de tamaño de muestra.
 */

const shadowLabRunner = require('./shadowLabRunner');

const MODEL_KEYS = [
  'v1_production',
  'v2_corrected',
  'model_b',
  'model_c',
  'beta_binomial',
  'ensemble_v2'
];

const EPS = 1e-3;
const TARGET_SETTLED_MILESTONE = 100;

function clip(p) {
  return Math.min(1 - EPS, Math.max(EPS, p));
}

function sampleWarning(n) {
  if (n < 10) return 'Muestra insuficiente (n < 10)';
  if (n < 30) return 'Muestra baja (10 <= n < 30)';
  if (n < 100) return 'Muestra preliminar (30 <= n < 100)';
  return 'Muestra inicial alcanzada (evaluar significancia estadística)';
}

function evaluateModelOnRecords(records, getProbFn, evThreshold = 0.0) {
  const evaluated = [];
  for (const r of records) {
    const p = getProbFn(r);
    if (typeof p !== 'number' || !Number.isFinite(p)) continue;
    const outcome = r.settlement?.outcome;
    if (outcome !== 'WON' && outcome !== 'LOST') continue;
    const odds = r.preMatchBlock?.oddsAtPrediction?.approvalOdds;
    if (!odds || odds <= 1) continue;
    evaluated.push({
      id: r.predictionId,
      settledAt: r.settlement.settledAtUtc || r.kickoffUtc,
      p,
      y: outcome === 'WON' ? 1 : 0,
      odds,
      clvOddsPct: r.closingOddsSnapshot?.clvOddsPct ?? null,
      clvProbPp: r.closingOddsSnapshot?.clvProbPp ?? null
    });
  }

  const n = evaluated.length;
  if (n === 0) {
    return {
      n: 0,
      hitRatePct: null,
      roiPct: null,
      netProfitU: 0,
      brier: null,
      logLoss: null,
      ecePct: null,
      avgClvOddsPct: null,
      avgClvProbPp: null,
      maxDrawdownU: 0,
      sampleNote: sampleWarning(0)
    };
  }

  let wins = 0, profit = 0, brierSum = 0, llSum = 0;
  let clvOddsSum = 0, clvOddsN = 0, clvProbSum = 0, clvProbN = 0;
  const buckets = [
    { min: 0.0, max: 0.5999, list: [] },
    { min: 0.60, max: 0.6999, list: [] },
    { min: 0.70, max: 0.7999, list: [] },
    { min: 0.80, max: 0.8999, list: [] },
    { min: 0.90, max: 1.0001, list: [] }
  ];

  // Orden cronológico para drawdown
  const chrono = [...evaluated].sort((a, b) => String(a.settledAt).localeCompare(String(b.settledAt)));
  let cum = 0, peak = 0, maxDD = 0;

  for (const x of chrono) {
    const pc = clip(x.p);
    brierSum += Math.pow(x.p - x.y, 2);
    llSum += -(x.y * Math.log(pc) + (1 - x.y) * Math.log(1 - pc));
    const bk = buckets.find(b => x.p >= b.min && x.p <= b.max);
    if (bk) bk.list.push(x);

    const ev = x.p * x.odds - 1;
    if (ev >= evThreshold) {
      if (x.y === 1) {
        wins++;
        profit += (x.odds - 1);
        cum += (x.odds - 1);
      } else {
        profit -= 1;
        cum -= 1;
      }
      if (cum > peak) peak = cum;
      if (peak - cum > maxDD) maxDD = peak - cum;
    }

    if (x.clvOddsPct !== null) { clvOddsSum += x.clvOddsPct; clvOddsN++; }
    if (x.clvProbPp !== null) { clvProbSum += x.clvProbPp; clvProbN++; }
  }

  let ece = 0;
  for (const b of buckets) {
    if (b.list.length > 0) {
      const avgP = b.list.reduce((s, z) => s + z.p, 0) / b.list.length;
      const obsP = b.list.reduce((s, z) => s + z.y, 0) / b.list.length;
      ece += (b.list.length / n) * Math.abs(obsP - avgP);
    }
  }

  return {
    n,
    hitRatePct: Number(((wins / n) * 100).toFixed(1)),
    roiPct: Number(((profit / n) * 100).toFixed(1)),
    netProfitU: Number(profit.toFixed(2)),
    brier: Number((brierSum / n).toFixed(4)),
    logLoss: Number((llSum / n).toFixed(4)),
    ecePct: Number((ece * 100).toFixed(2)),
    avgClvOddsPct: clvOddsN > 0 ? Number((clvOddsSum / clvOddsN).toFixed(2)) : null,
    avgClvProbPp: clvProbN > 0 ? Number((clvProbSum / clvProbN).toFixed(2)) : null,
    maxDrawdownU: Number(maxDD.toFixed(2)),
    sampleNote: sampleWarning(n)
  };
}

class ShadowLabReporter {
  constructor(runner = shadowLabRunner) {
    this.runner = runner;
  }

  generateReport() {
    const records = this.runner._readAll();
    const integrity = this.runner.verifyAllHashes();

    const settledWon = records.filter(r => r.settlement?.outcome === 'WON').length;
    const settledLost = records.filter(r => r.settlement?.outcome === 'LOST').length;
    const settledVoid = records.filter(r => r.settlement?.outcome === 'VOID').length;
    const pending = records.filter(r => r.settlement?.status !== 'SETTLED').length;
    const settledWL = settledWon + settledLost;
    const withClosing = records.filter(r => r.closingOddsSnapshot?.closingOdds !== null).length;

    // Comparación de los 6 modelos + baseline mercado sin vig
    const modelsComparison = {};
    for (const k of MODEL_KEYS) {
      modelsComparison[k] = evaluateModelOnRecords(
        records,
        r => (r.preMatchBlock?.models?.[k]?.available ? r.preMatchBlock.models[k].prob : null),
        -1.0 // Evalúa el universo completo de predicciones disponibles de cada modelo con stake 1U
      );
    }
    modelsComparison.market_novig_baseline = evaluateModelOnRecords(
      records,
      r => r.preMatchBlock?.oddsAtPrediction?.marketNoVigProb ?? null,
      -1.0
    );

    // Desglose por mercado (usando ensemble_v2 y v1_production como referencia)
    const markets = [...new Set(records.map(r => r.preMatchBlock?.market || 'Sin mercado'))];
    const byMarket = markets.map(m => {
      const sub = records.filter(r => (r.preMatchBlock?.market || 'Sin mercado') === m);
      return {
        market: m,
        totalObservations: sub.length,
        v1: evaluateModelOnRecords(sub, r => (r.preMatchBlock?.models?.v1_production?.available ? r.preMatchBlock.models.v1_production.prob : null), -1.0),
        ensemble_v2: evaluateModelOnRecords(sub, r => (r.preMatchBlock?.models?.ensemble_v2?.available ? r.preMatchBlock.models.ensemble_v2.prob : null), -1.0)
      };
    });

    // Desglose por rango de cuotas
    const oddsRangeOf = (o) => {
      if (!o) return 'Sin cuota';
      if (o < 1.50) return '< 1.50';
      if (o < 1.70) return '1.50 - 1.69';
      if (o < 1.90) return '1.70 - 1.89';
      if (o < 2.20) return '1.90 - 2.19';
      return '>= 2.20';
    };
    const ranges = [...new Set(records.map(r => oddsRangeOf(r.preMatchBlock?.oddsAtPrediction?.approvalOdds)))];
    const byOddsRange = ranges.map(rng => {
      const sub = records.filter(r => oddsRangeOf(r.preMatchBlock?.oddsAtPrediction?.approvalOdds) === rng);
      return {
        oddsRange: rng,
        totalObservations: sub.length,
        v1: evaluateModelOnRecords(sub, r => (r.preMatchBlock?.models?.v1_production?.available ? r.preMatchBlock.models.v1_production.prob : null), -1.0),
        ensemble_v2: evaluateModelOnRecords(sub, r => (r.preMatchBlock?.models?.ensemble_v2?.available ? r.preMatchBlock.models.ensemble_v2.prob : null), -1.0)
      };
    });

    return {
      generatedAtUtc: new Date().toISOString(),
      shadowMode: true,
      integrity,
      progress: {
        totalObservations: records.length,
        settledWL,
        settledWon,
        settledLost,
        settledVoid,
        pending,
        withClosingOdds: withClosing,
        milestoneTarget: TARGET_SETTLED_MILESTONE,
        milestoneProgressPct: Number(Math.min(100, (settledWL / TARGET_SETTLED_MILESTONE) * 100).toFixed(1)),
        milestoneNote: '100 observaciones liquidadas es un hito inicial de auditoría, no una garantía automática de significancia estadística.'
      },
      modelsComparison,
      byMarket,
      byOddsRange
    };
  }
}

module.exports = ShadowLabReporter;
