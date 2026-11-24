/**
 * AGENT 6: RISK MANAGER (JUEZ CON POTESTAD DE VETO - ELENA)
 * Responsable de la validación final del comité de IA:
 * - Recibe la predicción matemática del Prediction Engine
 * - Evalúa los informes de los 5 analistas especializados
 * - Detecta contradicciones, sesgos, riesgos de alineación o noticias adversas
 * - Ejerce potestad de VETO estricto (APROBAR, PENDIENTE, RECHAZAR)
 * - Nueva Fase 9: Vetos por calidad de datos, muestra corta, probabilidad inflada y fuente no verificada.
 */
const config = require('../config');

class RiskManager {
  constructor() {
    this.name = 'Risk Manager';
    this.alias = 'Elena';
    this.version = '2.0.0';
    this.minEV = config.prediction?.minEV || 0.07; // +7.0% EV mandatorio
  }

  _extractKickoffTimestamp(candidate) {
    if (!candidate) return null;
    if (candidate.kickoffTimestamp || candidate.kickoff_timestamp) {
      const raw = candidate.kickoffTimestamp || candidate.kickoff_timestamp;
      return raw < 10000000000 ? raw * 1000 : raw;
    }
    const iso = candidate.eventDateUtc || candidate.kickoffUtc || candidate.kickoff_utc || candidate.eventDate || candidate.matchTime;
    if (iso) {
      const ts = new Date(iso).getTime();
      if (!isNaN(ts)) return ts;
    }
    return null;
  }

  _isMatchStartedOrFinished(candidate) {
    if (!candidate) return false;
    if (candidate.is_finished === true || candidate.isFinished === true) return true;
    if (candidate.isLive === true || candidate.is_live === true) return true;
    const ms = String(candidate.matchStatus || candidate.match_status || '').toUpperCase();
    return ['FINALIZADO', 'FINISHED', 'EN_CURSO', 'LIVE', 'IN_PLAY', 'STARTED'].includes(ms);
  }

  _isAlreadyExpired(candidate) {
    if (!candidate) return false;
    return (
      candidate.evaluationExpired === true ||
      candidate.status === 'EXPIRADO_SIN_EVALUACION' ||
      candidate.elena_decision === 'EXPIRADO_SIN_EVALUACION' ||
      candidate.evaluationStatus === 'EXPIRED'
    );
  }

  /**
   * Emite el veredicto definitivo sobre el candidato analizado
   */
  async evaluate(candidate, prediction, agentReports = {}, options = {}) {
    const now = typeof options.now === 'number' ? options.now : Date.now();

    // --- REGLA 0 (IRREVERSIBILIDAD Y GUARDA TEMPORAL INDEPENDIENTE) ---
    if (this._isAlreadyExpired(candidate)) {
      const reason = 'VETO TEMPORAL (IRREVERSIBLE): Selección previamente expirada sin evaluación prepartido. Estado EXPIRADO_SIN_EVALUACION preservado.';
      return {
        agentName: this.name,
        alias: this.alias,
        candidateId: candidate.id,
        finalStatus: 'EXPIRADO_SIN_EVALUACION',
        finalReason: reason,
        vetoApplied: true,
        temporalVeto: true,
        evaluationExpired: true,
        evaluationStatus: 'EXPIRED',
        checkpointStatus: candidate.checkpointStatus || 'MISSED',
        expiredAtUtc: candidate.expiredAtUtc || new Date(now).toISOString(),
        blockedApprovalAttempt: {
          attemptedAtUtc: new Date(now).toISOString(),
          preservedStatus: 'EXPIRADO_SIN_EVALUACION',
          reason
        },
        vetoReasons: [reason],
        pendingReasons: [],
        approvalReasons: [],
        decidedAt: new Date(now).toISOString()
      };
    }

    const kickoffTs = this._extractKickoffTimestamp(candidate);
    const isStartedOrFinished = this._isMatchStartedOrFinished(candidate);
    if (isStartedOrFinished || (kickoffTs !== null && now >= kickoffTs)) {
      const reason = isStartedOrFinished
        ? 'VETO TEMPORAL POST-KICKOFF: Partido iniciado o finalizado. No se permiten aprobaciones prepartido.'
        : `VETO TEMPORAL POST-KICKOFF: Kickoff alcanzado (${new Date(kickoffTs).toISOString()} <= ${new Date(now).toISOString()}). No se permiten aprobaciones prepartido tardías.`;
      return {
        agentName: this.name,
        alias: this.alias,
        candidateId: candidate.id,
        finalStatus: 'RECHAZADO',
        finalReason: `VETADO: ${reason}`,
        vetoApplied: true,
        temporalVeto: true,
        evaluationExpired: true,
        evaluationStatus: 'EXPIRED',
        checkpointStatus: 'MISSED',
        expiredAtUtc: new Date(now).toISOString(),
        vetoReasons: [reason],
        pendingReasons: [],
        approvalReasons: [],
        decidedAt: new Date(now).toISOString()
      };
    }

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

    // --- REGLA 1B (FASE 9): CONTROL DE SOBREESTIMACIÓN Y DIVERGENCIA ---
    const projectedProb = prediction?.pProjected ?? prediction?.projectedProb ?? null;
    const bookmakerOdds = candidate.bookmakerOdds || candidate.odds || 0;
    if (projectedProb !== null && projectedProb > 0.85 && bookmakerOdds > 1.60) {
      vetoReasons.push(`VETO POR PROBABILIDAD INFLADA: Probabilidad calculada (${(projectedProb * 100).toFixed(1)}%) sobreoptimista e implausible para cuota de mercado ${bookmakerOdds}.`);
    }

    const divergence = prediction?.modelDivergence ?? null;
    const maxDiv = config.prediction?.maxModelDivergence || 0.15;
    if (divergence !== null && divergence > maxDiv) {
      vetoReasons.push(`VETO POR DIVERGENCIA DE MODELOS: Discrepancia entre Poisson y empírico (${(divergence * 100).toFixed(1)}%) supera umbral máximo (${(maxDiv * 100).toFixed(0)}%).`);
    }

    // --- REGLA 1C (FASE 9): INTEGRIDAD DE DATOS Y TAMAÑO DE MUESTRA ---
    const qualityStatus = candidate.researchData?.qualityStatus;
    if (qualityStatus === 'INVESTIGACION_INCOMPLETA' || qualityStatus === 'ERROR_DATOS') {
      vetoReasons.push(`VETO POR CALIDAD DE DATOS: Investigación incompleta o datos no verificados (${qualityStatus}).`);
    }

    const sampleSize = candidate.sampleSize 
      || candidate.researchData?.sampleSize 
      || candidate.researchData?.validMatches 
      || candidate.researchData?.playerData?.historicalValues?.length 
      || candidate.researchData?.playerData?.observations?.length 
      || 0;

    const minMatchesReq = isTeamProp 
      ? (config.sampling?.minTeamValidMatches || 10) 
      : (config.sampling?.minPlayerValidMatches || 8);

    if (sampleSize > 0 && sampleSize < minMatchesReq) {
      vetoReasons.push(`VETO POR MUESTRA INSUFICIENTE: Muestra real insuficiente (N=${sampleSize} < mínimo requerido ${minMatchesReq}).`);
    }

    if (candidate.verificationStatus === 'ERROR_DE_VERIFICACION') {
      vetoReasons.push('VETO POR INTEGRIDAD DE FUENTE: Error o inconsistencia de verificación en datos de origen.');
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
      alias: this.alias,
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
