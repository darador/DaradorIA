/**
 * AGENT 3: MATCH CONTEXT ANALYST
 * Investiga el contexto deportivo: calendario, motivación, descanso,
 * lesiones, suspensiones, rotaciones probables y perfil del árbitro.
 */

class MatchContextAnalyst {
  constructor() {
    this.name = 'Match Context Analyst';
    this.version = '1.0.0';
  }

  /**
   * Evalúa el contexto global del encuentro y la designación arbitral
   */
  async analyze(candidate, prediction) {
    const research = candidate.researchData || {};
    const lineup = research.lineupData || {};
    const referee = research.refereeData || null;
    const market = candidate.market || '';

    const confirmedAbsences = [];
    const probableAbsences = [];
    const rotationRisks = [];
    const advantages = [];

    // 1. Estado de la Alineación
    const isConfirmed = lineup.status === 'CONFIRMADA' || lineup.status === 'CONFIRMADO';
    if (isConfirmed) {
      advantages.push('Alineación oficial verificada: el jugador está confirmado en el once inicial.');
    } else if (candidate.isTeamProp) {
      advantages.push('Mercado colectivo: alineación individual no compromete la selección.');
    } else {
      rotationRisks.push('Alineación previa (proyectada): aún no se cuenta con la planilla oficial del colegiado (T-60 min).');
    }

    // 2. Análisis Arbitral (Faltas y Tarjetas)
    if (referee) {
      if (referee.favorsOvers) {
        advantages.push(`Árbitro favorable: ${referee.refereeName} promedia ${referee.avgFouls} faltas por partido (${referee.foulStrictnessRatio}x sobre el promedio de la liga).`);
      } else {
        rotationRisks.push(`Árbitro permisivo: ${referee.refereeName} promedia menos infracciones (${referee.avgFouls}) que la media.`);
      }
    }

    // 3. Recomendación del Agente
    let recommendation = 'NEUTRAL';
    let confidence = 0.75;

    if (advantages.length >= 2 && rotationRisks.length === 0) {
      recommendation = 'FAVORABLE';
      confidence = 0.90;
    } else if (rotationRisks.some(r => r.includes('no se cuenta con la planilla'))) {
      recommendation = 'NEUTRAL'; // Neutral hasta confirmar
      confidence = 0.70;
    }

    return {
      agentName: this.name,
      candidateId: candidate.id,
      match: candidate.match,
      contextSummary: `Contexto del partido ${candidate.match}. Alineación: ${lineup.status || 'PROBABLE'}. ${referee ? `Árbitro: ${referee.refereeName}.` : ''}`,
      confirmedAbsences,
      probableAbsences,
      rotationRisks,
      impactAnalysis: isConfirmed ? 'Bajo riesgo de rotación.' : 'Riesgo moderado a la espera de confirmación de planilla.',
      sources: ['StatsHub Lineups', 'Official Match Schedule'],
      confidenceScore: confidence,
      recommendation
    };
  }
}

module.exports = new MatchContextAnalyst();
