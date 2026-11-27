/**
 * EXPERIMENTAL DISCOVERY SCREENER V2.4
 * Extensión aislada para descubrir oportunidades en el rango [1.45, 2.20]
 * respetando el rate governor y la caché sin alterar los screeners productivos.
 */

const mcpClient = require('../mcp/mcpClient');
const { EXPERIMENTAL_ODDS_POLICY_V24 } = require('./experimentalOddsPolicyV24');

class ExperimentalDiscoveryEngine {
  constructor() {
    this.policy = EXPERIMENTAL_ODDS_POLICY_V24;
    this.minOdds = this.policy.minOdds; // 1.45
    this.maxOdds = this.policy.maxOdds; // 2.20
    this.queryLogs = [];
  }

  _recordQuery(toolName, params, resultCount = 0) {
    this.queryLogs.push({
      toolName,
      params,
      resultCount,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Screener experimental de Player Props [1.45 - 2.20]
   */
  async screenPlayerProps(dateInput) {
    const dates = Array.isArray(dateInput) ? dateInput : [dateInput];
    const params = {
      selectedDates: dates,
      oddsFrom: this.minOdds,
      oddsTo: this.maxOdds,
      hitRateFrom: this.policy.screeningRanges.minHitRate,
      hitRateOption: 'L10',
      hitRateScope: 'all',
      type: 'over',
      lineupFilterType: 'predicted',
      pageSize: 35,
      statTypes: ['shots', 'shotsOnTarget', 'fouls', 'foulsWon', 'tackles', 'interceptions', 'duelsWon', 'scoredOrAssisted']
    };

    try {
      const res = await mcpClient.callTool('getPropScreener', params);
      const rows = res?.data || [];
      this._recordQuery('getPropScreener', params, rows.length);
      return this._mapPropRows(rows, 'prop_screener_v24');
    } catch (err) {
      console.warn('[ExpDiscovery] Error en getPropScreener experimental:', err.message);
      this._recordQuery('getPropScreener', params, 0);
      return [];
    }
  }

  /**
   * Screener experimental de Team Props [1.45 - 2.20]
   */
  async screenTeamProps(dateInput) {
    const dates = Array.isArray(dateInput) ? dateInput : [dateInput];
    const params = {
      selectedDates: dates,
      minOdds: this.minOdds,
      maxOdds: this.maxOdds,
      minHitRateL10: this.policy.screeningRanges.minHitRate,
      oddsType: 'over',
      limit: 25,
      statTypes: ['shots', 'shotsOnTarget', 'corners', 'cards', 'goals']
    };

    try {
      const res = await mcpClient.callTool('getTeamPropScreener', params);
      const rows = res?.data || [];
      this._recordQuery('getTeamPropScreener', params, rows.length);
      return this._mapTeamPropRows(rows, 'team_prop_screener_v24');
    } catch (err) {
      console.warn('[ExpDiscovery] Error en getTeamPropScreener experimental:', err.message);
      this._recordQuery('getTeamPropScreener', params, 0);
      return [];
    }
  }

  /**
   * Screener experimental de Player Trends [1.45 - 2.20]
   */
  async screenPlayerTrends(dateStr) {
    const params = {
      oddsFrom: this.minOdds,
      oddsTo: this.maxOdds,
      minHitRate: this.policy.screeningRanges.minHitRate,
      type: 'over',
      pageSize: 25,
      lineup: 'predicted'
    };

    try {
      const res = await mcpClient.callTool('getPlayerTrends', params);
      const rows = res?.data || [];
      this._recordQuery('getPlayerTrends', params, rows.length);
      return this._mapTrendsRows(rows, 'player_trends_v24');
    } catch (err) {
      console.warn('[ExpDiscovery] Error en getPlayerTrends experimental:', err.message);
      this._recordQuery('getPlayerTrends', params, 0);
      return [];
    }
  }

  /**
   * Screener experimental de Outliers de Mercado [1.45 - 2.20]
   */
  async screenOutliers() {
    const params = {
      minOdds: this.minOdds,
      maxOdds: this.maxOdds,
      limit: 20
    };

    try {
      const res = await mcpClient.callTool('getOutliers', params);
      const rows = res?.data || [];
      this._recordQuery('getOutliers', params, rows.length);
      return this._mapOutlierRows(rows, 'outliers_v24');
    } catch (err) {
      console.warn('[ExpDiscovery] Error en getOutliers experimental:', err.message);
      this._recordQuery('getOutliers', params, 0);
      return [];
    }
  }

  /**
   * Preselección experimental: Permite pasar candidatos en [1.45, 2.20] hacia Deep Research
   */
  evaluateAndPrioritizeExperimental(cand) {
    const odds = Number(cand.bookmakerOdds || cand.odds || 0);

    // Etiquetado explícito de política
    cand.policy = 'EXPERIMENTAL_ODDS_V24';
    cand.environment = 'EXPERIMENTAL';

    // Descarte si está fuera del rango experimental [1.45, 2.20]
    if (odds < this.minOdds || odds > this.maxOdds) {
      cand.status = this.policy.STATES.REJECTED;
      cand.discardReason = `Cuota fuera de rango experimental [${this.minOdds}, ${this.maxOdds}]: @${odds.toFixed(2)}`;
      return cand;
    }

    if (cand.lineupStatus === 'BENCH_RISK') {
      cand.status = this.policy.STATES.REJECTED;
      cand.discardReason = 'Alineación confirmada sin el jugador titular';
      return cand;
    }

    // Pasa a UNDER_RESEARCH para investigación completa
    cand.status = this.policy.STATES.UNDER_RESEARCH;
    cand.priority = odds >= 1.60 ? 'ALTA' : 'MEDIA';
    cand.discoveryReason = `Candidato experimental detectado a cuota @${odds.toFixed(2)} (${cand.discoverySources ? cand.discoverySources.join('+') : 'Screener'}). Avanza a Deep Research.`;
    return cand;
  }

  _mapPropRows(rows, source) {
    return rows.map(r => ({
      sourceCandidateId: r.id || `prop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      playerOrTeam: r.playerName || r.player,
      team: r.teamName || r.team,
      match: r.matchName || `${r.homeTeam} vs ${r.awayTeam}`,
      competition: r.leagueName || r.league,
      market: r.statType,
      line: r.line,
      bookmakerOdds: Number(r.odds || r.bestOdds || 1.75),
      bookmaker: r.bookmaker || 'Bet365',
      trendL10: r.hitRateL10 || (r.hitRate ? `${r.hitRate}%` : null),
      discoverySources: [source],
      requestedOddsRange: `[${this.minOdds}, ${this.maxOdds}]`,
      queryTimestamp: new Date().toISOString()
    }));
  }

  _mapTeamPropRows(rows, source) {
    return rows.map(r => ({
      sourceCandidateId: r.id || `teamprop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      playerOrTeam: `${r.teamName || r.team} (Equipo)`,
      team: r.teamName || r.team,
      match: r.matchName || `${r.homeTeam} vs ${r.awayTeam}`,
      competition: r.leagueName || r.league,
      market: r.statType,
      line: r.line,
      bookmakerOdds: Number(r.odds || r.bestOdds || 1.75),
      bookmaker: r.bookmaker || 'Bet365',
      trendL10: r.hitRateL10 || (r.hitRate ? `${r.hitRate}%` : null),
      discoverySources: [source],
      isTeamProp: true,
      requestedOddsRange: `[${this.minOdds}, ${this.maxOdds}]`,
      queryTimestamp: new Date().toISOString()
    }));
  }

  _mapTrendsRows(rows, source) {
    return rows.map(r => ({
      sourceCandidateId: r.id || `trend_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      playerOrTeam: r.playerName || r.player,
      team: r.teamName,
      match: r.nextMatch || r.matchName,
      competition: r.leagueName,
      market: r.statType,
      line: r.line,
      bookmakerOdds: Number(r.odds || 1.75),
      bookmaker: r.bookmaker || 'Bet365',
      trendL10: r.streak || r.hitRate,
      discoverySources: [source],
      requestedOddsRange: `[${this.minOdds}, ${this.maxOdds}]`,
      queryTimestamp: new Date().toISOString()
    }));
  }

  _mapOutlierRows(rows, source) {
    return rows.map(r => ({
      sourceCandidateId: r.id || `outlier_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      playerOrTeam: r.entityName || r.player || r.team,
      team: r.teamName,
      match: r.matchName,
      competition: r.leagueName,
      market: r.marketName || r.statType,
      line: r.line,
      bookmakerOdds: Number(r.bestOdds || r.odds || 1.80),
      bookmaker: r.bestBookmaker || 'Bet365',
      discoverySources: [source],
      requestedOddsRange: `[${this.minOdds}, ${this.maxOdds}]`,
      queryTimestamp: new Date().toISOString()
    }));
  }
}

module.exports = ExperimentalDiscoveryEngine;
