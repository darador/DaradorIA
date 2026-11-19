/**
 * DISCOVERY ENGINE - DETECCIÓN AUTÓNOMA DE CANDIDATOS
 * Fase 2: Explora fixtures, screeners de jugadores y equipos, tendencias y outliers
 * para alimentar la lista de candidatos que avanzarán a Deep Research.
 */
const config = require('../config');
const mcpClient = require('../mcp/mcpClient');
const storage = require('../data/storage');

class DiscoveryEngine {
  constructor() {
    this.targetCompetitions = config.targetCompetitions || [];
    this.minOdds = config.prediction?.minOdds || 1.60;
    this.maxOdds = config.prediction?.maxOdds || 2.35;
  }

  /**
   * Ejecuta el ciclo completo de descubrimiento
   * @param {Object} options { targetDate: 'YYYY-MM-DD', maxCandidates: 20 }
   */
  async runDiscovery(options = {}) {
    const today = options.targetDate || options.date || new Date().toISOString().slice(0, 10);
    const maxCandidates = options.maxCandidates || 20;

    console.log(`[Discovery] Iniciando escaneo de candidatos para la fecha: ${today}`);

    const runMeta = {
      targetDate: today,
      startTime: new Date().toISOString(),
      fixturesScanned: 0,
      candidatesFound: 0,
      byPriority: { ALTA: 0, MEDIA: 0, BAJA: 0 },
      toolsQueried: []
    };

    const rawCandidates = [];

    try {
      // 1. Obtener Fixtures del día
      const fixtures = await this._getUpcomingFixtures(today);
      runMeta.fixturesScanned = fixtures.length;
      runMeta.toolsQueried.push('getFixturesByDate');

      // 2. Screener de Props de Jugadores
      const playerProps = await this._screenPlayerProps(today);
      runMeta.toolsQueried.push('getPropScreener');
      rawCandidates.push(...playerProps);

      // 3. Screener de Props de Equipos
      const teamProps = await this._screenTeamProps(today);
      runMeta.toolsQueried.push('getTeamPropScreener');
      rawCandidates.push(...teamProps);

      // 4. Tendencias de Jugadores
      const playerTrends = await this._screenPlayerTrends(today);
      runMeta.toolsQueried.push('getPlayerTrends');
      rawCandidates.push(...playerTrends);

      // 5. Outliers y discrepancias de precios
      const outliers = await this._screenOutliers();
      runMeta.toolsQueried.push('getOutliers');
      rawCandidates.push(...outliers);

      // 6. Normalizar, Desduplicar y Enlazar con Fixtures
      const uniqueCandidates = this._deduplicateAndEnrich(rawCandidates, fixtures);

      // 7. Filtrar preliminarmente y asignar Prioridad
      const evaluatedCandidates = uniqueCandidates
        .map(cand => this._evaluateAndPrioritize(cand))
        .filter(cand => cand.status !== 'DESCARTADO')
        .sort((a, b) => this._priorityScore(b.priority) - this._priorityScore(a.priority))
        .slice(0, maxCandidates);

      // 8. Persistir en Storage
      for (const cand of evaluatedCandidates) {
        storage.saveCandidate(cand);
        runMeta.byPriority[cand.priority] = (runMeta.byPriority[cand.priority] || 0) + 1;
      }

      runMeta.candidatesFound = evaluatedCandidates.length;
      runMeta.endTime = new Date().toISOString();

      // Guardar registro de la corrida
      storage.saveRun({
        fixturesScanned: runMeta.fixturesScanned,
        candidatesFound: runMeta.candidatesFound,
        approvedCount: 0,
        rejectedCount: 0,
        mcpCallsUsed: runMeta.toolsQueried.length,
        status: 'DISCOVERY_COMPLETED',
        notes: `Discovery completado: ${runMeta.candidatesFound} candidatos priorizados (ALTA: ${runMeta.byPriority.ALTA}, MEDIA: ${runMeta.byPriority.MEDIA}, BAJA: ${runMeta.byPriority.BAJA})`
      });

      console.log(`[Discovery] Finalizado con éxito: ${evaluatedCandidates.length} candidatos detectados.`);

      return {
        runMeta,
        candidates: evaluatedCandidates
      };
    } catch (err) {
      console.error('[Discovery] Error crítico en DiscoveryEngine:', err.message);
      storage.saveRun({
        fixturesScanned: runMeta.fixturesScanned,
        candidatesFound: 0,
        status: 'DISCOVERY_FAILED',
        notes: `Fallo en discovery: ${err.message}`
      });
      throw err;
    }
  }

  // --- MÉTODOS DE CONSULTA AL MCP ---

  async _getUpcomingFixtures(dateStr) {
    try {
      const res = await mcpClient.callTool('getFixturesByDate', { date: dateStr });
      const data = res.data;
      if (!data) return [];

      const fixtures = [];
      const text = typeof data === 'string' ? data : (data.fixturesSummary || JSON.stringify(data));
      
      // Parsear líneas de partidos (formato: "HH:MM Team A v Team B")
      const lines = text.split('\n');
      let currentCompetition = 'Desconocida';

      for (const line of lines) {
        if (line.includes('(') && line.includes(')') && !line.startsWith('-')) {
          currentCompetition = line.split('[')[0].trim();
        } else if (line.startsWith('-') || line.includes(' v ') || line.includes(' vs ')) {
          const clean = line.replace(/^-\s*/, '').trim();
          fixtures.push({
            raw: clean,
            competition: currentCompetition,
            date: dateStr
          });
        }
      }

      return fixtures;
    } catch (e) {
      console.warn('[Discovery] Error obteniendo fixtures, continuando:', e.message);
      return [];
    }
  }

  async _screenPlayerProps(dateStr) {
    try {
      const res = await mcpClient.callTool('getPropScreener', {
        selectedDates: [dateStr],
        oddsFrom: 1.55,
        oddsTo: 2.45,
        hitRateFrom: 60,
        hitRateOption: 'L10',
        hitRateScope: 'all',
        type: 'over',
        lineupFilterType: 'predicted',
        pageSize: 30,
        statTypes: ['shots', 'shotsOnTarget', 'fouls', 'foulsWon', 'tackles', 'scoredOrAssisted']
      });

      return this._mapPropScreenerRows(res.data, 'prop_screener');
    } catch (e) {
      console.warn('[Discovery] Error en getPropScreener:', e.message);
      return [];
    }
  }

  async _screenTeamProps(dateStr) {
    try {
      const res = await mcpClient.callTool('getTeamPropScreener', {
        selectedDates: [dateStr],
        minOdds: 1.55,
        maxOdds: 2.45,
        minHitRateL10: 60,
        oddsType: 'over',
        limit: 25,
        statTypes: ['shots', 'shotsOnTarget', 'corners', 'cards', 'goals']
      });

      return this._mapTeamPropRows(res.data, 'team_prop_screener');
    } catch (e) {
      console.warn('[Discovery] Error en getTeamPropScreener:', e.message);
      return [];
    }
  }

  async _screenPlayerTrends(dateStr) {
    try {
      const res = await mcpClient.callTool('getPlayerTrends', {
        oddsFrom: 1.55,
        oddsTo: 2.45,
        minHitRate: 60,
        type: 'over',
        pageSize: 25,
        lineup: 'predicted'
      });

      return this._mapPlayerTrendsRows(res.data, 'player_trends');
    } catch (e) {
      console.warn('[Discovery] Error en getPlayerTrends:', e.message);
      return [];
    }
  }

  async _screenOutliers() {
    try {
      const res = await mcpClient.callTool('getOutliers', {
        minOdds: 1.55,
        maxOdds: 2.45,
        limit: 20
      });

      return this._mapOutlierRows(res.data, 'outlier_pricing');
    } catch (e) {
      console.warn('[Discovery] Error en getOutliers:', e.message);
      return [];
    }
  }

  // --- MAPEOS DE RESPUESTA A FORMATO UNIFICADO ---

  _mapPropScreenerRows(data, source) {
    if (!data) return [];
    const rows = Array.isArray(data) ? data : (data.data || data.props || data.rows || []);
    return rows.map(r => ({
      sourceTool: source,
      sport: 'football',
      competition: r.competitionName || r.competition || 'Liga Destacada',
      match: r.matchName || `${r.teamName || ''} vs ${r.opponentName || ''}`.trim(),
      matchTime: r.eventTimestamp || r.time || null,
      playerOrTeam: r.playerName || r.player,
      isTeamProp: false,
      team: r.teamName || r.team || '',
      opponent: r.opponentName || r.opponent || '',
      market: this._normalizeMarket(r.statType || r.stat),
      line: r.line ? `Más de ${r.line}` : 'Línea estándar',
      rawLine: r.line,
      bookmakerOdds: Number(r.bestOdds || r.odds || r.oddsValue || 1.75),
      bookmaker: r.bestBookmaker || r.bookmaker || 'bet365',
      trendL5: r.hitRateL5 ? `${r.hitRateL5}%` : (r.allCompsHitRateL5 ? `${r.allCompsHitRateL5}%` : null),
      trendL10: r.hitRateL10 ? `${r.hitRateL10}%` : (r.allCompsHitRateL10 ? `${r.allCompsHitRateL10}%` : null),
      statsSummary: {
        starts: r.startsInAllCompetitions || r.startsInCompetition || null,
        avg: r.avgPerGame || null,
        rawRate: r.hitRateL10 || r.hitRateFrom || null
      },
      lineupStatus: r.lineupStatus || (r.predictedStarter ? 'PREDICTED' : 'UNKNOWN'),
      raw: r
    }));
  }

  _mapTeamPropRows(data, source) {
    if (!data) return [];
    const rows = Array.isArray(data) ? data : (data.data || data.teamProps || data.rows || []);
    return rows.map(r => ({
      sourceTool: source,
      sport: 'football',
      competition: r.leagueName || r.competitionName || r.competition || 'Liga Destacada',
      match: r.matchName || (r.teamName && r.opponentTeamName ? `${r.teamName} vs ${r.opponentTeamName}` : ''),
      matchTime: r.kickoff || r.eventTimestamp || null,
      playerOrTeam: `${r.teamName || r.team || 'Equipo'} (Equipo)`,
      isTeamProp: true,
      team: r.teamName || r.team || '',
      opponent: r.opponentTeamName || r.opponentName || r.opponent || '',
      market: this._normalizeMarket(r.statType || r.market, true),
      line: r.line ? `Más de ${r.line}` : 'Línea estándar',
      rawLine: r.line,
      bookmakerOdds: Number(r.bestOdds || r.odds || 1.75),
      bookmaker: r.bestBookmakerName || r.bookmaker || 'bet365',
      trendL5: r.hitRateL5 ? `${r.hitRateL5}%` : null,
      trendL10: r.hitRateL10 ? `${r.hitRateL10}%` : null,
      statsSummary: {
        teamRateL10: r.hitRateL10,
        opponentConcededRateL10: r.opponentHitRateL10 || null
      },
      lineupStatus: 'TEAM_MARKET',
      raw: r
    }));
  }

  _mapPlayerTrendsRows(data, source) {
    if (!data) return [];
    const rows = Array.isArray(data) ? data : (data.data || data.trends || data.rows || []);
    return rows.map(r => ({
      sourceTool: source,
      sport: 'football',
      competition: r.competitionName || 'Liga Destacada',
      match: r.matchName || `${r.team || ''} vs ${r.opponent || ''}`.trim(),
      matchTime: r.eventTimestamp || null,
      playerOrTeam: r.player || r.playerName,
      isTeamProp: false,
      team: r.team || r.teamName || '',
      opponent: r.opponent || r.opponentName || '',
      market: this._normalizeMarket(r.statType || (r.market ? r.market.split(' ')[0] : null)),
      line: r.line ? `Más de ${r.line}` : (r.market && r.market.includes('over ') ? `Más de ${r.market.split('over ')[1]}` : 'Línea estándar'),
      rawLine: r.line || (r.market && r.market.includes('over ') ? parseFloat(r.market.split('over ')[1]) : null),
      bookmakerOdds: Number(r.bestOdds?.odds || r.bestOdds || r.odds || 1.80),
      bookmaker: r.bestOdds?.bookmaker || r.bestBookmaker || 'bet365',
      trendL5: r.hits || null,
      trendL10: r.last10 || null,
      statsSummary: {
        streak: r.hits,
        trendPercentage: r.trendPercentage || r.hitRate,
        windowAvg: r.windowAvg,
        matchup: r.matchup
      },
      lineupStatus: r.predictedXI === false ? 'BENCH_RISK' : 'PREDICTED',
      raw: r
    }));
  }

  _mapOutlierRows(data, source) {
    if (!data) return [];
    const rows = Array.isArray(data) ? data : (data.data || data.outliers || data.rows || []);
    return rows.map(r => ({
      sourceTool: source,
      sport: 'football',
      competition: r.competitionName || 'Liga Destacada',
      match: r.matchName || (r.homeTeam && r.awayTeam ? `${r.homeTeam} vs ${r.awayTeam}` : ''),
      matchTime: r.eventTimestamp || null,
      playerOrTeam: r.playerName || r.player,
      isTeamProp: false,
      team: r.homeTeam || r.teamName || '',
      opponent: r.awayTeam || r.opponentName || '',
      market: this._normalizeMarket(r.marketKey || r.market || r.statType),
      line: r.line ? `Más de ${r.line}` : 'Línea estándar',
      rawLine: r.line,
      bookmakerOdds: Number(r.bestOdds || 1.85),
      bookmaker: r.bestBookmaker || r.bookmaker || 'bet365',
      trendL5: null,
      trendL10: null,
      statsSummary: {
        edgeDiscrepancy: r.edge ? `${(r.edge * 100).toFixed(1)}%` : null,
        averageOdds: r.averageOdds || null
      },
      lineupStatus: 'UNKNOWN',
      raw: r
    }));
  }

  _normalizeMarket(rawStat, isTeam = false) {
    if (!rawStat) return isTeam ? 'Mercado de equipo' : 'Métricas individuales';
    const s = String(rawStat).toLowerCase();
    if (s.includes('shotontarget') || s === 'shotsontarget') return isTeam ? 'Remates al arco de equipo' : 'Remates al arco';
    if (s.includes('shot') || s === 'shots') return isTeam ? 'Remates de equipo' : 'Remates totales';
    if (s.includes('foulwon') || s === 'foulswon') return 'Faltas ganadas';
    if (s.includes('foul') || s === 'fouls') return 'Faltas cometidas';
    if (s.includes('tackle') || s === 'tackles') return 'Entradas (Tackles)';
    if (s.includes('corner') || s === 'corners') return 'Córners de equipo';
    if (s.includes('card') || s === 'cards' || s.includes('yellow')) return 'Tarjetas';
    if (s.includes('scoredorassisted') || s.includes('goalorassist') || s.includes('xgxa')) return 'Gol o Asistencia';
    if (s.includes('goal') || s === 'goals') return isTeam ? 'Goles de equipo' : 'Goles anotados';
    if (s.includes('pass') || s === 'passes') return 'Pases completados';
    return isTeam ? `Equipo: ${rawStat}` : rawStat;
  }

  // --- DESDUPLICACIÓN Y ENLACE ---

  _deduplicateAndEnrich(candidates, fixtures) {
    const map = new Map();

    for (const cand of candidates) {
      if (!cand.playerOrTeam || !cand.market) continue;

      // Clave única: jugador/equipo + partido + mercado + línea
      const key = `${cand.playerOrTeam.toLowerCase()}|${cand.match.toLowerCase()}|${cand.market.toLowerCase()}|${cand.line}`.trim();

      if (!map.has(key)) {
        map.set(key, {
          id: `cand_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          discoveredAt: new Date().toISOString(),
          sport: cand.sport,
          competition: cand.competition,
          match: cand.match || 'Partido por confirmar',
          matchTime: cand.matchTime,
          playerOrTeam: cand.playerOrTeam,
          isTeamProp: cand.isTeamProp,
          team: cand.team,
          opponent: cand.opponent,
          market: cand.market,
          line: cand.line,
          rawLine: cand.rawLine,
          bookmakerOdds: cand.bookmakerOdds,
          bookmaker: cand.bookmaker,
          trendL5: cand.trendL5,
          trendL10: cand.trendL10,
          statsSummary: cand.statsSummary,
          lineupStatus: cand.lineupStatus,
          discoverySources: [cand.sourceTool],
          mcpToolsQueried: [cand.sourceTool],
          rawSourceData: cand.raw
        });
      } else {
        // Enriquecer candidato existente si apareció en múltiples herramientas
        const existing = map.get(key);
        if (!existing.discoverySources.includes(cand.sourceTool)) {
          existing.discoverySources.push(cand.sourceTool);
          existing.mcpToolsQueried.push(cand.sourceTool);
        }
        if (!existing.trendL10 && cand.trendL10) existing.trendL10 = cand.trendL10;
        if (!existing.trendL5 && cand.trendL5) existing.trendL5 = cand.trendL5;
        if (cand.bookmakerOdds && cand.bookmakerOdds > existing.bookmakerOdds) {
          existing.bookmakerOdds = cand.bookmakerOdds; // Conservar mejor cuota detectada
        }
      }
    }

    return Array.from(map.values());
  }

  // --- FILTRADO PRELIMINAR Y PRIORIZACIÓN ---

  _parseRate(rateStr) {
    if (!rateStr) return 0;
    if (typeof rateStr === 'number') return rateStr <= 1 ? rateStr * 100 : rateStr;
    const str = String(rateStr).trim();
    if (str.includes('/')) {
      const parts = str.split('/');
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (den > 0) return (num / den) * 100;
    }
    const val = parseFloat(str);
    if (!isNaN(val)) {
      return val <= 1 ? val * 100 : val;
    }
    return 0;
  }

  _evaluateAndPrioritize(cand) {
    const odds = cand.bookmakerOdds || 1.70;
    const l10Num = this._parseRate(cand.trendL10) || cand.statsSummary?.teamRateL10 || 0;
    const l5Num = this._parseRate(cand.trendL5) || cand.statsSummary?.teamRateL5 || 0;
    const hasMultipleSources = cand.discoverySources.length > 1;

    // 1. Filtro flexible de cuota: descartar extremos inviables (< 1.45 o > 2.80)
    if (odds < 1.45 || odds > 2.80) {
      cand.status = 'DESCARTADO';
      cand.discardReason = `Cuota fuera de rango operativo (${odds})`;
      return cand;
    }

    // 2. Descarte por riesgo manifiesto de suplencia si se conoce
    if (cand.lineupStatus === 'BENCH_RISK') {
      cand.status = 'DESCARTADO';
      cand.discardReason = 'Alineación confirmada sin el jugador titular';
      return cand;
    }

    // 3. Asignación de Prioridad
    let priority = 'MEDIA';
    let discoveryReason = 'Tendencia estadística interesante identificada por screener.';

    if ((l10Num >= 70 && odds >= 1.60 && odds <= 2.25) || (hasMultipleSources && l10Num >= 60)) {
      priority = 'ALTA';
      discoveryReason = hasMultipleSources 
        ? `Convergencia de señales (${cand.discoverySources.join(' + ')}) con cuota atractiva (${odds}).`
        : `Alta consistencia estadística (L10: ${cand.trendL10 || l10Num + '%'}) a cuota ${odds}.`;
    } else if (l10Num >= 60 || (cand.statsSummary?.edgeDiscrepancy && odds >= 1.70)) {
      priority = 'MEDIA';
      discoveryReason = cand.statsSummary?.edgeDiscrepancy 
        ? `Discrepancia de cuota en el mercado (${cand.statsSummary.edgeDiscrepancy}) frente a otros bookmakers.`
        : `Tendencia favorable (L10: ${cand.trendL10 || l10Num + '%'}) en rango de valor.`;
    } else {
      priority = 'BAJA';
      discoveryReason = 'Señal estadística secundaria, incluida para contraste de mercado.';
    }

    cand.priority = priority;
    cand.status = 'DETECTADO';
    cand.discoveryReason = discoveryReason;
    cand.pendingInvestigation = [
      'Minutos esperados y titularidad reciente',
      'Métricas concedidas por el rival (xGA, shotsAgainst, foulsConceded)',
      'Ajuste matemático Poisson / Distribución empírica',
      'Noticias de última hora y bajas'
    ];

    return cand;
  }

  _priorityScore(priority) {
    if (priority === 'ALTA') return 3;
    if (priority === 'MEDIA') return 2;
    return 1;
  }
}

module.exports = new DiscoveryEngine();
