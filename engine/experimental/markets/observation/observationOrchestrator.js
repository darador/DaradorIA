/**
 * FASE 9 — OBSERVATION ORCHESTRATOR & DASHBOARD EXPORTER (SHADOW MODE ONLY)
 *
 * Coordina el ciclo completo de observación sin habilitar ejecución automática:
 *  1. Descubre partidos futuros en ligas ya habilitadas (matchDiscoveryScreener)
 *  2. Registra observaciones inmutables pre-partido (ObservationStore)
 *  3. Evalúa alertas de calidad de modelos (degradación Brier/LogLoss, drift calibración)
 *  4. Genera el snapshot JSON (api/evidence_fase9.json) para el Dashboard de Evidencia independiente.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { runTwoStageMatchDiscovery } = require('../matchDiscoveryScreener');
const { ObservationStore } = require('./observationStore');
const { SettlementProcessor } = require('./settlementProcessor');
const validator = require('./statisticalValidator');

const DEFAULT_EXPORT_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'api', 'evidence_fase9.json');

class ObservationOrchestrator {
  constructor(options = {}) {
    this.store = options.store || new ObservationStore(options.storeOptions);
    this.settlement = options.settlement || new SettlementProcessor(this.store);
    this.exportPath = options.exportPath || DEFAULT_EXPORT_PATH;
    this.autoExecutionAllowed = false;
  }

  /**
   * Ejecuta un ciclo de observación pre-partido sobre ligas habilitadas (Shadow Mode).
   */
  async runObservationCycle(discoveryOptions = {}) {
    const disc = await runTwoStageMatchDiscovery(discoveryOptions);
    const recorded = [];
    const skipped = [];

    for (const c of disc.candidates) {
      if (!c.kickoffUtc) {
        skipped.push({ candidateId: c.candidateId, reason: 'MISSING_KICKOFF_UTC' });
        continue;
      }
      const res = this.store.recordObservation({
        matchId: c.matchId,
        league: c.league,
        season: discoveryOptions.season || '2026-2027',
        homeTeam: c.homeTeam || (c.match ? c.match.split(' vs ')[0] : ''),
        awayTeam: c.awayTeam || (c.match ? c.match.split(' vs ')[1] : ''),
        kickoffUtc: c.kickoffUtc,
        observedAtUtc: new Date().toISOString(),
        marketFamily: c.marketFamily,
        market: c.market,
        selection: c.selection,
        line: c.line ?? null,
        modelName: 'MatchOutcomeDC',
        modelVersion: c.modelVersion,
        parameterVersion: discoveryOptions.parameterVersion || 'params-default-v1',
        modelProbability: c.modelProb,
        probabilities1X2: c.probabilities1X2 || null,
        odds: c.bookmakerOdds,
        bookmaker: c.bookmaker || 'StatsHubBest',
        impliedProbability: c.impliedProb,
        noVigProbability: c.noVigProb,
        dataQualityTier: c.dataQuality?.tier || 'MEDIA',
        dataSources: ['statshub:getFixturesByDate', 'statshub:getMatchOdds', 'statshub:getTeamPerformance'],
        features: c.parameters || null
      });
      if (res.recorded) recorded.push(res);
      else skipped.push({ candidateId: c.candidateId, reason: res.reason });
    }

    return {
      autoExecutionAllowed: false,
      leaguesScanned: disc.leaguesScanned,
      apiCallsUsed: disc.apiCallsUsed,
      recordedCount: recorded.length,
      skippedCount: skipped.length,
      recorded,
      skipped
    };
  }

  /**
   * Detecta degradación de Brier/LogLoss o drift de calibración y registra alertas locales (sin Telegram).
   */
  runQualityAudit(observations = null) {
    const obs = observations || this.store.getObservations();
    const families = Array.from(new Set(obs.map(o => o.marketFamily)));
    const alertsTriggered = [];

    for (const fam of families) {
      const ev = validator.evaluateFamilySlice(obs, fam);
      const base = validator.compareAgainstBaselines(obs, fam);

      // Alerta 1: degradación vs mercado sin vig
      if (base.vsMarketNoVig?.available && base.vsMarketNoVig.comparableCount >= 10) {
        if (base.vsMarketNoVig.deltaBrier > 0.015 || base.vsMarketNoVig.deltaLogLoss > 0.04) {
          alertsTriggered.push(this.store.logQualityAlert({
            code: 'MODEL_DEGRADATION_VS_MARKET',
            severity: 'WARNING',
            message: `Degradación en ${fam}: deltaBrier=${base.vsMarketNoVig.deltaBrier}, deltaLogLoss=${base.vsMarketNoVig.deltaLogLoss} (peor que mercado sin vig).`,
            details: base.vsMarketNoVig
          }));
        }
      }

      // Alerta 2: diferencia relevante entre probabilidad pronosticada y frecuencia observada
      if (ev.calibration?.expectedCalibrationError !== null && ev.counts.decided >= 10 && ev.calibration.expectedCalibrationError > 0.12) {
        alertsTriggered.push(this.store.logQualityAlert({
          code: 'CALIBRATION_DRIFT_DETECTED',
          severity: 'WARNING',
          message: `Descalibración detectada en ${fam}: ECE=${ev.calibration.expectedCalibrationError} (> 0.12).`,
          details: ev.calibration
        }));
      }
    }

    return alertsTriggered;
  }

  /**
   * Construye y exporta el JSON estructurado para el Dashboard de Evidencia independiente.
   */
  buildAndExportDashboardData({ writeToDisk = true } = {}) {
    const observations = this.store.getObservations();
    const rejected = this.store.getRejectedObservations();
    const alerts = this.store.getQualityAlerts();
    const integrity = this.store.verifyIntegrity();

    const families = Array.from(new Set(observations.map(o => o.marketFamily)));
    const byFamily = {};
    const baselinesByFamily = {};
    const oosByFamily = {};

    for (const fam of families) {
      byFamily[fam] = validator.evaluateFamilySlice(observations, fam);
      baselinesByFamily[fam] = validator.compareAgainstBaselines(observations, fam);
      oosByFamily[fam] = validator.runStrictTemporalOutOfSampleSplit(observations, fam);
    }

    const payload = {
      generatedAtUtc: new Date().toISOString(),
      mode: 'SHADOW_MODE_EXPERIMENTAL',
      autoExecutionAllowed: false,
      integrity,
      summary: {
        totalObservations: observations.length,
        uniqueMatches: new Set(observations.map(o => o.matchId)).size,
        pendingCount: observations.filter(o => o.status === 'PENDING').length,
        wonCount: observations.filter(o => o.status === 'WON').length,
        lostCount: observations.filter(o => o.status === 'LOST').length,
        voidCount: observations.filter(o => o.status === 'VOID').length,
        pushCount: observations.filter(o => o.status === 'PUSH').length,
        rejectedAntiLeakageCount: rejected.length,
        qualityAlertsCount: alerts.length
      },
      byFamily,
      baselinesByFamily,
      oosByFamily,
      byLeague: validator.sliceObservations(observations, 'league'),
      byPeriod: validator.sliceObservations(observations, 'period'),
      byModelVersion: validator.sliceObservations(observations, 'modelVersion'),
      byDataQuality: validator.sliceObservations(observations, 'dataQualityTier'),
      recentAlerts: alerts.slice(-25).reverse(),
      observations
    };

    if (writeToDisk) {
      const dir = path.dirname(this.exportPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.exportPath, JSON.stringify(payload, null, 2), 'utf8');
    }

    return payload;
  }
}

module.exports = {
  ObservationOrchestrator
};
