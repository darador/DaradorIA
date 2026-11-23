/**
 * TEST SUITE: FASE 2.3 — SHADOW MODE PARALELO EN VIVO
 * Valida:
 * 1. Evaluación paralela de los 6 modelos (V1, V2, Model B, Model C, Beta-Binomial, Ensemble v2).
 * 2. Registro de modelos no disponibles con motivo explícito.
 * 3. Integridad temporal estricta (bloquea pre-partido >= kickoff y cierre > kickoff).
 * 4. Deduplicación estricta por pickId y eventKey.
 * 5. Inmutabilidad criptográfica SHA-256 antes y después de liquidar (WON/LOST/VOID) + detección de alteración.
 * 6. Scheduler aislado T-5 min (ventana, mutex, captura 2-way y cálculo CLV).
 * 7. Generación del informe comparativo experimental (6 modelos + baseline sin vig).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

async function run() {
  console.log('==================================================================');
  console.log('🧪 TEST SUITE FASE 2.3: SHADOW MODE PARALELO, CLV T-5 E INMUTABILIDAD');
  console.log('==================================================================\n');

  const tmpLedger = path.join(os.tmpdir(), `shadow_lab_v23_test_${Date.now()}.json`);
  const runner = new ShadowLabRunner(tmpLedger);

  try {
    console.log('--- 1. Evaluación Paralela de los 6 Modelos y No-Vig ---');
    await test('Registra los 6 modelos en paralelo con cuota 2-way exacta (isExactNoVig === true)', () => {
      const res = runner.recordParallelObservation({
        pickId: 'lab_pick_01',
        matchId: 'match_lab_01',
        competition: 'Brasileirão Série A',
        match: 'Botafogo vs São Paulo',
        kickoffUtc: '2026-11-23T23:00:00.000Z',
        observedAtUtc: '2026-11-23T20:00:00.000Z',
        playerOrTeam: 'Botafogo (Equipo)',
        isTeamProp: true,
        market: 'Goles de equipo',
        line: 'Menos de 1.5',
        bookmaker: 'BetMGM UK',
        openingOdds: 1.70,
        approvalOdds: 1.67,
        underOdds: 1.67,
        overOdds: 2.15,
        historicalValues: [1, 0, 1, 1, 0, 1, 2, 1, 0, 1, 1, 0, 1, 1, 0]
      });
      assert.strictEqual(res.recorded, true);
      const m = res.record.preMatchBlock.models;
      for (const k of ['v1_production', 'v2_corrected', 'model_b', 'model_c', 'beta_binomial', 'ensemble_v2']) {
        assert.strictEqual(m[k].available, true, `Modelo ${k} debe estar disponible`);
        assert(m[k].prob > 0 && m[k].prob < 1, `Probabilidad de ${k} fuera de (0,1): ${m[k].prob}`);
      }
      assert.strictEqual(res.record.preMatchBlock.oddsAtPrediction.isExactNoVig, true);
      assert.strictEqual(res.record.preMatchBlock.oddsAtPrediction.noVigMethod, 'exact_2way_proportional');
      assert(res.preMatchHash && res.preMatchHash.length === 64, 'Debe emitir sello SHA-256');
    });

    await test('Sin cuota opuesta marca isExactNoVig === false y registra motivo en modelos con muestra corta', () => {
      const res = runner.recordParallelObservation({
        pickId: 'lab_pick_02',
        matchId: 'match_lab_02',
        competition: 'Premier League',
        match: 'Brentford vs Everton',
        kickoffUtc: '2026-11-23T20:00:00.000Z',
        observedAtUtc: '2026-11-23T18:00:00.000Z',
        playerOrTeam: 'Thierno Barry',
        isTeamProp: false,
        market: 'Remates al arco',
        line: 'Más de 0.5',
        approvalOdds: 1.57,
        historicalValues: [1, 2, 1, 0, 1, 1, 2, 1] // n=8: Model B OK, Model C < 15 -> unavailable con motivo
      });
      assert.strictEqual(res.recorded, true);
      assert.strictEqual(res.record.preMatchBlock.oddsAtPrediction.isExactNoVig, false);
      assert.strictEqual(res.record.preMatchBlock.oddsAtPrediction.noVigMethod, 'estimated_overround');
      assert.strictEqual(res.record.preMatchBlock.models.model_b.available, true);
      assert.strictEqual(res.record.preMatchBlock.models.model_c.available, false);
      assert(res.record.preMatchBlock.models.model_c.reason.includes('< 15'), 'Debe explicar motivo de indisponibilidad de Model C');
    });

    console.log('\n--- 2. Integridad Temporal y Deduplicación ---');
    await test('Temporal Guard: bloquea observación con observedAtUtc >= kickoffUtc', () => {
      const blocked = runner.recordParallelObservation({
        pickId: 'lab_leak_01',
        matchId: 'match_leak_01',
        kickoffUtc: '2026-11-23T20:00:00.000Z',
        observedAtUtc: '2026-11-23T20:00:00.000Z',
        approvalOdds: 1.80,
        historicalValues: [1, 1, 1, 1, 1]
      });
      assert.strictEqual(blocked.recorded, false);
      assert.strictEqual(blocked.reason, 'TEMPORAL_LEAKAGE_BLOCKED');
    });

    await test('Deduplicación: bloquea duplicado por pickId y por eventKey', () => {
      const dupById = runner.recordParallelObservation({
        pickId: 'lab_pick_01',
        matchId: 'other_match',
        kickoffUtc: '2026-11-23T23:00:00.000Z',
        observedAtUtc: '2026-11-23T20:05:00.000Z',
        approvalOdds: 1.67
      });
      assert.strictEqual(dupById.recorded, false);
      assert.strictEqual(dupById.reason, 'DUPLICATE_PREVENTED');

      const dupByEventKey = runner.recordParallelObservation({
        pickId: 'lab_pick_01_clone',
        matchId: 'match_lab_01',
        playerOrTeam: 'Botafogo (Equipo)',
        market: 'Goles de equipo',
        line: 'Menos de 1.5',
        kickoffUtc: '2026-11-23T23:00:00.000Z',
        observedAtUtc: '2026-11-23T20:10:00.000Z',
        approvalOdds: 1.67
      });
      assert.strictEqual(dupByEventKey.recorded, false);
      assert.strictEqual(dupByEventKey.reason, 'DUPLICATE_PREVENTED');
    });

    console.log('\n--- 3. Scheduler Aislado T-5 min y Captura de CLV ---');
    await test('Scheduler T-5 captura cuota de cierre solo en ventana [T-10, T-1] y calcula CLV', async () => {
      const scheduler = new TMinus5ClosingScheduler({
        runner,
        oddsProvider: async (obs) => ({
          closingOdds: obs.pickId === 'lab_pick_01' ? 1.58 : 1.52,
          closingOppositeOdds: obs.pickId === 'lab_pick_01' ? 2.30 : 2.45,
          source: 'Mock T-5 Provider'
        })
      });

      // A las 22:55 UTC: lab_pick_01 (23:00 UTC) está exactamente a T-5 min; lab_pick_02 (20:00 UTC) ya pasó
      const nowAtT5 = Date.parse('2026-11-23T22:55:00.000Z');
      const cycle = await scheduler.runCycle(nowAtT5);
      assert.strictEqual(cycle.eligibleCount, 1);
      assert.strictEqual(cycle.capturedCount, 1);
      assert(cycle.captured[0].clvOddsPct > 0, 'Cuota 1.67 vs cierre 1.58 debe dar CLV positivo');

      // Segunda corrida a T-4 min no vuelve a capturar (idempotente)
      const cycle2 = await scheduler.runCycle(Date.parse('2026-11-23T22:56:00.000Z'));
      assert.strictEqual(cycle2.eligibleCount, 0);
    });

    await test('Scheduler T-5 respeta bloqueo Mutex si ya hay ciclo en curso', async () => {
      const scheduler = new TMinus5ClosingScheduler({ runner });
      scheduler.inFlight = true;
      const skipped = await scheduler.runCycle();
      assert.strictEqual(skipped.skipped, true);
      assert.strictEqual(skipped.reason, 'MUTEX_LOCKED');
      scheduler.inFlight = false;
    });

    console.log('\n--- 4. Liquidación Inmutable, Idempotencia y Reporte Comparativo ---');
    await test('Liquidación registra WON/LOST/VOID sin alterar preMatchBlock ni preMatchHash', () => {
      const s1 = runner.recordSettlement('lab_pick_01', { outcome: 'WON', actualStat: 1, settledAtUtc: '2026-11-24T01:05:00.000Z' });
      assert.strictEqual(s1.settled, true);
      assert.strictEqual(s1.hashIntact, true);

      // Idempotencia ante doble liquidación
      const s1Dup = runner.recordSettlement('lab_pick_01', { outcome: 'LOST', actualStat: 3 });
      assert.strictEqual(s1Dup.settled, false);
      assert.strictEqual(s1Dup.reason, 'ALREADY_SETTLED_IDEMPOTENT');

      const s2 = runner.recordSettlement('lab_pick_02', { outcome: 'LOST', actualStat: 0, settledAtUtc: '2026-11-23T22:05:00.000Z' });
      assert.strictEqual(s2.settled, true);

      const integrity = runner.verifyAllHashes();
      assert.strictEqual(integrity.total, 2);
      assert.strictEqual(integrity.intact, 2);
      assert.strictEqual(integrity.tamperedCount, 0);
    });

    await test('ShadowLabReporter genera comparativa de los 6 modelos + baseline sin vig', () => {
      const reporter = new ShadowLabReporter(runner);
      const report = reporter.generateReport();
      assert.strictEqual(report.shadowMode, true);
      assert.strictEqual(report.progress.settledWL, 2);
      assert.strictEqual(report.progress.milestoneTarget, 100);
      assert.strictEqual(report.modelsComparison.v1_production.n, 2);
      assert.strictEqual(report.modelsComparison.ensemble_v2.n, 2);
      assert.strictEqual(report.modelsComparison.market_novig_baseline.n, 2);
      assert(report.byMarket.length === 2);
      assert(report.byOddsRange.length >= 1);
    });
  } finally {
    try {
      if (fs.existsSync(tmpLedger)) fs.unlinkSync(tmpLedger);
    } catch (e) {}
  }

  console.log('\n==================================================================');
  console.log(`🏁 RESULTADO FASE 2.3: ${passed} PASADAS, ${failed} FALLADAS`);
  console.log('==================================================================');
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
