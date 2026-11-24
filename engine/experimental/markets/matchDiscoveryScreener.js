/**
 * MATCH DISCOVERY SCREENER (FASE 4 — EXPERIMENTAL / 2-STAGE SCREENING)
 *
 * Incorpora mercados de partido (1X2 y Doble Oportunidad) al flujo de descubrimiento
 * respetando límites de API, caché y rateGovernor existentes.
 *
 * Estrategia en 2 etapas:
 *   Etapa 1 (Screening barato): recorre ligas prioritarias ya configuradas con
 *     getFixturesByDate({ competitionId, date, days, withOdds: true }) — 1 llamada por liga.
 *     Descarta partidos sin cuotas o fuera de cobertura.
 *   Etapa 2 (Investigación profunda acotada): solo para los top K partidos seleccionados
 *     consulta getMatchOdds, getTeamPerformance (local/visitante) y opcionalmente getTeamNews
 *     (Tier 1/Europa), ejecuta MatchOutcomeModel y emite candidatas preliminares con EV positivo.
 *
 * NO modifica DiscoveryEngine productivo ni habilita apuestas reales.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const mcpClient = require('../../mcp/mcpClient');
const { predictMatchOutcomes } = require('./matchOutcomeModel');
const { auditMatchOddsCoverage, COVERAGE_STATUS } = require('./marketCoverageAudit');

const COMPETITIONS_PATH = path.resolve(__dirname, '..', '..', 'storage_data', 'competitions_config.json');

/**
 * Parsea fixturesSummary devuelto por getFixturesByDate(withOdds: true).
 * Ejemplo de línea:
 *   - Tue 20:00 Arsenal v Borussia Dortmund (id arsenal-v-borussia-dortmund.0uein1n) | lineups predicted | ref Maurizio Mariani | 1X2 H 1.45 Bet365 / D 4.75 BetMGM UK / A 7.00 Paddy Power, favourite Arsenal
 */
function parseFixturesWithOddsSummary(summaryText, competitionName, dateStr) {
  if (!summaryText || typeof summaryText !== 'string') return [];
  const lines = summaryText.split('\n');
  const out = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('-')) continue;

    const idMatch = line.match(/\(id\s+([^\s)]+)\)/i);
    const matchId = idMatch ? idMatch[1] : null;
    const teamsMatch = line.match(/^-\s+(?:[A-Za-z]{3}\s+)?(\d{2}:\d{2})\s+(.+?)\s+v\s+(.+?)\s+\(id\s+/i);
    if (!teamsMatch || !matchId) continue;

    const kickoffHm = teamsMatch[1];
    const homeTeam = teamsMatch[2].trim();
    const awayTeam = teamsMatch[3].trim();

    const oddsMatch = line.match(/1X2\s+H\s+([\d.]+)\s+.+?\/\s+D\s+([\d.]+)\s+.+?\/\s+A\s+([\d.]+)/i);
    const odds1X2 = oddsMatch
      ? { home: Number(oddsMatch[1]), draw: Number(oddsMatch[2]), away: Number(oddsMatch[3]) }
      : null;

    out.push({
      matchId,
      competition: competitionName,
      date: dateStr,
      kickoffHmUtc: kickoffHm,
      homeTeam,
      awayTeam,
      match: `${homeTeam} vs ${awayTeam}`,
      hasPreliminary1X2Odds: Boolean(odds1X2 && odds1X2.home > 1 && odds1X2.draw > 1 && odds1X2.away > 1),
      preliminary1X2: odds1X2
    });
  }

  return out;
}

/**
 * Carga ligas prioritarias ya habilitadas (ENABLED o TRIAL) sin agregar nuevas ligas.
 */
function loadEnabledCompetitions(maxLeagues = 8) {
  if (!fs.existsSync(COMPETITIONS_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(COMPETITIONS_PATH, 'utf8'));
  const list = Array.isArray(raw?.competitions) ? raw.competitions : [];
  return list
    .filter(c => (c.status === 'ENABLED' || c.status === 'TRIAL') && c.competitionId)
    .sort((a, b) => (a.tier || 9) - (b.tier || 9))
    .slice(0, maxLeagues);
}

/**
 * Screening Etapa 1 + Etapa 2 con inyección de cliente MCP (permite tests deterministas sin consumo real).
 */
async function runTwoStageMatchDiscovery({
  date = new Date().toISOString().slice(0, 10),
  days = 2,
  maxLeagues = 8,
  maxDeepMatches = 8,
  minEvPct = 2.0,
  minSampleGames = 8,
  client = mcpClient,
  competitions = null
} = {}) {
  const leagues = competitions || loadEnabledCompetitions(maxLeagues);
  const stage1Fixtures = [];
  const discardedStage1 = [];
  let apiCallsUsed = 0;

  // --- ETAPA 1: Screening barato (1 llamada por liga con withOdds: true) ---
  for (const league of leagues) {
    try {
      const res = await client.callTool('getFixturesByDate', {
        competitionId: league.competitionId,
        date,
        days,
        limit: 12,
        withOdds: true
      });
      apiCallsUsed++;
      const parsed = parseFixturesWithOddsSummary(res?.data?.fixturesSummary || '', league.name, date);
      for (const fx of parsed) {
        if (fx.hasPreliminary1X2Odds) {
          stage1Fixtures.push({ ...fx, tier: league.tier || 2, competitionId: league.competitionId });
        } else {
          discardedStage1.push({ matchId: fx.matchId, match: fx.match, reason: 'SIN_CUOTAS_1X2_PRELIMINARES' });
        }
      }
    } catch (err) {
      discardedStage1.push({ competition: league.name, reason: `ERROR_STAGE1: ${err.message}` });
    }
  }

  // Priorizar Tier 1 y cuotas balanceadas antes de acotar a maxDeepMatches
  const shortlisted = stage1Fixtures
    .sort((a, b) => (a.tier - b.tier))
    .slice(0, maxDeepMatches);

  // --- ETAPA 2: Investigación profunda acotada (solo sobre shortlisted) ---
  const candidates = [];
  const discardedStage2 = [];

  for (const fx of shortlisted) {
    try {
      const oddsRes = await client.callTool('getMatchOdds', { matchId: fx.matchId });
      apiCallsUsed++;
      const oddsAudit = auditMatchOddsCoverage(oddsRes?.data);
      if (oddsAudit.markets.match_1x2 !== COVERAGE_STATUS.COMPLETO) {
        discardedStage2.push({ matchId: fx.matchId, match: fx.match, reason: 'CUOTAS_1X2_NO_DISPONIBLES' });
        continue;
      }

      const [homePerfRes, awayPerfRes] = await Promise.all([
        client.callTool('getTeamPerformance', { teamId: fx.homeTeam, limit: 25 }),
        client.callTool('getTeamPerformance', { teamId: fx.awayTeam, limit: 25 })
      ]);
      apiCallsUsed += 2;

      let homeNews = null;
      let awayNews = null;
      if ((fx.tier || 2) === 1) {
        try {
          const newsRes = await client.callTool('getTeamNews', { matchId: fx.matchId });
          apiCallsUsed++;
          const teamsNews = Array.isArray(newsRes?.data?.teams) ? newsRes.data.teams : [];
          homeNews = teamsNews.find(t => t.side === 'home') || null;
          awayNews = teamsNews.find(t => t.side === 'away') || null;
        } catch (_) {
          // No bloqueante si getTeamNews no tiene cobertura
        }
      }

      const evalResult = predictMatchOutcomes({
        matchId: fx.matchId,
        match: fx.match,
        league: fx.competition,
        homeTeamPerf: homePerfRes?.data,
        awayTeamPerf: awayPerfRes?.data,
        homeTeamNews: homeNews,
        awayTeamNews: awayNews,
        odds1X2: oddsAudit.extractedOdds.odds1X2,
        oddsDoubleChance: oddsAudit.extractedOdds.oddsDoubleChance,
        minSampleGames
      });

      if (!evalResult.ok) {
        discardedStage2.push({ matchId: fx.matchId, match: fx.match, reason: evalResult.reason });
        continue;
      }

      // Emitir candidatas por familia que superen minEvPct (sin forzar selección)
      const emitFamily = (family, pricingMap, metaOdds) => {
        if (!pricingMap) return;
        for (const [sel, item] of Object.entries(pricingMap)) {
          if (!item || !item.available) continue;
          if (item.evPct >= minEvPct) {
            candidates.push({
              candidateId: `exp_${fx.matchId}_${family}_${sel}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
              matchId: fx.matchId,
              match: fx.match,
              league: fx.competition,
              sport: 'football',
              marketFamily: family,
              market: family === 'match_1x2' ? 'Ganador 1X2' : 'Doble Oportunidad',
              selection: sel,
              bookmakerOdds: item.bookmakerOdds,
              oddsAgeMinutes: metaOdds?.ageMinutes ?? null,
              booksCount: metaOdds?.books ?? null,
              modelProb: item.modelProb,
              impliedProb: item.impliedProb,
              noVigProb: item.noVigProb,
              fairOdds: item.fairOdds,
              ev: item.ev,
              evPct: item.evPct,
              dataQuality: evalResult.dataQuality,
              parameters: evalResult.parameters,
              probabilities1X2: evalResult.probabilities.matchResult1X2,
              probabilitiesDC: evalResult.probabilities.doubleChance,
              modelVersion: evalResult.modelVersion,
              isExperimental: true,
              autoExecutionAllowed: false
            });
          }
        }
      };

      emitFamily('match_1x2', evalResult.pricing.match_1x2, oddsAudit.extractedOdds.odds1X2);
      emitFamily('double_chance', evalResult.pricing.double_chance, oddsAudit.extractedOdds.oddsDoubleChance);
    } catch (err) {
      discardedStage2.push({ matchId: fx.matchId, match: fx.match, reason: `ERROR_STAGE2: ${err.message}` });
    }
  }

  return {
    date,
    days,
    leaguesScanned: leagues.length,
    stage1FixturesFound: stage1Fixtures.length,
    stage2Shortlisted: shortlisted.length,
    apiCallsUsed,
    candidatesCount: candidates.length,
    candidates,
    discardedStage1,
    discardedStage2
  };
}

module.exports = {
  parseFixturesWithOddsSummary,
  loadEnabledCompetitions,
  runTwoStageMatchDiscovery
};
