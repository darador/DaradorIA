/**
 * TEST SUITE: EXPANSIÓN DEL UNIVERSO DE MERCADOS (FASES 2–8)
 * Verifica matemáticamente y funcionalmente:
 *   - Modelo 1X2 Dixon-Coles (suma exacta = 1, derivación exacta 1X/X2/12, xG, localía, ausencias)
 *   - Devig 3-way, EV real (sin confundir probabilidad alta con EV+) y filtro de movement warnings
 *   - Auditoría de cobertura sin inventar series (goalsFor vs corners agregado vs tackles no disponible)
 *   - Screening en 2 etapas con control de consumo API
 *   - Shadow Lab Multi-Familia (SHA-256, anti-leakage, idempotencia, LogLoss/Brier 3-way y 2-way, CLV)
 *   - Elena + Risk Manager guard aislado (veto vinculante de RM sobre Elena)
 *   - Ranking unificado multi-familia (filtros duros + anti-dominancia de datos pobres)
 *   - Centro de Evidencia multi-dimensional con bandera de muestra insuficiente
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const model = require('../experimental/markets/matchOutcomeModel');
const coverage = require('../experimental/markets/marketCoverageAudit');
const screener = require('../experimental/markets/matchDiscoveryScreener');
const { ShadowLabMarkets } = require('../experimental/markets/shadowLabMarkets');
const guard = require('../experimental/markets/marketElenaRiskGuard');
const ranker = require('../experimental/markets/opportunityRanker');
const evidence = require('../experimental/markets/evidenceCenter');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

function makeTeamPerf(avgFor, avgAgainst, count = 15, xgFor = avgFor, xgAgainst = avgAgainst) {
  const matches = [];
  for (let i = 0; i < count; i++) {
    matches.push({
      date: `2026-10-${String(28 - i).padStart(2, '0')}`,
      venue: i % 2 === 0 ? 'home' : 'away',
      goalsFor: Math.round(avgFor),
      goalsAgainst: Math.round(avgAgainst)
    });
  }
  return {
    totals: {
      games: count,
      stats: {
        xG: { avg: xgFor, games: count },
        corners: { avg: 5.4, total: 5.4 * count },
        shots: { avg: 14.2, total: 14.2 * count }
      },
      opponentStats: {
        xG: { avg: xgAgainst, games: count },
        corners: { avg: 4.1, total: 4.1 * count }
      }
    },
    matches
  };
}

(async () => {
  console.log('\n🧪 Iniciando Test Suite: Expansión de Mercados 1X2 & Doble Oportunidad (Fases 2–8)...\n');

  await runTest('1. Probabilidades 1X2 suman exactamente 1.000000 y derivan Doble Oportunidad coherentemente', () => {
    const res = model.predictMatchOutcomes({
      matchId: 'arsenal-v-dortmund',
      match: 'Arsenal vs Borussia Dortmund',
      league: 'UEFA Champions League',
      homeTeamPerf: makeTeamPerf(2.1, 0.7, 16, 1.95, 0.85),
      awayTeamPerf: makeTeamPerf(1.5, 1.2, 16, 1.45, 1.25),
      odds1X2: { home: 1.47, draw: 4.75, away: 7.00 },
      oddsDoubleChance: { '1X': 1.09, 'X2': 3.00, '12': 1.17 }
    });
    assert.strictEqual(res.ok, true);
    const p = res.probabilities.matchResult1X2;
    const dc = res.probabilities.doubleChance;
    assert(Math.abs((p.home + p.draw + p.away) - 1.0) < 1e-5, '1X2 debe sumar 1');
    assert(Math.abs(dc['1X'] - (p.home + p.draw)) < 1e-5, 'P(1X) = P(1) + P(X)');
    assert(Math.abs(dc['X2'] - (p.draw + p.away)) < 1e-5, 'P(X2) = P(X) + P(2)');
    assert(Math.abs(dc['12'] - (p.home + p.away)) < 1e-5, 'P(12) = P(1) + P(2)');
    assert.strictEqual(res.parameters.usedXG, true);
  });

  await runTest('2. Muestra insuficiente en goles devuelve DATOS_INSUFICIENTES (sin inventar)', () => {
    const res = model.predictMatchOutcomes({
      match: 'Equipo A vs Equipo B',
      homeTeamPerf: makeTeamPerf(1.5, 1.0, 4),
      awayTeamPerf: makeTeamPerf(1.2, 1.2, 12),
      minSampleGames: 8
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 'DATOS_INSUFICIENTES');
  });

  await runTest('3. Doble Oportunidad con probabilidad alta (~85%) pero cuota baja (1.09) NO tiene EV positivo', () => {
    const pr = model.evaluateSelectionPricing({
      selection: '1X',
      marketFamily: 'double_chance',
      modelProb: 0.86,
      bookmakerOdds: 1.09,
      noVigProb: 0.88
    });
    assert.strictEqual(pr.hasPositiveEV, false);
    assert(pr.ev < 0, 'EV debe ser negativo aunque prob sea 86%');
  });

  await runTest('4. Devig 3-way remueve overround exacto y deriva probabilidades no-vig de Doble Oportunidad', () => {
    const dv = model.devig3Way(1.47, 4.75, 7.00);
    assert.strictEqual(dv.available, true);
    assert(dv.overround > 1.02 && dv.overround < 1.10);
    assert(Math.abs((dv.probs.home + dv.probs.draw + dv.probs.away) - 1.0) < 1e-5);
    assert(Math.abs(dv.doubleChanceNoVig['1X'] - (dv.probs.home + dv.probs.draw)) < 1e-5);
  });

  await runTest('5. Filtro de price movement descarta filas contaminadas "first-half prices mixed in"', () => {
    const mv = model.parseCleanPriceMovement({
      rows: [
        { bookmaker: 'Bet365', selection: 'away', opening: 7.0, current: 7.0, nowOnScreen: 6.25 },
        { bookmaker: 'All British Casino', selection: 'away', opening: 7.5, current: 6.33, warning: 'first-half prices mixed in' }
      ]
    }, 'away');
    assert.strictEqual(mv.cleanCount, 1);
    assert.strictEqual(mv.discardedCorruptCount, 1);
    assert.strictEqual(mv.rows[0].current, 6.25);
  });

  await runTest('6. Auditoría de cobertura: goles es COMPLETO por fila, córners AGREGADO_SIN_SERIE y tackles NO_DISPONIBLE', () => {
    const perf = makeTeamPerf(1.8, 0.9, 14);
    const goals = coverage.extractSafeTeamMarketData(perf, 'goals', 10);
    const corners = coverage.extractSafeTeamMarketData(perf, 'corners', 10);
    const tackles = coverage.extractSafeTeamMarketData(perf, 'tackles', 10);

    assert.strictEqual(goals.coverageStatus, coverage.COVERAGE_STATUS.COMPLETO);
    assert.strictEqual(goals.observations.length, 14);
    assert.strictEqual(corners.coverageStatus, coverage.COVERAGE_STATUS.AGREGADO_SIN_SERIE);
    assert.strictEqual(corners.observations, null, 'Nunca inventar series fila a fila para corners');
    assert.strictEqual(corners.avg, 5.4);
    assert.strictEqual(tackles.coverageStatus, coverage.COVERAGE_STATUS.NO_DISPONIBLE);
  });

  await runTest('7. Discovery Screener en 2 etapas respeta maxDeepMatches y filtra partidos sin cuotas', async () => {
    const mockClient = {
      async callTool(name) {
        if (name === 'getFixturesByDate') {
          return {
            data: {
              fixturesSummary: [
                'Premier League [competitionId premier-league]:',
                '- Tue 20:00 Arsenal v Dortmund (id m1) | 1X2 H 1.80 Bet365 / D 3.80 Bet365 / A 4.50 Bet365, favourite Arsenal',
                '- Tue 20:00 Team C v Team D (id m2) | no odds yet'
              ].join('\n')
            }
          };
        }
        if (name === 'getMatchOdds') {
          return {
            data: {
              priced: true,
              markets: [
                {
                  name: 'To Win',
                  outcomes: [
                    { label: 'Arsenal', best: { odds: 1.85, ageMinutes: 10 }, books: 5 },
                    { label: 'Draw', best: { odds: 3.90, ageMinutes: 10 }, books: 5 },
                    { label: 'Dortmund', best: { odds: 4.50, ageMinutes: 10 }, books: 5 }
                  ]
                },
                {
                  name: 'Double Chance',
                  outcomes: [
                    { label: 'Arsenal or Draw', best: { odds: 1.24, ageMinutes: 10 }, books: 4 },
                    { label: 'Arsenal or Dortmund', best: { odds: 1.26, ageMinutes: 10 }, books: 4 },
                    { label: 'Draw or Dortmund', best: { odds: 2.15, ageMinutes: 10 }, books: 4 }
                  ]
                }
              ]
            }
          };
        }
        if (name === 'getTeamPerformance') {
          return { data: makeTeamPerf(2.1, 0.7, 15, 2.0, 0.8) };
        }
        if (name === 'getTeamNews') {
          return { data: { teams: [{ side: 'home', coverage: 'ok', players: [] }, { side: 'away', coverage: 'ok', players: [] }] } };
        }
        return { data: null };
      }
    };

    const out = await screener.runTwoStageMatchDiscovery({
      date: '2026-11-24',
      maxDeepMatches: 5,
      minEvPct: 1.0,
      client: mockClient,
      competitions: [{ name: 'Premier League', competitionId: 'premier-league', tier: 1 }]
    });

    assert.strictEqual(out.stage1FixturesFound, 1, 'm2 sin cuotas debe descartarse en Etapa 1');
    assert.strictEqual(out.discardedStage1.length, 1);
    assert.strictEqual(out.stage2Shortlisted, 1);
    assert(out.apiCallsUsed <= 5, 'Consumo acotado en 2 etapas');
  });

  await runTest('8. Shadow Lab Multi-Familia: anti-leakage, SHA-256, idempotencia, CLV y métricas 3-way/2-way separadas', () => {
    const tmpLedger = path.join(os.tmpdir(), `shadow_markets_test_${Date.now()}.json`);
    const lab = new ShadowLabMarkets(tmpLedger);

    // Anti-leakage: observedAtUtc >= kickoffUtc debe rechazarse
    const leak = lab.recordPrediction({
      matchId: 'm1',
      marketFamily: 'match_1x2',
      selection: '1',
      observedAtUtc: '2026-11-24T20:05:00Z',
      kickoffUtc: '2026-11-24T20:00:00Z',
      bookmakerOdds: 1.85,
      modelProb: 0.60,
      probabilities1X2: { home: 0.60, draw: 0.23, away: 0.17 }
    });
    assert.strictEqual(leak.recorded, false);
    assert.strictEqual(leak.reason, 'TEMPORAL_LEAKAGE_BLOCKED');

    // Registro válido 1X2 + Doble Oportunidad
    const r1 = lab.recordPrediction({
      matchId: 'm1',
      match: 'Arsenal vs Dortmund',
      league: 'UEFA Champions League',
      marketFamily: 'match_1x2',
      selection: '1',
      observedAtUtc: '2026-11-24T15:00:00Z',
      kickoffUtc: '2026-11-24T20:00:00Z',
      bookmakerOdds: 1.85,
      modelProb: 0.60,
      probabilities1X2: { home: 0.60, draw: 0.23, away: 0.17 },
      dataQuality: { tier: 'ALTA', score: 0.92 }
    });
    const r2 = lab.recordPrediction({
      matchId: 'm1',
      match: 'Arsenal vs Dortmund',
      league: 'UEFA Champions League',
      marketFamily: 'double_chance',
      selection: '1X',
      observedAtUtc: '2026-11-24T15:00:00Z',
      kickoffUtc: '2026-11-24T20:00:00Z',
      bookmakerOdds: 1.25,
      modelProb: 0.83,
      probabilitiesDC: { '1X': 0.83, 'X2': 0.40, '12': 0.77 },
      dataQuality: { tier: 'ALTA', score: 0.92 }
    });
    assert.strictEqual(r1.recorded, true);
    assert.strictEqual(r2.recorded, true);

    // Duplicado bloqueado
    const dup = lab.recordPrediction({
      matchId: 'm1',
      marketFamily: 'match_1x2',
      selection: '1',
      observedAtUtc: '2026-11-24T16:00:00Z',
      kickoffUtc: '2026-11-24T20:00:00Z',
      bookmakerOdds: 1.85,
      modelProb: 0.60
    });
    assert.strictEqual(dup.reason, 'DUPLICATE_PREVENTED');

    // CLV y liquidación idempotente
    const clv1 = lab.recordClosingOdds(r1.predictionId, 1.75);
    assert(clv1.clvPct > 5, 'CLV positivo al tomar 1.85 vs cierre 1.75');

    const s1 = lab.settlePrediction(r1.predictionId, { homeGoals: 2, awayGoals: 1 });
    assert.strictEqual(s1.status, 'WON');
    const s1Again = lab.settlePrediction(r1.predictionId, { homeGoals: 2, awayGoals: 1 });
    assert.strictEqual(s1Again.idempotent, true);

    const s2 = lab.settlePrediction(r2.predictionId, { homeGoals: 2, awayGoals: 1 });
    assert.strictEqual(s2.status, 'WON');

    const integrity = lab.verifyIntegrity();
    assert.strictEqual(integrity.ok, true);
    assert.strictEqual(integrity.intact, 2);

    const metrics = lab.evaluateByMarketFamily();
    assert(metrics.match_1x2.multiclassLogLoss !== null, '1X2 tiene Log Loss multiclase');
    assert(metrics.match_1x2.multiclassBrierScore !== null, '1X2 tiene Brier multiclase');
    assert(metrics.double_chance.binaryBrierScore !== null, 'DC tiene Brier binario');
    assert.strictEqual(metrics.match_1x2.sampleStatus, 'INSUFFICIENT_SAMPLE');

    // Centro de Evidencia sobre los mismos registros
    const evRep = evidence.buildEvidenceReport(lab._readAll(), ['league', 'marketFamily']);
    assert.strictEqual(evRep.slicesCount, 2);
    assert.strictEqual(evRep.slices[0].sampleStatus, 'INSUFFICIENT_SAMPLE');

    fs.unlinkSync(tmpLedger);
  });

  await runTest('9. Elena aprueba oportunidad 1X2 válida, pero veto de Risk Manager (superposición) SIEMPRE prevalece', () => {
    const candidate = {
      matchId: 'm_overlap',
      match: 'Inter vs Stuttgart',
      league: 'UEFA Champions League',
      sport: 'football',
      marketFamily: 'match_1x2',
      market: 'Ganador 1X2',
      selection: '1',
      bookmakerOdds: 1.55,
      oddsAgeMinutes: 20,
      modelProb: 0.70,
      impliedProb: 0.645,
      noVigProb: 0.63,
      ev: 0.085,
      evPct: 8.5,
      modelConsensus: 0.85,
      dataQuality: { score: 0.90, tier: 'ALTA' },
      parameters: { homeSampleGames: 15, awaySampleGames: 15 }
    };

    const packet = guard.buildElenaMarketPacket(candidate);
    const elena = guard.evaluateElenaForMarket(packet);
    assert.strictEqual(elena.approved, true);

    const verdict = guard.validateMarketRisk({
      candidate,
      elenaVerdict: elena,
      activeExposures: [{ matchId: 'm_active', kickoffUtc: '2026-11-24T20:00:00Z', sport: 'football' }],
      availableCapitalArs: 50000,
      kickoffUtc: '2026-11-24T20:30:00Z'
    });

    assert.strictEqual(verdict.elenaApproved, true);
    assert.strictEqual(verdict.riskManagerApproved, false);
    assert.strictEqual(verdict.riskManagerPrevailed, true);
    assert.strictEqual(verdict.finalStatus, 'EN_ESPERA');
    assert.strictEqual(verdict.autoExecutionAllowed, false);
  });

  await runTest('10. Ranking unificado: filtros obligatorios y evidencia sólida SIEMPRE vence a datos pobres', () => {
    const ranked = ranker.rankOpportunities([
      {
        id: 'weak_data_high_ev',
        marketFamily: 'match_1x2',
        bookmakerOdds: 2.50,
        modelProb: 0.50,
        evPct: 14.0,
        dataQualityScore: 0.56,
        sampleSize: 8,
        uncertainty: 0.35,
        modelConsensus: 0.55
      },
      {
        id: 'solid_evidence',
        marketFamily: 'double_chance',
        bookmakerOdds: 1.45,
        modelProb: 0.75,
        evPct: 8.75,
        dataQualityScore: 0.94,
        sampleSize: 20,
        uncertainty: 0.12,
        modelConsensus: 0.90,
        historicalCalibrationScore: 0.88,
        historicalAvgClvPct: 2.4
      },
      {
        id: 'high_prob_negative_ev',
        marketFamily: 'double_chance',
        bookmakerOdds: 1.08,
        modelProb: 0.90,
        evPct: -2.8,
        dataQualityScore: 0.95,
        sampleSize: 20
      }
    ]);

    assert.strictEqual(ranked.autoExecutionAllowed, false);
    assert.strictEqual(ranked.rejectedCount, 1, 'Alta probabilidad con EV negativo debe rechazarse');
    assert.strictEqual(ranked.approvedCount, 2);
    assert.strictEqual(ranked.approvedCandidates[0].id, 'solid_evidence', 'Evidencia sólida debe liderar el ranking');
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO EXPANSIÓN MERCADOS 1X2/DC: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log(`====================================================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
