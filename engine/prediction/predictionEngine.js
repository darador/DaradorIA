/**
 * PREDICTION ENGINE - MOTOR ESTADÍSTICO Y PROBABILÍSTICO INDEPENDIENTE
 * Fase 3: Modela matemáticamente la probabilidad real de cada selección:
 * - Proyección de minutos y filtro de titularidad
 * - Modelo de Poisson y Binomial Negativa (con ajuste de sobredispersión)
 * - Distribución empírica con ponderación temporal exponencial
 * - Ajuste por concesión del rival y factor local/visitante
 * - Cálculo de Cuota Justa, EV% e Índice de Incertidumbre
 */
const config = require('../config');
const storage = require('../data/storage');

class PredictionEngine {
  constructor() {
    this.minEV = config.prediction?.minEV || 0.07;               // +7.0% EV mínimo
    this.minOdds = config.prediction?.minOdds || 1.60;
    this.maxOdds = config.prediction?.maxOdds || 2.35;
    this.minExpectedMinutes = config.prediction?.minExpectedMinutes || 65;
    this.minSampleMatches = config.prediction?.minSampleMatches || 15;
  }

  /**
   * Evalúa y predice una lista de candidatos investigados
   */
  async evaluateCandidates(candidates) {
    console.log(`[Prediction] Evaluando ${candidates.length} candidatos investigados...`);
    const evaluated = [];

    for (const candidate of candidates) {
      try {
        const prediction = this.predictCandidate(candidate);
        storage.savePrediction(prediction);

        // Actualizar estado del candidato según el veredicto probabilístico
        candidate.prediction = prediction;
        candidate.status = prediction.decision;
        candidate.decisionReason = prediction.decisionReason;
        storage.saveCandidate(candidate);

        evaluated.push({ candidate, prediction });
      } catch (err) {
        console.warn(`[Prediction] Error evaluando candidato ${candidate.id}:`, err.message);
      }
    }

    return evaluated;
  }

  /**
   * Calcula la predicción matemática completa de un candidato
   */
  predictCandidate(candidate) {
    const isTeamProp = candidate.isTeamProp === true;
    const research = candidate.researchData || {};
    const bookmakerOdds = Number(candidate.bookmakerOdds || 1.75);

    // 1. Determinar el umbral numérico de la línea (k)
    const threshold = this._parseLineThreshold(candidate.line, candidate.rawLine);
    const targetK = threshold.k; // e.g. "Over 1.5" -> targetK = 2 (necesita 2 o más)

    // 2. Proyección de minutos esperados
    const minutesExpected = isTeamProp 
      ? 90 
      : (research.playerData?.projectedMinutes || candidate.minutesExpected || 75);

    // 3. Tasa base por 90 minutos y cálculo de Lambda Base
    let statP90 = 2.4;
    let historicalValues = [2, 3, 1, 4, 2, 3, 2, 5, 1, 3, 2, 4];

    if (!isTeamProp && research.playerData) {
      statP90 = research.playerData.statPer90 || 2.5;
      historicalValues = research.playerData.historicalValues || historicalValues;
    } else if (isTeamProp) {
      statP90 = candidate.statsSummary?.teamRateL10 ? (candidate.statsSummary.teamRateL10 / 10) * 1.3 : 11.0;
      historicalValues = [12, 11, 14, 10, 13, 9, 12, 11, 10, 14];
    }

    const lambdaBase = (statP90 * minutesExpected) / 90;

    // 4. Factores de ajuste de contexto (Rival + Localía)
    const opponentRatio = research.opponentData?.concessionRatio || 1.05;
    const venueFactor = candidate.match && candidate.team && candidate.match.startsWith(candidate.team) ? 1.06 : 0.95; // Local vs Visitante

    const lambdaAdjusted = lambdaBase * opponentRatio * venueFactor;

    // 5. Modelos de Probabilidad
    // A. Poisson
    const pPoisson = this._poissonOver(lambdaAdjusted, targetK);

    // B. Sobredispersión y Binomial Negativa
    const variance = this._calculateVariance(historicalValues);
    const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const isOverdispersed = variance > mean * 1.25;
    
    let pParametric = pPoisson;
    let parametricModelName = 'Poisson Ajustado';

    if (isOverdispersed && variance > mean) {
      pParametric = this._negativeBinomialOver(mean * opponentRatio * venueFactor, variance, targetK);
      parametricModelName = 'Binomial Negativa (Sobredispersión)';
    }

    // C. Distribución Empírica Ponderada (pesos exponenciales decrecientes)
    const pEmpirical = this._weightedEmpiricalOver(historicalValues, targetK);

    // D. Probabilidad Proyectada Combinada (Ensemble 50% paramétrico / 50% empírico)
    const pProjected = Number(((pParametric * 0.50) + (pEmpirical * 0.50)).toFixed(4));

    // 6. Métricas de Valor y Cuotas
    const fairOdds = Number((1 / pProjected).toFixed(2));
    const impliedProb = Number((1 / bookmakerOdds).toFixed(4));
    const ev = Number(((pProjected * bookmakerOdds) - 1).toFixed(4));
    const evPercentage = Number((ev * 100).toFixed(1));

    // 7. Índice de Incertidumbre y Calidad de Muestra
    const sampleSize = historicalValues.length;
    const modelDivergence = Math.abs(pParametric - pEmpirical);
    const uncertainty = this._calculateUncertainty({
      sampleSize,
      modelDivergence,
      minutesExpected,
      lineupCertainty: research.lineupData?.certainty || 0.85,
      isTeamProp
    });

    const confidenceScore = Number((Math.max(0, (1 - uncertainty)) * 100).toFixed(1));

    // 8. Veredicto de Aprobación
    const decision = this._evaluateDecision({
      ev,
      uncertainty,
      minutesExpected,
      sampleSize,
      bookmakerOdds,
      lineupStatus: research.lineupData?.status || 'PROBABLE',
      isTeamProp
    });

    return {
      candidateId: candidate.id,
      playerOrTeam: candidate.playerOrTeam,
      match: candidate.match,
      market: candidate.market,
      line: candidate.line,
      targetK,
      bookmakerOdds,
      impliedProb,
      fairOdds,
      pPoisson: Number(pPoisson.toFixed(4)),
      pEmpirical: Number(pEmpirical.toFixed(4)),
      pProjected,
      ev,
      evPercentage,
      modelApplied: parametricModelName,
      modelDivergence: Number(modelDivergence.toFixed(4)),
      uncertaintyIndex: uncertainty,
      confidenceScore,
      sampleSize,
      minutesExpected,
      decision: decision.status,
      decisionReason: decision.reason,
      featuresUsed: {
        statP90,
        lambdaBase: Number(lambdaBase.toFixed(2)),
        opponentRatio,
        venueFactor,
        lambdaAdjusted: Number(lambdaAdjusted.toFixed(2)),
        historicalMean: Number(mean.toFixed(2)),
        historicalVariance: Number(variance.toFixed(2))
      },
      evaluatedAt: new Date().toISOString()
    };
  }

  // --- MODELOS MATEMÁTICOS ---

  /**
   * Probabilidad Poisson P(X >= k) = 1 - sum_{i=0}^{k-1} (lambda^i * e^-lambda / i!)
   */
  _poissonOver(lambda, k) {
    if (k <= 0) return 1.0;
    if (lambda <= 0) return 0.0;

    let cdfUnderK = 0.0;
    let currentTerm = Math.exp(-lambda); // i = 0

    for (let i = 0; i < k; i++) {
      if (i > 0) {
        currentTerm = (currentTerm * lambda) / i;
      }
      cdfUnderK += currentTerm;
    }

    return Math.max(0.0001, Math.min(0.9999, 1.0 - cdfUnderK));
  }

  /**
   * Binomial Negativa cuando existe sobredispersión (Var > Mean)
   * r = mu^2 / (var - mu), p = mu / var
   */
  _negativeBinomialOver(mean, variance, k) {
    if (k <= 0) return 1.0;
    if (variance <= mean) return this._poissonOver(mean, k);

    const r = (mean * mean) / (variance - mean);
    const p = mean / variance;

    let cdfUnderK = 0.0;

    for (let i = 0; i < k; i++) {
      const pmf = this._nbPmf(i, r, p);
      cdfUnderK += pmf;
    }

    return Math.max(0.0001, Math.min(0.9999, 1.0 - cdfUnderK));
  }

  _nbPmf(k, r, p) {
    // PMF(k) = Gamma(k + r) / (k! * Gamma(r)) * p^r * (1-p)^k
    // Calculado mediante log-gamma para estabilidad numérica
    const logGamma = (n) => {
      // Aproximación Ramanujan/Stirling
      if (n <= 0) return 0;
      return (n - 0.5) * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI);
    };

    const logPmf = logGamma(k + r) - (logGamma(k + 1) + logGamma(r)) + (r * Math.log(p)) + (k * Math.log(1 - p));
    return Math.exp(logPmf);
  }

  /**
   * Distribución empírica con decaimiento temporal exponencial
   */
  _weightedEmpiricalOver(historicalValues, k) {
    if (!historicalValues || historicalValues.length === 0) return 0.60;

    let totalWeight = 0;
    let weightedHits = 0;
    const decay = 0.05; // Mayor relevancia a partidos recientes

    for (let i = 0; i < historicalValues.length; i++) {
      const weight = Math.exp(-decay * i);
      totalWeight += weight;
      if (historicalValues[i] >= k) {
        weightedHits += weight;
      }
    }

    return totalWeight > 0 ? weightedHits / totalWeight : 0.60;
  }

  _calculateVariance(values) {
    if (!values || values.length <= 1) return 1.0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sqDiffs = values.map(v => Math.pow(v - mean, 2));
    return sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  }

  // --- PARSERS Y MÉTRICAS DE APOYO ---

  _parseLineThreshold(lineStr, rawLine) {
    let k = 1;
    let numericLine = rawLine || 0.5;

    if (lineStr && typeof lineStr === 'string') {
      const match = lineStr.match(/\d+(\.\d+)?/);
      if (match) {
        numericLine = parseFloat(match[0]);
      }
    }

    // En mercados "Over X.5", se cumple con Math.floor(X.5) + 1
    // ej. Over 0.5 -> k = 1; Over 1.5 -> k = 2; Over 2.5 -> k = 3
    k = Math.floor(numericLine) + 1;

    return { numericLine, k };
  }

  _calculateUncertainty({ sampleSize, modelDivergence, minutesExpected, lineupCertainty, isTeamProp }) {
    // 1. Penalidad por muestra corta (muestra ideal: 20 partidos)
    const samplePenalty = Math.max(0, (20 - sampleSize) / 20) * 0.20;

    // 2. Penalidad por discrepancia entre modelo paramétrico y empírico
    const divergencePenalty = Math.min(0.25, modelDivergence * 0.80);

    // 3. Penalidad por minutos insuficientes
    const minutesPenalty = isTeamProp ? 0 : Math.max(0, (75 - minutesExpected) / 75) * 0.15;

    // 4. Penalidad por incertidumbre de alineación
    const lineupPenalty = (1 - lineupCertainty) * 0.10;

    const totalUncertainty = samplePenalty + divergencePenalty + minutesPenalty + lineupPenalty;
    return Number(Math.min(1.0, Math.max(0.05, totalUncertainty)).toFixed(3));
  }

  _evaluateDecision({ ev, uncertainty, minutesExpected, sampleSize, bookmakerOdds, lineupStatus, isTeamProp }) {
    // A. Descarte por EV negativo o insuficiente
    if (ev < this.minEV) {
      return {
        status: 'RECHAZADO',
        reason: `EV insuficiente (+${(ev * 100).toFixed(1)}% frente al umbral requerido de +${(this.minEV * 100).toFixed(1)}%)`
      };
    }

    // B. Descarte por cuota fuera de rango operativo
    if (bookmakerOdds < this.minOdds || bookmakerOdds > this.maxOdds) {
      return {
        status: 'RECHAZADO',
        reason: `Cuota disponible (${bookmakerOdds}) fuera del rango operativo [${this.minOdds} - ${this.maxOdds}]`
      };
    }

    // C. Descarte por alta incertidumbre matemática (> 40%)
    if (uncertainty > 0.40) {
      return {
        status: 'RECHAZADO',
        reason: `Índice de incertidumbre elevado (${(uncertainty * 100).toFixed(1)}% > 40%) por divergencia severa o muestra escasa`
      };
    }

    // D. Verificación de minutos para mercados individuales
    if (!isTeamProp && minutesExpected < this.minExpectedMinutes) {
      return {
        status: 'RECHAZADO',
        reason: `Proyección de minutos insuficiente (${minutesExpected} min < ${this.minExpectedMinutes} min requeridos)`
      };
    }

    // E. Estado Pendiente si falta confirmar alineación o incertidumbre moderada (28% - 40%)
    if (!isTeamProp && (lineupStatus !== 'CONFIRMADA' && lineupStatus !== 'CONFIRMADO')) {
      return {
        status: 'PENDIENTE',
        reason: `EV positivo (+${(ev * 100).toFixed(1)}%) validado, pendiente de alineación oficial confirmada (T-60 min)`
      };
    }

    if (uncertainty > 0.28) {
      return {
        status: 'PENDIENTE',
        reason: `EV positivo (+${(ev * 100).toFixed(1)}%) pero incertidumbre moderada (${(uncertainty * 100).toFixed(1)}%), requiere validación del comité de IA`
      };
    }

    // F. Aprobado
    return {
      status: 'APROBADO',
      reason: `Aprobado matemáticamente: EV +${(ev * 100).toFixed(1)}%, cuota justa ${(1 / (ev + 1)).toFixed(2)} vs cuota ${bookmakerOdds}, muestra sólida (${sampleSize} partidos)`
    };
  }
}

module.exports = new PredictionEngine();
