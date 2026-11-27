/**
 * VALUE ENGINE (VE) — DARADOR IA 2.0 (FASE 1)
 * Módulo independiente para evaluación de rentabilidad, cuota justa y valor esperado.
 * 
 * Filosofía: Quality First / Balanced
 * - Calcula probabilidad implícita pura: 1 / cuota.
 * - Calcula cuota justa del modelo: 1 / pEstimada.
 * - Calcula EV Bruto: (pEstimada * cuota) - 1.
 * - Calcula EV Ajustado por Incertidumbre: penalización proporcional al error estándar de p.
 * - Evalúa sensibilidad del EV frente a fluctuaciones en cuota y probabilidad.
 * - Genera anomalías ante EV extraordinarios (> +25% en cuota > 1.80) sin recortar artificialmente el valor.
 */

class ValueEngine {
  constructor(customConfig = {}) {
    this.config = {
      extraordinaryEvThreshold: customConfig.extraordinaryEvThreshold || 0.25, // +25%
      highOddsThreshold: customConfig.highOddsThreshold || 1.80,              // Cuotas > 1.80
      minAcceptableEv: customConfig.minAcceptableEv || 0.05,                   // +5% EV mínimo
      uncertaintyRiskAversion: customConfig.uncertaintyRiskAversion || 0.50   // Coeficiente de ajuste
    };
  }

  /**
   * Ejecuta el análisis completo de valor sobre una probabilidad calibrada
   * @param {Object} params { pCalibrated, odds, uncertaintyIndex, sampleSize, market, pVoid, pWin, pLoss }
   * @returns {Object} Dictamen completo de valor y anomalías
   */
  evaluateValue(params) {
    const {
      pCalibrated,
      odds,
      uncertaintyIndex = 0.15,
      sampleSize = 15,
      market = 'General',
      pVoid = 0.0,
      pWin = null,
      pLoss = null
    } = params;

    const bookmakerOdds = Number(odds);
    const pEst = Number(pWin !== null && pWin !== undefined ? pWin : pCalibrated);
    const pPush = Number(pVoid || 0.0);
    const pDefeat = Number(pLoss !== null && pLoss !== undefined ? pLoss : Math.max(0, 1.0 - pEst - pPush));

    if (!Number.isFinite(bookmakerOdds) || bookmakerOdds <= 1.0) {
      return {
        valid: false,
        error: 'Cuota de casa inválida o menor/igual a 1.0'
      };
    }

    if (!Number.isFinite(pEst) || pEst <= 0.0 || pEst > 1.0) {
      return {
        valid: false,
        error: 'Probabilidad calibrada fuera del rango válido (0, 1]'
      };
    }

    // 1. Probabilidades y Cuotas
    const impliedProb = 1 / bookmakerOdds;
    const fairOdds = 1 / pEst;

    // 2. EV Bruto (Contemplando Push / VOID de forma rigurosa)
    // Fórmula 1: EV = P(win) * (cuota - 1) - P(loss)
    // Equivalencia exacta: EV = P(win) * cuota + P(void) - 1, ya que P(win) + P(loss) + P(void) = 1.0
    const grossEv = (pEst * (bookmakerOdds - 1)) - pDefeat;
    const grossEvPct = Number((grossEv * 100).toFixed(2));

    // 3. EV Ajustado por Incertidumbre
    // Penaliza el EV reduciendo pEst en función de la incertidumbre: pConservative = pEst * (1 - u * lambda)
    const conservativeP = Math.max(0.01, pEst * (1 - (uncertaintyIndex * this.config.uncertaintyRiskAversion)));
    const conservativeLoss = Math.max(0, 1.0 - conservativeP - pPush);
    const adjustedEv = (conservativeP * (bookmakerOdds - 1)) - conservativeLoss;
    const adjustedEvPct = Number((adjustedEv * 100).toFixed(2));

    // 4. Sensibilidad del EV
    // ¿Cuánto puede caer la probabilidad real antes de que el EV sea negativo?
    const breakEvenProb = impliedProb;
    const marginOfSafetyProb = pEst - breakEvenProb;
    const marginOfSafetyPct = Number((marginOfSafetyProb * 100).toFixed(2));

    // Sensibilidad ante movimiento de cuota (línea de cierre): si la cuota cae 5% y 10%
    const evIfOddsDrop5Pct = (pEst * (bookmakerOdds * 0.95)) - 1;
    const evIfOddsDrop10Pct = (pEst * (bookmakerOdds * 0.90)) - 1;

    // 5. Detección de Anomalías y EV Extraordinario
    const isExtraordinary = grossEv >= this.config.extraordinaryEvThreshold && bookmakerOdds >= this.config.highOddsThreshold;
    const anomalyReport = {
      detected: isExtraordinary,
      severity: isExtraordinary ? (grossEv >= 0.40 ? 'CRITICAL' : 'HIGH') : 'NONE',
      reasons: []
    };

    if (isExtraordinary) {
      anomalyReport.reasons.push(
        `EV extraordinario detectado (+${grossEvPct}% en cuota @${bookmakerOdds.toFixed(2)}). Excede el umbral del ${(this.config.extraordinaryEvThreshold * 100).toFixed(0)}%.`
      );
      if (sampleSize < 15) {
        anomalyReport.reasons.push(`Muestra estadística reducida (n=${sampleSize}). Alta probabilidad de sesgo o Mirage Trend.`);
      }
      if (uncertaintyIndex > 0.25) {
        anomalyReport.reasons.push(`Índice de incertidumbre elevado (${(uncertaintyIndex * 100).toFixed(1)}%).`);
      }
    }

    // 6. Dictamen de Calidad de Valor
    let valueRating = 'NO_VALUE';
    if (grossEv >= this.config.minAcceptableEv) {
      if (adjustedEv >= 0.02 && !isExtraordinary) {
        valueRating = 'STRONG_VALUE';
      } else if (isExtraordinary) {
        valueRating = 'SUSPICIOUS_HIGH_VALUE';
      } else {
        valueRating = 'MARGINAL_VALUE';
      }
    }

    return {
      valid: true,
      market,
      bookmakerOdds,
      impliedProb: Number(impliedProb.toFixed(4)),
      fairOdds: Number(fairOdds.toFixed(2)),
      pEstimated: pEst,
      conservativeProb: Number(conservativeP.toFixed(4)),
      
      // EV Metrics
      grossEv: Number(grossEv.toFixed(4)),
      grossEvPct,
      adjustedEv: Number(adjustedEv.toFixed(4)),
      adjustedEvPct,

      // Sensibilidad
      sensitivity: {
        breakEvenProb: Number(breakEvenProb.toFixed(4)),
        marginOfSafetyProb: Number(marginOfSafetyProb.toFixed(4)),
        marginOfSafetyPct,
        evAtMinus5PctOdds: Number((evIfOddsDrop5Pct * 100).toFixed(2)),
        evAtMinus10PctOdds: Number((evIfOddsDrop10Pct * 100).toFixed(2))
      },

      // Auditoría de anomalías (No recorta artificialmente, etiqueta y exige revisión)
      anomaly: anomalyReport,
      valueRating,
      evaluatedAt: new Date().toISOString()
    };
  }
}

module.exports = ValueEngine;
