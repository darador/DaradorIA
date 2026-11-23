/**
 * SHADOW HISTORY FETCHER & PARSER (FASE 2.3.1 — EXPERIMENTAL ONLY)
 * Recupera y valida series partido a partido (historicalValues, fechas y minutos)
 * desde las respuestas reales de StatsHub MCP:
 *   - Jugadores: getPlayerStats (matchColumns + matchRows)
 *   - Equipos:   getTeamPerformance (matches[].goalsFor para goles; explicita limitación en otros mercados)
 *   - Cuotas:    getMatchOdds (cuotas 2-way Over/Under y cierre T-5)
 *
 * Garantías de integridad:
 * - Filtra estrictamente cualquier partido con fecha >= kickoffUtc o mismo matchId (cero fuga temporal).
 * - Nunca fabrica series sintéticas a partir de promedios agregados.
 */

function mapMarketToStatColumn(market) {
  const m = String(market || '').toLowerCase();
  if (m.includes('remates al arco') || m.includes('tiros a puerta')) return 'shotsOnTarget';
  if (m.includes('remate') || m.includes('tiro')) return 'shots';
  if (m.includes('entrada') || m.includes('tackle')) return 'tackles';
  if (m.includes('falta') && (m.includes('ganad') || m.includes('recibid'))) return 'foulsWon';
  if (m.includes('falta')) return 'fouls';
  if (m.includes('córner') || m.includes('corner')) return 'corners';
  if (m.includes('gol')) return 'goals';
  if (m.includes('tarjeta') || m.includes('amarilla')) return 'yellowCards';
  if (m.includes('asistencia')) return 'assists';
  return null;
}

function matchIdSuffix(id) {
  if (!id) return '';
  const parts = String(id).split('.');
  return parts[parts.length - 1].toLowerCase();
}

function isStrictlyBeforeKickoff(rowDateStr, kickoffUtc, rowMatchId, candidateMatchId) {
  if (candidateMatchId && rowMatchId) {
    if (String(rowMatchId).toLowerCase() === String(candidateMatchId).toLowerCase()) return false;
    const s1 = matchIdSuffix(rowMatchId);
    const s2 = matchIdSuffix(candidateMatchId);
    if (s1 && s2 && s1.length >= 6 && s1 === s2) return false;
  }
  if (!rowDateStr || !kickoffUtc) return true;
  const koDateOnly = String(kickoffUtc).slice(0, 10);
  const rowDateOnly = String(rowDateStr).slice(0, 10);
  // Si el partido histórico es del mismo día o posterior al kickoff, excluir para garantizar 0 fuga temporal
  return rowDateOnly < koDateOnly;
}

/**
 * Extrae serie histórica partido a partido desde StatsHub getPlayerStats.
 */
function extractFromPlayerStats(pStatsResponse, { candidateMatchId = null, kickoffUtc = null, market = null, statColumn = null } = {}) {
  if (!pStatsResponse || !Array.isArray(pStatsResponse.matchRows) || !Array.isArray(pStatsResponse.matchColumns)) {
    return {
      ok: false,
      sourceEndpoint: 'statshub:getPlayerStats',
      historicalValues: [],
      matchDates: [],
      minutesPerMatch: [],
      sampleCount: 0,
      filteredPostKickoffCount: 0,
      reason: 'Respuesta getPlayerStats sin matchColumns/matchRows'
    };
  }

  const cols = pStatsResponse.matchColumns;
  const colName = statColumn || pStatsResponse.requestedStat?.column || mapMarketToStatColumn(market);
  const idxStat = cols.indexOf(colName);
  const idxDate = cols.indexOf('date');
  const idxMin = cols.indexOf('minutes');
  const idxMatchId = cols.indexOf('matchId');

  if (idxStat === -1) {
    return {
      ok: false,
      sourceEndpoint: 'statshub:getPlayerStats',
      historicalValues: [],
      matchDates: [],
      minutesPerMatch: [],
      sampleCount: 0,
      filteredPostKickoffCount: 0,
      reason: `Columna '${colName}' no encontrada en matchColumns`
    };
  }

  const historicalValues = [];
  const matchDates = [];
  const minutesPerMatch = [];
  let filteredPostKickoffCount = 0;

  for (const row of pStatsResponse.matchRows) {
    const rDate = idxDate !== -1 ? row[idxDate] : null;
    const rMatchId = idxMatchId !== -1 ? row[idxMatchId] : null;
    if (!isStrictlyBeforeKickoff(rDate, kickoffUtc, rMatchId, candidateMatchId)) {
      filteredPostKickoffCount++;
      continue;
    }
    const val = Number(row[idxStat]);
    if (!Number.isFinite(val)) continue;
    historicalValues.push(val);
    matchDates.push(rDate || null);
    if (idxMin !== -1 && Number.isFinite(Number(row[idxMin]))) {
      minutesPerMatch.push(Number(row[idxMin]));
    }
  }

  return {
    ok: historicalValues.length > 0,
    sourceEndpoint: 'statshub:getPlayerStats',
    statColumn: colName,
    historicalValues,
    matchDates,
    minutesPerMatch,
    avgMinutes: minutesPerMatch.length > 0
      ? Number((minutesPerMatch.reduce((a, b) => a + b, 0) / minutesPerMatch.length).toFixed(1))
      : null,
    sampleCount: historicalValues.length,
    filteredPostKickoffCount,
    reason: historicalValues.length > 0 ? null : 'Sin observaciones pre-partido válidas tras filtro temporal'
  };
}

/**
 * Extrae serie histórica partido a partido desde StatsHub getTeamPerformance.
 * Nota real de StatsHub: matches[] incluye goalsFor/goalsAgainst por partido, pero omite
 * corners/cards/shots por fila (solo expone totals.stats agregados). Nunca fabrica series desde promedios.
 */
function extractFromTeamPerformance(teamPerfResponse, { candidateMatchId = null, kickoffUtc = null, market = null } = {}) {
  if (!teamPerfResponse || !Array.isArray(teamPerfResponse.matches)) {
    return {
      ok: false,
      sourceEndpoint: 'statshub:getTeamPerformance',
      historicalValues: [],
      matchDates: [],
      minutesPerMatch: [],
      sampleCount: 0,
      filteredPostKickoffCount: 0,
      reason: 'Respuesta getTeamPerformance sin array matches'
    };
  }

  const m = String(market || '').toLowerCase();
  const isGoalsMarket = m.includes('gol');

  if (!isGoalsMarket) {
    return {
      ok: false,
      sourceEndpoint: 'statshub:getTeamPerformance',
      historicalValues: [],
      matchDates: [],
      minutesPerMatch: [],
      sampleCount: 0,
      filteredPostKickoffCount: 0,
      aggregatedOnly: teamPerfResponse.totals?.stats || null,
      reason: `STATSHUB_TEAM_PERFORMANCE_OMITS_PER_GAME_STATS: getTeamPerformance no entrega serie partido a partido para '${market}' (solo totales agregados)`
    };
  }

  const historicalValues = [];
  const matchDates = [];
  const minutesPerMatch = [];
  let filteredPostKickoffCount = 0;

  for (const row of teamPerfResponse.matches) {
    if (!isStrictlyBeforeKickoff(row.date, kickoffUtc, row.matchId, candidateMatchId)) {
      filteredPostKickoffCount++;
      continue;
    }
    const val = Number(row.goalsFor);
    if (!Number.isFinite(val)) continue;
    historicalValues.push(val);
    matchDates.push(row.date || null);
    minutesPerMatch.push(90);
  }

  return {
    ok: historicalValues.length > 0,
    sourceEndpoint: 'statshub:getTeamPerformance',
    statColumn: 'goalsFor',
    historicalValues,
    matchDates,
    minutesPerMatch,
    avgMinutes: 90,
    sampleCount: historicalValues.length,
    filteredPostKickoffCount,
    reason: historicalValues.length > 0 ? null : 'Sin partidos previos válidos en getTeamPerformance'
  };
}

/**
 * Extrae cuotas 2-way (targetOdds + oppositeOdds) desde StatsHub getMatchOdds.
 */
function extractTwoWayOddsFromMatchOdds(matchOddsResponse, { marketName, line, side = 'over' }) {
  if (!matchOddsResponse || !Array.isArray(matchOddsResponse.markets)) {
    return { found: false, closingOdds: null, closingOppositeOdds: null, reason: 'Sin mercados en getMatchOdds' };
  }
  const targetMkt = matchOddsResponse.markets.find(m =>
    String(m.name || '').toLowerCase() === String(marketName || '').toLowerCase()
  );
  if (!targetMkt || !Array.isArray(targetMkt.outcomes)) {
    return { found: false, closingOdds: null, closingOppositeOdds: null, reason: `Mercado '${marketName}' no encontrado` };
  }

  const numLine = Number(String(line).replace(/[^\d.]/g, ''));
  const overLabel = `over ${numLine}`;
  const underLabel = `under ${numLine}`;

  const overOut = targetMkt.outcomes.find(o => String(o.label || '').toLowerCase() === overLabel);
  const underOut = targetMkt.outcomes.find(o => String(o.label || '').toLowerCase() === underLabel);

  const targetOut = String(side).toLowerCase() === 'under' ? underOut : overOut;
  const oppOut = String(side).toLowerCase() === 'under' ? overOut : underOut;

  if (!targetOut || !targetOut.best || !targetOut.best.odds) {
    return { found: false, closingOdds: null, closingOppositeOdds: null, reason: `Línea '${side} ${numLine}' sin cuota activa` };
  }

  return {
    found: true,
    closingOdds: Number(targetOut.best.odds),
    closingOppositeOdds: oppOut?.best?.odds ? Number(oppOut.best.odds) : null,
    bookmaker: targetOut.best.bookmaker || null,
    ageMinutes: targetOut.best.ageMinutes ?? null,
    source: `StatsHub getMatchOdds (${targetOut.best.bookmaker || 'best'})`
  };
}

module.exports = {
  mapMarketToStatColumn,
  extractFromPlayerStats,
  extractFromTeamPerformance,
  extractTwoWayOddsFromMatchOdds
};
