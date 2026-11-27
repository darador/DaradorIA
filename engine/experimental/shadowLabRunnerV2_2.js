/**
 * SHADOW LAB RUNNER V2.2 — DARADOR IA 2.0 (FASE 2.6)
 * Ejecutor con Integración Canónica de Datos Históricos (HistoricalDataResolver).
 * 
 * Cohorte: SHADOW_V2.2_HISTORICAL_INTEGRATION
 * 
 * Novedades:
 * 1. Resuelve contratos estrictos COUNT_HISTORY y BINARY_HISTORY mediante HistoricalDataResolver.
 * 2. Prohíbe inventar observaciones sintéticas.
 * 3. Ejecuta Beta-Binomial puro sobre BINARY_HISTORY y Ensamble completo sobre COUNT_HISTORY.
 * 4. Separa explícitamente candidatos VALID, LIMITED e INVALID.
 * 5. Si el estado es INVALID (ej. SIN_HISTORIAL), marca predictionEligible: false y NO imputa 0.50 como válido.
 * 6. Registra auditoría de integridad temporal (kickoff vs source timestamp).
 */

const DataQualityEngine = require('../quality/dataQualityEngine');
const CalibratedProbabilityModel = require('../quality/calibratedProbabilityModel');
const HistoricalDataResolver = require('../quality/historicalDataResolver');
const ValueEngine = require('../value/valueEngine');
const ShadowLabStore = require('./shadowLabStore');

class ShadowLabRunnerV2_2 {
  constructor(options = {}) {
    this.name = 'ShadowLabRunnerV2_2';
    this.version = '2.2.0-historical-integration';
    this.cohortId = 'SHADOW_V2.2_HISTORICAL_INTEGRATION';
    this.dqe = options.dqe || new DataQualityEngine();
    this.resolver = options.resolver || new HistoricalDataResolver();
    this.probModel = options.probModel || new CalibratedProbabilityModel();
    this.valueEngine = options.valueEngine || new ValueEngine();
    this.store = options.store || new ShadowLabStore();
  }

  /**
   * Procesa un candidato de forma pasiva integrando historial canónico
   */
  processCandidate(candidate, v1Prediction = null) {
    if (!candidate || !candidate.id) {
      return { success: false, reason: 'INVALID_CANDIDATE: ID ausente' };
    }

    try {
      // 1. Resolución de Historial Pre-Partido
      const historyResolution = this.resolver.resolveHistory(candidate);

      // 2. Evaluación de Calidad de Datos (DQE)
      const qualityReport = this.dqe.assessQuality(candidate);

      // 3. Extracción de cuota y línea
      const lineStr = String(candidate.line || candidate.rawLine || '0.5');
      const bookmakerOdds = Number(candidate.bookmakerOdds || candidate.odds || candidate.cuota || 1.80);

      // 4. Comparativa V1 (Producción actual)
      const pV1 = v1Prediction?.pProjected !== undefined ? Number(v1Prediction.pProjected) : 
                  (candidate.real_prob !== undefined ? Number(candidate.real_prob) / 100 : null);
      const evV1 = v1Prediction?.evPercentage !== undefined ? Number(v1Prediction.evPercentage) :
                   (candidate.edge_pct !== undefined ? Number(candidate.edge_pct) : null);

      // 5. Evaluación Probabilística V2 según contrato
      let probReport = null;
      let valueReport = null;

      if (historyResolution.predictionEligible) {
        probReport = this.probModel.evaluateCalibratedProbabilityFromContract(historyResolution, {
          adjustments: {
            concessionRatio: candidate.researchData?.opponentData?.concessionRatio || 1.0,
            venueFactor: candidate.match && candidate.team && candidate.match.startsWith(candidate.team) ? 1.05 : 0.96
          }
        });

        if (probReport.pCalibrated !== null) {
          valueReport = this.valueEngine.evaluateValue({
            pCalibrated: probReport.pCalibrated,
            odds: bookmakerOdds,
            uncertaintyIndex: probReport.uncertaintyIndex,
            sampleSize: historyResolution.countHistory?.sampleSize || historyResolution.binaryHistory?.sampleSize || 10,
            market: candidate.market,
            pVoid: probReport.pVoid || 0.0,
            pWin: probReport.pWin,
            pLoss: probReport.pLoss
          });
        }
      }

      // Si es INVALID por falta de historial, se conserva el dictamen explícito sin disfrazarlo de probabilidad válida
      const isEligible = Boolean(probReport && probReport.predictionEligible && probReport.pCalibrated !== null);

      // 6. Registro de Congelamiento Inmutable en la Cohorte V2.2
      const frozenEntry = {
        cohortId: this.cohortId,
        candidateId: candidate.id,
        match: candidate.match || candidate.partido,
        competition: candidate.competition || candidate.league || candidate.liga,
        selection: candidate.playerOrTeam || candidate.player || candidate.team || candidate.seleccion,
        market: candidate.market || candidate.mercado,
        line: lineStr,
        odds: bookmakerOdds,
        
        // Historial Resuelto
        contractType: historyResolution.contractType,
        historySource: historyResolution.source || 'NONE',
        historicalSampleSize: historyResolution.countHistory?.sampleSize || historyResolution.binaryHistory?.sampleSize || 0,
        observationWindow: historyResolution.countHistory?.observationWindow || historyResolution.binaryHistory?.observationWindow || 'NONE',

        // Trazabilidad Temporal Rigurosa (4 Timestamps diferenciados)
        temporalAudit: historyResolution.temporalAudit,
        sourceEventTimestamp: historyResolution.temporalAudit?.sourceEventTimestamp,
        ingestedAt: historyResolution.temporalAudit?.ingestedAt,
        dataCutoffTimestamp: historyResolution.temporalAudit?.dataCutoffTimestamp,
        eventKickoff: historyResolution.temporalAudit?.eventKickoff,

        // Comparativa V1 vs V2
        pV1,
        evV1,
        pV2: isEligible ? probReport.pCalibrated : null,
        pConservative: isEligible ? valueReport.conservativeProb : null,
        grossEvV2: isEligible ? valueReport.grossEvPct : null,
        adjustedEvV2: isEligible ? valueReport.adjustedEvPct : null,
        uncertaintyIndex: isEligible ? probReport.uncertaintyIndex : 0.50,
        predictionEligible: isEligible,

        // DQE Status
        dqeStatus: historyResolution.status, // VALID, LIMITED, INVALID
        eligibleModels: historyResolution.eligibleModels || [],
        ineligibleModels: historyResolution.ineligibleModels || [],
        ineligibleReason: historyResolution.ineligibleReason || null,
        dqeIssues: qualityReport.issues,
        dqeWarnings: qualityReport.warnings,
        valueRating: isEligible ? valueReport.valueRating : 'INVALID_NO_PREDICTION',
        anomaly: isEligible ? valueReport.anomaly : { detected: false, severity: 'NONE', reasons: [] },

        modelVersion: 'v2.2-historical-integration',
        extractorVersion: this.resolver.version,
        isExecutedInProduction: Boolean(candidate.status === 'APROBADO' || candidate.elena_decision === 'APROBADO'),
        isShadowMode: Boolean(candidate.shadow_mode !== false),
        evaluatedAt: new Date().toISOString()
      };

      // Congelar en el almacén
      const freezeResult = this.store.freezePrediction(frozenEntry);

      return {
        success: true,
        candidateId: candidate.id,
        cohortId: this.cohortId,
        predictionEligible: isEligible,
        dqeStatus: historyResolution.status,
        contractType: historyResolution.contractType,
        pV1,
        pV2: isEligible ? probReport.pCalibrated : null,
        evV1,
        evV2: isEligible ? valueReport.grossEvPct : null,
        freezeResult
      };

    } catch (err) {
      console.error(`[ShadowLabRunnerV2_2] Error procesando candidato ${candidate?.id}:`, err.message);
      return {
        success: false,
        candidateId: candidate?.id,
        error: err.message
      };
    }
  }
}

module.exports = ShadowLabRunnerV2_2;
