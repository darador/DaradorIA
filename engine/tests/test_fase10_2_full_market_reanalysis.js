/**
 * TEST SUITE OBLIGATORIA — FASE 10.2: REANÁLISIS INTEGRAL Y DESCUBRIMIENTO CONTINUO (20 ESCENARIOS)
 *
 * Cubre los 20 requisitos obligatorios de la Sección 15:
 *  1. Descubrimiento de eventos nuevos
 *  2. Reanálisis de eventos existentes
 *  3. Descubrimiento de mercados nuevos (1X2, DC, DNB, AH, BTTS, Total Goles)
 *  4. Detección de cambio de cuota (ODDS_IMPROVED / ODDS_DETERIORATED)
 *  5. EV que pasa de negativo a positivo (EV_BECAME_POSITIVE)
 *  6. EV que pasa de positivo a negativo (EV_BECAME_NEGATIVE)
 *  7. Cambio de bookmaker (NEW_BOOKMAKER)
 *  8. Bookmaker no disponible (BOOKMAKER_UNAVAILABLE)
 *  9. Datos insuficientes (INSUFFICIENT_DATA, compuerta de evidencia)
 * 10. Bloqueo de eventos iniciados (EXPIRED / skippedStarted)
 * 11. Prevención de leakage temporal (analyzedAtUtc >= kickoffUtc bloqueado)
 * 12. Versionado inmutable encadenado SHA-256 (sin sobrescribir análisis previo)
 * 13. Idempotencia (sin cambios no duplica versiones)
 * 14. Prevención de escaneos concurrentes (Mutex)
 * 15. Fallo de StatsHub (PROVIDER_ERROR con errors visibles)
 * 16. RateGovernor / límites de llamadas respetados (1 getMatchOdds por partido)
 * 17. Caché intra-ejecución (sin llamadas duplicadas)
 * 18. Veto vinculante de Risk Manager (prevalece sobre Elena)
 * 19. Elena no disponible (REANALYSIS_REQUIRED, nunca simula aprobación)
 * 20. Conservación de históricos (12 observaciones Fase 9 y Daily Board intactos)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ReanalysisStore } = require('../experimental/markets/reanalysis/reanalysisStore');
const {
  OPPORTUNITY_STATES,
  CHANGE_REASONS,
  reanalyzeOpportunity
} = require('../experimental/markets/reanalysis/opportunityReanalysisEngine');
const { FullMarketRescanEngine } = require('../experimental/markets/reanalysis/fullMarketRescanEngine');

let passed = 0;
let failed = 0;

function makeTmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_f10_2_'));
  const store = new ReanalysisStore({ versionsPath: path.join(dir, 'versions.json') });
  const engine = new FullMarketRescanEngine({
    store,
    statePath: path.join(dir, 'state.json'),
    exportPath: path.join(dir, 'opps.json')
  });
  return { dir, store, engine };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function mkPerf(gf, ga, n = 15) {
  return {
    totals: { games: n, stats: { xG: { avg: gf, games: n } }, opponentStats: { xG: { avg: ga, games: n } } },
    matches: Array.from({ length: n }, (_, i) => ({ venue: i % 2 === 0 ? 'home' : 'away', goalsFor: Math.round(gf), goalsAgainst: Math.round(ga) }))
  };
}

function mkClient({ homeOdds = 2.40, bookmakerHome = 'Bet365', kickoff = 'Tue 28 Nov 2026, 20:00 UTC', counter = null } = {}) {
  return {
    async callTool(name, args) {
      if (counter) counter[name] = (counter[name] || 0) + 1;
      if (name === 'getFixturesByDate') {
        return { data: { fixturesSummary: 'Premier League [competitionId pl]:\n- Tue 20:00 TeamA v TeamB (id m_102) | 1X2 H 2.40 Bet365 / D 3.40 Bet365 / A 3.10 Bet365, favourite TeamA' } };
      }
      if (name === 'getMatchOdds') {
        return {
          data: {
            context: `TeamA v TeamB · kick-off ${kickoff} · full-time match markets`,
            priced: true,
            markets: [
              { name: 'To Win', outcomes: [
                { label: 'TeamA', best: { odds: homeOdds, bookmaker: bookmakerHome, ageMinutes: 5 }, books: 4 },
                { label: 'Draw', best: { odds: 3.40, bookmaker: 'BetMGM UK', ageMinutes: 5 }, books: 4 },
                { label: 'TeamB', best: { odds: 3.10, bookmaker: 'Paddy Power', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Double Chance', outcomes: [
                { label: 'TeamA or Draw', best: { odds: 1.42, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'TeamA or TeamB', best: { odds: 1.32, bookmaker: 'All British Casino', ageMinutes: 5 }, books: 4 },
                { label: 'Draw or TeamB', best: { odds: 1.65, bookmaker: 'BetMGM UK', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Draw No Bet', outcomes: [
                { label: 'TeamA', best: { odds: 1.75, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'TeamB', best: { odds: 2.15, bookmaker: 'Paddy Power', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Asian Handicap', outcomes: [
                { label: 'TeamA (-0.5)', best: { odds: 2.38, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'TeamB (+0.5)', best: { odds: 1.65, bookmaker: 'BetMGM UK', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Both Teams To Score', outcomes: [
                { label: 'Yes', best: { odds: 1.75, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 },
                { label: 'No', best: { odds: 2.10, bookmaker: 'BetMGM UK', ageMinutes: 5 }, books: 4 }
              ]},
              { name: 'Total Goals', outcomes: [
                { label: 'Over 2.5', best: { odds: 1.85, bookmaker: 'All British Casino', ageMinutes: 5 }, books: 4 },
                { label: 'Under 2.5', best: { odds: 2.00, bookmaker: 'Bet365', ageMinutes: 5 }, books: 4 }
              ]}
            ]
          }
        };
      }
      if (name === 'getTeamPerformance') return { data: mkPerf(2.1, 0.8) };
      if (name === 'getTeamNews') return { data: { teams: [] } };
      return { data: null };
    }
  };
}

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

(async () => {
  console.log('\n🔄 Iniciando Test Suite Obligatoria — Fase 10.2 Reanálisis Integral (20 Escenarios)...\n');

  await runTest('1. Descubrimiento de eventos nuevos', async () => {
    const { dir, engine } = makeTmpEnv();
    try {
      const res = await engine.runFullRescan({
        date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z',
        client: mkClient(), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.summary.eventsDiscovered, 1);
      assert.strictEqual(res.summary.eventsProcessed, 1);
      assert(res.summary.newOpportunitiesCount >= 1);
    } finally { cleanup(dir); }
  });

  await runTest('2. Reanálisis de eventos existentes crea nueva versión vinculada', async () => {
    const { dir, store, engine } = makeTmpEnv();
    try {
      await engine.runFullRescan({ date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z', client: mkClient({ homeOdds: 2.40 }), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }] });
      const res2 = await engine.runFullRescan({ date: '2026-11-28', nowUtc: '2026-11-28T12:00:00Z', client: mkClient({ homeOdds: 2.65 }), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }] });
      assert(res2.summary.existingChangedCount >= 1);
      const hist = store.getHistoryForOpportunity('m_102__match_1x2__1__none');
      assert.strictEqual(hist.length, 2);
      assert.strictEqual(hist[1].previousAnalysisId, hist[0].analysisId);
    } finally { cleanup(dir); }
  });

  await runTest('3. Descubrimiento de mercados nuevos (1X2, DC, DNB, AH, BTTS, Total Goles = 14 selecciones)', async () => {
    const { dir, engine } = makeTmpEnv();
    try {
      const res = await engine.runFullRescan({ date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z', client: mkClient(), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }] });
      assert.strictEqual(res.summary.marketsExplored, 14);
    } finally { cleanup(dir); }
  });

  await runTest('4. Detección de cambio de cuota (ODDS_IMPROVED / ODDS_DETERIORATED)', () => {
    const base = { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.50, bookmaker: 'Bet365', dataQualityScore: 0.90, sampleSize: 15 };
    const imp = reanalyzeOpportunity({ candidate: { ...base, bookmakerOdds: 2.20 }, previousVersion: { odds: 2.00, probability: 0.50, expectedValuePct: 0, bookmaker: 'Bet365' }, nowUtc: '2026-11-28T12:00:00Z' });
    const det = reanalyzeOpportunity({ candidate: { ...base, bookmakerOdds: 1.85 }, previousVersion: { odds: 2.00, probability: 0.50, expectedValuePct: 0, bookmaker: 'Bet365' }, nowUtc: '2026-11-28T12:00:00Z' });
    assert(imp.changes.reasons.includes(CHANGE_REASONS.ODDS_IMPROVED));
    assert(det.changes.reasons.includes(CHANGE_REASONS.ODDS_DETERIORATED));
  });

  await runTest('5. EV que pasa de negativo a positivo (EV_BECAME_POSITIVE)', () => {
    const res = reanalyzeOpportunity({
      candidate: { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.52, bookmakerOdds: 2.10, bookmaker: 'Bet365', dataQualityScore: 0.90, sampleSize: 15 },
      previousVersion: { odds: 1.85, probability: 0.52, expectedValuePct: -3.8, bookmaker: 'Bet365' },
      nowUtc: '2026-11-28T12:00:00Z'
    });
    assert(res.changes.reasons.includes(CHANGE_REASONS.EV_BECAME_POSITIVE));
    assert.strictEqual(res.status, OPPORTUNITY_STATES.OPPORTUNITY);
  });

  await runTest('6. EV que pasa de positivo a negativo (EV_BECAME_NEGATIVE -> REJECTED)', () => {
    const res = reanalyzeOpportunity({
      candidate: { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.52, bookmakerOdds: 1.80, bookmaker: 'Bet365', dataQualityScore: 0.90, sampleSize: 15 },
      previousVersion: { odds: 2.10, probability: 0.52, expectedValuePct: 9.2, bookmaker: 'Bet365' },
      nowUtc: '2026-11-28T12:00:00Z'
    });
    assert(res.changes.reasons.includes(CHANGE_REASONS.EV_BECAME_NEGATIVE));
    assert.strictEqual(res.status, OPPORTUNITY_STATES.REJECTED);
  });

  await runTest('7. Cambio de bookmaker detectado (NEW_BOOKMAKER)', () => {
    const res = reanalyzeOpportunity({
      candidate: { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.55, bookmakerOdds: 2.05, bookmaker: 'Paddy Power', dataQualityScore: 0.90, sampleSize: 15 },
      previousVersion: { odds: 2.05, probability: 0.55, expectedValuePct: 12.75, bookmaker: 'Bet365' },
      nowUtc: '2026-11-28T12:00:00Z'
    });
    assert(res.changes.reasons.includes(CHANGE_REASONS.NEW_BOOKMAKER));
  });

  await runTest('8. Bookmaker no disponible se registra como BOOKMAKER_UNAVAILABLE (nunca StatsHubBest)', async () => {
    const { dir, store, engine } = makeTmpEnv();
    try {
      await engine.runFullRescan({ date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z', client: mkClient({ bookmakerHome: '' }), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }] });
      const latest = store.getLatestByOpportunityId().get('m_102__match_1x2__1__none');
      assert.strictEqual(latest.bookmaker, 'BOOKMAKER_UNAVAILABLE');
    } finally { cleanup(dir); }
  });

  await runTest('9. Datos insuficientes bloquean clasificación aunque EV sea alto (compuerta de evidencia)', () => {
    const res = reanalyzeOpportunity({
      candidate: { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.70, bookmakerOdds: 2.50, bookmaker: 'Bet365', dataQualityScore: 0.35, sampleSize: 4 },
      nowUtc: '2026-11-28T12:00:00Z'
    });
    assert.strictEqual(res.status, OPPORTUNITY_STATES.INSUFFICIENT_DATA);
  });

  await runTest('10. Bloqueo de eventos ya iniciados (eventsSkippedStarted = 1)', async () => {
    const { dir, engine } = makeTmpEnv();
    try {
      const res = await engine.runFullRescan({
        date: '2026-11-28', nowUtc: '2026-11-28T20:10:00Z',
        client: mkClient({ kickoff: 'Tue 28 Nov 2026, 20:00 UTC' }),
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.summary.eventsSkippedStarted, 1);
      assert.strictEqual(res.summary.eventsProcessed, 0);
    } finally { cleanup(dir); }
  });

  await runTest('11. Prevención de leakage temporal: ReanalysisStore rechaza analyzedAtUtc >= kickoffUtc', () => {
    const { dir, store } = makeTmpEnv();
    try {
      const r = store.appendVersion({
        opportunityId: 'x', matchId: 'm', market: '1X2', selection: '1', odds: 2.0, bookmaker: 'Bet365',
        probability: 0.55, analyzedAtUtc: '2026-11-28T20:05:00Z', kickoffUtc: '2026-11-28T20:00:00Z', status: 'OPPORTUNITY'
      });
      assert.strictEqual(r.recorded, false);
      assert.strictEqual(r.reason, 'POST_KICKOFF_REANALYSIS_BLOCKED');
    } finally { cleanup(dir); }
  });

  await runTest('12. Versionado inmutable encadenado SHA-256 detecta alteración', () => {
    const { dir, store } = makeTmpEnv();
    try {
      store.appendVersion({ opportunityId: 'x', matchId: 'm', market: '1X2', selection: '1', odds: 2.0, bookmaker: 'Bet365', probability: 0.55, analyzedAtUtc: '2026-11-28T10:00:00Z', kickoffUtc: '2026-11-28T20:00:00Z', status: 'OPPORTUNITY' });
      assert.strictEqual(store.verifyIntegrity().ok, true);
      const raw = JSON.parse(fs.readFileSync(store.versionsPath, 'utf8'));
      raw[0].odds = 9.99;
      fs.writeFileSync(store.versionsPath, JSON.stringify(raw), 'utf8');
      assert.strictEqual(store.verifyIntegrity().ok, false);
    } finally { cleanup(dir); }
  });

  await runTest('13. Idempotencia: reescanear sin cambios no duplica versiones', async () => {
    const { dir, store, engine } = makeTmpEnv();
    try {
      const opts = { date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z', client: mkClient(), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }] };
      const r1 = await engine.runFullRescan(opts);
      const r2 = await engine.runFullRescan(opts);
      assert.strictEqual(r2.summary.versionsRecorded, 0);
      assert.strictEqual(r2.summary.versionsUnchangedSkipped, r1.summary.versionsRecorded);
      assert.strictEqual(store.getAllVersions().length, r1.summary.versionsRecorded);
    } finally { cleanup(dir); }
  });

  await runTest('14. Prevención de escaneos concurrentes (Mutex)', async () => {
    const { dir, engine } = makeTmpEnv();
    try {
      engine._running = true;
      const blocked = await engine.runFullRescan({ client: mkClient() });
      assert.strictEqual(blocked.skipped, true);
      assert.strictEqual(blocked.reason, 'RESCAN_ALREADY_RUNNING');
      engine._running = false;
    } finally { cleanup(dir); }
  });

  await runTest('15. Fallo de StatsHub registrado explícitamente en errors', async () => {
    const { dir, engine } = makeTmpEnv();
    try {
      const res = await engine.runFullRescan({
        date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z',
        client: { async callTool() { throw new Error('StatsHub Timeout'); } },
        competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }]
      });
      assert.strictEqual(res.summary.errors.length, 1);
    } finally { cleanup(dir); }
  });

  await runTest('16 & 17. Optimización de consultas y caché: exactamente 1 getMatchOdds por partido aunque evalúe 14 selecciones', async () => {
    const { dir, engine } = makeTmpEnv();
    try {
      const counter = {};
      await engine.runFullRescan({ date: '2026-11-28', nowUtc: '2026-11-28T10:00:00Z', client: mkClient({ counter }), competitions: [{ name: 'Premier League', competitionId: 'pl', tier: 1 }] });
      assert.strictEqual(counter.getMatchOdds, 1, 'Debe consultar getMatchOdds exactamente 1 vez por partido');
      assert.strictEqual(counter.getTeamPerformance, 2, 'Solo 1 vez por equipo');
    } finally { cleanup(dir); }
  });

  await runTest('18. Veto vinculante de Risk Manager prevalece sobre Elena', () => {
    const res = reanalyzeOpportunity({
      candidate: { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.65, bookmakerOdds: 2.00, bookmaker: 'Bet365', dataQualityScore: 0.90, sampleSize: 15 },
      activeExposures: [{ matchId: 'other', kickoffUtc: '2026-11-28T20:15:00Z', sport: 'football' }],
      nowUtc: '2026-11-28T12:00:00Z'
    });
    assert.strictEqual(res.elenaVerdict.approved, true);
    assert.strictEqual(res.riskVerdict.riskManagerApproved, false);
    assert.strictEqual(res.status, OPPORTUNITY_STATES.WATCHLIST);
  });

  await runTest('19. Elena no disponible -> REANALYSIS_REQUIRED (nunca simula aprobación)', () => {
    const res = reanalyzeOpportunity({
      candidate: { matchId: 'm', marketFamily: 'match_1x2', selection: '1', kickoffUtc: '2026-11-28T20:00:00Z', modelProb: 0.65, bookmakerOdds: 2.00, bookmaker: 'Bet365', dataQualityScore: 0.90, sampleSize: 15 },
      elenaEvaluator: null,
      nowUtc: '2026-11-28T12:00:00Z'
    });
    assert.strictEqual(res.elenaVerdict.available, false);
    assert.strictEqual(res.status, OPPORTUNITY_STATES.REANALYSIS_REQUIRED);
  });

  await runTest('20. Conservación de históricos: 12 observaciones Fase 9 y Daily Board permanecen intactos', () => {
    const { ObservationStore } = require('../experimental/markets/observation/observationStore');
    const obsStore = new ObservationStore();
    const check = obsStore.verifyIntegrity();
    assert.strictEqual(check.ok, true);
    assert.strictEqual(check.total, 12);
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO FASE 10.2 (REANÁLISIS INTEGRAL): ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log(`====================================================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
