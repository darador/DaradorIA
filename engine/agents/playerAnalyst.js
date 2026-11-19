/**
 * AGENT 1: PLAYER ANALYST
 * Investiga estadísticas individuales, consistencia, titularidad y rol táctico del jugador.
 * Detecta contradicciones entre tendencias superficiales y el rendimiento real.
 */

class PlayerAnalyst {
  constructor() {
    this.name = 'Player Analyst';
    this.version = '1.0.0';
  }

  /**
   * Evalúa el perfil individual del jugador para la selección analizada
   */
  async analyze(candidate, prediction) {
    const isTeamProp = candidate.isTeamProp === true;
    const player = candidate.researchData?.playerData || {};
    const market = candidate.market || '';

    // Si es un mercado de equipo, el análisis individual es de rol colectivo
    if (isTeamProp) {
      return {
        agentName: this.name,
        candidateId: candidate.id,
        target: candidate.playerOrTeam,
        summary: `Mercado colectivo (${candidate.market}). La contribución se evalúa como bloque de equipo.`,
        favorableFindings: ['Mercado no dependiente de la sustitución o rendimiento de un único jugador.'],
        risks: [],
        missingData: [],
        confidenceScore: 0.90,
        recommendation: 'FAVORABLE'
      };
    }

    const favorable = [];
    const risks = [];
    const missing = [];

    const starts = player.starts || 0;
    const avgMins = player.avgMinutes || 0;
    const statP90 = player.statPer90 || 0;
    const hist = player.historicalValues || [];

    // 1. Evaluación de Muestra y Titularidades
    if (starts >= 15) {
      favorable.push(`Muestra sólida de titularidades (${starts} partidos de titular en la temporada).`);
    } else if (starts >= 10) {
      favorable.push(`Muestra aceptable de titularidades (${starts} partidos).`);
    } else {
      risks.push(`Muestra corta de titularidades (${starts} partidos), susceptible a varianza.`);
    }

    // 2. Evaluación de Minutos
    if (avgMins >= 75) {
      favorable.push(`Volumen de minutos elevado (promedia ${avgMins} min por titularidad, titular indiscutido).`);
    } else if (avgMins >= 65) {
      favorable.push(`Minutos suficientes (${avgMins} min en promedio), susceptible a rotaciones tardías.`);
    } else {
      risks.push(`Minutos promedio reducidos (${avgMins} min), alto riesgo de sustitución temprana.`);
    }

    // 3. Consistencia del Stat por 90
    if (statP90 > (candidate.rawLine || 1.5)) {
      favorable.push(`Tasa de producción destacada (${statP90} por 90 min) superando holgadamente la línea exigida (${candidate.line}).`);
    } else {
      risks.push(`Tasa de producción ajustada (${statP90} por 90 min) respecto a la línea (${candidate.line}).`);
    }

    // 4. Regularidad en la serie histórica (descarte de outliers inflados)
    const zeroGames = hist.filter(v => v === 0).length;
    if (hist.length > 0 && (zeroGames / hist.length) > 0.35) {
      risks.push(`Alta dispersión en la serie: en el ${((zeroGames / hist.length) * 100).toFixed(0)}% de los partidos no generó producción.`);
    }

    // 5. Determinación de recomendación
    let recommendation = 'NEUTRAL';
    let confidence = 0.75;

    if (risks.length === 0 && favorable.length >= 2) {
      recommendation = 'FAVORABLE';
      confidence = 0.88;
    } else if (risks.length >= 2) {
      recommendation = 'DESFAVORABLE';
      confidence = 0.60;
    }

    return {
      agentName: this.name,
      candidateId: candidate.id,
      target: candidate.playerOrTeam,
      summary: `${candidate.playerOrTeam} proyecta ${player.projectedMinutes || avgMins} min con una tasa de ${statP90} por 90 min en ${market}.`,
      favorableFindings: favorable,
      risks,
      missingData: missing,
      confidenceScore: confidence,
      recommendation
    };
  }
}

module.exports = new PlayerAnalyst();
