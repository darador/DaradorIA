/**
 * SHADOW LAB EVALUATOR (V2.1 - HARDENED) — DARADOR IA 2.0
 * 
 * Mejoras Metodológicas y Estadísticas de Fase 2 Hardening:
 * 1. Bootstrap Pareado: Genera intervalos de confianza al 95% (BCa o percentil) para la diferencia
 *    entre Brier Score (V2 - V1) y Log Loss (V2 - V1) sobre idénticas observaciones.
 * 2. Agrupamiento por Partido (Cluster Bootstrap):
 *    - Trata el partido como unidad de muestreo para evitar subestimar la varianza cuando existen
 *      múltiples picks en un mismo encuentro (mercados correlacionados).
 * 3. Calibration Curve y Expected Calibration Error (ECE):
 *    - 10 bins de calibración con recuentos de aciertos observados vs probabilidades promedio.
 * 4. Comparación pareada estricta (idénticas cuotas y eventos).
 */

class ShadowLabEvaluator {
  constructor(store) {
    this.store = store;
  }

  /**
   * Ejecuta la evaluación comparativa rigurosa con significancia estadística
   */
  evaluatePerformance(options = {}) {
    const allPredictions = this.store.getPredictions();

    // Filtrar predicciones liquidadas con resultado válido
    let eligible = allPredictions.filter(p => p.isSettled && p.result);

    if (options.scope === 'executed') {
      eligible = eligible.filter(p => p.isExecutedInProduction);
    } else if (options.scope === 'shadow') {
      eligible = eligible.filter(p => p.isShadowMode);
    }

    const settledNonVoid = eligible.filter(p => !p.result.isVoid);
    const voidPicks = eligible.filter(p => p.result.isVoid);

    if (settledNonVoid.length === 0) {
      return {
        sampleSize: 0,
        totalEligible: eligible.length,
        voidCount: voidPicks.length,
        message: 'Sin suficientes predicciones liquidadas para evaluación estadística.'
      };
    }

    // 1. Métricas Puntuales
    const metricsV1 = this._calculateProbabilisticMetrics(settledNonVoid, 'pV1');
    const metricsV2 = this._calculateProbabilisticMetrics(settledNonVoid, 'pV2');
    const metricsV2Cons = this._calculateProbabilisticMetrics(settledNonVoid, 'pConservative');

    // 2. Bootstrap Pareado por Clusters de Partido (mínimo 5,000 réplicas por defecto para evaluaciones rigurosas)
    const replications = options.replications || 5000;
    const bootstrapResults = this._clusterBootstrapComparison(settledNonVoid, replications);

    // 3. Simulación Financiera
    const financialV1 = this._simulateBettingStrategy(settledNonVoid, 'pV1', 'evV1');
    const financialV2 = this._simulateBettingStrategy(settledNonVoid, 'pV2', 'grossEvV2');

    // 4. Desglose
    const breakdowns = {
      byMarket: this._segmentBreakdown(settledNonVoid, 'market'),
      byLeague: this._segmentBreakdown(settledNonVoid, 'competition'),
      byOddsRange: this._oddsRangeBreakdown(settledNonVoid)
    };

    const clusterCount = new Set(settledNonVoid.map(p => p.match || p.candidateId)).size;

    const report = {
      evaluationTimestamp: new Date().toISOString(),
      sampleSize: settledNonVoid.length,
      voidCount: voidPicks.length,
      independentMatchesCount: clusterCount,
      clusterCount,

      probabilisticComparison: {
        brierScore: {
          v1: metricsV1.brierScore,
          v2: metricsV2.brierScore,
          v2Conservative: metricsV2Cons.brierScore,
          diffPointEstimate: Number((metricsV2.brierScore - metricsV1.brierScore).toFixed(4)),
          diff95Ci: bootstrapResults ? bootstrapResults.brierDiffCi95 : null,
          isV2Better: metricsV2.brierScore < metricsV1.brierScore,
          isStatisticallySignificant: bootstrapResults ? bootstrapResults.isBrierSignificant : false
        },
        logLoss: {
          v1: metricsV1.logLoss,
          v2: metricsV2.logLoss,
          v2Conservative: metricsV2Cons.logLoss,
          diffPointEstimate: Number((metricsV2.logLoss - metricsV1.logLoss).toFixed(4)),
          diff95Ci: bootstrapResults ? bootstrapResults.logLossDiffCi95 : null,
          isV2Better: metricsV2.logLoss < metricsV1.logLoss,
          isStatisticallySignificant: bootstrapResults ? bootstrapResults.isLogLossSignificant : false
        },
        calibration: {
          eceV1: metricsV1.calibrationError,
          eceV2: metricsV2.calibrationError,
          curveV1: metricsV1.calibrationCurve,
          curveV2: metricsV2.calibrationCurve
        }
      },

      financialSimulation: {
        v1: financialV1,
        v2: financialV2
      },

      statisticalNotes: {
        methodology: `Cluster Bootstrap pareado a nivel de partido (${replications.toLocaleString()} réplicas con reposición)`,
        hypothesisTested: 'H0: Brier(V2) >= Brier(V1) vs H1: Brier(V2) < Brier(V1)',
        ciConstructionMethod: 'Percentil empírico al 95% [p2.5, p97.5] sobre réplicas remuestreadas por matchId',
        voidTreatment: 'Los eventos nulos (VOID/Push) se excluyen del cálculo del Brier Score y Log Loss pero se auditan y conservan con trazabilidad completa (voidCount).',
        significanceInterpretation: bootstrapResults && bootstrapResults.isBrierSignificant
          ? 'La mejora probabilística de V2 es estadísticamente significativa al 95% de confianza.'
          : (clusterCount < 30 
              ? 'Muestra insuficiente de partidos (< 30 clusters). No se declara significancia hasta acumulación representativa.'
              : 'Diferencia aún no estadísticamente concluyente (CI95 incluye el cero).')
      },

      breakdowns
    };

    this.store.saveEvaluationReport(report);
    return report;
  }

  _calculateProbabilisticMetrics(items, probKey) {
    let brierSum = 0;
    let logLossSum = 0;
    let validCount = 0;

    const bins = Array.from({ length: 10 }, (_, i) => ({
      bin: `${(i * 10)}% - ${((i + 1) * 10)}%`,
      count: 0,
      sumProb: 0,
      hits: 0
    }));

    for (const item of items) {
      let p = item[probKey];
      if (p === null || p === undefined || !Number.isFinite(p)) continue;

      p = Math.max(0.0001, Math.min(0.9999, p));
      const y = item.result.isWon ? 1 : 0;

      brierSum += Math.pow(p - y, 2);
      logLossSum -= (y * Math.log(p) + (1 - y) * Math.log(1 - p));

      const binIdx = Math.min(9, Math.floor(p * 10));
      bins[binIdx].count++;
      bins[binIdx].sumProb += p;
      bins[binIdx].hits += y;

      validCount++;
    }

    if (validCount === 0) return { brierScore: null, logLoss: null, calibrationError: null, calibrationCurve: [] };

    let ece = 0;
    const curve = [];
    for (const bin of bins) {
      if (bin.count > 0) {
        const avgProb = bin.sumProb / bin.count;
        const actualRate = bin.hits / bin.count;
        ece += (bin.count / validCount) * Math.abs(actualRate - avgProb);
        curve.push({
          bin: bin.bin,
          picks: bin.count,
          avgPredictedProb: Number((avgProb * 100).toFixed(1)),
          actualHitRate: Number((actualRate * 100).toFixed(1)),
          gap: Number((Math.abs(actualRate - avgProb) * 100).toFixed(1))
        });
      }
    }

    return {
      brierScore: Number((brierSum / validCount).toFixed(4)),
      logLoss: Number((logLossSum / validCount).toFixed(4)),
      calibrationError: Number((ece * 100).toFixed(2)),
      calibrationCurve: curve
    };
  }

  /**
   * Bootstrap por Conglomerados (Cluster Bootstrap):
   * Agrupa los eventos por partido y remuestrea partidos enteros con reposición
   */
  _clusterBootstrapComparison(items, replications = 1000) {
    // Agrupar por partido
    const clustersMap = new Map();
    for (const item of items) {
      const matchKey = item.match || item.candidateId;
      if (!clustersMap.has(matchKey)) clustersMap.set(matchKey, []);
      clustersMap.get(matchKey).push(item);
    }

    const clusters = Array.from(clustersMap.values());
    const numClusters = clusters.length;

    if (numClusters < 5) {
      return null; // Muestra de clusters insuficiente para bootstrap confiable
    }

    const brierDiffs = [];
    const logLossDiffs = [];

    for (let r = 0; r < replications; r++) {
      const resampledItems = [];
      for (let i = 0; i < numClusters; i++) {
        const randIdx = Math.floor(Math.random() * numClusters);
        resampledItems.push(...clusters[randIdx]);
      }

      const m1 = this._calculateProbabilisticMetrics(resampledItems, 'pV1');
      const m2 = this._calculateProbabilisticMetrics(resampledItems, 'pV2');

      if (m1.brierScore !== null && m2.brierScore !== null) {
        brierDiffs.push(m2.brierScore - m1.brierScore);
        logLossDiffs.push(m2.logLoss - m1.logLoss);
      }
    }

    if (brierDiffs.length < 100) return null;

    brierDiffs.sort((a, b) => a - b);
    logLossDiffs.sort((a, b) => a - b);

    const lowerIdx = Math.floor(brierDiffs.length * 0.025);
    const upperIdx = Math.floor(brierDiffs.length * 0.975);

    const brierCi = [Number(brierDiffs[lowerIdx].toFixed(4)), Number(brierDiffs[upperIdx].toFixed(4))];
    const logLossCi = [Number(logLossDiffs[lowerIdx].toFixed(4)), Number(logLossDiffs[upperIdx].toFixed(4))];

    // Significancia: si el límite superior del intervalo es estrictamente menor a 0 (V2 - V1 < 0)
    const isBrierSignificant = brierCi[1] < 0;
    const isLogLossSignificant = logLossCi[1] < 0;

    return {
      brierDiffCi95: brierCi,
      logLossDiffCi95: logLossCi,
      isBrierSignificant,
      isLogLossSignificant
    };
  }

  _simulateBettingStrategy(items, probKey, evKey) {
    let totalBets = 0;
    let wonBets = 0;
    let lostBets = 0;
    let totalStaked = 0;
    let netProfit = 0;
    let peakProfit = 0;
    let maxDrawdown = 0;

    for (const item of items) {
      const ev = item[evKey] !== undefined ? item[evKey] : ((item[probKey] * item.odds - 1) * 100);
      if (ev < 5.0) continue;

      totalBets++;
      const stake = 1.0;
      totalStaked += stake;

      if (item.result.isWon) {
        wonBets++;
        const pVal = (item.odds - 1.0) * stake;
        netProfit += pVal;
      } else if (item.result.isLost) {
        lostBets++;
        netProfit -= stake;
      }

      if (netProfit > peakProfit) peakProfit = netProfit;
      const dd = peakProfit - netProfit;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const roi = totalStaked > 0 ? (netProfit / totalStaked) * 100 : 0.0;
    const winRate = (wonBets + lostBets) > 0 ? (wonBets / (wonBets + lostBets)) * 100 : 0.0;

    return {
      betsPlaced: totalBets,
      won: wonBets,
      lost: lostBets,
      winRatePct: Number(winRate.toFixed(1)),
      totalStakedUnits: Number(totalStaked.toFixed(2)),
      netProfitUnits: Number(netProfit.toFixed(2)),
      roiPct: Number(roi.toFixed(1)),
      maxDrawdownUnits: Number(maxDrawdown.toFixed(2))
    };
  }

  _segmentBreakdown(items, fieldKey) {
    const groups = {};
    for (const item of items) {
      const g = item[fieldKey] || 'Otros';
      if (!groups[g]) groups[g] = { total: 0, won: 0, lost: 0, sumBrierV1: 0, sumBrierV2: 0 };
      groups[g].total++;

      const y = item.result.isWon ? 1 : 0;
      if (item.result.isWon) groups[g].won++;
      else if (item.result.isLost) groups[g].lost++;

      const p1 = item.pV1 !== null ? item.pV1 : 0.5;
      const p2 = item.pV2 !== null ? item.pV2 : 0.5;

      groups[g].sumBrierV1 += Math.pow(p1 - y, 2);
      groups[g].sumBrierV2 += Math.pow(p2 - y, 2);
    }

    const res = {};
    for (const [k, v] of Object.entries(groups)) {
      const settled = v.won + v.lost;
      res[k] = {
        total: v.total,
        winRate: settled > 0 ? ((v.won / settled) * 100).toFixed(1) + '%' : '0.0%',
        brierV1: settled > 0 ? Number((v.sumBrierV1 / settled).toFixed(4)) : null,
        brierV2: settled > 0 ? Number((v.sumBrierV2 / settled).toFixed(4)) : null
      };
    }
    return res;
  }

  _oddsRangeBreakdown(items) {
    const ranges = [
      { name: '1.10 - 1.35', min: 1.10, max: 1.35 },
      { name: '1.36 - 1.65', min: 1.36, max: 1.65 },
      { name: '1.66 - 1.95', min: 1.66, max: 1.95 },
      { name: '1.96 - 2.45', min: 1.96, max: 2.45 }
    ];

    const res = {};
    for (const r of ranges) {
      const subset = items.filter(x => x.odds >= r.min && x.odds <= r.max);
      if (subset.length === 0) continue;

      const m1 = this._calculateProbabilisticMetrics(subset, 'pV1');
      const m2 = this._calculateProbabilisticMetrics(subset, 'pV2');
      const won = subset.filter(x => x.result.isWon).length;
      const settled = subset.filter(x => x.result.isWon || x.result.isLost).length;

      res[r.name] = {
        sampleSize: subset.length,
        winRate: settled > 0 ? ((won / settled) * 100).toFixed(1) + '%' : '0.0%',
        brierV1: m1.brierScore,
        brierV2: m2.brierScore,
        logLossV1: m1.logLoss,
        logLossV2: m2.logLoss
      };
    }
    return res;
  }
}

module.exports = ShadowLabEvaluator;
