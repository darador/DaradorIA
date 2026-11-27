/**
 * DARADOR DISCOVERY ENGINE 3.0
 * Motor unificado de descubrimiento de oportunidades deportivas de DARADOR IA.
 * Reemplaza integralmente el Discovery legacy eliminando cuellos de botella:
 * 1. Cobertura dinámica de todas las competiciones habilitadas (21+ ligas)
 * 2. Exploración sistemática de Player Props, Team Props y Match Markets (1X2, DC, O/U)
 * 3. Integración con CandidateNormalizer y ResearchQueue sin truncamiento arbitrario
 * 4. Trazabilidad completa de consultas, mercados cubiertos y descartes
 */

const config = require('../config');
const mcpClient = require('../mcp/mcpClient');
const storage = require('../data/storage');
const competitionRegistry = require('../data/competitionRegistry');
const { candidateNormalizer } = require('./candidateNormalizer');
const { researchQueue } = require('./researchQueue');

class DiscoveryEngine3 {
  constructor(customConfig = {}) {
    this.name = 'DiscoveryEngine3.0';
    this.version = '3.0.0';
    
    // Rango de cuotas operativo (configurable para V2.4 / producción)
    this.minOdds = customConfig.minOdds || (config.prediction?.minOdds ?? 1.45);
    this.maxOdds = customConfig.maxOdds || (config.prediction?.maxOdds ?? 2.35);

    // Registro de auditoría y métricas de cobertura
    this.auditMetrics = {
      executionId: null,
      startedAt: null,
      completedAt: null,
      fixturesScanned: 0,
      fixturesInvestigated: 0,
      competitionsScanned: [],
      marketsRequested: [],
      marketsReturned: [],
      marketsNoCoverage: [],
      rawCandidatesFound: 0,
      candidatesNormalized: 0,
      candidatesEnqueued: 0,
      discards: {}
    };
  }

  _recordDiscard(reason, cand) {
    if (!this.auditMetrics.discards[reason]) {
      this.auditMetrics.discards[reason] = 0;
    }
    this.auditMetrics.discards[reason]++;
  }

  /**
   * Ejecuta el ciclo integral de descubrimiento 3.0
   * @param {Object} options { targetDate, targetDates, daysAhead, oddsRange }
   */
  async runDiscovery(options = {}) {
    const today = options.targetDate || options.date || new Date().toISOString().slice(0, 10);
    const targetDates = options.targetDates ? 
      (Array.isArray(options.targetDates) ? options.targetDates : [options.targetDates]) :
      (options.daysAhead === 2 || options.horizonHours === 48 ? 
        [today, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)] : 
        [today]);

    const execId = `disc3_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.auditMetrics.executionId = execId;
    this.auditMetrics.startedAt = new Date().toISOString();
    this.auditMetrics.fixturesScanned = 0;
    this.auditMetrics.fixturesInvestigated = 0;
    this.auditMetrics.competitionsScanned = [];
    this.auditMetrics.marketsRequested = [];
    this.auditMetrics.marketsReturned = [];
    this.auditMetrics.marketsNoCoverage = [];
    this.auditMetrics.rawCandidatesFound = 0;
    this.auditMetrics.candidatesNormalized = 0;
    this.auditMetrics.candidatesEnqueued = 0;
    this.auditMetrics.discards = {};

    console.log(`[Discovery 3.0] Iniciando escaneo unificado para fechas: ${targetDates.join(', ')}`);

    // 1. Obtener competiciones autorizadas
    const activeComps = competitionRegistry.getActiveCompetitions();
    this.auditMetrics.competitionsScanned = activeComps.map(c => c.name || c.id);

    const allDiscoveredCandidates = [];

    // 2. Fixture Discovery: Consultar fixtures por fecha
    for (const dateStr of targetDates) {
      try {
        const fixtures = await this._getUpcomingFixtures(dateStr);
        this.auditMetrics.fixturesScanned += fixtures.length;

        // Filtrar fixtures por competiciones autorizadas (o incluir si no está restringido)
        for (const fix of fixtures) {
          const compName = fix.competitionName || fix.league || fix.tournament;
          const isAllowedComp = activeComps.some(c => 
            (c.name && compName && compName.toLowerCase().includes(c.name.toLowerCase())) ||
            (c.id && fix.competitionId && fix.competitionId.toLowerCase() === c.id.toLowerCase())
          );

          if (isAllowedComp || activeComps.length === 0) {
            this.auditMetrics.fixturesInvestigated++;
            // Consultar Match Markets específicos del fixture (1X2, Doble Oportunidad, O/U Goles)
            const matchMarketCands = await this._screenMatchOddsForFixture(fix, dateStr);
            matchMarketCands.forEach(c => allDiscoveredCandidates.push(c));
          } else {
            this._recordDiscard('COMPETITION_NOT_ACTIVE', fix);
          }
        }
      } catch (err) {
        console.warn(`[Discovery 3.0] Advertencia al obtener fixtures para ${dateStr}:`, err.message);
      }
    }

    // 3. Screeners Sistemáticos de Mercado (Player Props, Team Props, Trends, Outliers)
    for (const dateStr of targetDates) {
      // 3A. Player Props
      const playerCands = await this._screenPlayerProps(dateStr);
      playerCands.forEach(c => allDiscoveredCandidates.push(c));

      // 3B. Team Props
      const teamCands = await this._screenTeamProps(dateStr);
      teamCands.forEach(c => allDiscoveredCandidates.push(c));

      // 3C. Player Trends
      const trendCands = await this._screenPlayerTrends(dateStr);
      trendCands.forEach(c => allDiscoveredCandidates.push(c));

      // 3D. Outliers
      const outlierCands = await this._screenOutliers();
      outlierCands.forEach(c => allDiscoveredCandidates.push(c));
    }

    this.auditMetrics.rawCandidatesFound = allDiscoveredCandidates.length;
    console.log(`[Discovery 3.0] Total candidatos brutos descubiertos: ${allDiscoveredCandidates.length}`);

    // 4. Normalización Centralizada y Deduplicación Inteligente
    const normalizedMap = new Map();
    for (const raw of allDiscoveredCandidates) {
      const odds = Number(raw.odds);
      if (isNaN(odds) || odds < this.minOdds || odds > this.maxOdds) {
        this._recordDiscard(`ODDS_OUT_OF_RANGE_[${this.minOdds}-${this.maxOdds}]`, raw);
        continue;
      }

      const normalized = candidateNormalizer.normalize(raw, {
        engineVersion: this.version,
        executionId: execId
      });

      if (!normalized) {
        this._recordDiscard('NORMALIZATION_FAILED', raw);
        continue;
      }

      const canId = normalized.candidateId;
      if (normalizedMap.has(canId)) {
        // Si ya existe, versionar o actualizar oferta de cuota sin duplicar candidato
        const existing = normalizedMap.get(canId);
        candidateNormalizer.mergePriceAlternative(existing, normalized);
      } else {
        normalizedMap.set(canId, normalized);
      }
    }

    const uniqueCandidates = Array.from(normalizedMap.values());
    this.auditMetrics.candidatesNormalized = uniqueCandidates.length;

    // 5. Persistir en storage con status DETECTADO y encolar en ResearchQueue sin truncamientos
    uniqueCandidates.sort((a, b) => (b.preliminaryScore || 0) - (a.preliminaryScore || 0));

    for (const cand of uniqueCandidates) {
      if (!cand.status || cand.status === 'UNDER_RESEARCH') {
        cand.status = 'DETECTADO';
      }
      storage.saveCandidate(cand);
    }

    researchQueue.enqueueBatch(uniqueCandidates);
    this.auditMetrics.candidatesEnqueued = uniqueCandidates.length;
    this.auditMetrics.completedAt = new Date().toISOString();

    console.log(`[Discovery 3.0] Encolados y persistidos exitosamente ${uniqueCandidates.length} candidatos para Deep Research.`);

    return {
      runMeta: {
        fixturesScanned: this.auditMetrics.fixturesScanned,
        candidatesFound: uniqueCandidates.length,
        executionId: execId
      },
      executionId: execId,
      candidates: uniqueCandidates,
      auditMetrics: this.auditMetrics
    };
  }

  /**
   * Consulta fixtures usando getFixturesByDate
   */
  async _getUpcomingFixtures(dateStr) {
    this._recordMarketRequested('getFixturesByDate');
    try {
      const res = await mcpClient.callTool('getFixturesByDate', { date: dateStr });
      const raw = res?.data || res?.fixtures || res || [];
      const list = Array.isArray(raw) ? raw : (raw.fixtures || []);
      this._recordMarketReturned('getFixturesByDate', list.length);
      return list.map(f => ({
        fixtureId: f.id || f.fixtureId || f.matchId,
        matchId: f.id || f.fixtureId || f.matchId,
        competitionName: f.competitionName || f.competition || f.league,
        competitionId: f.competitionId,
        homeTeam: f.homeTeam || f.home_team || (f.teams?.home?.name),
        awayTeam: f.awayTeam || f.away_team || (f.teams?.away?.name),
        matchTime: f.time || f.kickoffTime || f.kickoff,
        eventDateUtc: f.eventDateUtc || f.kickoffUtc || f.date,
        venue: f.venue
      }));
    } catch (err) {
      this._recordMarketNoCoverage('getFixturesByDate', err.message);
      return [];
    }
  }

  /**
   * Consulta match odds para 1X, X2, 12, O/U 1.5, 2.5, 3.5
   */
  async _screenMatchOddsForFixture(fixture, dateStr) {
    const fixtureId = fixture.fixtureId || fixture.matchId;
    if (!fixtureId) return [];

    this._recordMarketRequested('getMatchOdds');
    const candidates = [];

    try {
      const res = await mcpClient.callTool('getMatchOdds', { 
        fixtureId: fixtureId,
        date: dateStr
      });

      const oddsData = res?.data || res?.odds || res || {};
      this._recordMarketReturned('getMatchOdds', 1);

      const matchName = `${fixture.homeTeam} vs ${fixture.awayTeam}`;

      // Doble oportunidad (1X, X2, 12)
      if (oddsData.doubleChance) {
        const dc = oddsData.doubleChance;
        if (dc['1X'] && dc['1X'].odds) {
          candidates.push(this._buildRawMatchCandidate(fixture, 'Doble Oportunidad', '1X (Local o Empate)', dc['1X'].odds, dc['1X'].bookmaker || 'Consensus'));
        }
        if (dc['X2'] && dc['X2'].odds) {
          candidates.push(this._buildRawMatchCandidate(fixture, 'Doble Oportunidad', 'X2 (Empate o Visitante)', dc['X2'].odds, dc['X2'].bookmaker || 'Consensus'));
        }
        if (dc['12'] && dc['12'].odds) {
          candidates.push(this._buildRawMatchCandidate(fixture, 'Doble Oportunidad', '12 (Local o Visitante)', dc['12'].odds, dc['12'].bookmaker || 'Consensus'));
        }
      }

      // Over/Under Goles (1.5, 2.5, 3.5)
      if (oddsData.overUnderGoals || oddsData.totals) {
        const ou = oddsData.overUnderGoals || oddsData.totals;
        [1.5, 2.5, 3.5].forEach(line => {
          const overKey = `over_${line}`;
          const underKey = `under_${line}`;
          if (ou[overKey] && ou[overKey].odds) {
            candidates.push(this._buildRawMatchCandidate(fixture, 'Total Goles', `Más de ${line}`, ou[overKey].odds, ou[overKey].bookmaker || 'Consensus'));
          }
          if (ou[underKey] && ou[underKey].odds) {
            candidates.push(this._buildRawMatchCandidate(fixture, 'Total Goles', `Menos de ${line}`, ou[underKey].odds, ou[underKey].bookmaker || 'Consensus'));
          }
        });
      }

      // 1X2 Moneyline
      if (oddsData.matchResult || oddsData['1x2']) {
        const ml = oddsData.matchResult || oddsData['1x2'];
        if (ml['1'] && ml['1'].odds) {
          candidates.push(this._buildRawMatchCandidate(fixture, 'Resultado del Partido', `Gana ${fixture.homeTeam}`, ml['1'].odds, ml['1'].bookmaker || 'Consensus'));
        }
        if (ml['X'] && ml['X'].odds) {
          candidates.push(this._buildRawMatchCandidate(fixture, 'Resultado del Partido', 'Empate', ml['X'].odds, ml['X'].bookmaker || 'Consensus'));
        }
        if (ml['2'] && ml['2'].odds) {
          candidates.push(this._buildRawMatchCandidate(fixture, 'Resultado del Partido', `Gana ${fixture.awayTeam}`, ml['2'].odds, ml['2'].bookmaker || 'Consensus'));
        }
      }

    } catch (err) {
      this._recordMarketNoCoverage('getMatchOdds', err.message);
    }

    return candidates;
  }

  _buildRawMatchCandidate(fixture, market, selection, odds, bookmaker) {
    return {
      matchId: fixture.fixtureId || fixture.matchId,
      fixtureId: fixture.fixtureId || fixture.matchId,
      match: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
      competition: fixture.competitionName,
      competitionId: fixture.competitionId,
      market: market,
      selection: selection,
      line: selection,
      odds: Number(odds),
      bookmaker: bookmaker,
      playerOrTeam: fixture.homeTeam,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      eventDateUtc: fixture.eventDateUtc,
      source: 'StatsHub:getMatchOdds'
    };
  }

  /**
   * Consulta Player Props vía getPropScreener con escaneo multi-horizonte:
   * 1. Tendencias consolidadas L15 (>= 70% acierto, titulares previstos, SuperSub activado)
   * 2. Racha reciente L10 / L5 (>= 75% acierto)
   */
  async _screenPlayerProps(dateStr) {
    this._recordMarketRequested('getPropScreener');
    const allProps = [];

    // Estrategia 1: Tendencias L15 robustas (tipo StatsHub Elite / Twitter)
    try {
      const resL15 = await mcpClient.callTool('getPropScreener', {
        selectedDates: [dateStr],
        oddsFrom: this.minOdds,
        oddsTo: this.maxOdds,
        hitRateOption: 'L15',
        hitRateFrom: 70,
        lineupFilterType: 'predicted',
        useSupersub: true,
        pageSize: 50
      });
      const listL15 = resL15?.data || resL15?.props || resL15 || [];
      const propsL15 = Array.isArray(listL15) ? listL15 : (listL15.props || []);
      propsL15.forEach(p => {
        allProps.push({
          ...p,
          odds: p.bestOdds || p.odds,
          source: 'StatsHub:getPropScreener:L15_SuperSub'
        });
      });
    } catch (err) {
      console.warn('[Discovery 3.0] Error en screener L15:', err.message);
    }

    // Estrategia 2: Rachas L10 de alta frecuencia (>= 75%)
    try {
      const resL10 = await mcpClient.callTool('getPropScreener', {
        selectedDates: [dateStr],
        oddsFrom: this.minOdds,
        oddsTo: this.maxOdds,
        hitRateOption: 'L10',
        hitRateFrom: 75,
        lineupFilterType: 'predicted',
        useSupersub: true,
        pageSize: 50
      });
      const listL10 = resL10?.data || resL10?.props || resL10 || [];
      const propsL10 = Array.isArray(listL10) ? listL10 : (listL10.props || []);
      propsL10.forEach(p => {
        allProps.push({
          ...p,
          odds: p.bestOdds || p.odds,
          source: 'StatsHub:getPropScreener:L10_Hot'
        });
      });
    } catch (err) {
      console.warn('[Discovery 3.0] Error en screener L10:', err.message);
    }

    this._recordMarketReturned('getPropScreener', allProps.length);
    return allProps;
  }

  /**
   * Consulta Team Props vía getTeamPropScreener
   */
  async _screenTeamProps(dateStr) {
    this._recordMarketRequested('getTeamPropScreener');
    try {
      const res = await mcpClient.callTool('getTeamPropScreener', {
        date: dateStr,
        minOdds: this.minOdds,
        maxOdds: this.maxOdds
      });
      const list = res?.data || res?.props || res || [];
      const props = Array.isArray(list) ? list : (list.props || []);
      this._recordMarketReturned('getTeamPropScreener', props.length);

      return props.map(p => ({
        ...p,
        source: 'StatsHub:getTeamPropScreener'
      }));
    } catch (err) {
      this._recordMarketNoCoverage('getTeamPropScreener', err.message);
      return [];
    }
  }

  /**
   * Consulta Player Trends vía getPlayerTrends
   */
  async _screenPlayerTrends(dateStr) {
    this._recordMarketRequested('getPlayerTrends');
    try {
      const res = await mcpClient.callTool('getPlayerTrends', {
        date: dateStr,
        oddsFrom: this.minOdds,
        oddsTo: this.maxOdds,
        minHitRate: 70
      });
      const list = res?.data || res?.trends || res || [];
      const trends = Array.isArray(list) ? list : (list.trends || []);
      this._recordMarketReturned('getPlayerTrends', trends.length);

      return trends.map(t => ({
        ...t,
        source: 'StatsHub:getPlayerTrends'
      }));
    } catch (err) {
      this._recordMarketNoCoverage('getPlayerTrends', err.message);
      return [];
    }
  }

  /**
   * Consulta Outliers vía getOutliers
   */
  async _screenOutliers() {
    this._recordMarketRequested('getOutliers');
    try {
      const res = await mcpClient.callTool('getOutliers', {
        minOdds: this.minOdds,
        maxOdds: this.maxOdds
      });
      const list = res?.data || res?.outliers || res || [];
      const outliers = Array.isArray(list) ? list : (list.outliers || []);
      this._recordMarketReturned('getOutliers', outliers.length);

      return outliers.map(o => ({
        ...o,
        source: 'StatsHub:getOutliers'
      }));
    } catch (err) {
      this._recordMarketNoCoverage('getOutliers', err.message);
      return [];
    }
  }

  _recordMarketRequested(m) {
    if (!this.auditMetrics.marketsRequested.includes(m)) {
      this.auditMetrics.marketsRequested.push(m);
    }
  }

  _recordMarketReturned(m, count) {
    const existing = this.auditMetrics.marketsReturned.find(x => x.market === m);
    if (existing) {
      existing.count += count;
    } else {
      this.auditMetrics.marketsReturned.push({ market: m, count });
    }
  }

  _recordMarketNoCoverage(m, err) {
    this.auditMetrics.marketsNoCoverage.push({ market: m, error: err, timestamp: new Date().toISOString() });
  }
}

module.exports = {
  DiscoveryEngine3,
  discoveryEngine3: new DiscoveryEngine3()
};
