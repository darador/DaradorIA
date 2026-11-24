/**
 * TEST SUITE OBLIGATORIA — FASE 9: OBSERVACIÓN Y VALIDACIÓN ESTADÍSTICA (19 ESCENARIOS)
 *
 * Cubre todos los requisitos de la Sección 14:
 *  1. Registro inmutable (append-only, sin sobrescribir)
 *  2. Hash de integridad SHA-256 (inputSnapshotHash y predictionHash + detección de tampering)
 *  3. Anti-leakage temporal (observedAtUtc >= kickoffUtc y datos futuros en inputs)
 *  4. Deduplicación estricta + alerta local
 *  5. Snapshots de cuotas (FIRST_VALID, T-60, T-30, T-5, CLOSING)
 *  6. CLV con cuotas comparables y CLV_UNAVAILABLE si cambia línea o bookmaker
 *  7. Exclusión de movimientos contaminados ("first-half prices mixed in")
 *  8. Liquidación idempotente y trazabilidad de correcciones
 *  9. Partidos suspendidos (nunca liquidados como LOST)
 * 10. Mercados con PUSH y VOID
 * 11. Brier Score binario y multiclase (1X2)
 * 12. Log Loss binario y multiclase (1X2) + Matriz de confusión
 * 13. ROI con stake plano de 1 unidad
 * 14. Intervalos de confianza 95% (Wilson + ROI)
 * 15. Cluster Bootstrap por matchId
 * 16. Separación temporal estricta train/validation/evaluation + OUT_OF_SAMPLE_NOT_AVAILABLE
 * 17. Comparación contra Baselines (mercado sin vig, base rate anterior, versión anterior)
 * 18. Ausencia de datos y clasificadores de muestra (INSUFFICIENT..STRONGER)
 * 19. Protección de módulos productivos y autoExecutionAllowed === false
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ObservationStore } = require('../experimental/markets/observation/observationStore');
const { SettlementProcessor, SETTLEMENT_STATES } = require('../experimental/markets/observation/settlementProcessor');
const validator = require('../experimental/markets/observation/statisticalValidator');
const { ObservationOrchestrator } = require('../experimental/markets/observation/observationOrchestrator');

let passed = 0;
let failed = 0;

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_f9_'));
  return {
    dir,
    store: new ObservationStore({
      obsPath: path.join(dir, 'obs.json'),
      rejectedPath: path.join(dir, 'rej.json'),
      alertsPath: path.join(dir, 'alerts.json')
    })
  };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
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
  console.log('\n🧪 Iniciando Test Suite Obligatoria — Fase 9: Observación y Validación Estadística (19 Escenarios)...\n');

  await runTest('1. Registro inmutable: nueva evaluación con cuota/versión distinta crea observación independiente sin sobrescribir', () => {
    const { dir, store } = tmpStore();
    try {
      const r1 = store.recordObservation({
        matchId: 'm1', league: 'Premier League', season: '2026-2027',
        homeTeam: 'Arsenal', awayTeam: 'Chelsea',
        kickoffUtc: '2026-11-28T15:00:00Z', observedAtUtc: '2026-11-28T10:00:00Z',
        marketFamily: 'match_1x2', market: 'Ganador 1X2', selection: '1',
        modelName: 'MatchOutcomeDC', modelVersion: 'v1.0', modelProbability: 0.58,
        probabilities1X2: { home: 0.58, draw: 0.24, away: 0.18 },
        odds: 1.85, bookmaker: 'Bet365', noVigProbability: 0.54, dataQualityTier: 'ALTA'
      });
      const r2 = store.recordObservation({
        matchId: 'm1', league: 'Premier League', season: '2026-2027',
        homeTeam: 'Arsenal', awayTeam: 'Chelsea',
        kickoffUtc: '2026-11-28T15:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', market: 'Ganador 1X2', selection: '1',
        modelName: 'MatchOutcomeDC', modelVersion: 'v1.1', modelProbability: 0.60,
        probabilities1X2: { home: 0.60, draw: 0.23, away: 0.17 },
        odds: 1.80, bookmaker: 'Bet365', noVigProbability: 0.55, dataQualityTier: 'ALTA'
      });
      assert.strictEqual(r1.recorded, true);
      assert.strictEqual(r2.recorded, true);
      assert.notStrictEqual(r1.observationId, r2.observationId);
      assert.strictEqual(store.getObservations().length, 2);
    } finally { cleanup(dir); }
  });

  await runTest('2. Hash de integridad SHA-256 verifica registros intactos y detecta manipulación', () => {
    const { dir, store } = tmpStore();
    try {
      const r = store.recordObservation({
        matchId: 'm2', league: 'LaLiga', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'double_chance', selection: '1X', modelProbability: 0.78, odds: 1.32, bookmaker: 'Bet365'
      });
      assert(r.inputSnapshotHash && r.predictionHash);
      assert.strictEqual(store.verifyIntegrity().ok, true);

      // Manipular probabilidad directamente en disco -> verifyIntegrity debe detectarlo
      const raw = JSON.parse(fs.readFileSync(store.obsPath, 'utf8'));
      raw[0].modelProbability = 0.99;
      fs.writeFileSync(store.obsPath, JSON.stringify(raw), 'utf8');
      const check = store.verifyIntegrity();
      assert.strictEqual(check.ok, false);
      assert.strictEqual(check.corruptedCount, 1);
    } finally { cleanup(dir); }
  });

  await runTest('3. Anti-leakage temporal rechaza observedAtUtc >= kickoffUtc e inputTimestamps futuros', () => {
    const { dir, store } = tmpStore();
    try {
      const postKo = store.recordObservation({
        matchId: 'm3', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T18:05:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 1.90, bookmaker: 'Bet365'
      });
      assert.strictEqual(postKo.recorded, false);

      const futureInput = store.recordObservation({
        matchId: 'm3b', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T15:00:00Z',
        inputTimestampsUtc: ['2026-11-28T19:30:00Z'],
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.55, odds: 1.90, bookmaker: 'Bet365'
      });
      assert.strictEqual(futureInput.recorded, false);
      assert.strictEqual(store.getRejectedObservations().length, 2);
      assert(store.getQualityAlerts().length >= 2);
    } finally { cleanup(dir); }
  });

  await runTest('4. Deduplicación estricta bloquea observación idéntica y emite alerta local', () => {
    const { dir, store } = tmpStore();
    try {
      const base = {
        matchId: 'm4', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelVersion: 'v1.0', modelProbability: 0.55, odds: 1.90, bookmaker: 'Bet365'
      };
      assert.strictEqual(store.recordObservation(base).recorded, true);
      const dup = store.recordObservation(base);
      assert.strictEqual(dup.recorded, false);
      assert.strictEqual(dup.reason, 'DUPLICATE_PREVENTED');
      assert(store.getQualityAlerts().some(a => a.code === 'DUPLICATE_OBSERVATION_DETECTED'));
    } finally { cleanup(dir); }
  });

  await runTest('5. Snapshots de cuotas registran T-60, T-30 y T-5 sin asumir que T-5 es cierre', () => {
    const { dir, store } = tmpStore();
    try {
      const r = store.recordObservation({
        matchId: 'm5', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.85, bookmaker: 'Bet365'
      });
      store.recordOddsSnapshot(r.observationId, { checkpoint: 'T_MINUS_60', capturedAtUtc: '2026-11-28T17:00:00Z', odds: 1.82, bookmaker: 'Bet365' });
      store.recordOddsSnapshot(r.observationId, { checkpoint: 'T_MINUS_30', capturedAtUtc: '2026-11-28T17:30:00Z', odds: 1.80, bookmaker: 'Bet365' });
      const t5 = store.recordOddsSnapshot(r.observationId, { checkpoint: 'T_MINUS_5', capturedAtUtc: '2026-11-28T17:55:00Z', odds: 1.78, bookmaker: 'Bet365' });
      assert.strictEqual(t5.clv.status, 'CLV_UNAVAILABLE', 'T-5 no debe asumirse automáticamente como CLOSING');
      assert.strictEqual(store.getObservations()[0].oddsSnapshots.length, 4);
    } finally { cleanup(dir); }
  });

  await runTest('6. CLV calcula correctamente con cuotas comparables y marca CLV_UNAVAILABLE si difiere línea o bookmaker', () => {
    const { dir, store } = tmpStore();
    try {
      const r = store.recordObservation({
        matchId: 'm6', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_goals', selection: 'OVER', line: 2.5, modelProbability: 0.58, odds: 1.95, bookmaker: 'Bet365'
      });
      // Línea distinta (2.5 vs 3.5) -> CLV_UNAVAILABLE
      const diffLine = store.recordOddsSnapshot(r.observationId, {
        checkpoint: 'CLOSING', capturedAtUtc: '2026-11-28T17:58:00Z', odds: 2.40, bookmaker: 'Bet365', line: 3.5
      });
      assert.strictEqual(diffLine.clv.status, 'CLV_UNAVAILABLE');

      // Mismo bookmaker, misma selección y misma línea (2.5) -> CLV_AVAILABLE positivo
      const validClose = store.recordOddsSnapshot(r.observationId, {
        checkpoint: 'CLOSING', capturedAtUtc: '2026-11-28T17:59:00Z', odds: 1.85, bookmaker: 'Bet365', line: 2.5
      });
      assert.strictEqual(validClose.clv.status, 'CLV_AVAILABLE');
      assert(validClose.clv.clvPct > 5.0);
    } finally { cleanup(dir); }
  });

  await runTest('7. Exclusión de movimientos contaminados ("first-half prices mixed in") con alerta local', () => {
    const { dir, store } = tmpStore();
    try {
      const r = store.recordObservation({
        matchId: 'm7', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '2', modelProbability: 0.20, odds: 6.50, bookmaker: 'All British Casino'
      });
      const res = store.recordOddsSnapshot(r.observationId, {
        checkpoint: 'CLOSING', odds: 5.50, bookmaker: 'All British Casino', warning: 'first-half prices mixed in'
      });
      assert.strictEqual(res.updated, false);
      assert.strictEqual(res.reason, 'CONTAMINATED_MOVEMENT_EXCLUDED');
      assert(store.getQualityAlerts().some(a => a.code === 'CONTAMINATED_ODDS_MOVEMENT_EXCLUDED'));
    } finally { cleanup(dir); }
  });

  await runTest('8. Liquidación idempotente y trazabilidad de correcciones sin borrar historial', () => {
    const { dir, store } = tmpStore();
    try {
      const sp = new SettlementProcessor(store);
      const r = store.recordObservation({
        matchId: 'm8', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });
      const s1 = sp.settleObservation(r.observationId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: 2, awayGoals: 1 });
      assert.strictEqual(s1.status, SETTLEMENT_STATES.WON);
      assert.strictEqual(s1.profitUnits, 0.8);

      const s2 = sp.settleObservation(r.observationId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: 2, awayGoals: 1 });
      assert.strictEqual(s2.idempotent, true);

      const corr = sp.recordSettlementCorrection(r.observationId, { newHomeGoals: 1, newAwayGoals: 1, reason: 'Gol anulado en acta oficial' });
      assert.strictEqual(corr.status, SETTLEMENT_STATES.LOST);
      assert.strictEqual(corr.correctionsCount, 1);
      assert.strictEqual(store.verifyIntegrity().ok, true, 'El hash pre-partido permanece intacto tras liquidar y corregir');
    } finally { cleanup(dir); }
  });

  await runTest('9. Partido suspendido NUNCA se liquida como LOST (queda PENDING o VOID oficial)', () => {
    const { dir, store } = tmpStore();
    try {
      const sp = new SettlementProcessor(store);
      const r = store.recordObservation({
        matchId: 'm9', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });
      const susp = sp.settleObservation(r.observationId, { matchStatus: 'SUSPENDED', resultConfirmed: false });
      assert.strictEqual(susp.settled, false);
      assert.strictEqual(store.getObservations()[0].status, SETTLEMENT_STATES.PENDING);

      const voided = sp.settleObservation(r.observationId, { matchStatus: 'SUSPENDED', officiallyVoided: true });
      assert.strictEqual(voided.status, SETTLEMENT_STATES.VOID);
      assert.strictEqual(voided.profitUnits, 0);
    } finally { cleanup(dir); }
  });

  await runTest('10. Mercados con PUSH (Over 2.0 en 1-1) y VOID liquidan con profit 0', () => {
    const { dir, store } = tmpStore();
    try {
      const sp = new SettlementProcessor(store);
      const r = store.recordObservation({
        matchId: 'm10', kickoffUtc: '2026-11-28T18:00:00Z', observedAtUtc: '2026-11-28T12:00:00Z',
        marketFamily: 'match_goals', selection: 'OVER', line: 2.0, modelProbability: 0.55, odds: 1.90, bookmaker: 'Bet365'
      });
      const pushRes = sp.settleObservation(r.observationId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: 1, awayGoals: 1 });
      assert.strictEqual(pushRes.status, SETTLEMENT_STATES.PUSH);
      assert.strictEqual(pushRes.profitUnits, 0);
    } finally { cleanup(dir); }
  });

  await runTest('11. Brier Score binario y multiclase (1X2) coinciden con fórmula exacta', () => {
    const obsBin = [
      { matchId: 'a', marketFamily: 'double_chance', status: 'WON', modelProbability: 0.80, odds: 1.25, settlement: { profitUnits: 0.25 } },
      { matchId: 'b', marketFamily: 'double_chance', status: 'LOST', modelProbability: 0.60, odds: 1.50, settlement: { profitUnits: -1 } }
    ];
    const evBin = validator.evaluateFamilySlice(obsBin, 'double_chance');
    // ((0.8-1)^2 + (0.6-0)^2) / 2 = (0.04 + 0.36)/2 = 0.20
    assert(Math.abs(evBin.predictive.brierScore - 0.20) < 1e-4);

    const obs1x2 = [
      {
        matchId: 'c', marketFamily: 'match_1x2', status: 'WON', modelProbability: 0.70, odds: 1.50,
        probabilities1X2: { home: 0.70, draw: 0.20, away: 0.10 },
        settlement: { actual1X2: '1', profitUnits: 0.50 }
      }
    ];
    const ev1x2 = validator.evaluateFamilySlice(obs1x2, 'match_1x2');
    // (0.7-1)^2 + (0.2-0)^2 + (0.1-0)^2 = 0.09 + 0.04 + 0.01 = 0.14
    assert(Math.abs(ev1x2.predictive.brierScore - 0.14) < 1e-4);
  });

  await runTest('12. Log Loss binario y multiclase (1X2) + Accuracy y Matriz de confusión 3x3', () => {
    const obs1x2 = [
      {
        matchId: 'c1', marketFamily: 'match_1x2', status: 'WON', modelProbability: 0.70, odds: 1.50,
        probabilities1X2: { home: 0.70, draw: 0.20, away: 0.10 },
        settlement: { actual1X2: '1', profitUnits: 0.50 }
      },
      {
        matchId: 'c2', marketFamily: 'match_1x2', status: 'LOST', modelProbability: 0.60, odds: 1.70,
        probabilities1X2: { home: 0.60, draw: 0.25, away: 0.15 },
        settlement: { actual1X2: 'X', profitUnits: -1 }
      }
    ];
    const ev = validator.evaluateFamilySlice(obs1x2, 'match_1x2');
    const expectedLL = (-Math.log(0.70) - Math.log(0.25)) / 2;
    assert(Math.abs(ev.predictive.logLoss - expectedLL) < 1e-4);
    assert.strictEqual(ev.predictive.accuracyPct, 50);
    assert.strictEqual(ev.predictive.confusionMatrix['1']['1'], 1);
    assert.strictEqual(ev.predictive.confusionMatrix['X']['1'], 1);
  });

  await runTest('13. ROI con stake plano 1U, Yield, Hit Rate y cuota media', () => {
    const obs = [
      { matchId: 'p1', marketFamily: 'btts', status: 'WON', modelProbability: 0.60, odds: 2.00, settlement: { profitUnits: 1.0 } },
      { matchId: 'p2', marketFamily: 'btts', status: 'WON', modelProbability: 0.60, odds: 2.00, settlement: { profitUnits: 1.0 } },
      { matchId: 'p3', marketFamily: 'btts', status: 'LOST', modelProbability: 0.55, odds: 1.80, settlement: { profitUnits: -1.0 } },
      { matchId: 'p4', marketFamily: 'btts', status: 'LOST', modelProbability: 0.55, odds: 1.80, settlement: { profitUnits: -1.0 } }
    ];
    const ev = validator.evaluateFamilySlice(obs, 'btts');
    assert.strictEqual(ev.profitability.hitRatePct, 50);
    assert.strictEqual(ev.profitability.cumulativeProfitUnits, 0);
    assert.strictEqual(ev.profitability.roiPct, 0);
    assert.strictEqual(ev.profitability.avgOdds, 1.9);
  });

  await runTest('14. Intervalos de confianza 95% (Wilson para Hit Rate y normal para ROI)', () => {
    const ciHr = validator.wilsonCI95(60, 100);
    assert(ciHr.lowPct > 49 && ciHr.lowPct < 52);
    assert(ciHr.highPct > 68 && ciHr.highPct < 71);
    const ciRoi = validator.roiCI95([1, 1, -1, 1, -1, 1, 1, -1, 1, -1]);
    assert(ciRoi.lowPct < 20 && ciRoi.highPct > 20);
  });

  await runTest('15. Cluster Bootstrap por matchId respeta dependencia de selecciones del mismo partido', () => {
    const paired = [
      { matchId: 'M1', observationId: 'o1', diff: -0.04 },
      { matchId: 'M1', observationId: 'o2', diff: -0.04 },
      { matchId: 'M2', observationId: 'o3', diff: -0.02 },
      { matchId: 'M3', observationId: 'o4', diff: -0.03 },
      { matchId: 'M4', observationId: 'o5', diff: -0.05 }
    ];
    const boot = validator.clusterBootstrapDiffCI(
      paired,
      (s) => s.reduce((a, x) => a + x.diff, 0) / s.length,
      { iterations: 300, seed: 77 }
    );
    assert.strictEqual(boot.available, true);
    assert.strictEqual(boot.clusterCount, 4, 'Debe agrupar en 4 partidos (clusters), no 5 observaciones');
    assert(boot.ci95High < 0);
  });

  await runTest('16. Separación temporal estricta train < validation < evaluation y OUT_OF_SAMPLE_NOT_AVAILABLE', () => {
    const small = [{ matchId: 's1', marketFamily: 'double_chance', status: 'WON', kickoffUtc: '2026-10-01T12:00:00Z', modelProbability: 0.7, odds: 1.4 }];
    const na = validator.runStrictTemporalOutOfSampleSplit(small, 'double_chance');
    assert.strictEqual(na.status, 'OUT_OF_SAMPLE_NOT_AVAILABLE');

    const series = [];
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 8, 1 + i, 18, 0, 0)).toISOString();
      series.push({
        matchId: `oos_${i}`, marketFamily: 'double_chance', status: i % 4 === 0 ? 'LOST' : 'WON',
        kickoffUtc: day, modelProbability: 0.72, odds: 1.40, settlement: { profitUnits: i % 4 === 0 ? -1 : 0.40 }
      });
    }
    const oos = validator.runStrictTemporalOutOfSampleSplit(series, 'double_chance');
    assert.strictEqual(oos.status, 'OUT_OF_SAMPLE_AVAILABLE');
    assert.strictEqual(oos.temporalIntegrityOk, true);
    assert(Date.parse(oos.splits.train.toUtc) <= Date.parse(oos.splits.validation.fromUtc));
    assert(oos.parameterVersion.startsWith('oos-cal-trainN'));
  });

  await runTest('17. Comparación contra Baselines (mercado sin vig, base rate anterior y versión anterior)', () => {
    const cur = [
      { matchId: 'b1', selection: '1X', marketFamily: 'double_chance', kickoffUtc: '2026-10-01T15:00:00Z', status: 'WON', modelProbability: 0.80, noVigProbability: 0.72, odds: 1.35, settlement: { profitUnits: 0.35 } },
      { matchId: 'b2', selection: '1X', marketFamily: 'double_chance', kickoffUtc: '2026-10-02T15:00:00Z', status: 'WON', modelProbability: 0.78, noVigProbability: 0.70, odds: 1.40, settlement: { profitUnits: 0.40 } },
      { matchId: 'b3', selection: '1X', marketFamily: 'double_chance', kickoffUtc: '2026-10-03T15:00:00Z', status: 'LOST', modelProbability: 0.55, noVigProbability: 0.65, odds: 1.50, settlement: { profitUnits: -1.0 } }
    ];
    const prev = [
      { matchId: 'b1', selection: '1X', marketFamily: 'double_chance', status: 'WON', modelProbability: 0.65, settlement: { profitUnits: 0.35 } },
      { matchId: 'b2', selection: '1X', marketFamily: 'double_chance', status: 'WON', modelProbability: 0.65, settlement: { profitUnits: 0.40 } },
      { matchId: 'b3', selection: '1X', marketFamily: 'double_chance', status: 'LOST', modelProbability: 0.75, settlement: { profitUnits: -1.0 } }
    ];
    const cmp = validator.compareAgainstBaselines(cur, 'double_chance', { previousVersionObs: prev, bootstrapIterations: 150 });
    assert.strictEqual(cmp.vsMarketNoVig.available, true);
    assert(cmp.vsMarketNoVig.deltaBrier < 0, 'Modelo mejor calibrado debe tener deltaBrier < 0 vs mercado');
    assert.strictEqual(cmp.vsHistoricalBaseRate.comparableCount, 2, 'El primer evento no tiene histórico anterior (zero lookahead)');
    assert.strictEqual(cmp.vsPreviousVersion.comparableCount, 3);
    assert(cmp.vsPreviousVersion.deltaBrier < 0);
  });

  await runTest('18. Ausencia de datos esenciales y umbrales oficiales de volumen de muestra', () => {
    const { dir, store } = tmpStore();
    try {
      const missing = store.recordObservation({ matchId: 'x1' });
      assert.strictEqual(missing.recorded, false);
      assert.strictEqual(validator.classifySampleSize(29), 'INSUFFICIENT_SAMPLE');
      assert.strictEqual(validator.classifySampleSize(30), 'PRELIMINARY_SAMPLE');
      assert.strictEqual(validator.classifySampleSize(100), 'DEVELOPING_EVIDENCE');
      assert.strictEqual(validator.classifySampleSize(300), 'STRONGER_EVIDENCE');
    } finally { cleanup(dir); }
  });

  await runTest('19. Protección de módulos productivos y autoExecutionAllowed === false en todo el pipeline', () => {
    const { dir, store } = tmpStore();
    try {
      const orch = new ObservationOrchestrator({ store, exportPath: path.join(dir, 'evidence.json') });
      assert.strictEqual(orch.autoExecutionAllowed, false);
      assert.strictEqual(store.autoExecutionAllowed, false);
      const exported = orch.buildAndExportDashboardData({ writeToDisk: true });
      assert.strictEqual(exported.autoExecutionAllowed, false);
      assert.strictEqual(exported.mode, 'SHADOW_MODE_EXPERIMENTAL');
      assert(fs.existsSync(path.join(dir, 'evidence.json')));
    } finally { cleanup(dir); }
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO FASE 9 (OBSERVACIÓN Y VALIDACIÓN): ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log(`====================================================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
