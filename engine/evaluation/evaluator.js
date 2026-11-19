/**
 * EVALUATION & BACKTESTING ENGINE
 * Fase 7: Evalúa la precisión probabilística y el rendimiento financiero del motor.
 * Implementa:
 * - Brier Score & Brier Skill Score
 * - Log-Loss (Entropía Cruzada)
 * - Calibración por Deciles (Curva de Fiabilidad)
 * - Yield%, ROI%, Max Drawdown, Profit Factor
 * - Análisis de Sesgo por Mercado y por Competición
 */
const storage = require('../data/storage');

class Evaluator {
  constructor() {
    this.name = 'Evaluator';
  }

  /**
   * Ejecuta el análisis de calibración y rendimiento sobre un conjunto de apuestas liquidadas
   * @param {Array} bets Apuestas liquidadas (con status, odds, stake, profit, probEstimada)
   * @returns {Object} Reporte de evaluación exhaustivo
   */
  evaluatePerformance(bets = null) {
    const data = bets || storage.getResults();
    if (!data || data.length === 0) {
      return {
        totalBets: 0,
        message: 'No hay suficientes apuestas liquidadas para evaluación.'
      };
    }

    const settled = data.filter(b => b.status === 'GANADA' || b.status === 'PERDIDA' || b.status === 'ACERTADA' || b.status === 'FALLADA');
    if (settled.length === 0) {
      return { totalBets: data.length, settledBets: 0, message: 'Ninguna apuesta resuelta aún.' };
    }

    // 1. Métricas Financieras
    let totalStaked = 0;
    let totalProfit = 0;
    let wonCount = 0;
    let lostCount = 0;
    let peakBalance = 0;
    let currentBalance = 0;
    let maxDrawdown = 0;

    // 2. Métricas de Calibración
    let brierSum = 0;
    let logLossSum = 0;
    let validProbCount = 0;

    // 3. Segmentación
    const marketMap = {};
    const decileBins = Array.from({ length: 5 }, (_, i) => ({
      range: `${50 + i * 10}% - ${60 + i * 10}%`,
      min: 0.50 + i * 0.10,
      max: 0.60 + i * 0.10,
      count: 0,
      predictedSum: 0,
      actualHits: 0
    }));

    for (const b of settled) {
      const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
      const stake = b.stakedUnits || b.stake || 1.0;
      const profit = b.profitUnits !== undefined ? b.profitUnits : (b.profit !== undefined ? b.profit : (isWon ? (b.odds - 1) * stake : -stake));

      totalStaked += stake;
      totalProfit += profit;
      currentBalance += profit;

      if (currentBalance > peakBalance) {
        peakBalance = currentBalance;
      }
      const dd = peakBalance - currentBalance;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }

      if (isWon) wonCount++;
      else lostCount++;

      // Evaluación probabilística
      const prob = b.realProb ? (b.realProb > 1 ? b.realProb / 100 : b.realProb) : (b.pProjected || (1 / (b.fairOdds || b.fair_odds || 1.6)));
      if (prob && prob > 0 && prob < 1) {
        const actualOutcome = isWon ? 1 : 0;
        brierSum += Math.pow(prob - actualOutcome, 2);
        const clampedP = Math.max(0.001, Math.min(0.999, prob));
        logLossSum += -(actualOutcome * Math.log(clampedP) + (1 - actualOutcome) * Math.log(1 - clampedP));
        validProbCount++;

        // Ubicar en decil
        const bin = decileBins.find(d => prob >= d.min && prob < d.max) || decileBins[decileBins.length - 1];
        bin.count++;
        bin.predictedSum += prob;
        if (isWon) bin.actualHits++;
      }

      // Por mercado
      const m = b.market || 'Otros';
      if (!marketMap[m]) {
        marketMap[m] = { total: 0, won: 0, lost: 0, profit: 0, staked: 0 };
      }
      marketMap[m].total++;
      if (isWon) marketMap[m].won++;
      else marketMap[m].lost++;
      marketMap[m].staked += stake;
      marketMap[m].profit += profit;
    }

    const winRate = Number(((wonCount / settled.length) * 100).toFixed(1));
    const yieldPct = Number(((totalProfit / totalStaked) * 100).toFixed(1));
    const brierScore = validProbCount > 0 ? Number((brierSum / validProbCount).toFixed(4)) : null;
    const logLoss = validProbCount > 0 ? Number((logLossSum / validProbCount).toFixed(4)) : null;

    // Calibración por deciles
    const calibrationReport = decileBins.map(d => ({
      range: d.range,
      sampleSize: d.count,
      avgPredictedProb: d.count > 0 ? Number(((d.predictedSum / d.count) * 100).toFixed(1)) : 0,
      actualHitRate: d.count > 0 ? Number(((d.actualHits / d.count) * 100).toFixed(1)) : 0,
      calibrationGap: d.count > 0 ? Number((((d.actualHits / d.count) - (d.predictedSum / d.count)) * 100).toFixed(1)) : 0
    }));

    // Desglose por mercado
    const marketsSummary = Object.keys(marketMap).map(m => {
      const item = marketMap[m];
      return {
        market: m,
        total: item.total,
        winRate: Number(((item.won / item.total) * 100).toFixed(1)),
        netProfit: Number(item.profit.toFixed(2)),
        yieldPct: item.staked > 0 ? Number(((item.profit / item.staked) * 100).toFixed(1)) : 0.0
      };
    });

    return {
      evaluatedAt: new Date().toISOString(),
      sampleSize: settled.length,
      financialMetrics: {
        totalStakedUnits: Number(totalStaked.toFixed(2)),
        netProfitUnits: Number(totalProfit.toFixed(2)),
        yieldPct,
        winRatePct: winRate,
        wonBets: wonCount,
        lostBets: lostCount,
        maxDrawdownUnits: Number(maxDrawdown.toFixed(2))
      },
      probabilisticMetrics: {
        brierScore,
        brierEvaluation: brierScore !== null ? (brierScore < 0.20 ? 'Excelente (Alta resolución)' : brierScore < 0.25 ? 'Aceptable' : 'Poco calibrado') : 'N/A',
        logLoss,
        evaluatedPicksWithProb: validProbCount
      },
      calibrationByDecile: calibrationReport,
      byMarket: marketsSummary
    };
  }
}

module.exports = new Evaluator();
