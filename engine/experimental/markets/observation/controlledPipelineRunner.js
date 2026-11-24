/**
 * FASE 10 — CONTROLLED PIPELINE RUNNER (ACTIVACIÓN OPERATIVA CONTROLADA)
 *
 * Conecta de extremo a extremo el circuito experimental de expansión de mercados
 * y Fase 9.1 en Shadow Mode (autoExecutionAllowed = false), completamente aislado
 * del Daily Board, Prediction Engine V1, Risk Manager productivo y RETO ESCALERA.
 *
 * Flujo de 12 pasos:
 *  1. CentralScheduler (o disparo manual controlado) inicia el ciclo con Mutex + persistencia.
 *  2. Consulta fixtures futuros de ligas ya habilitadas (getFixturesByDate withOdds:true).
 *  3. Filtra partidos elegibles (descarta ya iniciados y sin cuotas).
 *  4. Consulta getMatchOdds, getTeamPerformance (local/visitante) y getTeamNews (Tier 1).
 *  5. Ejecuta MatchOutcomeModel (1X2, Doble Oportunidad, BTTS, Total Goles, AH).
 *  6. Clasifica con OpportunityRanker (filtros duros + puntuación compuesta).
 *  7. Evalúa con Elena experimental (marketElenaRiskGuard).
 *  8. Aplica Market Risk Guard (veto vinculante sobre Elena).
 *  9. Registra observaciones pre-partido inmutables en ObservationStore (Fase 9.1).
 * 10. Programa ventanas de snapshots (T-60, T-30, T-5, T-1) para cada observación registrada.
 * 11. Ejecuta SettlementProcessor si existen partidos finalizados confirmados.
 * 12. Exporta api/evidence_fase9.json con telemetría operativa completa para /evidence_dashboard.html.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const defaultMcpClient = require('../../../mcp/mcpClient');
const v2Math = require('../../predictionEngineV2');
const { loadEnabledCompetitions, parseFixturesWithOddsSummary } = require('../matchDiscoveryScreener');
const { auditMatchOddsCoverage, COVERAGE_STATUS } = require('../marketCoverageAudit');
const { predictMatchOutcomes, evaluateSelectionPricing } = require('../matchOutcomeModel');
const { rankOpportunities } = require('../opportunityRanker');
const { buildElenaMarketPacket, evaluateElenaForMarket, validateMarketRisk } = require('../marketElenaRiskGuard');
const { ObservationStore } = require('./observationStore');
const { SettlementProcessor } = require('./settlementProcessor');
const { ObservationOrchestrator } = require('./observationOrchestrator');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_OP_STATE_PATH = path.join(STORAGE_DIR, 'fase10_operational_state.json');

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

function buildSnapshotSchedule(kickoffUtc) {
  const koMs = Date.parse(kickoffUtc);
  if (!Number.isFinite(koMs)) return [];
  return [
    { checkpoint: 'T_MINUS_60', scheduledUtc: new Date(koMs - 60 * 60 * 1000).toISOString(), status: 'SCHEDULED' },
    { checkpoint: 'T_MINUS_30', scheduledUtc: new Date(koMs - 30 * 60 * 1000).toISOString(), status: 'SCHEDULED' },
    { checkpoint: 'T_MINUS_5', scheduledUtc: new Date(koMs - 5 * 60 * 1000).toISOString(), status: 'SCHEDULED' },
    { checkpoint: 'CLOSING', scheduledUtc: new Date(koMs - 1 * 60 * 1000).toISOString(), status: 'SCHEDULED' }
  ];
}

class ControlledPipelineRunner {
  constructor(options = {}) {
    this.store = options.store || new ObservationStore(options.storeOptions);
    this.settlement = options.settlement || new SettlementProcessor(this.store);
    this.orchestrator = options.orchestrator || new ObservationOrchestrator({
      store: this.store,
      settlement: this.settlement,
      exportPath: options.exportPath
    });
    this.opStatePath = options.opStatePath || DEFAULT_OP_STATE_PATH;
    this.autoExecutionAllowed = false;
    this._running = false;
  }

  loadOperationalState() {
    if (!fs.existsSync(this.opStatePath)) {
      return {
        status: 'NOT_EXECUTED',
        autoExecutionAllowed: false,
        inProgressRunId: null,
        lastRunAtUtc: null,
        lastStatsHubQueryAtUtc: null,
        runsCount: 0,
        lastRunSummary: null,
        scheduledSnapshots: [],
        runHistory: []
      };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.opStatePath, 'utf8'));
      // Recuperación automática tras reinicio si quedó un run marcado inProgress
      if (parsed.inProgressRunId) {
        parsed.recoveredInterruptedRunId = parsed.inProgressRunId;
        parsed.inProgressRunId = null;
        parsed.status = 'RECOVERED_FROM_RESTART';
      }
      return parsed;
    } catch (_) {
      return {
        status: 'STATE_RECOVERY_RESET',
        autoExecutionAllowed: false,
        inProgressRunId: null,
        lastRunAtUtc: null,
        lastStatsHubQueryAtUtc: null,
        runsCount: 0,
        lastRunSummary: null,
        scheduledSnapshots: [],
        runHistory: []
      };
    }
  }

  _saveOperationalState(state) {
    atomicWriteJson(this.opStatePath, state);
  }

  /**
   * Ejecuta una corrida completa y controlada del circuito experimental (Shadow Mode).
   */
  async runControlledCycle({
    date = new Date().toISOString().slice(0, 10),
    days = 2,
    maxLeagues = 4,
    maxDeepMatches = 4,
    minEvPct = -5.0, // En observación Shadow Mode podemos observar todas o filtrar por EV >= minEvPct
    recordAllEvaluatedForCalibration = false,
    minSampleGames = 8,
    client = defaultMcpClient,
    competitions = null,
    nowUtc = new Date().toISOString(),
    trigger = 'MANUAL_CONTROLLED'
  } = {}) {
    if (this._running) {
      return { skipped: true, reason: 'CYCLE_ALREADY_RUNNING', autoExecutionAllowed: false };
    }
    this._running = true;

    const runId = `f10_run_${Date.now()}`;
    const startedAtUtc = new Date().toISOString();
    const nowMs = Date.parse(nowUtc);
    const opState = this.loadOperationalState();
    opState.inProgressRunId = runId;
    this._saveOperationalState(opState);

    const stageErrors = [];
    const rejectionReasons = {};
    const trackReject = (reason) => {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    };

    const telemetry = {
      runId,
      trigger,
      startedAtUtc,
      completedAtUtc: null,
      outcomeCategory: 'EXECUTED', // EXECUTED | ZERO_OPPORTUNITIES | PROVIDER_ERROR | INSUFFICIENT_DATA
      autoExecutionAllowed: false,
      leaguesScanned: 0,
      mcpCallsUsed: 0,
      lastStatsHubQueryAtUtc: null,
      fixturesDiscovered: 0,
      fixturesSkippedStarted: 0,
      fixturesSkippedNoOdds: 0,
      matchesInvestigated: 0,
      marketsEvaluated: { match_1x2: 0, double_chance: 0, btts: 0, match_goals: 0, asian_handicap: 0 },
      predictionsGenerated: 0,
      observationsAccepted: 0,
      observationsRejected: 0,
      observationsDuplicated: 0,
      snapshotsScheduled: 0,
      rejectionReasons,
      stageErrors,
      recordedObservationIds: []
    };

    try {
      const leagues = competitions || loadEnabledCompetitions(maxLeagues);
      telemetry.leaguesScanned = leagues.length;

      // --- ETAPA 1: Discovery de fixtures futuros ---
      const stage1Fixtures = [];
      for (const league of leagues) {
        try {
          const res = await client.callTool('getFixturesByDate', {
            competitionId: league.competitionId,
            date,
            days,
            limit: 12,
            withOdds: true
          }, { timeoutMs: 12000 });
          telemetry.mcpCallsUsed++;
          telemetry.lastStatsHubQueryAtUtc = new Date().toISOString();

          const parsed = parseFixturesWithOddsSummary(res?.data?.fixturesSummary || '', league.name, date);
          telemetry.fixturesDiscovered += parsed.length;

          for (const fx of parsed) {
            if (!fx.hasPreliminary1X2Odds) {
              telemetry.fixturesSkippedNoOdds++;
              trackReject('SIN_CUOTAS_PRELIMINARES');
              continue;
            }
            stage1Fixtures.push({ ...fx, tier: league.tier || 2, competitionId: league.competitionId });
          }
        } catch (err) {
          stageErrors.push({ stage: 'DISCOVERY_FIXTURES', league: league.name, error: err.message });
        }
      }

      if (stage1Fixtures.length === 0 && stageErrors.length > 0 && telemetry.fixturesDiscovered === 0) {
        telemetry.outcomeCategory = 'PROVIDER_ERROR';
      }

      const shortlisted = stage1Fixtures.sort((a, b) => a.tier - b.tier).slice(0, maxDeepMatches);

      // --- ETAPA 2: Investigación profunda acotada + MatchOutcomeModel ---
      const rawCandidates = [];

      for (const fx of shortlisted) {
        try {
          const oddsRes = await client.callTool('getMatchOdds', { matchId: fx.matchId }, { timeoutMs: 12000 });
          telemetry.mcpCallsUsed++;
          telemetry.lastStatsHubQueryAtUtc = new Date().toISOString();

          const oddsAudit = auditMatchOddsCoverage(oddsRes?.data);
          const kickoffUtc = oddsAudit.kickoffUtc || `${fx.date}T${fx.kickoffHmUtc || '20:00'}:00.000Z`;
          const koMs = Date.parse(kickoffUtc);

          // Regla crítica: NO procesar partidos ya iniciados
          if (!Number.isFinite(koMs) || koMs <= nowMs) {
            telemetry.fixturesSkippedStarted++;
            trackReject('PARTIDO_YA_INICIADO');
            continue;
          }

          if (oddsAudit.markets.match_1x2 !== COVERAGE_STATUS.COMPLETO) {
            trackReject('CUOTAS_1X2_NO_DISPONIBLES');
            continue;
          }

          const [homePerfRes, awayPerfRes] = await Promise.all([
            client.callTool('getTeamPerformance', { teamId: fx.homeTeam, limit: 25 }, { timeoutMs: 12000 }),
            client.callTool('getTeamPerformance', { teamId: fx.awayTeam, limit: 25 }, { timeoutMs: 12000 })
          ]);
          telemetry.mcpCallsUsed += 2;
          telemetry.lastStatsHubQueryAtUtc = new Date().toISOString();

          let homeNews = null;
          let awayNews = null;
          if (fx.tier === 1) {
            try {
              const newsRes = await client.callTool('getTeamNews', { matchId: fx.matchId }, { timeoutMs: 12000 });
              telemetry.mcpCallsUsed++;
              const teamsNews = Array.isArray(newsRes?.data?.teams) ? newsRes.data.teams : [];
              homeNews = teamsNews.find(t => t.side === 'home') || null;
              awayNews = teamsNews.find(t => t.side === 'away') || null;
            } catch (_) {}
          }

          telemetry.matchesInvestigated++;

          const evalRes = predictMatchOutcomes({
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

          if (!evalRes.ok) {
            trackReject('DATOS_INSUFICIENTES_EQUIPO');
            continue;
          }

          const baseMeta = {
            matchId: fx.matchId,
            match: fx.match,
            homeTeam: fx.homeTeam,
            awayTeam: fx.awayTeam,
            league: fx.competition,
            sport: 'football',
            kickoffUtc,
            dataQuality: evalRes.dataQuality,
            dataQualityScore: evalRes.dataQuality.score,
            sampleSize: Math.min(evalRes.parameters.homeSampleGames, evalRes.parameters.awaySampleGames),
            parameters: evalRes.parameters,
            probabilities1X2: evalRes.probabilities.matchResult1X2,
            noVig1X2: evalRes.marketDevig1X2?.probs || null,
            modelName: 'MatchOutcomeDC',
            modelVersion: evalRes.modelVersion,
            modelConsensus: 0.80
          };

          // 1) 1X2 (bookmaker real por selección, nunca 'StatsHubBest')
          if (evalRes.pricing.match_1x2) {
            for (const [sel, item] of Object.entries(evalRes.pricing.match_1x2)) {
              if (!item?.available) continue;
              telemetry.marketsEvaluated.match_1x2++;
              telemetry.predictionsGenerated++;
              rawCandidates.push({
                ...baseMeta,
                marketFamily: 'match_1x2',
                market: 'Ganador 1X2',
                selection: sel,
                line: null,
                bookmaker: oddsAudit.extractedOdds.odds1X2?.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
                bookmakerOdds: item.bookmakerOdds,
                oddsAgeMinutes: oddsAudit.extractedOdds.odds1X2?.ageMinutesBySelection?.[sel] ?? oddsAudit.extractedOdds.odds1X2?.ageMinutes ?? 0,
                modelProb: item.modelProb,
                impliedProb: item.impliedProb,
                noVigProb: item.noVigProb,
                ev: item.ev,
                evPct: item.evPct
              });
            }
          }

          // 2) Doble Oportunidad (bookmaker real por selección, nunca 'StatsHubBest')
          if (evalRes.pricing.double_chance) {
            for (const [sel, item] of Object.entries(evalRes.pricing.double_chance)) {
              if (!item?.available) continue;
              telemetry.marketsEvaluated.double_chance++;
              telemetry.predictionsGenerated++;
              rawCandidates.push({
                ...baseMeta,
                marketFamily: 'double_chance',
                market: 'Doble Oportunidad',
                selection: sel,
                line: null,
                bookmaker: oddsAudit.extractedOdds.oddsDoubleChance?.bookmakers?.[sel] || 'BOOKMAKER_UNAVAILABLE',
                bookmakerOdds: item.bookmakerOdds,
                oddsAgeMinutes: oddsAudit.extractedOdds.oddsDoubleChance?.ageMinutesBySelection?.[sel] ?? oddsAudit.extractedOdds.oddsDoubleChance?.ageMinutes ?? 0,
                modelProb: item.modelProb,
                impliedProb: item.impliedProb,
                noVigProb: item.noVigProb,
                ev: item.ev,
                evPct: item.evPct
              });
            }
          }

          // 3) BTTS
          const bttsOdds = oddsAudit.extractedOdds.oddsBtts;
          if (bttsOdds && bttsOdds.YES > 1 && bttsOdds.NO > 1) {
            const nvYes = v2Math.computeNoVigProb(bttsOdds.YES, bttsOdds.NO).prob;
            const nvNo = v2Math.computeNoVigProb(bttsOdds.NO, bttsOdds.YES).prob;
            const pYes = evaluateSelectionPricing({ selection: 'YES', marketFamily: 'btts', modelProb: evalRes.probabilities.btts.yes, bookmakerOdds: bttsOdds.YES, noVigProb: nvYes });
            const pNo = evaluateSelectionPricing({ selection: 'NO', marketFamily: 'btts', modelProb: evalRes.probabilities.btts.no, bookmakerOdds: bttsOdds.NO, noVigProb: nvNo });
            for (const [sel, pr, bk] of [['YES', pYes, bttsOdds.bookmakerYes], ['NO', pNo, bttsOdds.bookmakerNo]]) {
              if (!pr.available) continue;
              telemetry.marketsEvaluated.btts++;
              telemetry.predictionsGenerated++;
              rawCandidates.push({
                ...baseMeta,
                marketFamily: 'btts',
                market: 'Ambos Equipos Marcan',
                selection: sel,
                line: null,
                bookmaker: bk,
                bookmakerOdds: pr.bookmakerOdds,
                oddsAgeMinutes: bttsOdds.ageMinutes ?? 0,
                modelProb: pr.modelProb,
                impliedProb: pr.impliedProb,
                noVigProb: pr.noVigProb,
                ev: pr.ev,
                evPct: pr.evPct
              });
            }
          }

          // 4) Total Goles (si la línea está en nuestra distribución derivada)
          const tgOdds = oddsAudit.extractedOdds.oddsTotalGoals;
          const tgDist = tgOdds ? evalRes.probabilities.totalGoals[String(tgOdds.line)] : null;
          if (tgOdds && tgDist && tgOdds.OVER > 1 && tgOdds.UNDER > 1) {
            const nvOver = v2Math.computeNoVigProb(tgOdds.OVER, tgOdds.UNDER).prob;
            const nvUnder = v2Math.computeNoVigProb(tgOdds.UNDER, tgOdds.OVER).prob;
            const pOver = evaluateSelectionPricing({ selection: 'OVER', marketFamily: 'match_goals', modelProb: tgDist.pOver, bookmakerOdds: tgOdds.OVER, noVigProb: nvOver, pPush: tgDist.pPush });
            const pUnder = evaluateSelectionPricing({ selection: 'UNDER', marketFamily: 'match_goals', modelProb: tgDist.pUnder, bookmakerOdds: tgOdds.UNDER, noVigProb: nvUnder, pPush: tgDist.pPush });
            for (const [sel, pr, bk] of [['OVER', pOver, tgOdds.bookmakerOver], ['UNDER', pUnder, tgOdds.bookmakerUnder]]) {
              if (!pr.available) continue;
              telemetry.marketsEvaluated.match_goals++;
              telemetry.predictionsGenerated++;
              rawCandidates.push({
                ...baseMeta,
                marketFamily: 'match_goals',
                market: `Total Goles ${tgOdds.line}`,
                selection: sel,
                line: tgOdds.line,
                bookmaker: bk,
                bookmakerOdds: pr.bookmakerOdds,
                oddsAgeMinutes: tgOdds.ageMinutes ?? 0,
                modelProb: pr.modelProb,
                impliedProb: pr.impliedProb,
                noVigProb: pr.noVigProb,
                ev: pr.ev,
                evPct: pr.evPct
              });
            }
          }
        } catch (err) {
          stageErrors.push({ stage: 'DEEP_RESEARCH_MATCH', matchId: fx.matchId, match: fx.match, error: err.message });
        }
      }

      // --- ETAPA 3: Ranking + Elena Experimental + Market Risk Guard ---
      const ranked = rankOpportunities(rawCandidates, {
        minEvPct: recordAllEvaluatedForCalibration ? -100 : minEvPct,
        minDataQualityScore: 0.55,
        minSampleSize: minSampleGames
      });

      for (const rej of ranked.rejectedCandidates) {
        telemetry.observationsRejected++;
        trackReject(rej.rankingReason || 'RANKER_PREFILTER_REJECTED');
      }

      const toPersist = [];
      for (const cand of ranked.approvedCandidates) {
        const packet = buildElenaMarketPacket(cand);
        const elena = evaluateElenaForMarket(packet, {
          minEvPct: recordAllEvaluatedForCalibration ? -100 : Math.max(0, minEvPct)
        });
        const rm = validateMarketRisk({
          candidate: cand,
          elenaVerdict: elena,
          activeExposures: [],
          availableCapitalArs: 50000,
          kickoffUtc: cand.kickoffUtc,
          minSampleGames
        });

        if (rm.finalStatus === 'APROBADO') {
          toPersist.push({ cand, elena, rm });
        } else {
          telemetry.observationsRejected++;
          trackReject(rm.finalDecisionReason || 'ELENA_OR_RM_REJECTED');
        }
      }

      // --- ETAPA 4: Registro Inmutable en Fase 9.1 + Programación de Snapshots ---
      for (const { cand } of toPersist) {
        const rec = this.store.recordObservation({
          matchId: cand.matchId,
          league: cand.league,
          season: '2026-2027',
          homeTeam: cand.homeTeam,
          awayTeam: cand.awayTeam,
          kickoffUtc: cand.kickoffUtc,
          observedAtUtc: nowUtc,
          marketFamily: cand.marketFamily,
          market: cand.market,
          selection: cand.selection,
          line: cand.line,
          modelName: cand.modelName,
          modelVersion: cand.modelVersion,
          parameterVersion: 'params-dc-rho-0.06-v1',
          modelProbability: cand.modelProb,
          probabilities1X2: cand.probabilities1X2,
          odds: cand.bookmakerOdds,
          bookmaker: cand.bookmaker,
          impliedProbability: cand.impliedProb,
          noVigProbability: cand.noVigProb,
          noVig1X2: cand.noVig1X2,
          dataQualityTier: cand.dataQuality?.tier || 'MEDIA',
          dataSources: ['statshub:getFixturesByDate', 'statshub:getMatchOdds', 'statshub:getTeamPerformance'],
          features: cand.parameters
        });

        if (rec.recorded) {
          telemetry.observationsAccepted++;
          telemetry.recordedObservationIds.push(rec.observationId);
          const schedule = buildSnapshotSchedule(cand.kickoffUtc);
          opState.scheduledSnapshots.push({
            observationId: rec.observationId,
            matchId: cand.matchId,
            kickoffUtc: cand.kickoffUtc,
            checkpoints: schedule
          });
          telemetry.snapshotsScheduled += schedule.length;
        } else if (rec.reason === 'DUPLICATE_PREVENTED') {
          telemetry.observationsDuplicated++;
          trackReject('DUPLICATE_PREVENTED');
        } else {
          telemetry.observationsRejected++;
          trackReject(rec.reason || 'STORE_REJECTED');
        }
      }

      if (telemetry.outcomeCategory === 'EXECUTED' && telemetry.observationsAccepted === 0) {
        telemetry.outcomeCategory = telemetry.matchesInvestigated === 0 ? 'INSUFFICIENT_DATA' : 'ZERO_OPPORTUNITIES';
      }

      telemetry.completedAtUtc = new Date().toISOString();

      // --- ETAPA 5: Persistir estado operativo y exportar Evidence Dashboard JSON ---
      opState.inProgressRunId = null;
      opState.status = telemetry.outcomeCategory;
      opState.lastRunAtUtc = telemetry.completedAtUtc;
      opState.lastStatsHubQueryAtUtc = telemetry.lastStatsHubQueryAtUtc || opState.lastStatsHubQueryAtUtc;
      opState.runsCount = (opState.runsCount || 0) + 1;
      opState.lastRunSummary = telemetry;
      opState.runHistory = [telemetry, ...(opState.runHistory || [])].slice(0, 30);
      this._saveOperationalState(opState);

      const exported = this.orchestrator.buildAndExportDashboardData({ writeToDisk: true });
      // Enriquecer api/evidence_fase9.json con telemetría operativa de Fase 10
      const enrichedExport = {
        ...exported,
        operationalStatus: {
          status: opState.status,
          lastRunAtUtc: opState.lastRunAtUtc,
          lastStatsHubQueryAtUtc: opState.lastStatsHubQueryAtUtc,
          runsCount: opState.runsCount,
          lastRunSummary: telemetry,
          scheduledSnapshotsCount: opState.scheduledSnapshots.length
        }
      };
      atomicWriteJson(this.orchestrator.exportPath, enrichedExport);

      return {
        ok: true,
        telemetry,
        integrity: exported.integrity,
        exportPath: this.orchestrator.exportPath
      };
    } catch (err) {
      telemetry.outcomeCategory = 'PROVIDER_ERROR';
      telemetry.completedAtUtc = new Date().toISOString();
      stageErrors.push({ stage: 'FATAL_CYCLE_ERROR', error: err.message });
      opState.inProgressRunId = null;
      opState.status = 'PROVIDER_ERROR';
      opState.lastRunAtUtc = telemetry.completedAtUtc;
      opState.lastRunSummary = telemetry;
      opState.runHistory = [telemetry, ...(opState.runHistory || [])].slice(0, 30);
      this._saveOperationalState(opState);
      return { ok: false, error: err.message, telemetry };
    } finally {
      this._running = false;
    }
  }
}

module.exports = {
  ControlledPipelineRunner,
  buildSnapshotSchedule
};
