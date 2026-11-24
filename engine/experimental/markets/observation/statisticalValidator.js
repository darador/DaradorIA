/**
 * FASE 9.1 — STATISTICAL VALIDATOR HARDENED
 *
 * Correcciones implementadas:
 *  - Distinción explícita: rawObservationCount, decidedObservationCount, uniqueMatchCount,
 *    effectiveSampleSize e independentClusterCount.
 *  - classifySampleSize() utiliza partidos independientes (uniqueMatchCount), nunca selecciones brutas.
 *  - Intervalos de confianza 95% de Hit Rate y ROI calculados mediante Cluster Bootstrap por matchId
 *    (devuelve INSUFFICIENT_CLUSTERS si independentClusterCount < 2). Wilson CI queda etiquetado
 *    explícitamente como independiente y se omite (null) cuando hay múltiples selecciones por partido.
 *  - Separación temporal OOS estricta (maxTrainKo < minValKo y maxValKo < minEvalKo) agrupando
 *    eventos con idéntico kickoffUtc en el mismo bloque; devuelve OUT_OF_SAMPLE_NOT_AVAILABLE si no
 *    puede garantizarse separación estricta.
 *  - Baseline multiclase 3-way real para 1X2 usando vector noVig1X2 { home, draw, away } (suma 1 ± 1e-3);
 *    devuelve BASELINE_UNAVAILABLE si faltan las 3 probabilidades comparables.
 */

'use strict';

const EPS = 1e-6;
const Z_95 = 1.959963984540054;
const DECIDED_STATUSES = new Set(['WON', 'LOST', 'HALF_WON', 'HALF_LOST']);

function clampProb(p) {
  return Math.min(1 - EPS, Math.max(EPS, Number(p)));
}

function round(v, d = 5) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function isValid3WayVec(vec) {
  if (!vec || typeof vec !== 'object') return false;
  const h = Number(vec.home);
  const d = Number(vec.draw);
  const a = Number(vec.away);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a)) return false;
  if (h <= 0 || d <= 0 || a <= 0 || h >= 1 || d >= 1 || a >= 1) return false;
  return Math.abs((h + d + a) - 1.0) <= 1e-3;
}

/**
 * Clasificador oficial de volumen de muestra basado en partidos independientes (uniqueMatchCount).
 */
function classifySampleSize(independentMatches) {
  if (independentMatches < 30) return 'INSUFFICIENT_SAMPLE';
  if (independentMatches < 100) return 'PRELIMINARY_SAMPLE';
  if (independentMatches < 300) return 'DEVELOPING_EVIDENCE';
  return 'STRONGER_EVIDENCE';
}

/**
 * Intervalo de confianza de Wilson al 95% SOLO para ensayos verdaderamente independientes.
 */
function wilsonCI95(successes, trials) {
  if (!trials || trials <= 0) return null;
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half = (Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / denom;
  return {
    method: 'wilson_independent_trials_only',
    lowPct: round(Math.max(0, center - half) * 100, 2),
    highPct: round(Math.min(1, center + half) * 100, 2)
  };
}

/**
 * Intervalo de confianza al 95% para ROI (solo si las observaciones son independientes).
 */
function roiCI95(profits) {
  const n = profits.length;
  if (n < 2) return null;
  const mean = profits.reduce((a, b) => a + b, 0) / n;
  const variance = profits.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return {
    method: 'normal_independent_trials_only',
    lowPct: round((mean - Z_95 * se) * 100, 2),
    highPct: round((mean + Z_95 * se) * 100, 2)
  };
}

function mulberry32(seed = 42) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cluster Bootstrap por partido (matchId):
 * Remuestrea partidos completos con reemplazo para preservar correlación intra-partido.
 */
function clusterBootstrapDiffCI(items, metricFn, { iterations = 500, seed = 2026 } = {}) {
  if (!Array.isArray(items) || items.length < 2) {
    return { available: false, reason: 'INSUFFICIENT_CLUSTERS', clusterCount: 0 };
  }

  const byMatch = new Map();
  for (const item of items) {
    const key = String(item.matchId || item.observationId);
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key).push(item);
  }
  const clusters = Array.from(byMatch.values());
  const k = clusters.length;
  if (k < 2) {
    return { available: false, clusterCount: k, reason: 'INSUFFICIENT_CLUSTERS' };
  }

  const rng = mulberry32(seed);
  const vals = [];
  for (let b = 0; b < iterations; b++) {
    const sample = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(rng() * k);
      sample.push(...clusters[idx]);
    }
    const v = metricFn(sample);
    if (Number.isFinite(v)) vals.push(v);
  }

  if (vals.length < 10) {
    return { available: false, clusterCount: k, reason: 'BOOTSTRAP_NO_CONVERGENTE' };
  }

  vals.sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * vals.length);
  const hiIdx = Math.min(vals.length - 1, Math.floor(0.975 * vals.length));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;

  return {
    available: true,
    method: 'cluster_bootstrap_by_matchId',
    clusterCount: k,
    observationCount: items.length,
    iterations: vals.length,
    meanDiff: round(mean, 5),
    ci95Low: round(vals[loIdx], 5),
    ci95High: round(vals[hiIdx], 5),
    includesZero: vals[loIdx] <= 0 && vals[hiIdx] >= 0
  };
}

function computeCalibrationBins(binaryObs) {
  const edges = [
    { label: '0.00-0.20', min: 0.0, max: 0.2 },
    { label: '0.20-0.40', min: 0.2, max: 0.4 },
    { label: '0.40-0.60', min: 0.4, max: 0.6 },
    { label: '0.60-0.80', min: 0.6, max: 0.8 },
    { label: '0.80-1.00', min: 0.8, max: 1.00001 }
  ];

  const bins = edges.map(e => ({
    interval: e.label,
    count: 0,
    predictedAvg: null,
    observedFreq: null,
    calibrationError: null,
    _predSum: 0,
    _obsSum: 0
  }));

  for (const o of binaryObs) {
    const p = clampProb(o.modelProbability);
    const y = o.status === 'WON' ? 1 : (o.status === 'HALF_WON' ? 0.75 : (o.status === 'HALF_LOST' ? 0.25 : 0));
    const idx = Math.min(4, Math.max(0, Math.floor(p / 0.2)));
    bins[idx].count++;
    bins[idx]._predSum += p;
    bins[idx]._obsSum += y;
  }

  let ece = 0;
  const total = binaryObs.length;
  for (const b of bins) {
    if (b.count > 0) {
      const pAvg = b._predSum / b.count;
      const oFreq = b._obsSum / b.count;
      b.predictedAvg = round(pAvg, 4);
      b.observedFreq = round(oFreq, 4);
      b.calibrationError = round(pAvg - oFreq, 4);
      ece += (b.count / total) * Math.abs(pAvg - oFreq);
    }
    delete b._predSum;
    delete b._obsSum;
  }

  return {
    bins,
    expectedCalibrationError: total > 0 ? round(ece, 5) : null
  };
}

function outcomeProfit(o) {
  if (Number.isFinite(Number(o.settlement?.profitUnits))) return Number(o.settlement.profitUnits);
  if (o.status === 'WON') return Number(o.odds) - 1;
  if (o.status === 'HALF_WON') return (Number(o.odds) - 1) / 2;
  if (o.status === 'HALF_LOST') return -0.5;
  if (o.status === 'LOST') return -1;
  return 0;
}

/**
 * Evalúa un conjunto homogéneo de observaciones (misma familia de mercado).
 * Nunca infla N ni los IC cuando hay múltiples selecciones del mismo partido.
 */
function evaluateFamilySlice(observations, marketFamily, { bootstrapIterations = 400 } = {}) {
  const familyObs = observations.filter(o => o.marketFamily === marketFamily);
  const decided = familyObs.filter(o => DECIDED_STATUSES.has(o.status));
  const settledAll = familyObs.filter(o => DECIDED_STATUSES.has(o.status) || o.status === 'VOID' || o.status === 'PUSH');
  const pendingCount = familyObs.filter(o => o.status === 'PENDING').length;

  const wonCount = decided.filter(o => o.status === 'WON').length;
  const halfWonCount = decided.filter(o => o.status === 'HALF_WON').length;
  const lostCount = decided.filter(o => o.status === 'LOST').length;
  const halfLostCount = decided.filter(o => o.status === 'HALF_LOST').length;
  const voidCount = familyObs.filter(o => o.status === 'VOID').length;
  const pushCount = familyObs.filter(o => o.status === 'PUSH').length;

  const rawObservationCount = familyObs.length;
  const decidedObservationCount = decided.length;
  const uniqueMatchCount = new Set(decided.map(o => o.matchId)).size;
  const totalUniqueMatches = new Set(familyObs.map(o => o.matchId)).size;
  const effectiveSampleSize = uniqueMatchCount;
  const independentClusterCount = uniqueMatchCount;
  const isClusteredSample = decidedObservationCount > uniqueMatchCount;

  const profits = decided.map(outcomeProfit);
  const cumProfit = profits.reduce((a, b) => a + b, 0);
  const avgOdds = decided.length > 0 ? decided.reduce((a, o) => a + Number(o.odds), 0) / decided.length : null;
  const winEquiv = wonCount + 0.5 * halfWonCount;

  // IC 95% por Cluster Bootstrap (respetando correlación por matchId)
  const hrClusterBoot = clusterBootstrapDiffCI(
    decided,
    (sample) => {
      const w = sample.reduce((acc, o) => acc + (o.status === 'WON' ? 1 : (o.status === 'HALF_WON' ? 0.5 : 0)), 0);
      return (w / sample.length) * 100;
    },
    { iterations: bootstrapIterations, seed: 101 }
  );

  const roiClusterBoot = clusterBootstrapDiffCI(
    decided,
    (sample) => {
      const p = sample.reduce((acc, o) => acc + outcomeProfit(o), 0);
      return (p / sample.length) * 100;
    },
    { iterations: bootstrapIterations, seed: 202 }
  );

  const hitRateCI95 = hrClusterBoot.available
    ? { method: 'cluster_bootstrap_by_matchId', clusterCount: hrClusterBoot.clusterCount, lowPct: round(hrClusterBoot.ci95Low, 2), highPct: round(hrClusterBoot.ci95High, 2) }
    : { available: false, reason: 'INSUFFICIENT_CLUSTERS', clusterCount: independentClusterCount };

  const roiCI95Clustered = roiClusterBoot.available
    ? { method: 'cluster_bootstrap_by_matchId', clusterCount: roiClusterBoot.clusterCount, lowPct: round(roiClusterBoot.ci95Low, 2), highPct: round(roiClusterBoot.ci95High, 2) }
    : { available: false, reason: 'INSUFFICIENT_CLUSTERS', clusterCount: independentClusterCount };

  // Calidad de mercado (CLV y edge vs no-vig)
  const clvObs = familyObs.filter(o => o.clv?.status === 'CLV_AVAILABLE' && Number.isFinite(o.clv.clvPct));
  const avgClvPct = clvObs.length > 0 ? clvObs.reduce((a, o) => a + o.clv.clvPct, 0) / clvObs.length : null;
  const positiveClvPct = clvObs.length > 0 ? (clvObs.filter(o => o.clv.clvPct > 0).length / clvObs.length) * 100 : null;

  const noVigDiffs = familyObs
    .filter(o => Number.isFinite(o.noVigProbability))
    .map(o => o.modelProbability - o.noVigProbability);
  const avgModelMinusNoVig = noVigDiffs.length > 0
    ? noVigDiffs.reduce((a, b) => a + b, 0) / noVigDiffs.length
    : null;

  // Métricas predictivas (multiclase para 1X2, binario para el resto)
  let predictive;
  if (marketFamily === 'match_1x2') {
    let brierSum = 0;
    let logLossSum = 0;
    let correctArgmax = 0;
    let validMulti = 0;
    const confusion = {
      '1': { '1': 0, 'X': 0, '2': 0 },
      'X': { '1': 0, 'X': 0, '2': 0 },
      '2': { '1': 0, 'X': 0, '2': 0 }
    };

    for (const o of decided) {
      const p1x2 = o.probabilities1X2;
      const actual = o.settlement?.actual1X2;
      if (!p1x2 || !actual) continue;
      const pMap = {
        '1': clampProb(p1x2.home),
        'X': clampProb(p1x2.draw),
        '2': clampProb(p1x2.away)
      };
      logLossSum += -Math.log(pMap[actual]);
      brierSum += ['1', 'X', '2'].reduce((acc, k) => acc + Math.pow(pMap[k] - (actual === k ? 1 : 0), 2), 0);
      const predictedClass = Object.entries(pMap).sort((a, b) => b[1] - a[1])[0][0];
      if (predictedClass === actual) correctArgmax++;
      if (confusion[actual] && confusion[actual][predictedClass] !== undefined) {
        confusion[actual][predictedClass]++;
      }
      validMulti++;
    }

    predictive = {
      metricType: 'MULTICLASS_3WAY',
      brierScore: validMulti > 0 ? round(brierSum / validMulti, 5) : null,
      logLoss: validMulti > 0 ? round(logLossSum / validMulti, 5) : null,
      accuracyPct: validMulti > 0 ? round((correctArgmax / validMulti) * 100, 2) : null,
      confusionMatrix: confusion,
      evaluatedCount: validMulti
    };
  } else {
    let brierSum = 0;
    let logLossSum = 0;
    let accCorrect = 0;
    for (const o of decided) {
      const p = clampProb(o.modelProbability);
      const y = o.status === 'WON' ? 1 : (o.status === 'HALF_WON' ? 0.75 : (o.status === 'HALF_LOST' ? 0.25 : 0));
      brierSum += Math.pow(p - y, 2);
      logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      if ((p >= 0.5 && y >= 0.5) || (p < 0.5 && y < 0.5)) accCorrect++;
    }

    predictive = {
      metricType: 'BINARY',
      brierScore: decided.length > 0 ? round(brierSum / decided.length, 5) : null,
      logLoss: decided.length > 0 ? round(logLossSum / decided.length, 5) : null,
      accuracyPct: decided.length > 0 ? round((accCorrect / decided.length) * 100, 2) : null,
      confusionMatrix: null,
      evaluatedCount: decided.length
    };
  }

  // Sesgos por liga o período
  const skewWarnings = [];
  if (uniqueMatchCount >= 10) {
    const byLeague = {};
    const byMonth = {};
    const seenMatches = new Set();
    for (const o of decided) {
      if (seenMatches.has(o.matchId)) continue;
      seenMatches.add(o.matchId);
      byLeague[o.league] = (byLeague[o.league] || 0) + 1;
      const m = String(o.kickoffUtc || '').slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + 1;
    }
    for (const [lg, cnt] of Object.entries(byLeague)) {
      if (cnt / uniqueMatchCount > 0.60) {
        skewWarnings.push(`Sesgo de liga: ${lg} concentra ${Math.round((cnt / uniqueMatchCount) * 100)}% de los partidos.`);
      }
    }
    for (const [mo, cnt] of Object.entries(byMonth)) {
      if (cnt / uniqueMatchCount > 0.60) {
        skewWarnings.push(`Sesgo temporal: ${mo} concentra ${Math.round((cnt / uniqueMatchCount) * 100)}% de los partidos.`);
      }
    }
  }

  // Clasificación basada EXCLUSIVAMENTE en partidos independientes (uniqueMatchCount)
  const sampleStatus = classifySampleSize(effectiveSampleSize);
  const calibration = computeCalibrationBins(decided);

  return {
    marketFamily,
    totalObservations: rawObservationCount,
    rawObservationCount,
    decidedObservationCount,
    uniqueMatches: totalUniqueMatches,
    uniqueMatchCount,
    effectiveSampleSize,
    independentClusterCount,
    isClusteredSample,
    pendingCount,
    counts: {
      won: wonCount,
      halfWon: halfWonCount,
      lost: lostCount,
      halfLost: halfLostCount,
      void: voidCount,
      push: pushCount,
      decided: decidedObservationCount,
      settledAll: settledAll.length
    },
    sampleStatus,
    sampleWarning: sampleStatus === 'INSUFFICIENT_SAMPLE'
      ? `Muestra insuficiente (partidos independientes=${effectiveSampleSize} < 30; obs decididas=${decidedObservationCount}). No usar indicadores verdes de rentabilidad.`
      : null,
    skewWarnings,
    predictive,
    profitability: {
      simulatedBets: decidedObservationCount,
      hitRatePct: decidedObservationCount > 0 ? round((winEquiv / decidedObservationCount) * 100, 2) : null,
      hitRateCI95,
      wilsonCI95_IndependentOnly: !isClusteredSample ? wilsonCI95(wonCount, decidedObservationCount) : null,
      avgOdds: round(avgOdds, 3),
      cumulativeProfitUnits: round(cumProfit, 4),
      roiPct: decidedObservationCount > 0 ? round((cumProfit / decidedObservationCount) * 100, 2) : null,
      roiCI95: roiCI95Clustered,
      yieldPct: decidedObservationCount > 0 ? round((cumProfit / decidedObservationCount) * 100, 2) : null
    },
    marketQuality: {
      clvSampleCount: clvObs.length,
      avgClvPct: round(avgClvPct, 3),
      positiveClvRatePct: round(positiveClvPct, 2),
      avgModelMinusNoVig: round(avgModelMinusNoVig, 5)
    },
    calibration
  };
}

/**
 * Comparación contra Baselines sobre EXACTAMENTE las mismas observaciones.
 * Para match_1x2 usa Brier y Log Loss MULTICLASE 3-way con noVig1X2 { home, draw, away }
 * y marca BASELINE_UNAVAILABLE si faltan las 3 probabilidades comparables.
 */
function compareAgainstBaselines(observations, marketFamily, { previousVersionObs = null, bootstrapIterations = 400 } = {}) {
  const decided = observations
    .filter(o => o.marketFamily === marketFamily && DECIDED_STATUSES.has(o.status))
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));

  const binaryBrier = (p, y) => Math.pow(clampProb(p) - y, 2);
  const binaryLL = (p, y) => -(y * Math.log(clampProb(p)) + (1 - y) * Math.log(1 - clampProb(p)));
  const multiBrier = (vec, actual) => ['1', 'X', '2'].reduce((acc, k) => {
    const p = clampProb(k === '1' ? vec.home : (k === 'X' ? vec.draw : vec.away));
    return acc + Math.pow(p - (actual === k ? 1 : 0), 2);
  }, 0);
  const multiLL = (vec, actual) => {
    const p = clampProb(actual === '1' ? vec.home : (actual === 'X' ? vec.draw : vec.away));
    return -Math.log(p);
  };

  // 1. Baseline: Probabilidad implícita de mercado sin margen
  let vsMarketNoVig;
  if (marketFamily === 'match_1x2') {
    const comparable = decided.filter(o =>
      isValid3WayVec(o.probabilities1X2) &&
      isValid3WayVec(o.noVig1X2) &&
      ['1', 'X', '2'].includes(o.settlement?.actual1X2)
    );
    if (comparable.length === 0) {
      vsMarketNoVig = {
        available: false,
        status: 'BASELINE_UNAVAILABLE',
        metricType: 'MULTICLASS_3WAY',
        comparableCount: 0,
        reason: 'Faltan vectores completos noVig1X2 { home, draw, away } (suma 1) o probabilities1X2 para comparación multiclase 1X2.'
      };
    } else {
      const mB = comparable.reduce((a, o) => a + multiBrier(o.probabilities1X2, o.settlement.actual1X2), 0) / comparable.length;
      const bB = comparable.reduce((a, o) => a + multiBrier(o.noVig1X2, o.settlement.actual1X2), 0) / comparable.length;
      const mL = comparable.reduce((a, o) => a + multiLL(o.probabilities1X2, o.settlement.actual1X2), 0) / comparable.length;
      const bL = comparable.reduce((a, o) => a + multiLL(o.noVig1X2, o.settlement.actual1X2), 0) / comparable.length;

      const bootBrier = clusterBootstrapDiffCI(
        comparable,
        (sample) => {
          const mm = sample.reduce((a, o) => a + multiBrier(o.probabilities1X2, o.settlement.actual1X2), 0) / sample.length;
          const bb = sample.reduce((a, o) => a + multiBrier(o.noVig1X2, o.settlement.actual1X2), 0) / sample.length;
          return mm - bb;
        },
        { iterations: bootstrapIterations }
      );

      vsMarketNoVig = {
        available: true,
        status: 'AVAILABLE',
        metricType: 'MULTICLASS_3WAY',
        comparableCount: comparable.length,
        modelBrier: round(mB, 5),
        baselineBrier: round(bB, 5),
        deltaBrier: round(mB - bB, 5),
        modelLogLoss: round(mL, 5),
        baselineLogLoss: round(bL, 5),
        deltaLogLoss: round(mL - bL, 5),
        clusterBootstrapBrierDiff: bootBrier
      };
    }
  } else {
    const withNoVig = decided.filter(o => Number.isFinite(o.noVigProbability));
    if (withNoVig.length === 0) {
      vsMarketNoVig = { available: false, status: 'BASELINE_UNAVAILABLE', metricType: 'BINARY', comparableCount: 0, reason: 'SIN_OBSERVACIONES_CON_NOVIG' };
    } else {
      const mB = withNoVig.reduce((a, o) => a + binaryBrier(o.modelProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;
      const bB = withNoVig.reduce((a, o) => a + binaryBrier(o.noVigProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;
      const mL = withNoVig.reduce((a, o) => a + binaryLL(o.modelProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;
      const bL = withNoVig.reduce((a, o) => a + binaryLL(o.noVigProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;

      const bootBrier = clusterBootstrapDiffCI(
        withNoVig,
        (sample) => {
          const mm = sample.reduce((a, o) => a + binaryBrier(o.modelProbability, o.status === 'WON' ? 1 : 0), 0) / sample.length;
          const bb = sample.reduce((a, o) => a + binaryBrier(o.noVigProbability, o.status === 'WON' ? 1 : 0), 0) / sample.length;
          return mm - bb;
        },
        { iterations: bootstrapIterations }
      );

      vsMarketNoVig = {
        available: true,
        status: 'AVAILABLE',
        metricType: 'BINARY',
        comparableCount: withNoVig.length,
        modelBrier: round(mB, 5),
        baselineBrier: round(bB, 5),
        deltaBrier: round(mB - bB, 5),
        modelLogLoss: round(mL, 5),
        baselineLogLoss: round(bL, 5),
        deltaLogLoss: round(mL - bL, 5),
        clusterBootstrapBrierDiff: bootBrier
      };
    }
  }

  // 2. Baseline: Base Rate histórico estrictamente anterior al evento (zero lookahead)
  const baseRatePairs = [];
  for (let i = 0; i < decided.length; i++) {
    const cur = decided[i];
    const curKo = Date.parse(cur.kickoffUtc);
    const prior = decided.filter(p => Date.parse(p.kickoffUtc) < curKo);
    if (prior.length === 0) continue;
    const priorRate = prior.filter(p => p.status === 'WON').length / prior.length;
    baseRatePairs.push({ obs: cur, priorRate, matchId: cur.matchId, observationId: cur.observationId });
  }

  let vsHistoricalBaseRate = { comparableCount: baseRatePairs.length, available: false, status: 'BASELINE_UNAVAILABLE', reason: 'SIN_HISTORICO_ANTERIOR' };
  if (baseRatePairs.length > 0) {
    const modelBrier = baseRatePairs.reduce((a, x) => a + binaryBrier(x.obs.modelProbability, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;
    const baseBrier = baseRatePairs.reduce((a, x) => a + binaryBrier(x.priorRate, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;
    const modelLL = baseRatePairs.reduce((a, x) => a + binaryLL(x.obs.modelProbability, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;
    const baseLL = baseRatePairs.reduce((a, x) => a + binaryLL(x.priorRate, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;

    vsHistoricalBaseRate = {
      available: true,
      status: 'AVAILABLE',
      comparableCount: baseRatePairs.length,
      modelBrier: round(modelBrier, 5),
      baselineBrier: round(baseBrier, 5),
      deltaBrier: round(modelBrier - baseBrier, 5),
      modelLogLoss: round(modelLL, 5),
      baselineLogLoss: round(baseLL, 5),
      deltaLogLoss: round(modelLL - baseLL, 5)
    };
  }

  // 3. Baseline: Versión anterior del modelo (emparejada por matchId + selection)
  let vsPreviousVersion = { comparableCount: 0, available: false, status: 'BASELINE_UNAVAILABLE', reason: 'SIN_VERSION_ANTERIOR_COMPARABLE' };
  if (Array.isArray(previousVersionObs) && previousVersionObs.length > 0) {
    const prevMap = new Map();
    for (const p of previousVersionObs) {
      if (p.marketFamily === marketFamily && DECIDED_STATUSES.has(p.status)) {
        prevMap.set(`${p.matchId}__${p.selection}`, p);
      }
    }
    const matched = [];
    for (const cur of decided) {
      const prev = prevMap.get(`${cur.matchId}__${cur.selection}`);
      if (prev) matched.push({ cur, prev, matchId: cur.matchId, observationId: cur.observationId });
    }
    if (matched.length > 0) {
      const mBrier = matched.reduce((a, x) => a + binaryBrier(x.cur.modelProbability, x.cur.status === 'WON' ? 1 : 0), 0) / matched.length;
      const pBrier = matched.reduce((a, x) => a + binaryBrier(x.prev.modelProbability, x.prev.status === 'WON' ? 1 : 0), 0) / matched.length;
      const mLL = matched.reduce((a, x) => a + binaryLL(x.cur.modelProbability, x.cur.status === 'WON' ? 1 : 0), 0) / matched.length;
      const pLL = matched.reduce((a, x) => a + binaryLL(x.prev.modelProbability, x.prev.status === 'WON' ? 1 : 0), 0) / matched.length;
      const mRoi = (matched.reduce((a, x) => a + outcomeProfit(x.cur), 0) / matched.length) * 100;
      const pRoi = (matched.reduce((a, x) => a + outcomeProfit(x.prev), 0) / matched.length) * 100;

      const curClv = matched.map(x => x.cur.clv?.clvPct).filter(Number.isFinite);
      const prevClv = matched.map(x => x.prev.clv?.clvPct).filter(Number.isFinite);
      const deltaClv = (curClv.length > 0 && prevClv.length > 0)
        ? round((curClv.reduce((a, b) => a + b, 0) / curClv.length) - (prevClv.reduce((a, b) => a + b, 0) / prevClv.length), 3)
        : null;

      vsPreviousVersion = {
        available: true,
        status: 'AVAILABLE',
        comparableCount: matched.length,
        deltaBrier: round(mBrier - pBrier, 5),
        deltaLogLoss: round(mLL - pLL, 5),
        deltaRoiPct: round(mRoi - pRoi, 2),
        deltaClvPct: deltaClv
      };
    }
  }

  return {
    marketFamily,
    vsMarketNoVig,
    vsHistoricalBaseRate,
    vsPreviousVersion
  };
}

/**
 * Validación temporal estricta fuera de muestra (Sección 6 Fase 9.1):
 * Agrupa por timestamp exacto de kickoffUtc para que eventos simultáneos NUNCA se dividan
 * entre train y validation ni entre validation y evaluation.
 * Garantiza estrictamente: maxTrainKo < minValKo y (si hay eval) maxValKo < minEvalKo.
 */
function runStrictTemporalOutOfSampleSplit(observations, marketFamily, {
  minTrainCount = 20,
  minValCount = 10,
  trainRatio = 0.60,
  valRatio = 0.20
} = {}) {
  const valid = observations
    .filter(o => o.marketFamily === marketFamily && DECIDED_STATUSES.has(o.status) && o.kickoffUtc && Number.isFinite(Date.parse(o.kickoffUtc)))
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));

  if (valid.length < minTrainCount + minValCount) {
    return {
      status: 'OUT_OF_SAMPLE_NOT_AVAILABLE',
      reason: `Histórico insuficiente para partición temporal estricta (N=${valid.length} < mínimo ${minTrainCount + minValCount}).`,
      totalAvailable: valid.length
    };
  }

  // Agrupar todos los eventos con idéntico kickoffUtc en un bloque atómico indivisible
  const timeBuckets = [];
  for (const o of valid) {
    const ts = Date.parse(o.kickoffUtc);
    const last = timeBuckets[timeBuckets.length - 1];
    if (last && last.ts === ts) last.items.push(o);
    else timeBuckets.push({ ts, iso: o.kickoffUtc, items: [o] });
  }

  if (timeBuckets.length < 2) {
    return {
      status: 'OUT_OF_SAMPLE_NOT_AVAILABLE',
      reason: 'Todos los eventos comparten el mismo kickoffUtc; imposible garantizar separación temporal estricta (maxTrainKo < minValKo).',
      totalAvailable: valid.length
    };
  }

  const targetTrain = Math.max(minTrainCount, Math.floor(valid.length * trainRatio));
  const targetVal = Math.max(minValCount, Math.floor(valid.length * valRatio));

  const trainSet = [];
  const valSet = [];
  const evalSet = [];

  let phase = 'train';
  let remaining = valid.length;
  for (let i = 0; i < timeBuckets.length; i++) {
    const bucket = timeBuckets[i];
    const nextBucket = timeBuckets[i + 1];
    remaining -= bucket.items.length;

    if (phase === 'train') {
      trainSet.push(...bucket.items);
      const nextWouldStarveVal = nextBucket && (remaining - nextBucket.items.length < minValCount);
      if (trainSet.length >= targetTrain || (trainSet.length >= minTrainCount && nextWouldStarveVal)) {
        phase = 'validation';
      }
    } else if (phase === 'validation') {
      valSet.push(...bucket.items);
      if (valSet.length >= targetVal) phase = 'evaluation';
    } else {
      evalSet.push(...bucket.items);
    }
  }

  if (trainSet.length < minTrainCount || valSet.length < minValCount) {
    return {
      status: 'OUT_OF_SAMPLE_NOT_AVAILABLE',
      reason: `No se pudo formar train (${trainSet.length}/${minTrainCount}) y validation (${valSet.length}/${minValCount}) sin partir partidos simultáneos.`,
      totalAvailable: valid.length
    };
  }

  const maxTrainKo = Date.parse(trainSet[trainSet.length - 1].kickoffUtc);
  const minValKo = Date.parse(valSet[0].kickoffUtc);
  const maxValKo = Date.parse(valSet[valSet.length - 1].kickoffUtc);
  const minEvalKo = evalSet.length > 0 ? Date.parse(evalSet[0].kickoffUtc) : null;

  const trainBeforeVal = maxTrainKo < minValKo;
  const valBeforeEval = minEvalKo === null || maxValKo < minEvalKo;
  const temporalIntegrityOk = trainBeforeVal && valBeforeEval;

  if (!temporalIntegrityOk) {
    return {
      status: 'OUT_OF_SAMPLE_NOT_AVAILABLE',
      reason: 'Fallo de separación temporal estricta entre bloques.',
      totalAvailable: valid.length
    };
  }

  // Parámetros estimados EXCLUSIVAMENTE sobre trainSet
  const trainPredAvg = trainSet.reduce((a, o) => a + o.modelProbability, 0) / trainSet.length;
  const trainObsRate = trainSet.filter(o => o.status === 'WON').length / trainSet.length;
  const calibrationShiftLearnedOnTrain = round(trainObsRate - trainPredAvg, 5);
  const parameterVersion = `oos-cal-trainN${trainSet.length}-${trainSet[trainSet.length - 1].kickoffUtc.slice(0, 10)}`;

  return {
    status: 'OUT_OF_SAMPLE_AVAILABLE',
    temporalIntegrityOk: true,
    parameterVersion,
    calibrationShiftLearnedOnTrain,
    splits: {
      train: {
        count: trainSet.length,
        fromUtc: trainSet[0].kickoffUtc,
        toUtc: trainSet[trainSet.length - 1].kickoffUtc,
        metrics: evaluateFamilySlice(trainSet, marketFamily)
      },
      validation: {
        count: valSet.length,
        fromUtc: valSet[0].kickoffUtc,
        toUtc: valSet[valSet.length - 1].kickoffUtc,
        metrics: evaluateFamilySlice(valSet, marketFamily)
      },
      evaluation: evalSet.length > 0 ? {
        count: evalSet.length,
        fromUtc: evalSet[0].kickoffUtc,
        toUtc: evalSet[evalSet.length - 1].kickoffUtc,
        metrics: evaluateFamilySlice(evalSet, marketFamily)
      } : { count: 0, status: 'PENDING_MORE_DATA' }
    }
  };
}

function sliceObservations(observations, dimension, filters = {}) {
  const filtered = observations.filter(o => {
    if (filters.league && o.league !== filters.league) return false;
    if (filters.season && o.season !== filters.season) return false;
    if (filters.marketFamily && o.marketFamily !== filters.marketFamily) return false;
    if (filters.market && o.market !== filters.market) return false;
    if (filters.modelName && o.modelName !== filters.modelName) return false;
    if (filters.modelVersion && o.modelVersion !== filters.modelVersion) return false;
    if (filters.dataQualityTier && o.dataQualityTier !== filters.dataQualityTier) return false;
    if (filters.bookmaker && o.bookmaker !== filters.bookmaker) return false;
    if (filters.period && String(o.kickoffUtc || '').slice(0, 7) !== filters.period) return false;
    return true;
  });

  const groups = new Map();
  for (const o of filtered) {
    const key = dimension === 'period' ? (String(o.kickoffUtc || '').slice(0, 7) || 'unknown') : String(o[dimension] ?? 'unknown');
    const compKey = `${key}__${o.marketFamily}`;
    if (!groups.has(compKey)) groups.set(compKey, { dimensionValue: key, marketFamily: o.marketFamily, rows: [] });
    groups.get(compKey).rows.push(o);
  }

  return Array.from(groups.values()).map(g => ({
    dimension,
    dimensionValue: g.dimensionValue,
    ...evaluateFamilySlice(g.rows, g.marketFamily)
  }));
}

module.exports = {
  classifySampleSize,
  wilsonCI95,
  roiCI95,
  clusterBootstrapDiffCI,
  computeCalibrationBins,
  evaluateFamilySlice,
  compareAgainstBaselines,
  runStrictTemporalOutOfSampleSplit,
  sliceObservations
};
