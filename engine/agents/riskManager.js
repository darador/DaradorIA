/**
 * AGENT 6: RISK MANAGER (JUEZ CON POTESTAD DE VETO)
 * Responsable de la validación final del comité de IA:
 * - Recibe la predicción matemática del Prediction Engine
 * - Evalúa los informes de los 5 analistas especializados
 * - Detecta contradicciones, sesgos, riesgos de alineación o noticias adversas
 * - Ejerce potestad de VETO estricto (APROBAR, PENDIENTE, RECHAZAR)
 */

class RiskManager {
  constructor() {
    this.name = 'Risk Manager';
    this.version = '1.0.0';
    this.minEV = 0.07; // +7.0% EV mandatorio
  }

  /**
   * Emite el veredicto definitivo sobre el candidato analizado
   */
  async evaluate(candidate, prediction, agentReports = {}) {
    const pAnalyst = agentReports.playerAnalyst || {};
    const tAnalyst = agentReports.teamAnalyst || {};
    const mContext = agentReports.matchContext || {};
    const oAnalyst = agentReports.oddsAnalyst || {};
    const mIntel = agentReports.matchIntel || {};

    const vetoReasons = [];
    const pendingReasons = [];
    const approvalReasons = [];

    const ev = prediction?.ev || 0;
    const evPercentage = prediction?.evPercentage || 0;
    const uncertainty = prediction?.uncertaintyIndex || 0;
    const isTeamProp = candidate.isTeamProp === true;

    // --- REGLA 1: BARRERA MATEMÁTICA ESTRICTA (NO NEGOCIABLE) ---
    if (ev < this.minEV) {
      vetoReasons.push(`VETO MATEMÁTICO: EV insuficiente (+${evPercentage}% < +${(this.minEV * 100).toFixed(1)}%).`);
    }

    if (uncertainty > 0.38) {
      vetoReasons.push(`VETO POR INCERTIDUMBRE: Dispersión del modelo elevada (${(uncertainty * 100).toFixed(1)}% > 38%).`);
    }

    // --- REGLA 2: CONTROL DE ALINEACIÓN Y SUPLENCIA ---
    if (!isTeamProp) {
      const lineupStatus = candidate.researchData?.lineupData?.status || 'PROBABLE';
      if (lineupStatus === 'SUPLENTE_CONFIRMADO') {
        vetoReasons.push('VETO DE ALINEACIÓN: El jugador no fue incluido en el once titular oficial.');
      } else if (lineupStatus !== 'CONFIRMADA' && lineupStatus !== 'CONFIRMADO') {
        pendingReasons.push('ALINEACIÓN PENDIENTE: Selección aprobada cuantitativamente, supeditada a la confirmación de la planilla oficial (T-60 min).');
      }

      // Alerta de minutos del Player Analyst
      if (pAnalyst.recommendation === 'DESFAVORABLE') {
        vetoReasons.push(`VETO DE JUGADOR: Player Analyst detectó riesgo crítico en minutos o rol (${pAnalyst.risks?.join('; ') || 'Riesgo manifiesto'}).`);
      }
    }

    // --- REGLA 3: CONTRADICCIONES TÁCTICAS (TEAM ANALYST & INTEL) ---
    if (tAnalyst.recommendation === 'DESFAVORABLE') {
      vetoReasons.push(`VETO TÁCTICO: Team Analyst identificó bloqueo en el estilo defensivo del rival (${tAnalyst.risks?.join('; ') || 'Matchup desfavorable'}).`);
    }

    if (mIntel.structuredSignals?.newsRiskDetected === true) {
      vetoReasons.push('VETO DE NOTICIAS: Match Intelligence Analyst detectó novedad de última hora adversa.');
    }

    // --- REGLA 4: ANÁLISIS DE CUOTA (ODDS ANALYST) ---
    if (oAnalyst.recommendation === 'DESFAVORABLE') {
      vetoReasons.push(`VETO DE PRECIO: Odds Analyst determinó que la cuota actual carece de margen frente a la línea justa.`);
    }

    // --- VEREDICTO FINAL ---
    let finalStatus = 'RECHAZADO';
    let finalReason = '';

    if (vetoReasons.length > 0) {
      finalStatus = 'RECHAZADO';
      finalReason = `VETADO: ${vetoReasons.join(' | ')}`;
    } else if (pendingReasons.length > 0) {
      finalStatus = 'PENDIENTE';
      finalReason = pendingReasons.join(' | ');
    } else {
      finalStatus = 'APROBADO';
      finalReason = `UNANIMIDAD DEL COMITÉ DE IA: Aprobado con EV +${evPercentage}% (Cuota: ${candidate.bookmakerOdds}), baja incertidumbre (${(uncertainty * 100).toFixed(1)}%) y consenso favorable de los analistas.`;
    }

    return {
      agentName: this.name,
      candidateId: candidate.id,
      finalStatus,
      finalReason,
      vetoApplied: vetoReasons.length > 0,
      vetoReasons,
      pendingReasons,
      approvalReasons,
      decidedAt: new Date().toISOString()
    };
  }
}

module.exports = new RiskManager();
