/**
 * AGENT 4: ODDS ANALYST
 * Analiza el mercado de apuestas, comparativa entre bookmakers,
 * margen implícito, discrepancias de cuotas y potencial de CLV (Closing Line Value).
 */

class OddsAnalyst {
  constructor() {
    this.name = 'Odds Analyst';
    this.version = '1.0.0';
  }

  /**
   * Evalúa las cuotas del mercado frente a la cuota justa calculada
   */
  async analyze(candidate, prediction) {
    const bookmakerOdds = Number(candidate.bookmakerOdds || 1.75);
    const fairOdds = prediction?.fairOdds || (1 / (prediction?.pProjected || 0.60));
    const evPercentage = prediction?.evPercentage || 0;
    const outlierData = candidate.rawSourceData?.edge ? candidate.rawSourceData : null;

    const observedDiscrepancies = [];
    const risks = [];
    const advantages = [];

    // 1. Análisis de Cuota Justa vs Cuota de Mercado
    if (bookmakerOdds > fairOdds) {
      advantages.push(`Cuota disponible (${bookmakerOdds}) supera la cuota justa estimada (${fairOdds.toFixed(2)}), generando un EV positivo del +${evPercentage}%.`);
    } else {
      risks.push(`Cuota insuficiente: la cuota (${bookmakerOdds}) no cubre la probabilidad real proyectada (cuota justa: ${fairOdds.toFixed(2)}).`);
    }

    // 2. Discrepancias entre Casas (Outlier pricing)
    if (outlierData) {
      const avgOdds = outlierData.averageOdds || bookmakerOdds;
      const edge = outlierData.edge ? (outlierData.edge * 100).toFixed(1) : '0';
      observedDiscrepancies.push(`Discrepancia de mercado detectada: precio de ${bookmakerOdds} vs promedio de otras casas (${avgOdds}) [Divergencia: +${edge}%].`);
    }

    // 3. Rango Operativo
    if (bookmakerOdds >= 1.65 && bookmakerOdds <= 2.20) {
      advantages.push(`Cuota en rango óptimo de balance rentabilidad/varianza (${bookmakerOdds}).`);
    } else if (bookmakerOdds > 2.25) {
      risks.push(`Cuota elevada (${bookmakerOdds}), mayor exposición a varianza a corto plazo.`);
    }

    // 4. Potencial de CLV
    let clvPotential = 'MODERADO';
    if (evPercentage >= 15 && outlierData) {
      clvPotential = 'ALTO: la cuota actual ofrece valor prematuro antes del ajuste de mercado.';
    } else if (evPercentage < 8) {
      clvPotential = 'BAJO: margen muy ajustado respecto a la línea de cierre probable.';
    }

    // 5. Recomendación
    let recommendation = 'NEUTRAL';
    let confidence = 0.80;

    if (advantages.length >= 2 && risks.length === 0) {
      recommendation = 'FAVORABLE';
      confidence = 0.90;
    } else if (risks.length >= 1) {
      recommendation = 'DESFAVORABLE';
      confidence = 0.65;
    }

    return {
      agentName: this.name,
      candidateId: candidate.id,
      marketAnalysis: `Análisis de mercado para ${candidate.market} @ ${bookmakerOdds} (${candidate.bookmaker || 'bet365'}). Cuota justa: ${fairOdds.toFixed(2)}. EV: +${evPercentage}%.`,
      referenceOdds: bookmakerOdds,
      bestOdds: bookmakerOdds,
      fairOdds: Number(fairOdds.toFixed(2)),
      observedDiscrepancies,
      risks,
      clvAssessment: clvPotential,
      confidenceScore: confidence,
      recommendation
    };
  }
}

module.exports = new OddsAnalyst();
