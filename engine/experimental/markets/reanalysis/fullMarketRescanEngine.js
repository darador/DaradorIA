/**
 * FASE 10.2 — FULL MARKET RESCAN ENGINE (DESCUBRIMIENTO CONTINUO Y REANÁLISIS INTEGRAL)
 *
 * Motor experimental en 2 niveles (Shadow Mode, autoExecutionAllowed = false):
 *  - Nivel 1 (Discovery): consulta ligas habilitadas + eventos ya rastreados,
 *    desduplica por matchId, excluye partidos iniciados/cancelados/fuera de ventana.
 *  - Nivel 2 (Deep Research): consulta getMatchOdds UNA sola vez por partido,
 *    getTeamPerformance (local/visitante) y getTeamNews (Tier 1), audita cobertura
 *    real de todos los mercados (1X2, Doble Oportunidad, DNB, AH, Total Goles, BTTS,
 *    Team Stats agregados sin fabricar series), reanaliza contra versiones previas
 *    y persiste versiones inmutables encadenadas SHA-256 en ReanalysisStore.
 *
 * Incluye:
 *  - Mutex anti-solapamiento
 *  - Reanudación segura de escaneos interrumpidos (fase10_2_rescan_state.json)
 *  - Reanálisis selectivo de un único evento (reanalyzeSingleEvent)
 *  - Exportación a api/opportunities_fase10_2.json para el Dashboard de Oportunidades
 */

'use strict';

const fs = require('fs');
const path = require('path');

const defaultMcpClient = require('../../../mcp/mcpClient');
const v2Math = require('../../predictionEngineV2');
const { loadEnabledCompetitions, parseFixturesWithOddsSummary } = require('../matchDiscoveryScreener');
const { auditMatchOddsCoverage, COVERAGE_STATUS } = require('../marketCoverageAudit');
const { predictMatchOutcomes, evaluateSelectionPricing } = require('../matchOutcomeModel');
const { ReanalysisStore } = require('./reanalysisStore');
const {
  OPPORTUNITY_STATES,
  CHANGE_REASONS,
  buildOpportunityId,
  reanalyzeOpportunity
} = require('./opportunityReanalysisEngine');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_RESCAN_STATE_PATH = path.join(STORAGE_DIR, 'fase10_2_rescan_state.json');
const DEFAULT_EXPORT_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'api', 'opportunities_fase10_2.json');

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 2), 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

class FullMarketRescanEngine {
  constructor(options = {}) {
    this.store = options.store || new ReanalysisStore(options.storeOptions);
    this.statePath = options.statePath || DEFAULT_RESCAN_STATE_PATH;
    this.exportPath = options.exportPath || DEFAULT_EXPORT_PATH;
    this.autoExecutionAllowed = false;
    this._running = false;
  }

  _loadState() {
    if (!fs.existsSync(this.statePath)) {
      return { status: 'NOT_EXECUTED', inProgressScanId: null, completedMatchIds: [], lastSummary: null, scanHistory: [] };
    }
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      if (s.inProgressScanId) {
        s.recoveredFromInterruptedScanId = s.inProgressScanId;
        s.inProgressScanId = null;
      }
      return s;
    } catch (_) {
      return { status: 'STATE_RESET', inProgressScanId: null, completedMatchIds: [], lastSummary: null, scanHistory: [] };
    }
  }

  _saveState(s) {
    atomicWriteJson(this.statePath, s);
  }

  /**
   * Extrae todos los mercados realmente disponibles y evaluables de un partido sin repetir getMatchOdds.
   */
  _buildMarketCandidatesForMatch({ fx, kickoffUtc, oddsAudit, evalRes, rawOddsPayload }) {
    const marketAvailabilityLog = [];
    const candidates = [];

    const baseMeta = {
      matchId: fx.matchId,
      match: fx.match,
      homeTeam: fx.homeTeam,
      awayTeam: fx.awayTeam,
      league: fx.competition,
      sport: 'football',
      kickoffUtc,
      matchStatus: fx.matchStatus || 'SCHEDULED',
      dataQuality: evalRes.dataQuality,
      dataQualityScore: evalRes.dataQuality.score,
      sampleSize: Math.min(evalRes.parameters.homeSampleGames, evalRes.parameters.awaySampleGames),
      parameters: evalRes.parameters,
      modelId: 'MatchOutcomeDC',
      modelVersion: evalRes.modelVersion,
      modelConsensus: 0.80,
      evidenceTier: 'INSUFFICIENT_SAMPLE',
      dataCoverage: COVERAGE_STATUS.COMPLETO
    };

    const ex = oddsAudit.extractedOdds || {};

    // 1. 1X2
    if (ex.odds1X2 && evalRes.pricing.match_1x2) {
      marketAvailabilityLog.push({
        matchId: fx.matchId, market: '1X2', status: 'AVAILABLE', line: null,
        selections: ['1', 'X', '2'], bookmakers: ex.odds1X2.bookmakers
      });
      for (const [sel, item] of Object.entries(evalRes.pricing.match_1x2)) {
        if (!item?.available) continue;
        candidates.push({
          ...baseMeta,
          marketFamily: 'match_1x2',
          market: 'Ganador 1X2',
          selection: sel,
          line: null,
          bookmaker: ex.odds1X2.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
          bookmakerOdds: item.bookmakerOdds,
          oddsAgeMinutes: ex.odds1X2.ageMinutesBySelection?.[sel] ?? ex.odds1X2.ageMinutes ?? 0,
          modelProb: item.modelProb,
          noVigProb: item.noVigProb
        });
      }
    } else {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: '1X2', status: 'UNAVAILABLE', reason: 'Sin cuotas 1X2 completas' });
    }

    // 2. Doble Oportunidad
    if (ex.oddsDoubleChance && evalRes.pricing.double_chance) {
      marketAvailabilityLog.push({
        matchId: fx.matchId, market: 'Double Chance', status: 'AVAILABLE', line: null,
        selections: ['1X', 'X2', '12'], bookmakers: ex.oddsDoubleChance.bookmakers
      });
      for (const [sel, item] of Object.entries(evalRes.pricing.double_chance)) {
        if (!item?.available) continue;
        candidates.push({
          ...baseMeta,
          marketFamily: 'double_chance',
          market: 'Doble Oportunidad',
          selection: sel,
          line: null,
          bookmaker: ex.oddsDoubleChance.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
          bookmakerOdds: item.bookmakerOdds,
          oddsAgeMinutes: ex.oddsDoubleChance.ageMinutesBySelection?.[sel] ?? ex.oddsDoubleChance.ageMinutes ?? 0,
          modelProb: item.modelProb,
          noVigProb: item.noVigProb
        });
      }
    } else {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: 'Double Chance', status: 'UNAVAILABLE', reason: 'Sin cuotas Doble Oportunidad' });
    }

    // 3. Draw No Bet (derivado coherentemente de 1X2: P(DNB_1) = P(1)/(P(1)+P(2)))
    const dnbMkt = (rawOddsPayload?.markets || []).find(m => String(m.name || '').toLowerCase() === 'draw no bet');
    if (dnbMkt && Array.isArray(dnbMkt.outcomes) && dnbMkt.outcomes.length >= 2) {
      const p1 = evalRes.probabilities.matchResult1X2.home;
      const p2 = evalRes.probabilities.matchResult1X2.away;
      const nonDraw = Math.max(1e-9, p1 + p2);
      const oH = Number(dnbMkt.outcomes[0]?.best?.odds);
      const oA = Number(dnbMkt.outcomes[1]?.best?.odds);
      const bkH = dnbMkt.outcomes[0]?.best?.bookmaker || 'BOOKMAKER_UNAVAILABLE';
      const bkA = dnbMkt.outcomes[1]?.best?.bookmaker || 'BOOKMAKER_UNAVAILABLE';
      if (oH > 1 && oA > 1) {
        marketAvailabilityLog.push({ matchId: fx.matchId, market: 'Draw No Bet', status: 'AVAILABLE', line: 0, selections: ['HOME', 'AWAY'], bookmakers: { HOME: bkH, AWAY: bkA } });
        const nvH = v2Math.computeNoVigProb(oH, oA).prob;
        const nvA = v2Math.computeNoVigProb(oA, oH).prob;
        candidates.push(
          { ...baseMeta, marketFamily: 'draw_no_bet', market: 'Draw No Bet', selection: 'HOME', line: 0, bookmaker: bkH, bookmakerOdds: oH, modelProb: p1 / nonDraw, noVigProb: nvH },
          { ...baseMeta, marketFamily: 'draw_no_bet', market: 'Draw No Bet', selection: 'AWAY', line: 0, bookmaker: bkA, bookmakerOdds: oA, modelProb: p2 / nonDraw, noVigProb: nvA }
        );
      }
    } else {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: 'Draw No Bet', status: 'UNAVAILABLE', reason: 'Sin cuotas Draw No Bet' });
    }

    // 4. BTTS
    if (ex.oddsBtts && ex.oddsBtts.YES > 1 && ex.oddsBtts.NO > 1) {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: 'BTTS', status: 'AVAILABLE', line: null, selections: ['YES', 'NO'], bookmakers: ex.oddsBtts.bookmakers });
      const nvY = v2Math.computeNoVigProb(ex.oddsBtts.YES, ex.oddsBtts.NO).prob;
      const nvN = v2Math.computeNoVigProb(ex.oddsBtts.NO, ex.oddsBtts.YES).prob;
      candidates.push(
        { ...baseMeta, marketFamily: 'btts', market: 'Ambos Equipos Marcan', selection: 'YES', line: null, bookmaker: ex.oddsBtts.bookmakers.YES, bookmakerOdds: ex.oddsBtts.YES, oddsAgeMinutes: ex.oddsBtts.ageMinutes, modelProb: evalRes.probabilities.btts.yes, noVigProb: nvY },
        { ...baseMeta, marketFamily: 'btts', market: 'Ambos Equipos Marcan', selection: 'NO', line: null, bookmaker: ex.oddsBtts.bookmakers.NO, bookmakerOdds: ex.oddsBtts.NO, oddsAgeMinutes: ex.oddsBtts.ageMinutes, modelProb: evalRes.probabilities.btts.no, noVigProb: nvN }
      );
    } else {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: 'BTTS', status: 'UNAVAILABLE', reason: 'Sin cuotas BTTS' });
    }

    // 5. Total Goals
    const tg = ex.oddsTotalGoals;
    const tgDist = tg ? evalRes.probabilities.totalGoals[String(tg.line)] : null;
    if (tg && tgDist && tg.OVER > 1 && tg.UNDER > 1) {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: `Total Goals ${tg.line}`, status: 'AVAILABLE', line: tg.line, selections: ['OVER', 'UNDER'], bookmakers: tg.bookmakers });
      const nvO = v2Math.computeNoVigProb(tg.OVER, tg.UNDER).prob;
      const nvU = v2Math.computeNoVigProb(tg.UNDER, tg.OVER).prob;
      candidates.push(
        { ...baseMeta, marketFamily: 'match_goals', market: `Total Goles ${tg.line}`, selection: 'OVER', line: tg.line, bookmaker: tg.bookmakers.OVER, bookmakerOdds: tg.OVER, oddsAgeMinutes: tg.ageMinutes, modelProb: tgDist.pOver, noVigProb: nvO },
        { ...baseMeta, marketFamily: 'match_goals', market: `Total Goles ${tg.line}`, selection: 'UNDER', line: tg.line, bookmaker: tg.bookmakers.UNDER, bookmakerOdds: tg.UNDER, oddsAgeMinutes: tg.ageMinutes, modelProb: tgDist.pUnder, noVigProb: nvU }
      );
    } else {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: 'Total Goals', status: 'UNAVAILABLE', reason: 'Sin línea de Total Goles soportada/cotizada' });
    }

    // 6. Asian Handicap (si línea existe en distribución)
    const ah = ex.oddsAsianHandicap;
    const ahDist = ah ? evalRes.probabilities.asianHandicapHome[String(ah.lineHome)] : null;
    if (ah && ahDist && ah.HOME > 1 && ah.AWAY > 1) {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: `Asian Handicap ${ah.lineHome}`, status: 'AVAILABLE', line: ah.lineHome, selections: ['HOME', 'AWAY'], bookmakers: ah.bookmakers });
      const nvH = v2Math.computeNoVigProb(ah.HOME, ah.AWAY).prob;
      const nvA = v2Math.computeNoVigProb(ah.AWAY, ah.HOME).prob;
      candidates.push(
        { ...baseMeta, marketFamily: 'asian_handicap', market: `Hándicap Asiático (${ah.lineHome})`, selection: 'HOME', line: ah.lineHome, bookmaker: ah.bookmakers.HOME, bookmakerOdds: ah.HOME, oddsAgeMinutes: ah.ageMinutes, modelProb: ahDist.pWinNoPush, noVigProb: nvH },
        { ...baseMeta, marketFamily: 'asian_handicap', market: `Hándicap Asiático (${ah.lineAway})`, selection: 'AWAY', line: ah.lineAway, bookmaker: ah.bookmakers.AWAY, bookmakerOdds: ah.AWAY, oddsAgeMinutes: ah.ageMinutes, modelProb: ahDist.pLossNoPush, noVigProb: nvA }
      );
    } else {
      marketAvailabilityLog.push({ matchId: fx.matchId, market: 'Asian Handicap', status: 'UNAVAILABLE', reason: 'Sin línea AH estándar disponible en matriz' });
    }

    // 7. Team Stats (corners/cards/shots/fouls): explícitamente AGREGADO_SIN_SERIE (NO fabricar series)
    marketAvailabilityLog.push(
      { matchId: fx.matchId, market: 'Team Corners / Cards / Shots / Fouls', status: 'AGREGADO_SIN_SERIE', reason: 'StatsHub omite series partido a partido por fila en getTeamPerformance; no se fabrican series.' }
    );

    return { candidates, marketAvailabilityLog };
  }

  /**
   * Reanálisis selectivo de un único partido (reutilizable desde el barrido completo o disparo manual).
   */
  async reanalyzeSingleEvent(fx, {
    client = defaultMcpClient,
    nowUtc = new Date().toISOString(),
    minSampleGames = 8,
    elenaEvaluator,
    riskValidator,
    runCache = new Map()
  } = {}) {
    const cachedCall = async (tool, args) => {
      const k = `${tool}:${JSON.stringify(args)}`;
      if (runCache.has(k)) return { res: runCache.get(k), fromRunCache: true };
      const res = await client.callTool(tool, args, { timeoutMs: 12000 });
      runCache.set(k, res);
      return { res, fromRunCache: false };
    };

    let apiCalls = 0;
    const { res: oddsRes, fromRunCache: oddsHit } = await cachedCall('getMatchOdds', { matchId: fx.matchId });
    if (!oddsHit) apiCalls++;

    const oddsAudit = auditMatchOddsCoverage(oddsRes?.data);
    const kickoffUtc = fx.kickoffUtc || oddsAudit.kickoffUtc || `${fx.date}T${fx.kickoffHmUtc || '20:00'}:00.000Z`;
    const nowMs = Date.parse(nowUtc);
    const koMs = Date.parse(kickoffUtc);

    if (Number.isFinite(koMs) && nowMs >= koMs) {
      return { skippedStarted: true, matchId: fx.matchId, kickoffUtc, apiCalls, results: [], marketAvailabilityLog: [] };
    }

    const [{ res: homeRes, fromRunCache: hHit }, { res: awayRes, fromRunCache: aHit }] = await Promise.all([
      cachedCall('getTeamPerformance', { teamId: fx.homeTeam, limit: 25 }),
      cachedCall('getTeamPerformance', { teamId: fx.awayTeam, limit: 25 })
    ]);
    if (!hHit) apiCalls++;
    if (!aHit) apiCalls++;

    let homeNews = null;
    let awayNews = null;
    if ((fx.tier || 2) === 1) {
      try {
        const { res: newsRes, fromRunCache: nHit } = await cachedCall('getTeamNews', { matchId: fx.matchId });
        if (!nHit) apiCalls++;
        const arr = Array.isArray(newsRes?.data?.teams) ? newsRes.data.teams : [];
        homeNews = arr.find(t => t.side === 'home') || null;
        awayNews = arr.find(t => t.side === 'away') || null;
      } catch (_) {}
    }

    const evalRes = predictMatchOutcomes({
      matchId: fx.matchId,
      match: fx.match,
      league: fx.competition,
      homeTeamPerf: homeRes?.data,
      awayTeamPerf: awayRes?.data,
      homeTeamNews: homeNews,
      awayTeamNews: awayNews,
      odds1X2: oddsAudit.extractedOdds?.odds1X2,
      oddsDoubleChance: oddsAudit.extractedOdds?.oddsDoubleChance,
      minSampleGames
    });

    if (!evalRes.ok) {
      return {
        skippedStarted: false,
        insufficientData: true,
        reason: evalRes.reason,
        matchId: fx.matchId,
        kickoffUtc,
        apiCalls,
        results: [],
        marketAvailabilityLog: [{ matchId: fx.matchId, market: 'ALL', status: 'DATOS_INSUFICIENTES', reason: evalRes.reason }]
      };
    }

    const { candidates, marketAvailabilityLog } = this._buildMarketCandidatesForMatch({
      fx, kickoffUtc, oddsAudit, evalRes, rawOddsPayload: oddsRes?.data
    });

    const latestMap = this.store.getLatestByOpportunityId();
    const results = [];

    for (const cand of candidates) {
      const oppId = buildOpportunityId(cand);
      const prev = latestMap.get(oppId) || null;
      const re = reanalyzeOpportunity({
        candidate: cand,
        previousVersion: prev,
        nowUtc,
        elenaEvaluator,
        riskValidator
      });

      const persisted = this.store.appendVersion({
        opportunityId: oppId,
        matchId: cand.matchId,
        match: cand.match,
        league: cand.league,
        marketFamily: cand.marketFamily,
        market: cand.market,
        selection: cand.selection,
        line: cand.line,
        odds: re.value?.odds ?? cand.bookmakerOdds,
        bookmaker: cand.bookmaker,
        probability: re.value?.probability ?? cand.modelProb,
        fairOdds: re.value?.fairOdds ?? null,
        impliedProbability: re.value?.impliedProbability ?? null,
        noVigProbability: re.value?.noVigProbability ?? cand.noVigProb,
        expectedValue: re.value?.expectedValue ?? null,
        expectedValuePct: re.value?.expectedValuePct ?? null,
        modelId: cand.modelId,
        modelVersion: cand.modelVersion,
        dataCoverage: cand.dataCoverage,
        dataQualityScore: cand.dataQualityScore,
        evidenceTier: cand.evidenceTier,
        analyzedAtUtc: nowUtc,
        kickoffUtc,
        changeReason: re.changes.reasons,
        status: re.status,
        elenaSummary: re.elenaVerdict ? { available: re.elenaVerdict.available, approved: re.elenaVerdict.approved, status: re.elenaVerdict.status, reasons: re.elenaVerdict.reasons } : null,
        riskManagerSummary: re.riskVerdict ? { approved: re.riskVerdict.riskManagerApproved, finalStatus: re.riskVerdict.finalStatus, reason: re.riskVerdict.finalDecisionReason } : null
      });

      results.push({ candidate: cand, analysis: re, persisted });
    }

    return { skippedStarted: false, insufficientData: false, matchId: fx.matchId, kickoffUtc, apiCalls, results, marketAvailabilityLog };
  }

  /**
   * Ejecuta un barrido integral de mercados en 2 niveles (controlado manualmente).
   */
  async runFullRescan({
    date = new Date().toISOString().slice(0, 10),
    days = 2,
    maxLeagues = 4,
    maxMatches = 6,
    nowUtc = new Date().toISOString(),
    client = defaultMcpClient,
    competitions = null,
    extraFixtures = [],
    elenaEvaluator,
    riskValidator,
    minSampleGames = 8
  } = {}) {
    if (this._running) {
      return { skipped: true, reason: 'RESCAN_ALREADY_RUNNING', autoExecutionAllowed: false };
    }
    this._running = true;

    const scanId = `rescan_${Date.now()}`;
    const t0 = Date.now();
    const state = this._loadState();
    state.inProgressScanId = scanId;
    state.completedMatchIds = [];
    this._saveState(state);

    const runCache = new Map();
    const summary = {
      scanId,
      startedAtUtc: new Date(t0).toISOString(),
      completedAtUtc: null,
      durationMs: 0,
      autoExecutionAllowed: false,
      leaguesScanned: 0,
      apiCallsUsed: 0,
      eventsDiscovered: 0,
      eventsProcessed: 0,
      eventsSkippedStarted: 0,
      marketsExplored: 0,
      newOpportunitiesCount: 0,
      existingChangedCount: 0,
      improvedCount: 0,
      deterioratedCount: 0,
      rejectedCount: 0,
      watchlistCount: 0,
      insufficientDataCount: 0,
      versionsRecorded: 0,
      versionsUnchangedSkipped: 0,
      errors: [],
      marketAvailabilityLog: []
    };

    try {
      const leagues = competitions || loadEnabledCompetitions(maxLeagues);
      summary.leaguesScanned = leagues.length;

      // Nivel 1: Discovery de fixtures futuros deduplicados por matchId
      const seenMatchIds = new Set();
      const fixtureList = [];

      for (const fx of (extraFixtures || [])) {
        if (fx?.matchId && !seenMatchIds.has(fx.matchId)) {
          seenMatchIds.add(fx.matchId);
          fixtureList.push(fx);
        }
      }

      for (const lg of leagues) {
        try {
          const res = await client.callTool('getFixturesByDate', {
            competitionId: lg.competitionId,
            date,
            days,
            limit: 12,
            withOdds: true
          }, { timeoutMs: 12000 });
          summary.apiCallsUsed++;
          const parsed = parseFixturesWithOddsSummary(res?.data?.fixturesSummary || '', lg.name, date);
          for (const fx of parsed) {
            if (!seenMatchIds.has(fx.matchId)) {
              seenMatchIds.add(fx.matchId);
              fixtureList.push({ ...fx, tier: lg.tier || 2, competitionId: lg.competitionId });
            }
          }
        } catch (err) {
          summary.errors.push({ stage: 'LEVEL1_DISCOVERY', league: lg.name, error: err.message });
        }
      }

      summary.eventsDiscovered = fixtureList.length;
      const targetFixtures = fixtureList.slice(0, maxMatches);

      // Nivel 2: Deep Research + Reanálisis por partido
      const allEvaluations = [];
      for (const fx of targetFixtures) {
        try {
          const out = await this.reanalyzeSingleEvent(fx, {
            client, nowUtc, minSampleGames, elenaEvaluator, riskValidator, runCache
          });
          summary.apiCallsUsed += out.apiCalls;
          summary.marketAvailabilityLog.push(...out.marketAvailabilityLog);

          if (out.skippedStarted) {
            summary.eventsSkippedStarted++;
            continue;
          }
          summary.eventsProcessed++;
          if (out.insufficientData) {
            summary.insufficientDataCount++;
            continue;
          }

          for (const item of out.results) {
            summary.marketsExplored++;
            const st = item.analysis.status;
            const ch = item.analysis.changes;

            if (item.persisted.recorded) summary.versionsRecorded++;
            else if (item.persisted.idempotent) summary.versionsUnchangedSkipped++;

            if (st === OPPORTUNITY_STATES.OPPORTUNITY && ch.isNew) summary.newOpportunitiesCount++;
            if (!ch.isNew && ch.hasSignificantChange) summary.existingChangedCount++;
            if (ch.reasons.includes(CHANGE_REASONS.ODDS_IMPROVED) || ch.reasons.includes(CHANGE_REASONS.EV_BECAME_POSITIVE)) summary.improvedCount++;
            if (ch.reasons.includes(CHANGE_REASONS.ODDS_DETERIORATED) || ch.reasons.includes(CHANGE_REASONS.EV_BECAME_NEGATIVE)) summary.deterioratedCount++;
            if (st === OPPORTUNITY_STATES.REJECTED) summary.rejectedCount++;
            if (st === OPPORTUNITY_STATES.WATCHLIST) summary.watchlistCount++;
            if (st === OPPORTUNITY_STATES.INSUFFICIENT_DATA) summary.insufficientDataCount++;

            allEvaluations.push(item);
          }

          state.completedMatchIds.push(fx.matchId);
          this._saveState(state);
        } catch (err) {
          summary.errors.push({ stage: 'LEVEL2_RESCAN', matchId: fx.matchId, match: fx.match, error: err.message });
        }
      }

      summary.completedAtUtc = new Date().toISOString();
      summary.durationMs = Date.now() - t0;

      state.inProgressScanId = null;
      state.status = summary.errors.length > 0 && summary.eventsProcessed === 0 ? 'PROVIDER_ERROR' : (summary.marketsExplored === 0 ? 'ZERO_OPPORTUNITIES' : 'COMPLETED');
      state.lastSummary = summary;
      state.scanHistory = [summary, ...(state.scanHistory || [])].slice(0, 20);
      this._saveState(state);

      // Exportar ranking y versionado para Dashboard de Oportunidades (Fase 10.2)
      const latestMap = this.store.getLatestByOpportunityId();
      const allVersions = this.store.getAllVersions();
      const ranking = Array.from(latestMap.values())
        .sort((a, b) => (b.expectedValuePct ?? -999) - (a.expectedValuePct ?? -999));

      const histories = {};
      for (const v of allVersions) {
        if (!histories[v.opportunityId]) histories[v.opportunityId] = [];
        histories[v.opportunityId].push(v);
      }

      const exportPayload = {
        generatedAtUtc: summary.completedAtUtc,
        mode: 'SHADOW_MODE_EXPERIMENTAL',
        autoExecutionAllowed: false,
        integrity: this.store.verifyIntegrity(),
        summary,
        ranking,
        histories
      };
      atomicWriteJson(this.exportPath, exportPayload);

      return { ok: true, summary, integrity: exportPayload.integrity, exportPath: this.exportPath };
    } finally {
      this._running = false;
    }
  }
}

module.exports = {
  FullMarketRescanEngine
};
