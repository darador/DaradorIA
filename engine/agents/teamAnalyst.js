/**
 * AGENT 2: TEAM ANALYST
 * Analiza el comportamiento táctico colectivo, estilos de juego,
 * fortalezas ofensivas y vulnerabilidades defensivas del rival.
 */

class TeamAnalyst {
  constructor() {
    this.name = 'Team Analyst';
    this.version = '1.0.0';
  }

  /**
   * Evalúa el matchup colectivo entre el equipo y el rival
   */
  async analyze(candidate, prediction) {
    const opponent = candidate.researchData?.opponentData || {};
    const team = candidate.team || 'Equipo';
    const opponentName = candidate.opponent || 'Rival';
    const market = candidate.market || '';

    const advantages = [];
    const risks = [];
    const missing = [];

    const concessionRatio = opponent.concessionRatio || 1.0;
    const isVulnerable = opponent.isVulnerable === true;

    // 1. Análisis de Concesión del Rival
    if (concessionRatio >= 1.15) {
      advantages.push(`Vulnerabilidad defensiva marcada de ${opponentName}: concede un ${((concessionRatio - 1) * 100).toFixed(1)}% más de ${market} que la media del torneo.`);
    } else if (concessionRatio >= 1.05) {
      advantages.push(`Rival permisivo: ${opponentName} concede ligeramente por encima del promedio (${concessionRatio}x).`);
    } else if (concessionRatio <= 0.88) {
      risks.push(`Defensa cerrada: ${opponentName} concede un ${((1 - concessionRatio) * 100).toFixed(1)}% menos de ${market} que el promedio de la liga.`);
    }

    // 2. Localía / Visitante
    const isHome = candidate.match && candidate.match.startsWith(team);
    if (isHome) {
      advantages.push(`${team} ejerce la localía, condición donde su volumen estadístico suele incrementarse.`);
    } else {
      risks.push(`${team} juega como visitante, donde la producción ofensiva y el dominio de posesión tienden a reducirse.`);
    }

    // 3. Compatibilidad de Estilos
    if (market.includes('Remates') || market.includes('tiro')) {
      if (isVulnerable) {
        advantages.push(`El planteo defensivo del rival concede espacios para transiciones y disparos de media distancia.`);
      }
    } else if (market.includes('Faltas')) {
      advantages.push(`Partido con fricción proyectada en zonas de disputa de balón.`);
    }

    // 4. Recomendación del Agente
    let recommendation = 'NEUTRAL';
    let confidence = 0.75;

    if (advantages.length >= 2 && risks.length <= 1) {
      recommendation = 'FAVORABLE';
      confidence = 0.85;
    } else if (risks.length >= 2) {
      recommendation = 'DESFAVORABLE';
      confidence = 0.65;
    }

    return {
      agentName: this.name,
      candidateId: candidate.id,
      match: candidate.match,
      tacticalSummary: `Matchup táctico entre ${team} y ${opponentName}. Ratio de concesión del rival: ${concessionRatio}x (${opponent.defensiveRank || 'Estándar'}).`,
      advantages,
      risks,
      missingData: missing,
      confidenceScore: confidence,
      recommendation
    };
  }
}

module.exports = new TeamAnalyst();
