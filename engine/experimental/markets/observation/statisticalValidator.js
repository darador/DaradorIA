/**
 * FASE 9 — STATISTICAL VALIDATOR (MÉTRICAS, BASELINES, INCERTIDUMBRE, CLUSTER BOOTSTRAP Y OOS)
 *
 * Implementa:
 *  - Sección 7: Evaluación estadística por liga, temporada, mercado, familia, selección, modelo,
 *    versión, período, calidad de datos y bookmaker. Brier/LogLoss binario y multiclase (1X2),
 *    Accuracy, Matriz de confusión 3x3, ROI 1U plano, Yield, Hit Rate, CLV y Calibración.
 *  - Sección 8: Comparación contra Baselines (mercado sin vig, base rate histórico estrictamente
 *    anterior al evento, versión anterior del modelo) sobre exactamente las mismas observaciones.
 *  - Sección 9: Indicadores de muestra (INSUFFICIENT/PRELIMINARY/DEVELOPING/STRONGER), IC 95%
 *    Wilson (Hit Rate) y normal (ROI), detección de sesgo de muestra y Cluster Bootstrap por matchId.
 *  - Sección 10: Validación temporal estricta fuera de muestra (train < validation < evaluation)
 *    sin divisiones aleatorias, retornando OUT_OF_SAMPLE_NOT_AVAILABLE si no hay volumen suficiente.
 */

'use strict';

const EPS = 1e-6;
const Z_95 = 1.959963984540054;

function clampProb(p) {
  return Math.min(1 - EPS, Math.max(EPS, Number(p)));
}

function round(v, d = 5) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/**
 * Clasificador oficial de volumen de muestra (Sección 9).
 * Describe volumen; NO certifica rentabilidad ni significancia estadística.
 */
function classifySampleSize(n) {
  if (n < 30) return 'INSUFFICIENT_SAMPLE';
  if (n < 100) return 'PRELIMINARY_SAMPLE';
  if (n < 300) return 'DEVELOPING_EVIDENCE';
  return 'STRONGER_EVIDENCE';
}

/**
 * Intervalo de confianza de Wilson al 95% para una proporción (Hit Rate).
 */
function wilsonCI95(successes, trials) {
  if (!trials || trials <= 0) return null;
  const p = successes / trials;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half = (Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / denom;
  return {
    lowPct: round(Math.max(0, center - half) * 100, 2),
    highPct: round(Math.min(1, center + half) * 100, 2)
  };
}

/**
 * Intervalo de confianza al 95% para ROI (stake plano 1U) basado en varianza muestral.
 */
function roiCI95(profits) {
  const n = profits.length;
  if (n < 2) return null;
  const mean = profits.reduce((a, b) => a + b, 0) / n;
  const variance = profits.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return {
    lowPct: round((mean - Z_95 * se) * 100, 2),
    highPct: round((mean + Z_95 * se) * 100, 2)
  };
}

/**
 * PRNG determinista (Mulberry32) para que el Cluster Bootstrap sea 100% reproducible.
 */
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
 * Remuestrea partidos completos con reemplazo para respetar la correlación entre
 * múltiples selecciones del mismo encuentro.
 */
function clusterBootstrapDiffCI(pairedItems, metricFn, { iterations = 500, seed = 2026 } = {}) {
  if (!Array.isArray(pairedItems) || pairedItems.length < 2) {
    return { available: false, reason: 'MUESTRA_INSUFICIENTE_BOOTSTRAP' };
  }

  const byMatch = new Map();
  for (const item of pairedItems) {
    const key = String(item.matchId || item.observationId);
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key).push(item);
  }
  const clusters = Array.from(byMatch.values());
  const k = clusters.length;
  if (k < 2) {
    return { available: false, clusterCount: k, reason: 'SE_REQUIEREN_AL_MENOS_2_PARTIDOS_PARA_CLUSTER_BOOTSTRAP' };
  }

  const rng = mulberry32(seed);
  const diffs = [];
  for (let b = 0; b < iterations; b++) {
    const sample = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(rng() * k);
      sample.push(...clusters[idx]);
    }
    const d = metricFn(sample);
    if (Number.isFinite(d)) diffs.push(d);
  }

  if (diffs.length < 10) {
    return { available: false, clusterCount: k, reason: 'BOOTSTRAP_NO_CONVERGENTE' };
  }

  diffs.sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * diffs.length);
  const hiIdx = Math.min(diffs.length - 1, Math.floor(0.975 * diffs.length));
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;

  return {
    available: true,
    clusterCount: k,
    observationCount: pairedItems.length,
    iterations: diffs.length,
    meanDiff: round(mean, 5),
    ci95Low: round(diffs[loIdx], 5),
    ci95High: round(diffs[hiIdx], 5),
    includesZero: diffs[loIdx] <= 0 && diffs[hiIdx] >= 0
  };
}

/**
 * Calcula bins de calibración (5 intervalos de ancho 0.20).
 */
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
    const y = o.status === 'WON' ? 1 : 0;
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

/**
 * Evalúa un conjunto homogéneo de observaciones (misma familia de mercado).
 * Nunca mezcla métricas de familias distintas.
 */
function evaluateFamilySlice(observations, marketFamily) {
  const familyObs = observations.filter(o => o.marketFamily === marketFamily);
  const decided = familyObs.filter(o => o.status === 'WON' || o.status === 'LOST');
  const settledAll = familyObs.filter(o => ['WON', 'LOST', 'VOID', 'PUSH'].includes(o.status));
  const pendingCount = familyObs.filter(o => o.status === 'PENDING').length;
  const wonCount = decided.filter(o => o.status === 'WON').length;
  const lostCount = decided.filter(o => o.status === 'LOST').length;
  const voidCount = familyObs.filter(o => o.status === 'VOID').length;
  const pushCount = familyObs.filter(o => o.status === 'PUSH').length;
  const uniqueMatches = new Set(familyObs.map(o => o.matchId)).size;

  const profits = decided.map(o => Number(o.settlement?.profitUnits ?? (o.status === 'WON' ? o.odds - 1 : -1)));
  const cumProfit = profits.reduce((a, b) => a + b, 0);
  const avgOdds = decided.length > 0 ? decided.reduce((a, o) => a + Number(o.odds), 0) / decided.length : null;

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

  // Métricas predictivas según familia (multiclase para 1X2, binario para DC/BTTS/O/U)
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
      const y = o.status === 'WON' ? 1 : 0;
      brierSum += Math.pow(p - y, 2);
      logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      if ((p >= 0.5 && y === 1) || (p < 0.5 && y === 0)) accCorrect++;
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

  // Detección de sesgos de concentración por liga o período
  const skewWarnings = [];
  if (decided.length >= 10) {
    const byLeague = {};
    const byMonth = {};
    for (const o of decided) {
      byLeague[o.league] = (byLeague[o.league] || 0) + 1;
      const m = String(o.kickoffUtc || '').slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + 1;
    }
    for (const [lg, cnt] of Object.entries(byLeague)) {
      if (cnt / decided.length > 0.60) {
        skewWarnings.push(`Sesgo de liga: ${lg} concentra ${Math.round((cnt / decided.length) * 100)}% de la muestra.`);
      }
    }
    for (const [mo, cnt] of Object.entries(byMonth)) {
      if (cnt / decided.length > 0.60) {
        skewWarnings.push(`Sesgo temporal: ${mo} concentra ${Math.round((cnt / decided.length) * 100)}% de la muestra.`);
      }
    }
  }

  const sampleStatus = classifySampleSize(decided.length);
  const calibration = computeCalibrationBins(decided);

  return {
    marketFamily,
    totalObservations: familyObs.length,
    uniqueMatches,
    pendingCount,
    counts: { won: wonCount, lost: lostCount, void: voidCount, push: pushCount, decided: decided.length, settledAll: settledAll.length },
    sampleStatus,
    sampleWarning: sampleStatus === 'INSUFFICIENT_SAMPLE'
      ? `Muestra insuficiente (N=${decided.length} < 30). No sacar conclusiones ni usar indicadores verdes de rentabilidad.`
      : null,
    skewWarnings,
    predictive,
    profitability: {
      simulatedBets: decided.length,
      hitRatePct: decided.length > 0 ? round((wonCount / decided.length) * 100, 2) : null,
      hitRateCI95: wilsonCI95(wonCount, decided.length),
      avgOdds: round(avgOdds, 3),
      cumulativeProfitUnits: round(cumProfit, 4),
      roiPct: decided.length > 0 ? round((cumProfit / decided.length) * 100, 2) : null,
      roiCI95: roiCI95(profits),
      yieldPct: decided.length > 0 ? round((cumProfit / decided.length) * 100, 2) : null
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
 * Compara el modelo experimental contra 3 Baselines sobre EXACTAMENTE las mismas observaciones:
 *  1. Probabilidad implícita de mercado sin margen (noVigProbability)
 *  2. Base rate histórico estrictamente anterior a cada evento (zero lookahead)
 *  3. Versión anterior del modelo (cuando exista)
 */
function compareAgainstBaselines(observations, marketFamily, { previousVersionObs = null, bootstrapIterations = 400 } = {}) {
  const decided = observations
    .filter(o => o.marketFamily === marketFamily && (o.status === 'WON' || o.status === 'LOST'))
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));

  const binaryBrier = (p, y) => Math.pow(clampProb(p) - y, 2);
  const binaryLL = (p, y) => -(y * Math.log(clampProb(p)) + (1 - y) * Math.log(1 - clampProb(p)));

  // 1. Baseline: Probabilidad implícita sin vig del mercado
  const withNoVig = decided.filter(o => Number.isFinite(o.noVigProbability));
  let vsMarketNoVig = { comparableCount: withNoVig.length, available: false, reason: 'SIN_OBSERVACIONES_CON_NOVIG' };
  if (withNoVig.length > 0) {
    const modelBrier = withNoVig.reduce((a, o) => a + binaryBrier(o.modelProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;
    const baseBrier = withNoVig.reduce((a, o) => a + binaryBrier(o.noVigProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;
    const modelLL = withNoVig.reduce((a, o) => a + binaryLL(o.modelProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;
    const baseLL = withNoVig.reduce((a, o) => a + binaryLL(o.noVigProbability, o.status === 'WON' ? 1 : 0), 0) / withNoVig.length;

    const bootBrier = clusterBootstrapDiffCI(
      withNoVig,
      (sample) => {
        const mB = sample.reduce((a, o) => a + binaryBrier(o.modelProbability, o.status === 'WON' ? 1 : 0), 0) / sample.length;
        const bB = sample.reduce((a, o) => a + binaryBrier(o.noVigProbability, o.status === 'WON' ? 1 : 0), 0) / sample.length;
        return mB - bB; // negativo = modelo mejor que mercado
      },
      { iterations: bootstrapIterations }
    );

    vsMarketNoVig = {
      available: true,
      comparableCount: withNoVig.length,
      modelBrier: round(modelBrier, 5),
      baselineBrier: round(baseBrier, 5),
      deltaBrier: round(modelBrier - baseBrier, 5), // < 0 es mejor
      modelLogLoss: round(modelLL, 5),
      baselineLogLoss: round(baseLL, 5),
      deltaLogLoss: round(modelLL - baseLL, 5), // < 0 es mejor
      clusterBootstrapBrierDiff: bootBrier
    };
  }

  // 2. Baseline: Frecuencia histórica / Base Rate estrictamente anterior al kickoff (zero lookahead)
  const baseRatePairs = [];
  for (let i = 0; i < decided.length; i++) {
    const cur = decided[i];
    const curKo = Date.parse(cur.kickoffUtc);
    const prior = decided.filter(p => Date.parse(p.kickoffUtc) < curKo);
    if (prior.length === 0) continue;
    const priorRate = prior.filter(p => p.status === 'WON').length / prior.length;
    baseRatePairs.push({ obs: cur, priorRate, matchId: cur.matchId, observationId: cur.observationId });
  }

  let vsHistoricalBaseRate = { comparableCount: baseRatePairs.length, available: false, reason: 'SIN_HISTORICO_ANTERIOR' };
  if (baseRatePairs.length > 0) {
    const modelBrier = baseRatePairs.reduce((a, x) => a + binaryBrier(x.obs.modelProbability, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;
    const baseBrier = baseRatePairs.reduce((a, x) => a + binaryBrier(x.priorRate, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;
    const modelLL = baseRatePairs.reduce((a, x) => a + binaryLL(x.obs.modelProbability, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;
    const baseLL = baseRatePairs.reduce((a, x) => a + binaryLL(x.priorRate, x.obs.status === 'WON' ? 1 : 0), 0) / baseRatePairs.length;

    vsHistoricalBaseRate = {
      available: true,
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
  let vsPreviousVersion = { comparableCount: 0, available: false, reason: 'SIN_VERSION_ANTERIOR_COMPARABLE' };
  if (Array.isArray(previousVersionObs) && previousVersionObs.length > 0) {
    const prevMap = new Map();
    for (const p of previousVersionObs) {
      if (p.marketFamily === marketFamily && (p.status === 'WON' || p.status === 'LOST')) {
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
      const mRoi = (matched.reduce((a, x) => a + (x.cur.settlement?.profitUnits ?? 0), 0) / matched.length) * 100;
      const pRoi = (matched.reduce((a, x) => a + (x.prev.settlement?.profitUnits ?? 0), 0) / matched.length) * 100;

      const curClv = matched.map(x => x.cur.clv?.clvPct).filter(Number.isFinite);
      const prevClv = matched.map(x => x.prev.clv?.clvPct).filter(Number.isFinite);
      const deltaClv = (curClv.length > 0 && prevClv.length > 0)
        ? round((curClv.reduce((a, b) => a + b, 0) / curClv.length) - (prevClv.reduce((a, b) => a + b, 0) / prevClv.length), 3)
        : null;

      vsPreviousVersion = {
        available: true,
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
 * Validación temporal estricta fuera de muestra (Sección 10).
 * Separa cronológicamente train < validation < evaluation por kickoffUtc (CERO división aleatoria).
 * Devuelve OUT_OF_SAMPLE_NOT_AVAILABLE si no hay volumen histórico suficiente.
 */
function runStrictTemporalOutOfSampleSplit(observations, marketFamily, {
  minTrainCount = 20,
  minValCount = 10,
  trainRatio = 0.60,
  valRatio = 0.20
} = {}) {
  const sorted = observations
    .filter(o => o.marketFamily === marketFamily && (o.status === 'WON' || o.status === 'LOST') && o.kickoffUtc)
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));

  if (sorted.length < minTrainCount + minValCount) {
    return {
      status: 'OUT_OF_SAMPLE_NOT_AVAILABLE',
      reason: `Histórico insuficiente para partición temporal estricta (N=${sorted.length} < mínimo ${minTrainCount + minValCount}).`,
      totalAvailable: sorted.length
    };
  }

  const trainEnd = Math.max(minTrainCount, Math.floor(sorted.length * trainRatio));
  const valEnd = Math.min(sorted.length, trainEnd + Math.max(minValCount, Math.floor(sorted.length * valRatio)));

  const trainSet = sorted.slice(0, trainEnd);
  const valSet = sorted.slice(trainEnd, valEnd);
  const evalSet = sorted.slice(valEnd);

  // Garantía estricta de separación temporal sin solapamiento
  const maxTrainKo = Date.parse(trainSet[trainSet.length - 1].kickoffUtc);
  const minValKo = Date.parse(valSet[0].kickoffUtc);
  const temporalIntegrityOk = maxTrainKo <= minValKo;

  // Ajuste de calibración simple estimado EXCLUSIVAMENTE sobre trainSet (zero leakage)
  const trainPredAvg = trainSet.reduce((a, o) => a + o.modelProbability, 0) / trainSet.length;
  const trainObsRate = trainSet.filter(o => o.status === 'WON').length / trainSet.length;
  const calibrationShiftLearnedOnTrain = round(trainObsRate - trainPredAvg, 5);
  const parameterVersion = `oos-cal-trainN${trainSet.length}-${trainSet[trainSet.length - 1].kickoffUtc.slice(0, 10)}`;

  return {
    status: 'OUT_OF_SAMPLE_AVAILABLE',
    temporalIntegrityOk,
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

/**
 * Segmentación multi-dimensional independiente (Sección 7).
 */
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
    let key;
    if (dimension === 'period') key = String(o.kickoffUtc || '').slice(0, 7) || 'unknown';
    else key = String(o[dimension] ?? 'unknown');
    // Clave compuesta con marketFamily para nunca mezclar familias distintas
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
