/**
 * COVERAGE MATRIX - MATRIZ DE COBERTURA REAL STATSHUB MCP
 * Fase 11: Mapeo exhaustivo y comprobación empírica de disponibilidad por competición y tipo de estadística.
 */

const COVERAGE_STATUS = {
  DISPONIBLE: 'DISPONIBLE',
  DISPONIBLE_PARCIALMENTE: 'DISPONIBLE PARCIALMENTE',
  NO_DISPONIBLE: 'NO DISPONIBLE',
  NO_VERIFICADO: 'NO VERIFICADO'
};

/**
 * Matriz de capacidades verificadas en StatsHub MCP por entidad y métrica
 */
const STAT_CAPABILITIES = {
  // 1. Datos de Fixtures y Resultados
  fixtures: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getFixturesByDate',
    notes: 'Disponible para todas las competiciones del catálogo (fechas UTC, equipos, árbitros y estado de alineación).'
  },
  resultados: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getFixturesByDate / getMatchDetails',
    notes: 'Marcador final tras 90 minutos y en vivo durante el partido.'
  },

  // 2. Coberturas Colectivas (Equipos)
  estadisticasEquipos: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPerformance / getTeamStatistics',
    notes: 'Historial de los últimos 30 partidos por equipo, goles, tiros, córners, tarjetas.'
  },
  historialEquipos: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPerformance',
    notes: 'Últimos 10 a 30 partidos en todas las competiciones o específico de liga.'
  },
  cornersEquipo: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPropScreener / getTeamTrends',
    statField: 'corners',
    notes: 'Líneas de córners por equipo (Over/Under) en casi todas las ligas europeas y sudamericanas.'
  },
  tarjetasEquipo: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPropScreener / getTeamTrends',
    statField: 'cards',
    notes: 'Tarjetas de equipo totales.'
  },
  rematesEquipo: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPropScreener / getTeamPerformance',
    statField: 'shots',
    notes: 'Remates totales de equipo (Over/Under).'
  },
  rematesArcoEquipo: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPropScreener / getTeamPerformance',
    statField: 'shotsOnTarget',
    notes: 'Remates al arco de equipo (Over/Under).'
  },
  golesEquipo: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getTeamPropScreener / getTeamPerformance',
    statField: 'goals',
    notes: 'Goles de equipo (Over/Under).'
  },

  // 3. Coberturas Individuales (Jugadores)
  estadisticasIndividuales: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPlayer',
    notes: 'Disponible para ligas Tier 1 y Tier 2 con datos detallados por partido (hasta 20 apariciones).'
  },
  historialJugadores: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats',
    notes: 'Últimos 10 a 20 partidos de cada jugador con minutos, titularidad y rival.'
  },
  alineaciones: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getLineups / getFixturesByDate',
    notes: 'Disponible como "confirmed" o "predicted" en ligas Tier 1 y Championship; algunas ligas secundarias no disponen de predicción previa.'
  },
  minutosJugados: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats',
    statField: 'minutes',
    notes: 'Minutos exactos por partido en matchRows/matches.'
  },

  // 4. Métricas de Ataque Individual
  remates: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPropScreener',
    statField: 'shots',
    notes: 'Remates totales = a puerta + fuera + bloqueados. Alta liquidez en casas de apuestas.'
  },
  rematesAlArco: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPropScreener',
    statField: 'shotsOnTarget',
    notes: 'Remates a puerta incluyendo goles. Alta liquidez.'
  },
  rematesFuera: {
    status: COVERAGE_STATUS.DISPONIBLE_PARCIALMENTE,
    mcpTool: 'getPlayerStats',
    statField: 'shotOffTarget',
    notes: 'Existe como componente sumado en shots, pero las bookmakers raramente ofrecen líneas aisladas de "Remates Fuera" en screeners.'
  },
  rematesBloqueados: {
    status: COVERAGE_STATUS.DISPONIBLE_PARCIALMENTE,
    mcpTool: 'getPlayerStats',
    statField: 'blockedScoringAttempt',
    notes: 'Existe como componente sumado en shots, sin mercado aislado habitual de apuestas.'
  },

  // 5. Métricas de Disciplina Individual
  faltasCometidas: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPropScreener',
    statField: 'fouls',
    notes: 'Faltas cometidas por el jugador. Disponible en StatsHub y bookmakers.'
  },
  faltasRecibidasGanadas: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPropScreener',
    statField: 'foulsWon',
    notes: 'Faltas recibidas/ganadas por el jugador. Disponible en StatsHub y bookmakers.'
  },
  tarjetasIndividuales: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPropScreener',
    statField: 'yellowCards',
    notes: 'Tarjetas amarillas/rojas recibidas.'
  },

  // 6. Métricas de Defensa y Duelos
  tackles: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats / getPropScreener',
    statField: 'tackles',
    notes: 'Entradas totales intentadas/realizadas. Disponible en Tier 1 y Championship.'
  },
  tacklesGanados: {
    status: COVERAGE_STATUS.NO_DISPONIBLE,
    mcpTool: 'N/A',
    notes: 'StatsHub no desglosa tackles ganados de tackles intentados (provee tackles y duelsWon).'
  },
  duelos: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats',
    statField: 'duelsWon',
    notes: 'Duelos ganados totales (incluye duelos por tierra y duelos aéreos). Excelente para investigación, menor liquidez de bookmakers.'
  },
  intercepciones: {
    status: COVERAGE_STATUS.DISPONIBLE,
    mcpTool: 'getPlayerStats',
    statField: 'interceptions',
    notes: 'Balones interceptados por partido en getPlayerStats. Pocas cuotas directas pre-match.'
  },
  despejes: {
    status: COVERAGE_STATUS.NO_DISPONIBLE,
    mcpTool: 'N/A',
    notes: 'StatsHub MCP no provee el campo clearances ni en getPlayerStats ni en screeners.'
  }
};

/**
 * Cobertura por competición representativa verificada
 */
const COMPETITION_COVERAGE = {
  'Premier League': { tier: 1, country: 'England', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MAXIMA' },
  'Championship': { tier: 2, country: 'England', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'ALTA' },
  'Ligue 1': { tier: 1, country: 'France', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MAXIMA' },
  'Eredivisie': { tier: 1, country: 'Netherlands', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE_PARCIALMENTE', playerProps: 'DISPONIBLE_PARCIALMENTE', teamProps: 'DISPONIBLE', statsDepth: 'MEDIA' },
  'LaLiga': { tier: 1, country: 'Spain', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MAXIMA' },
  'Serie A': { tier: 1, country: 'Italy', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MAXIMA' },
  'Bundesliga': { tier: 1, country: 'Germany', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MAXIMA' },
  'Brasileirão Série A': { tier: 1, country: 'Brazil', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'ALTA' },
  'Liga Profesional': { tier: 1, country: 'Argentina', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MEDIA' },
  'UEFA Champions League': { tier: 1, country: 'Europe', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE', playerProps: 'DISPONIBLE', teamProps: 'DISPONIBLE', statsDepth: 'MAXIMA' },
  'Liga Portugal': { tier: 1, country: 'Portugal', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE_PARCIALMENTE', playerProps: 'DISPONIBLE_PARCIALMENTE', teamProps: 'DISPONIBLE', statsDepth: 'MEDIA' },
  'Scottish Premiership': { tier: 1, country: 'Scotland', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE_PARCIALMENTE', playerProps: 'DISPONIBLE_PARCIALMENTE', teamProps: 'DISPONIBLE', statsDepth: 'MEDIA' },
  'Trendyol Süper Lig': { tier: 1, country: 'Turkey', fixtures: 'DISPONIBLE', lineups: 'DISPONIBLE_PARCIALMENTE', playerProps: 'DISPONIBLE_PARCIALMENTE', teamProps: 'DISPONIBLE', statsDepth: 'MEDIA' }
};

module.exports = {
  COVERAGE_STATUS,
  STAT_CAPABILITIES,
  COMPETITION_COVERAGE
};
