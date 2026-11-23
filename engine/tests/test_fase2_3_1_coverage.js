/**
 * TEST SUITE: FASE 2.3.1 — COBERTURA DE DATOS HISTÓRICOS Y VALIDACIÓN OPERATIVA T-5
 * Valida con payloads reales de StatsHub MCP:
 * 1. Extracción partido a partido de getPlayerStats + filtro temporal (excluye partido propio/posterior).
 * 2. Extracción partido a partido de getTeamPerformance para goles + rechazo honesto en no-goles.
 * 3. Extracción 2-way de getMatchOdds (Over + Under) y prueba operativa real del scheduler T-5.
 * 4. Umbrales mínimos de muestra por modelo y mercado + métricas modelCoverage en ShadowLabReporter.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const fetcher = require('../experimental/shadowHistoryFetcher');
const { ShadowLabRunner } = require('../experimental/shadowLabRunner');
const TMinus5ClosingScheduler = require('../experimental/tMinus5ClosingScheduler');
const ShadowLabReporter = require('../experimental/shadowLabReporter');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}\n     ${err.message}`);
    failed++;
  }
}

// Payloads reales capturados de StatsHub MCP el 23/11/2026
const REAL_THIERNO_BARRY_PLAYER_STATS = {
  requestedStat: { statType: 'shotsOnTarget', column: 'shotsOnTarget' },
  matchColumns: ['matchId', 'date', 'competition', 'opponent', 'venue', 'result', 'minutes', 'shotsOnTarget', 'goals', 'assists', 'shots', 'yellowCards', 'rating'],
  matchRows: [
    ['match.0sg1wri', '2026-11-23', 'Premier League', 'Brentford', 'away', 'L 0-4', 69, 1, 0, 0, 1, 0, 6.7], // MISMO PARTIDO -> DEBE FILTRARSE
    ['match.1xmcnge', '2026-11-06', 'Premier League', 'Coventry', 'home', 'W 3-1', 90, 2, 2, 1, 6, 0, 8.6],
    ['match.0a4ji1j', '2026-11-02', 'Premier League', 'Newcastle', 'away', 'W 1-0', 80, 1, 1, 0, 3, 0, 7.5],
    ['match.0hqbzoi', '2026-10-29', 'EFL Cup', 'Newcastle', 'home', 'W 3-1', 90, 2, 1, 1, 2, 0, 8.9],
    ['match.1ajobmk', '2026-10-24', 'Premier League', 'Arsenal', 'away', 'L 0-2', 90, 1, 0, 0, 2, 0, 7.7],
    ['match.16o7ebc', '2026-10-17', 'Premier League', 'Chelsea', 'home', 'L 0-2', 90, 3, 0, 0, 3, 0, 6.8],
    ['match.1tiys5e', '2026-10-11', 'Premier League', 'Hull', 'away', 'D 2-2', 86, 3, 1, 0, 5, 0, 7.9],
    ['match.0vnvfu0', '2026-09-19', 'Premier League', 'Ipswich', 'home', 'W 1-0', 90, 1, 1, 0, 3, 0, 6.2],
    ['match.1vcpz1h', '2026-09-16', 'EFL Cup', 'Wolves', 'home', 'W 1-0', 58, 2, 0, 0, 2, 0, 6.5],
    ['match.0q5oc7q', '2026-09-12', 'Premier League', 'Tottenham', 'away', 'D 0-0', 90, 1, 0, 0, 5, 0, 6.6],
    ['match.17vqmse', '2026-09-06', 'Premier League', 'Man Utd', 'home', 'D 2-2', 90, 0, 0, 0, 4, 0, 6.6],
    ['match.0cqs0t9', '2026-08-29', 'Premier League', 'Bournemouth', 'away', 'D 1-1', 70, 2, 0, 0, 3, 0, 6.7],
    ['match.19wew7i', '2026-08-26', 'EFL Cup', 'Preston', 'away', 'W 4-0', 82, 5, 3, 1, 8, 0, 9.4],
    ['match.0vhlnfv', '2026-08-22', 'Premier League', 'Crystal Palace', 'home', 'W 2-0', 79, 1, 1, 0, 2, 0, 7.0],
    ['match.1ieh3ko', '2026-05-24', 'Premier League', 'Tottenham', 'away', 'L 0-1', 84, 0, 0, 0, 1, 0, 6.0],
    ['match.0hhocgv', '2026-04-25', 'Premier League', 'West Ham', 'away', 'L 1-2', 90, 2, 0, 0, 3, 0, 6.1],
    ['match.14m4n30', '2026-02-23', 'Premier League', 'Man Utd', 'home', 'L 0-1', 90, 0, 0, 0, 0, 0, 6.6]
  ]
};

const REAL_BOTAFOGO_TEAM_PERF = {
  totals: { games: 20, stats: { cards: { total: 46, avg: 2.3 }, corners: { total: 104, avg: 5.2 } } },
  matches: [
    { date: '2026-11-19', matchId: 'corinthians-v-botafogo.0fe3689', goalsFor: 0 },
    { date: '2026-11-05', matchId: 'botafogo-v-atletico-mineiro.0fxciep', goalsFor: 1 },
    { date: '2026-10-29', matchId: 'remo-v-botafogo.02mzhtw', goalsFor: 1 },
    { date: '2026-10-24', matchId: 'internacional-v-botafogo.038bsuu', goalsFor: 0 },
    { date: '2026-10-17', matchId: 'botafogo-v-chapecoense.0ir5x0i', goalsFor: 1 },
    { date: '2026-10-12', matchId: 'coritiba-v-botafogo.1aztsoe', goalsFor: 1 },
    { date: '2026-10-07', matchId: 'botafogo-v-vasco-da-gama.19kjg02', goalsFor: 1 },
    { date: '2026-09-19', matchId: 'mirassol-v-botafogo.039os6o', goalsFor: 0 },
    { date: '2026-09-16', matchId: 'botafogo-v-gremio.1y64qxs', goalsFor: 3 },
    { date: '2026-09-12', matchId: 'botafogo-v-red-bull-bragantino.031vuaw', goalsFor: 1 },
    { date: '2026-09-06', matchId: 'botafogo-v-palmeiras.18ht8s8', goalsFor: 0 },
    { date: '2026-08-30', matchId: 'flamengo-v-botafogo.1ttjzhv', goalsFor: 0 },
    { date: '2026-08-24', matchId: 'botafogo-v-athletico.0mximqd', goalsFor: 2 },
    { date: '2026-08-21', matchId: 'botafogo-v-cienciano.128vaex', goalsFor: 1 },
    { date: '2026-08-16', matchId: 'vitoria-v-botafogo.04tmkrj', goalsFor: 0 },
    { date: '2026-08-14', matchId: 'cienciano-v-botafogo.1fgy9xd', goalsFor: 1 },
    { date: '2026-08-09', matchId: 'botafogo-v-fluminense.07kimew', goalsFor: 1 },
    { date: '2026-07-26', matchId: 'cruzeiro-v-botafogo.05hklsy', goalsFor: 1 },
    { date: '2026-07-23', matchId: 'botafogo-v-vitoria.0tbkmta', goalsFor: 0 },
    { date: '2026-07-16', matchId: 'botafogo-v-santos.1hpehvs', goalsFor: 2 }
  ]
};

const REAL_BOTAFOGO_MATCH_ODDS = {
  markets: [
    {
      name: 'Home Team Goals',
      outcomes: [
        { label: 'Over 1.5', best: { odds: 2.2, bookmaker: 'Bet365', ageMinutes: 10 } },
        { label: 'Under 1.5', best: { odds: 1.65, bookmaker: 'BetMGM UK', ageMinutes: 12 } }
      ]
    }
  ]
};

async function run() {
  console.log('==================================================================');
  console.log('🧪 TEST SUITE FASE 2.3.1: COBERTURA HISTÓRICA Y PRUEBA OPERATIVA T-5');
  console.log('==================================================================\n');

  const tmpLedger = path.join(os.tmpdir(), `shadow_lab_v231_test_${Date.now()}.json`);
  const runner = new ShadowLabRunner(tmpLedger);

  try {
    await test('getPlayerStats filtra estrictamente el partido del kickoff (0 fuga temporal) y extrae fechas + minutos', () => {
      const ext = fetcher.extractFromPlayerStats(REAL_THIERNO_BARRY_PLAYER_STATS, {
        candidateMatchId: 'brentford-v-everton.0sg1wri',
        kickoffUtc: '2026-11-23T20:00:00.000Z',
        market: 'Remates al arco'
      });
      assert.strictEqual(ext.ok, true);
      assert.strictEqual(ext.filteredPostKickoffCount, 1, 'Debe filtrar match.0sg1wri (2026-11-23)');
      assert.strictEqual(ext.sampleCount, 16);
      assert.strictEqual(ext.matchDates[0], '2026-11-06');
      assert.strictEqual(ext.minutesPerMatch.length, 16);
      assert(ext.avgMinutes > 75 && ext.avgMinutes < 90);
    });

    await test('getTeamPerformance extrae 20 partidos reales de goles para Botafogo y rechaza honestamente tarjetas', () => {
      const goalsExt = fetcher.extractFromTeamPerformance(REAL_BOTAFOGO_TEAM_PERF, {
        candidateMatchId: 'botafogo-v-sao-paulo.1dxw70e',
        kickoffUtc: '2026-11-23T23:00:00.000Z',
        market: 'Goles de equipo'
      });
      assert.strictEqual(goalsExt.ok, true);
      assert.strictEqual(goalsExt.sampleCount, 20);
      assert.strictEqual(goalsExt.matchDates[0], '2026-11-19');

      const cardsExt = fetcher.extractFromTeamPerformance(REAL_BOTAFOGO_TEAM_PERF, {
        candidateMatchId: 'internacional-v-vitoria.1ymdoe1',
        kickoffUtc: '2026-11-23T22:30:00.000Z',
        market: 'Tarjetas de equipo'
      });
      assert.strictEqual(cardsExt.ok, false);
      assert.strictEqual(cardsExt.sampleCount, 0);
      assert(cardsExt.reason.includes('STATSHUB_TEAM_PERFORMANCE_OMITS_PER_GAME_STATS'));
    });

    await test('getMatchOdds extrae cuotas 2-way reales (Under 1.5 @1.65 / Over 1.5 @2.20)', () => {
      const q = fetcher.extractTwoWayOddsFromMatchOdds(REAL_BOTAFOGO_MATCH_ODDS, {
        marketName: 'Home Team Goals',
        line: 'Menos de 1.5',
        side: 'under'
      });
      assert.strictEqual(q.found, true);
      assert.strictEqual(q.closingOdds, 1.65);
      assert.strictEqual(q.closingOppositeOdds, 2.2);
    });

    await test('Registro paralelo con datos reales + prueba operativa T-5 + métricas de cobertura por modelo', async () => {
      // 1. Botafogo (20 partidos reales -> 6/6 modelos disponibles)
      const bExt = fetcher.extractFromTeamPerformance(REAL_BOTAFOGO_TEAM_PERF, {
        candidateMatchId: 'botafogo-v-sao-paulo.1dxw70e',
        kickoffUtc: '2026-11-23T23:00:00.000Z',
        market: 'Goles de equipo'
      });
      const rBota = runner.recordParallelObservation({
        pickId: 'op_botafogo_goals',
        matchId: 'botafogo-v-sao-paulo.1dxw70e',
        competition: 'Brasileirão Série A',
        match: 'Botafogo vs São Paulo',
        kickoffUtc: '2026-11-23T23:00:00.000Z',
        observedAtUtc: '2026-11-23T22:40:00.000Z',
        playerOrTeam: 'Botafogo (Equipo)',
        isTeamProp: true,
        market: 'Goles de equipo',
        line: 'Menos de 1.5',
        bookmaker: 'BetMGM UK',
        openingOdds: 1.67,
        approvalOdds: 1.67,
        historicalValues: bExt.historicalValues,
        matchDates: bExt.matchDates,
        minutesPerMatch: bExt.minutesPerMatch,
        avgMinutes: bExt.avgMinutes,
        historySourceEndpoint: bExt.sourceEndpoint
      });
      assert.strictEqual(rBota.recorded, true);
      for (const k of ['v1_production', 'v2_corrected', 'model_b', 'model_c', 'beta_binomial', 'ensemble_v2']) {
        assert.strictEqual(rBota.record.preMatchBlock.models[k].available, true, `Botafogo debe habilitar ${k}`);
      }

      // 2. Candidato con muestra corta (n=6 -> solo model_b y beta_binomial disponibles)
      const rShort = runner.recordParallelObservation({
        pickId: 'op_short_sample',
        matchId: 'match_short_01',
        competition: 'Premier League',
        match: 'Brentford vs Everton',
        kickoffUtc: '2026-11-23T23:30:00.000Z',
        observedAtUtc: '2026-11-23T22:40:00.000Z',
        playerOrTeam: 'Jugador Muestra Corta',
        isTeamProp: false,
        market: 'Remates al arco',
        line: 'Más de 0.5',
        approvalOdds: 1.70,
        historicalValues: [1, 2, 0, 1, 1, 2],
        matchDates: ['2026-11-10', '2026-11-05', '2026-11-01', '2026-10-25', '2026-10-20', '2026-10-15'],
        minutesPerMatch: [80, 90, 75, 85, 90, 82],
        historySourceEndpoint: 'statshub:getPlayerStats'
      });
      assert.strictEqual(rShort.recorded, true);
      assert.strictEqual(rShort.record.preMatchBlock.models.model_b.available, true);
      assert.strictEqual(rShort.record.preMatchBlock.models.beta_binomial.available, true);
      assert.strictEqual(rShort.record.preMatchBlock.models.v2_corrected.available, false);
      assert.strictEqual(rShort.record.preMatchBlock.models.model_c.available, false);
      assert.strictEqual(rShort.record.preMatchBlock.models.ensemble_v2.available, false);

      // 3. Prueba operativa del Scheduler T-5 sobre Botafogo (a las 22:55 UTC = T-5 min del kickoff 23:00 UTC)
      const scheduler = new TMinus5ClosingScheduler({
        runner,
        oddsProvider: async (obs) => {
          if (obs.pickId === 'op_botafogo_goals') {
            return fetcher.extractTwoWayOddsFromMatchOdds(REAL_BOTAFOGO_MATCH_ODDS, {
              marketName: 'Home Team Goals',
              line: obs.preMatchBlock.line,
              side: obs.preMatchBlock.side
            });
          }
          return null;
        }
      });

      const cycle = await scheduler.runCycle(Date.parse('2026-11-23T22:55:00.000Z'));
      assert.strictEqual(cycle.eligibleCount, 1, 'Solo Botafogo está en ventana T-5');
      assert.strictEqual(cycle.capturedCount, 1, 'Debe capturar cuota de cierre real de Botafogo');
      assert.strictEqual(cycle.captured[0].closingOdds, 1.65);
      assert.strictEqual(cycle.captured[0].clvOddsPct, 1.21, 'CLV(1.67 vs 1.65) = +1.21%');

      // 4. Verificar métricas de cobertura en ShadowLabReporter
      const reporter = new ShadowLabReporter(runner);
      const report = reporter.generateReport();
      assert.strictEqual(report.modelCoverage.model_b.coveragePct, 100);
      assert.strictEqual(report.modelCoverage.beta_binomial.coveragePct, 100);
      assert.strictEqual(report.modelCoverage.v2_corrected.coveragePct, 50);
      assert.strictEqual(report.modelCoverage.model_c.coveragePct, 50);
      assert.strictEqual(report.modelCoverage.ensemble_v2.coveragePct, 50);
      assert.strictEqual(report.integrity.tamperedCount, 0);
      console.log('    • Cobertura validada:', Object.fromEntries(Object.entries(report.modelCoverage).map(([k, v]) => [k, v.coveragePct + '%'])));
      console.log('    • Prueba T-5 Botafogo:', cycle.captured[0]);
    });
  } finally {
    try {
      if (fs.existsSync(tmpLedger)) fs.unlinkSync(tmpLedger);
    } catch (e) {}
  }

  console.log('\n==================================================================');
  console.log(`🏁 RESULTADO FASE 2.3.1: ${passed} PASADAS, ${failed} FALLADAS`);
  console.log('==================================================================');
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
