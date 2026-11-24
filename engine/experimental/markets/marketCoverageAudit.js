/**
 * MARKET COVERAGE AUDIT & SAFE TEAM EXTRACTOR (FASE 3 — EXPERIMENTAL)
 *
 * Clasifica la cobertura real de StatsHub MCP por familia de mercado sin inventar series:
 *   - COMPLETO: serie partido a partido disponible + cuotas activas
 *   - AGREGADO_SIN_SERIE: promedios/totales reales disponibles (totals.stats), sin fila por partido
 *   - DATOS_INSUFICIENTES: muestra por debajo del umbral mínimo o campos críticos ausentes
 *   - NO_DISPONIBLE: StatsHub no provee el dato para ese mercado/liga
 */

'use strict';

const MARKET_FAMILIES = Object.freeze({
  MATCH_1X2: 'match_1x2',
  DOUBLE_CHANCE: 'double_chance',
  ASIAN_HANDICAP: 'asian_handicap',
  MATCH_GOALS: 'match_goals',
  TEAM_GOALS: 'team_goals',
  BTTS: 'btts',
  TEAM_STATS: 'team_stats',
  PLAYER_PROPS: 'player_props'
});

const COVERAGE_STATUS = Object.freeze({
  COMPLETO: 'COMPLETO',
  AGREGADO_SIN_SERIE: 'AGREGADO_SIN_SERIE',
  DATOS_INSUFICIENTES: 'DATOS_INSUFICIENTES',
  NO_DISPONIBLE: 'NO_DISPONIBLE'
});

/**
 * Extrae datos reales de getTeamPerformance distinguiendo estrictamente entre:
 *  - Mercados con serie partido a partido real (goalsFor, goalsAgainst, totalGoals, btts, result)
 *  - Mercados solo agregados en totals.stats (shots, shotsOnTarget, corners, fouls, cards, yellowCards)
 *  - Mercados no presentes en getTeamPerformance (tackles -> solo en getTeamStatistics anual)
 */
function extractSafeTeamMarketData(teamPerf, marketKey, minGames = 10) {
  const key = String(marketKey || '').toLowerCase().trim();
  const matches = Array.isArray(teamPerf?.matches) ? teamPerf.matches : [];
  const totalGames = Number(teamPerf?.totals?.games ?? matches.length);

  // 1. Mercados con serie partido a partido real en matches[]
  if (['goals', 'teamgoals', 'goalsfor', 'matchgoals', 'totalgoals', 'btts', '1x2', 'doublechance', 'asianhandicap'].includes(key)) {
    const valid = matches.filter(m => Number.isFinite(Number(m?.goalsFor)) && Number.isFinite(Number(m?.goalsAgainst)));
    if (valid.length < minGames) {
      return {
        marketKey: key,
        coverageStatus: COVERAGE_STATUS.DATOS_INSUFICIENTES,
        seriesType: 'PER_MATCH',
        sampleSize: valid.length,
        observations: valid.map(m => Number(m.goalsFor)),
        reason: `Muestra insuficiente partido a partido (${valid.length} < ${minGames}).`
      };
    }

    let observations;
    if (key === 'matchgoals' || key === 'totalgoals') {
      observations = valid.map(m => Number(m.goalsFor) + Number(m.goalsAgainst));
    } else if (key === 'btts') {
      observations = valid.map(m => (Number(m.goalsFor) > 0 && Number(m.goalsAgainst) > 0 ? 1 : 0));
    } else {
      observations = valid.map(m => Number(m.goalsFor));
    }

    return {
      marketKey: key,
      coverageStatus: COVERAGE_STATUS.COMPLETO,
      seriesType: 'PER_MATCH',
      sampleSize: observations.length,
      observations,
      xGAvg: Number.isFinite(Number(teamPerf?.totals?.stats?.xG?.avg)) ? Number(teamPerf.totals.stats.xG.avg) : null,
      reason: null
    };
  }

  // 2. Mercados agregados de equipo (StatsHub omite per-game en rows y entrega totals.stats)
  const statMap = {
    shots: 'shots',
    shotsontarget: 'shotsOnTarget',
    corners: 'corners',
    fouls: 'fouls',
    cards: 'cards',
    yellowcards: 'yellowCards'
  };
  if (statMap[key]) {
    const field = statMap[key];
    const statObj = teamPerf?.totals?.stats?.[field];
    const oppObj = teamPerf?.totals?.opponentStats?.[field];
    const avg = Number(statObj?.avg);
    if (!Number.isFinite(avg) || totalGames < minGames) {
      return {
        marketKey: key,
        coverageStatus: COVERAGE_STATUS.DATOS_INSUFICIENTES,
        seriesType: 'AGGREGATED_ONLY',
        sampleSize: totalGames,
        observations: null,
        avg: null,
        opponentAvg: null,
        reason: `Estadística agregada ${field} ausente o muestra insuficiente (${totalGames} < ${minGames}).`
      };
    }
    return {
      marketKey: key,
      coverageStatus: COVERAGE_STATUS.AGREGADO_SIN_SERIE,
      seriesType: 'AGGREGATED_ONLY',
      sampleSize: totalGames,
      observations: null, // Explícitamente null: NO inventar series partido a partido
      avg,
      total: Number(statObj?.total ?? avg * totalGames),
      opponentAvg: Number.isFinite(Number(oppObj?.avg)) ? Number(oppObj.avg) : null,
      reason: 'StatsHub entrega totales/promedios agregados (sin desglose fila a fila en getTeamPerformance).'
    };
  }

  // 3. Tackles de equipo no existe en getTeamPerformance
  if (key === 'tackles' || key === 'teamtackles') {
    return {
      marketKey: key,
      coverageStatus: COVERAGE_STATUS.NO_DISPONIBLE,
      seriesType: 'NONE',
      sampleSize: 0,
      observations: null,
      reason: 'Tackles de equipo no tiene serie partido a partido en getTeamPerformance (solo tabla anual en getTeamStatistics).'
    };
  }

  return {
    marketKey: key,
    coverageStatus: COVERAGE_STATUS.NO_DISPONIBLE,
    seriesType: 'NONE',
    sampleSize: 0,
    observations: null,
    reason: `Mercado no mapeado o no disponible en StatsHub: ${key}`
  };
}

/**
 * Audita qué mercados tienen cuotas activas en un payload real de getMatchOdds.
 */
function auditMatchOddsCoverage(matchOddsPayload) {
  if (!matchOddsPayload || matchOddsPayload.priced === false || !Array.isArray(matchOddsPayload.markets)) {
    return {
      priced: false,
      markets: {
        match_1x2: COVERAGE_STATUS.NO_DISPONIBLE,
        double_chance: COVERAGE_STATUS.NO_DISPONIBLE,
        asian_handicap: COVERAGE_STATUS.NO_DISPONIBLE,
        match_goals: COVERAGE_STATUS.NO_DISPONIBLE,
        team_goals: COVERAGE_STATUS.NO_DISPONIBLE,
        btts: COVERAGE_STATUS.NO_DISPONIBLE,
        corners: COVERAGE_STATUS.NO_DISPONIBLE,
        cards: COVERAGE_STATUS.NO_DISPONIBLE
      },
      extractedOdds: {}
    };
  }

  const byName = new Map();
  for (const m of matchOddsPayload.markets) {
    byName.set(String(m.name || '').toLowerCase(), m);
  }

  const findMarket = (names) => {
    for (const n of names) {
      if (byName.has(n)) return byName.get(n);
    }
    return null;
  };

  const toWin = findMarket(['to win', 'match result', '1x2']);
  const dc = findMarket(['double chance']);
  const ah = findMarket(['asian handicap']);
  const btts = findMarket(['both teams to score']);
  const totGoals = findMarket(['total goals']);
  const homeGoals = findMarket(['home team goals']);
  const awayGoals = findMarket(['away team goals']);
  const corners = findMarket(['total corners']);
  const cards = findMarket(['total cards']);

  const extract1X2 = () => {
    if (!toWin || !Array.isArray(toWin.outcomes) || toWin.outcomes.length < 3) return null;
    const draw = toWin.outcomes.find(o => String(o.label || '').toLowerCase() === 'draw');
    const nonDraw = toWin.outcomes.filter(o => String(o.label || '').toLowerCase() !== 'draw');
    if (!draw || nonDraw.length < 2) return null;
    return {
      home: Number(nonDraw[0]?.best?.odds),
      draw: Number(draw?.best?.odds),
      away: Number(nonDraw[1]?.best?.odds),
      homeLabel: nonDraw[0]?.label,
      awayLabel: nonDraw[1]?.label,
      ageMinutes: Math.max(
        Number(nonDraw[0]?.best?.ageMinutes || 0),
        Number(draw?.best?.ageMinutes || 0),
        Number(nonDraw[1]?.best?.ageMinutes || 0)
      ),
      books: Math.min(
        Number(nonDraw[0]?.books || 0),
        Number(draw?.books || 0),
        Number(nonDraw[1]?.books || 0)
      )
    };
  };

  const extractDC = () => {
    if (!dc || !Array.isArray(dc.outcomes) || dc.outcomes.length < 3) return null;
    const o1X = dc.outcomes.find(o => /or draw$/i.test(String(o.label || '')));
    const oX2 = dc.outcomes.find(o => /^draw or /i.test(String(o.label || '')));
    const o12 = dc.outcomes.find(o => o !== o1X && o !== oX2);
    if (!o1X || !oX2 || !o12) return null;
    return {
      '1X': Number(o1X?.best?.odds),
      'X2': Number(oX2?.best?.odds),
      '12': Number(o12?.best?.odds),
      ageMinutes: Math.max(
        Number(o1X?.best?.ageMinutes || 0),
        Number(oX2?.best?.ageMinutes || 0),
        Number(o12?.best?.ageMinutes || 0)
      ),
      books: Math.min(Number(o1X?.books || 0), Number(oX2?.books || 0), Number(o12?.books || 0))
    };
  };

  const odds1X2 = extract1X2();
  const oddsDC = extractDC();

  return {
    priced: true,
    markets: {
      match_1x2: odds1X2 ? COVERAGE_STATUS.COMPLETO : COVERAGE_STATUS.NO_DISPONIBLE,
      double_chance: oddsDC ? COVERAGE_STATUS.COMPLETO : COVERAGE_STATUS.NO_DISPONIBLE,
      asian_handicap: ah ? COVERAGE_STATUS.COMPLETO : COVERAGE_STATUS.NO_DISPONIBLE,
      match_goals: totGoals ? COVERAGE_STATUS.COMPLETO : COVERAGE_STATUS.NO_DISPONIBLE,
      team_goals: (homeGoals || awayGoals) ? COVERAGE_STATUS.COMPLETO : COVERAGE_STATUS.NO_DISPONIBLE,
      btts: btts ? COVERAGE_STATUS.COMPLETO : COVERAGE_STATUS.NO_DISPONIBLE,
      corners: corners ? COVERAGE_STATUS.AGREGADO_SIN_SERIE : COVERAGE_STATUS.NO_DISPONIBLE,
      cards: cards ? COVERAGE_STATUS.AGREGADO_SIN_SERIE : COVERAGE_STATUS.NO_DISPONIBLE
    },
    extractedOdds: {
      odds1X2,
      oddsDoubleChance: oddsDC
    }
  };
}

module.exports = {
  MARKET_FAMILIES,
  COVERAGE_STATUS,
  extractSafeTeamMarketData,
  auditMatchOddsCoverage
};
