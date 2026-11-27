/**
 * SHADOW LAB RUNNER V2 — DARADOR IA 2.0 (FASE 2)
 * Ejecutor paralelo, pasivo y desacoplado del pipeline productivo.
 * 
 * Garantías de no-interferencia:
 * - NO bloquea ni interrumpe el flujo de discovery o predicción de producción.
 * - Captura errores de forma aislada (try/catch silencioso o logging de advertencia).
 * - NO tiene autoridad de veto ni altera decisiones de Elena o del Daily Board.
 * - Ejecuta DataQualityEngine, CalibratedProbabilityModel y ValueEngine.
 * - Registra la comparación V1 vs V2 y congela los datos en ShadowLabStore.
 */

const DataQualityEngine = require('../quality/dataQualityEngine');
const CalibratedProbabilityModel = require('../quality/calibratedProbabilityModel');
const ValueEngine = require('../value/valueEngine');
const ShadowLabStore = require('./shadowLabStore');

class ShadowLabRunnerV2 {
  constructor(options = {}) {
    this.name = 'ShadowLabRunnerV2';
    this.version = '2.0.0-shadow-lab';
    this.dqe = options.dqe || new DataQualityEngine();
    this.probModel = options.probModel || new CalibratedProbabilityModel();
    this.valueEngine = options.valueEngine || new ValueEngine();
    this.store = options.store || new ShadowLabStore();
  }

  /**
   * Procesa un candidato de forma pasiva en paralelo a la predicción V1
   * @param {Object} candidate Candidato analizado por el pipeline
   * @param {Object} v1Prediction Predicción generada por PredictionEngine V1 (opcional)
   * @returns {Object} Resultado de la evaluación Shadow V2
   */
  processCandidate(candidate, v1Prediction = null) {
    if (!candidate || !candidate.id) {
      return { success: false, reason: 'INVALID_CANDIDATE: ID ausente' };
    }

    try {
      // 1. Evaluación de Calidad de Datos (DQE)
      const qualityReport = this.dqe.assessQuality(candidate);

      // 2. Extracción de Parámetros
      const isTeam = qualityReport.isTeam;
      const rawData = candidate.researchData || candidate;
      const history = isTeam 
        ? (rawData.teamData?.observations || rawData.teamData?.historicalValues || candidate.historicalValues || [])
        : (rawData.playerData?.observations || rawData.playerData?.historicalValues || candidate.historicalValues || []);

      const lineStr = String(candidate.line || candidate.rawLine || '0.5');
      const isOver = !lineStr.toLowerCase().includes('menos') && !lineStr.toLowerCase().includes('under');
      const targetK = Math.floor(parseFloat(lineStr.replace(/[^0-9.]/g, '')) || 0.5) + 1;
      const bookmakerOdds = Number(candidate.bookmakerOdds || candidate.odds || candidate.cuota || 1.80);

      // 3. Probabilidad Calibrada con Beta-Binomial Shrinkage (V2)
      const probReport = this.probModel.evaluateCalibratedProbability({
        historicalValues: history,
        targetK,
        isOver,
        marketName: candidate.market,
        qualityStatus: qualityReport.status,
        adjustments: {
          concessionRatio: rawData.opponentData?.concessionRatio || 1.0,
          venueFactor: candidate.match && candidate.team && candidate.match.startsWith(candidate.team) ? 1.05 : 0.96
        }
      });

      // 4. Evaluación de Valor y Anomalías (Value Engine)
      const valueReport = this.valueEngine.evaluateValue({
        pCalibrated: probReport.pCalibrated,
        odds: bookmakerOdds,
        uncertaintyIndex: probReport.uncertaintyIndex,
        sampleSize: history.length,
        market: candidate.market
      });

      // 5. Comparativa V1 vs V2
      const pV1 = v1Prediction?.pProjected !== undefined ? Number(v1Prediction.pProjected) : 
                  (candidate.real_prob !== undefined ? Number(candidate.real_prob) / 100 : null);
      const evV1 = v1Prediction?.evPercentage !== undefined ? Number(v1Prediction.evPercentage) :
                   (candidate.edge_pct !== undefined ? Number(candidate.edge_pct) : null);

      // 6. Registro de Congelamiento Inmutable
      const frozenEntry = {
        candidateId: candidate.id,
        match: candidate.match || candidate.partido,
        competition: candidate.competition || candidate.league || candidate.liga,
        selection: candidate.playerOrTeam || candidate.player || candidate.seleccion,
        market: candidate.market || candidate.mercado,
        line: candidate.line || candidate.linea,
        odds: bookmakerOdds,
        historicalSample: history,
        sampleSize: history.length,
        isTeam,
        isOver,
        targetK,

        // Comparativa V1 vs V2
        pV1,
        evV1,
        pV2: probReport.pCalibrated,
        pShrinkage: probReport.pShrinkage,
        pCountDistribution: probReport.pCountDistribution,
        pConservative: valueReport.conservativeProb,
        grossEvV2: valueReport.grossEvPct,
        adjustedEvV2: valueReport.adjustedEvPct,
        uncertaintyIndex: probReport.uncertaintyIndex,

        // DQE y Diagnóstico
        dqeStatus: qualityReport.status,
        dqeScore: qualityReport.qualityScore,
        dqeIssues: qualityReport.issues,
        dqeWarnings: qualityReport.warnings,
        valueRating: valueReport.valueRating,
        anomaly: valueReport.anomaly,

        modelDetails: {
          modelUsed: probReport.modelUsed,
          varianceRatio: probReport.varianceRatio,
          sampleWeight: probReport.sampleWeight,
          priorUsed: this.probModel.priors[candidate.market?.toLowerCase()] || this.probModel.priors['default']
        },

        isExecutedInProduction: Boolean(candidate.status === 'APROBADO' || candidate.elena_decision === 'APROBADO'),
        isShadowMode: Boolean(candidate.shadow_mode !== false),
        evaluatedAt: new Date().toISOString()
      };

      // Congelar en el almacén aislado
      const freezeResult = this.store.freezePrediction(frozenEntry);

      return {
        success: true,
        candidateId: candidate.id,
        freezeResult,
        v2Comparison: {
          pV1,
          pV2: probReport.pCalibrated,
          diffProb: pV1 !== null ? Number((probReport.pCalibrated - pV1).toFixed(4)) : null,
          evV1,
          evV2: valueReport.grossEvPct,
          anomalyDetected: valueReport.anomaly.detected
        }
      };

    } catch (err) {
      console.warn(`[ShadowLabRunnerV2] Error no bloqueante procesando ${candidate.id}:`, err.message);
      return {
        success: false,
        candidateId: candidate.id,
        error: err.message,
        faultTolerant: true
      };
    }
  }

  /**
   * Procesa un lote de candidatos de forma segura
   */
  processBatch(candidates, predictionsMap = {}) {
    const results = [];
    for (const c of candidates) {
      const pred = predictionsMap[c.id] || c.prediction || null;
      results.push(this.processCandidate(c, pred));
    }
    return results;
  }
}

module.exports = ShadowLabRunnerV2;
