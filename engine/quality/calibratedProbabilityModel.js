/**
 * CALIBRATED PROBABILITY MODEL (V2.1 - HARDENED) — DARADOR IA 2.0
 * 
 * Correcciones y Mejoras de Fase 2 Hardening:
 * 1. Distinción explícita de variables:
 *    - successes: cantidad de aciertos históricos del evento apostado.
 *    - failures: cantidad de fallos (sampleSize - successes).
 *    - sampleSize: n total de partidos válidos.
 *    - threshold: umbral numérico de la línea (ej. 2.5, 0.5, 3.0).
 *    - k: entero de conteo (k = Math.floor(threshold) + 1 para Over, etc.).
 * 2. Soporte completo para Over, Under y Líneas Enteras con posibilidad de VOID (push):
 *    - Over X.5 / Under X.5: Eventos binarios pWin + pLoss = 1.
 *    - Over X.0 / Under X.0: Eventos con devolución (pWin + pLoss + pVoid = 1).
 * 3. Documentación estricta de la ponderación de P_calibrada.
 */

class CalibratedProbabilityModel {
  constructor(customConfig = {}) {
    // Priors Beta(alpha, beta) por mercado
    this.priors = {
      'remates totales': { alpha: 4.5, beta: 3.0, strength: 7.5 },
      'remates al arco': { alpha: 3.8, beta: 3.2, strength: 7.0 },
      'faltas cometidas': { alpha: 4.8, beta: 3.2, strength: 8.0 },
      'faltas ganadas': { alpha: 4.2, beta: 3.8, strength: 8.0 },
      'entradas (tackles)': { alpha: 4.0, beta: 3.5, strength: 7.5 },
      'córners de equipo': { alpha: 5.0, beta: 3.0, strength: 8.0 },
      'remates de equipo': { alpha: 4.8, beta: 4.0, strength: 8.8 },
      'remates al arco de equipo': { alpha: 4.2, beta: 4.8, strength: 9.0 },
      'goles de equipo': { alpha: 3.8, beta: 4.2, strength: 8.0 },
      'goles totales': { alpha: 4.2, beta: 3.8, strength: 8.0 },
      'default': { alpha: 4.0, beta: 4.0, strength: 8.0 }
    };

    // Parámetros de ensamble
    this.smallSampleThreshold = customConfig.smallSampleThreshold || 15;
    this.weightSmallSampleBeta = customConfig.weightSmallSampleBeta || 0.65; // 65% Beta en n < 15
    this.weightStandardBeta = customConfig.weightStandardBeta || 0.50;      // 50% Beta en n >= 15
  }

  /**
   * Calcula la probabilidad regularizada mediante Beta-Binomial Shrinkage
   * Fórmula exacta: P_posterior = (successes + alpha) / (sampleSize + alpha + beta)
   * 
   * @param {number} successes Número de veces que se cumplió la apuesta
   * @param {number} sampleSize Tamaño total de la muestra (n)
   * @param {string} marketName Nombre del mercado para seleccionar el prior
   */
  calculateBetaBinomialShrinkage(successes, sampleSize, marketName = 'default') {
    if (sampleSize <= 0) {
      return {
        pPosterior: 0.50,
        posteriorStdDev: 0.25,
        rawHitRate: 0.50,
        shrinkageApplied: 0.0,
        sampleWeight: 0.0,
        successes: 0,
        failures: 0,
        sampleSize: 0,
        alpha: 4.0,
        beta: 4.0
      };
    }

    const marketKey = (marketName || '').toLowerCase().trim();
    const prior = this.priors[marketKey] || this.priors['default'];
    const { alpha, beta, strength } = prior;

    const failures = Math.max(0, sampleSize - successes);
    const pPosterior = (successes + alpha) / (sampleSize + alpha + beta);

    const posteriorVariance = ((alpha + successes) * (beta + failures)) /
      (Math.pow(sampleSize + alpha + beta, 2) * (sampleSize + alpha + beta + 1));

    const rawHitRate = successes / sampleSize;

    return {
      pPosterior: Number(pPosterior.toFixed(4)),
      posteriorStdDev: Number(Math.sqrt(posteriorVariance).toFixed(4)),
      rawHitRate: Number(rawHitRate.toFixed(4)),
      shrinkageApplied: Number(Math.abs(pPosterior - rawHitRate).toFixed(4)),
      sampleWeight: Number((sampleSize / (sampleSize + strength)).toFixed(3)),
      successes,
      failures,
      sampleSize,
      alpha,
      beta
    };
  }

  /**
   * Modela la distribución de conteos para mercados Over, Under y Líneas Enteras
   * Devuelve { pWin, pLoss, pVoid } garantizando que sumen 1.0 (coherencia de Kolmogorov)
   * 
   * @param {number[]} historicalValues Observaciones numéricas
   * @param {number} threshold Umbral de la línea (ej. 2.5, 3.0, 0.5)
   * @param {string} betType 'OVER' | 'UNDER'
   * @param {Object} adjustments { concessionRatio, venueFactor }
   */
  calculateCountDistribution(historicalValues, threshold, betType = 'OVER', adjustments = {}) {
    if (!Array.isArray(historicalValues) || historicalValues.length === 0) {
      return {
        pWin: 0.50, pLoss: 0.50, pVoid: 0.0,
        modelUsed: 'DEFAULT', varianceToMean: 1.0
      };
    }

    const sampleSize = historicalValues.length;
    const mean = historicalValues.reduce((a, b) => a + b, 0) / sampleSize;
    const variance = sampleSize > 1
      ? historicalValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (sampleSize - 1)
      : mean;

    const concessionRatio = adjustments.concessionRatio || 1.0;
    const venueFactor = adjustments.venueFactor || 1.0;
    const lambda = Math.max(0.05, mean * concessionRatio * venueFactor);

    const varianceRatio = mean > 0 ? variance / mean : 1.0;
    const isOverdispersed = varianceRatio > 1.25 && variance > lambda;

    const isIntegerLine = Number.isInteger(threshold);
    const modelUsed = isOverdispersed ? 'Binomial Negativa (Sobredispersión)' : 'Poisson Ajustado';

    // Función PMF
    const getPmf = (i) => isOverdispersed
      ? this._nbPmf(i, (lambda * lambda) / (variance - lambda), lambda / variance)
      : (Math.exp(-lambda) * Math.pow(lambda, i)) / this._factorial(i);

    let pWin = 0;
    let pLoss = 0;
    let pVoid = 0;

    if (isIntegerLine) {
      // Línea entera (ej. 3.0):
      // Si conteo == threshold -> VOID (Push)
      pVoid = getPmf(threshold);

      if (betType === 'OVER') {
        // Gana si X > threshold (X >= threshold + 1)
        pWin = isOverdispersed
          ? this._negativeBinomialOver(lambda, variance, threshold + 1)
          : this._poissonOver(lambda, threshold + 1);
        pLoss = Math.max(0, 1.0 - pWin - pVoid);
      } else {
        // UNDER: Gana si X < threshold (X <= threshold - 1)
        const pAtLeastThreshold = isOverdispersed
          ? this._negativeBinomialOver(lambda, variance, threshold)
          : this._poissonOver(lambda, threshold);
        pWin = Math.max(0, 1.0 - pAtLeastThreshold);
        pLoss = Math.max(0, 1.0 - pWin - pVoid);
      }
    } else {
      // Línea decimal tradicional (ej. 0.5, 1.5, 2.5):
      // No existe void (pVoid = 0).
      pVoid = 0.0;
      const kOver = Math.floor(threshold) + 1; // e.g. 2.5 -> k=3

      const pOver = isOverdispersed
        ? this._negativeBinomialOver(lambda, variance, kOver)
        : this._poissonOver(lambda, kOver);

      if (betType === 'OVER') {
        pWin = pOver;
        pLoss = Math.max(0, 1.0 - pWin);
      } else {
        pWin = Math.max(0, 1.0 - pOver);
        pLoss = Math.max(0, 1.0 - pWin);
      }
    }

    return {
      pWin: Number(pWin.toFixed(4)),
      pLoss: Number(pLoss.toFixed(4)),
      pVoid: Number(pVoid.toFixed(4)),
      totalProbability: Number((pWin + pLoss + pVoid).toFixed(4)), // Debe ser 1.0
      modelUsed,
      lambda: Number(lambda.toFixed(2)),
      sampleMean: Number(mean.toFixed(2)),
      sampleVariance: Number(variance.toFixed(2)),
      varianceToMean: Number(varianceRatio.toFixed(2)),
      threshold,
      betType,
      isIntegerLine
    };
  }

  /**
   * Ensambla la probabilidad calibrada combinando Shrinkage Bayesiano y Modelo de Conteo
   * 
   * METODOLOGÍA DE COMBINACIÓN:
   * P_calibrada = w_beta * P_posterior + (1 - w_beta) * P_count_win
   * Donde:
   * - Si sampleSize < 15: w_beta = 0.65 (mayor peso al prior para evitar Mirage Trend).
   * - Si sampleSize >= 15: w_beta = 0.50 (ponderación equilibrada 50/50).
   */
  /**
   * Evalúa la probabilidad sobre el contrato estricto de HistoricalDataResolver
   * Soporta tanto COUNT_HISTORY (ensamble completo) como BINARY_HISTORY (Beta-Binomial puro)
   */
  evaluateCalibratedProbabilityFromContract(resolvedContract, options = {}) {
    if (!resolvedContract || resolvedContract.status === 'INVALID' || !resolvedContract.predictionEligible) {
      return {
        pCalibrated: null,
        pWin: null,
        pLoss: null,
        pVoid: null,
        uncertaintyIndex: 0.50,
        predictionEligible: false,
        status: 'INVALID',
        reason: resolvedContract?.reason || 'SIN_HISTORIAL'
      };
    }

    const { contractType, countHistory, binaryHistory } = resolvedContract;
    const marketName = binaryHistory?.market || countHistory?.market || 'default';
    const qualityStatus = resolvedContract.status; // 'VALID' | 'LIMITED'

    // CASO A: Disponemos de serie de observaciones completa (COUNT_HISTORY) -> Ensamble V2.1
    if (contractType === 'COUNT_HISTORY' && countHistory && countHistory.observations?.length >= 3) {
      const historicalValues = countHistory.observations;
      const threshold = countHistory.threshold;
      const betType = countHistory.betType;
      const adjustments = options.adjustments || {};

      return {
        ...this.evaluateCalibratedProbability({
          historicalValues,
          threshold,
          betType,
          marketName,
          adjustments,
          qualityStatus
        }),
        contractType: 'COUNT_HISTORY',
        modelApplied: 'V2.2_ENSEMBLE_BETA_COUNT',
        predictionEligible: true,
        status: qualityStatus
      };
    }

    // CASO B: Disponemos exclusivamente de información empírica binaria (BINARY_HISTORY)
    // Se ejecuta Beta-Binomial Shrinkage estricto; Poisson y NegBinom quedan PROHIBIDOS por falta de conteo
    if (contractType === 'BINARY_HISTORY' && binaryHistory && binaryHistory.sampleSize >= 5) {
      const { successes, sampleSize, isIntegerLine } = binaryHistory;
      const shrinkage = this.calculateBetaBinomialShrinkage(successes, sampleSize, marketName);

      // Penalización por incertidumbre ante falta de serie de conteo (+0.06)
      let uncertainty = (1.0 - shrinkage.sampleWeight) * 0.22 + (shrinkage.posteriorStdDev * 1.5) + 0.06;
      if (isIntegerLine) uncertainty += 0.04;
      uncertainty = Math.min(0.48, Math.max(0.08, uncertainty));

      const pPosterior = shrinkage.pPosterior;
      const pLoss = Number((1.0 - pPosterior).toFixed(4));

      return {
        pCalibrated: pPosterior,
        pWin: pPosterior,
        pLoss,
        pVoid: 0.0,
        uncertaintyIndex: Number(uncertainty.toFixed(4)),
        contractType: 'BINARY_HISTORY',
        modelApplied: 'V2.2_BETA_BINOMIAL_SHRINKAGE_ONLY',
        predictionEligible: true,
        // Si el contrato binario fue validado con n >= 5 y sin inconsistencias, es VALID
        status: (resolvedContract.status === 'VALID' || (binaryHistory.sampleSize >= 5 && !binaryHistory.hasInconsistencies)) ? 'VALID' : 'LIMITED',
        ineligibleModels: ['POISSON', 'NEGATIVE_BINOMIAL'],
        weightsUsed: {
          weightBeta: 1.0,
          weightCount: 0.0,
          rule: 'BINARY_HISTORY_SHRINKAGE_PURE (Sin imputación artificial de Poisson)'
        },
        shrinkageDetails: shrinkage,
        countDistributionDetails: null
      };
    }

    return {
      pCalibrated: null,
      pWin: null,
      pLoss: null,
      pVoid: null,
      uncertaintyIndex: 0.50,
      predictionEligible: false,
      status: 'INVALID',
      reason: 'CONTRATO_NO_RECONOCIDO'
    };
  }

  evaluateCalibratedProbability(params) {
    const {
      historicalValues = [],
      threshold = 1.5,
      betType = 'OVER',
      marketName = 'default',
      adjustments = {},
      qualityStatus = 'VALID'
    } = params;

    const sampleSize = historicalValues.length;
    if (sampleSize === 0) {
      return {
        pCalibrated: 0.50,
        pWin: 0.50,
        pLoss: 0.50,
        pVoid: 0.0,
        uncertaintyIndex: 0.50,
        reason: 'SIN_HISTORIAL'
      };
    }

    // Contar aciertos empíricos según la condición
    const isInteger = Number.isInteger(threshold);
    let successes = 0;
    let pushCount = 0;

    historicalValues.forEach(v => {
      if (isInteger && v === threshold) {
        pushCount++;
      } else if (betType === 'OVER' && v > threshold) {
        successes++;
      } else if (betType === 'UNDER' && v < threshold) {
        successes++;
      }
    });

    const shrinkage = this.calculateBetaBinomialShrinkage(successes, sampleSize, marketName);
    const countDist = this.calculateCountDistribution(historicalValues, threshold, betType, adjustments);

    // Ponderación documentada:
    const wBeta = sampleSize < this.smallSampleThreshold ? this.weightSmallSampleBeta : this.weightStandardBeta;
    const wCount = 1.0 - wBeta;

    const pBlendedWin = (shrinkage.pPosterior * wBeta) + (countDist.pWin * wCount);

    // Ajuste de incertidumbre formal
    let uncertainty = (1.0 - shrinkage.sampleWeight) * 0.20 + (shrinkage.posteriorStdDev * 1.5);
    if (qualityStatus === 'LIMITED') uncertainty += 0.08;
    if (countDist.isIntegerLine) uncertainty += 0.03; // Mayor incertidumbre ante líneas push
    uncertainty = Math.min(0.48, Math.max(0.05, uncertainty));

    return {
      pCalibrated: Number(pBlendedWin.toFixed(4)),
      pWin: Number(pBlendedWin.toFixed(4)),
      pLoss: Number(countDist.pLoss.toFixed(4)),
      pVoid: Number(countDist.pVoid.toFixed(4)),
      uncertaintyIndex: Number(uncertainty.toFixed(4)),
      weightsUsed: {
        weightBeta: wBeta,
        weightCount: Number(wCount.toFixed(2)),
        rule: sampleSize < this.smallSampleThreshold ? 'SMALL_SAMPLE_CONSERVATIVE (65/35)' : 'STANDARD_EQUILIBRIUM (50/50)'
      },
      shrinkageDetails: shrinkage,
      countDistributionDetails: countDist
    };
  }

  _poissonOver(lambda, k) {
    if (k <= 0) return 1.0;
    if (lambda <= 0) return 0.0;
    let cdf = 0.0;
    let term = Math.exp(-lambda);
    for (let i = 0; i < k; i++) {
      if (i > 0) term = (term * lambda) / i;
      cdf += term;
    }
    return Math.max(0.0001, Math.min(0.9999, 1.0 - cdf));
  }

  _negativeBinomialOver(mean, variance, k) {
    if (k <= 0) return 1.0;
    if (variance <= mean) return this._poissonOver(mean, k);

    const r = (mean * mean) / (variance - mean);
    const p = mean / variance;

    let cdf = 0.0;
    for (let i = 0; i < k; i++) {
      cdf += this._nbPmf(i, r, p);
    }
    return Math.max(0.0001, Math.min(0.9999, 1.0 - cdf));
  }

  _nbPmf(k, r, p) {
    const logGamma = (n) => {
      if (n <= 0) return 0;
      return (n - 0.5) * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI);
    };
    const logPmf = logGamma(k + r) - (logGamma(k + 1) + logGamma(r)) + (r * Math.log(p)) + (k * Math.log(1 - p));
    return Math.exp(logPmf);
  }

  _factorial(n) {
    if (n <= 1) return 1;
    let res = 1;
    for (let i = 2; i <= n; i++) res *= i;
    return res;
  }
}

module.exports = CalibratedProbabilityModel;
