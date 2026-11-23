/**
 * TEST SUITE: FASES 2.1 Y 2.2 — MOTOR EXPERIMENTAL V2 Y SHADOW FEATURE COLLECTOR
 * Valida todas las correcciones matemáticas contra valores teóricos de referencia,
 * complementariedad Over/Under, líneas enteras con push, shrinkage, CLV y guarda temporal.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const v1 = require('../prediction/predictionEngine');
const v2 = require('../experimental/predictionEngineV2');
const { ShadowFeatureCollector } = require('../experimental/shadowFeatureCollector');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}\n     ${err.message}`);
    failed++;
  }
}

function approxEq(actual, expected, tol = 1e-9, msg = '') {
  assert(
    Math.abs(actual - expected) <= tol,
    `${msg} esperado=${expected}, actual=${actual}, diff=${Math.abs(actual - expected)}`
  );
}

console.log('==================================================================');
console.log('🧪 TEST SUITE FASES 2.1 & 2.2: MOTOR EXPERIMENTAL V2 Y CLV SHADOW');
console.log('==================================================================\n');

console.log('--- 1. Lanczos logGamma y Precisión Teórica ---');
test('logGammaLanczos(1) === 0 (factorial 0! = 1)', () => {
  approxEq(v2.logGammaLanczos(1), 0, 1e-12);
});
test('logGammaLanczos(5) === ln(24) (factorial 4! = 24)', () => {
  approxEq(v2.logGammaLanczos(5), Math.log(24), 1e-12);
});
test('logGammaLanczos(0.5) === ln(sqrt(pi))', () => {
  approxEq(v2.logGammaLanczos(0.5), Math.log(Math.sqrt(Math.PI)), 1e-12);
});
test('logGammaLanczos(0.25) mediante reflexión de Euler (Gamma(0.25) ≈ 3.62560990822)', () => {
  approxEq(Math.exp(v2.logGammaLanczos(0.25)), 3.6256099082219083, 1e-10);
});

console.log('\n--- 2. Poisson: PMF, CDF, Suma = 1 y Referencia Analítica ---');
test('Poisson(lambda=2.0): PMF(0)=e^-2, PMF(1)=2e^-2, PMF(2)=2e^-2', () => {
  const e2 = Math.exp(-2);
  approxEq(v2.poissonPmf(2, 0), e2, 1e-12);
  approxEq(v2.poissonPmf(2, 1), 2 * e2, 1e-12);
  approxEq(v2.poissonPmf(2, 2), 2 * e2, 1e-12);
  approxEq(v2.poissonCdf(2, 2), 5 * e2, 1e-12);
});
test('Poisson(lambda=3.5): suma de PMF(k=0..40) === 1.0', () => {
  let sum = 0;
  for (let k = 0; k <= 40; k++) sum += v2.poissonPmf(3.5, k);
  approxEq(sum, 1.0, 1e-10);
});
test('Poisson caso extremo lambda=0: PMF(0)=1, Over 0.5 = 0, Under 0.5 = 1', () => {
  assert.strictEqual(v2.poissonPmf(0, 0), 1);
  assert.strictEqual(v2.poissonOver(0, 1), 0);
  assert.strictEqual(v2.poissonUnder(0, 0), 1);
});

console.log('\n--- 3. Binomial Negativa (Lanczos): PMF, CDF, Suma = 1 y Escalado Coherente ---');
test('NB(r=2, p=0.5): valores exactos PMF(0)=0.25, PMF(1)=0.25, PMF(2)=0.1875', () => {
  // Con r=2, p=0.5 -> mean = 2, var = 4
  approxEq(v2.nbPmf(0, 2, 0.5), 0.25, 1e-12);
  approxEq(v2.nbPmf(1, 2, 0.5), 0.25, 1e-12);
  approxEq(v2.nbPmf(2, 2, 0.5), 0.1875, 1e-12);
  approxEq(v2.nbCdf(2, 4, 2), 0.6875, 1e-12);
});
test('NB sobredispersión severa (r=0.5, p=0.25): suma de PMF(k=0..150) === 1.0', () => {
  let sum = 0;
  for (let k = 0; k <= 150; k++) sum += v2.nbPmf(k, 0.5, 0.25);
  approxEq(sum, 1.0, 1e-9);
});
test('Escalado coherente NB: al multiplicar media por 1.5, phi permanece constante y NO revierte a Poisson', () => {
  // En V1, mean=4, var=5.2 -> mean*1.5 = 6.0 > 5.2 revertía silenciosamente a Poisson!
  const pBase = v2.nbParamsFromMeanVariance(4.0, 5.2, 1.0);
  const pScaled = v2.nbParamsFromMeanVariance(4.0, 5.2, 1.5);
  assert.strictEqual(pBase.usePoisson, false);
  assert.strictEqual(pScaled.usePoisson, false, 'Debe mantener Binomial Negativa tras escalar');
  approxEq(pScaled.phi, pBase.phi, 1e-12, 'Dispersión phi debe conservarse');
  approxEq(pScaled.lambda, 6.0, 1e-12);
  approxEq(pScaled.varScaled, 7.8, 1e-12);
});

console.log('\n--- 4. Over / Under (Líneas Medias y Enteras con Push) ---');
test('Línea media (1.5): P(Over 1.5) + P(Under 1.5) === 1.0 y P(Push) === 0 (Poisson y NB)', () => {
  const line = v2.parseLine('Más de 1.5');
  assert.strictEqual(line.hasPush, false);
  const dPois = v2.evaluateLineDistribution(2.2, 2.2, line, 1.0, 'poisson');
  approxEq(dPois.pOver + dPois.pUnder, 1.0, 1e-12);
  assert.strictEqual(dPois.pPush, 0);

  const dNB = v2.evaluateLineDistribution(2.2, 5.5, line, 1.0, 'nb');
  approxEq(dNB.pOver + dNB.pUnder, 1.0, 1e-12);
  assert.strictEqual(dNB.pPush, 0);
});
test('Línea Under (Menos de 5.5): selecciona P(X <= 5) y es complemento exacto de Over 5.5', () => {
  const lUnder = v2.parseLine('Menos de 5.5');
  const lOver = v2.parseLine('Más de 5.5');
  assert.strictEqual(lUnder.side, 'under');
  const rUnder = v2.evaluateLineDistribution(4.8, 7.2, lUnder, 1.0, 'nb');
  const rOver = v2.evaluateLineDistribution(4.8, 7.2, lOver, 1.0, 'nb');
  approxEq(rUnder.pSelectedRaw + rOver.pSelectedRaw, 1.0, 1e-12);
});
test('Línea entera (2.0): P(Over 2.0) + P(Push 2.0) + P(Under 2.0) === 1.0', () => {
  const lInt = v2.parseLine('Más de 2.0');
  assert.strictEqual(lInt.isIntegerLine, true);
  assert.strictEqual(lInt.pushK, 2);
  assert.strictEqual(lInt.kOverMin, 3);
  assert.strictEqual(lInt.kUnderMax, 1);

  const dNB = v2.evaluateLineDistribution(2.5, 5.0, lInt, 1.0, 'nb');
  assert(dNB.pPush > 0, 'Línea entera debe tener masa de push > 0');
  approxEq(dNB.pOver + dNB.pPush + dNB.pUnder, 1.0, 1e-12);
});

console.log('\n--- 5. Eliminación de Doble Penalización por Minutos y Shrinkage Beta-Binomial ---');
test('Sin statPer90 ni avgMinutes: NO multiplica promedio por partido por expectedMinutes/90', () => {
  const res = v2.computeLambdaBase({ isTeamProp: false, perMatchMean: 2.0, statPer90: null, avgMinutesPlayed: null, expectedMinutes: 75 });
  assert.strictEqual(res.lambdaBase, 2.0);
  assert.strictEqual(res.method, 'per_match_unscaled_no_minutes');
});
test('Con avgMinutes=75 y expectedMinutes=75: lambdaBase === perMatchMean (sin sesgo)', () => {
  const res = v2.computeLambdaBase({ isTeamProp: false, perMatchMean: 2.0, statPer90: null, avgMinutesPlayed: 75, expectedMinutes: 75 });
  approxEq(res.lambdaBase, 2.0, 1e-12);
  approxEq(res.statPer90Resolved, 2.4, 1e-12);
});
test('Beta-Binomial Shrinkage: evita 0% y 100% en muestras extremas (0/5, 5/5, 10/10)', () => {
  const p0 = v2.betaBinomialShrink(0, 5, 0.55, 15);
  const p5 = v2.betaBinomialShrink(5, 5, 0.55, 15);
  const p10 = v2.betaBinomialShrink(10, 10, 0.55, 15);
  assert(p0 > 0 && p0 < 1, `p0 debe estar en (0,1), fue ${p0}`);
  assert(p5 > 0 && p5 < 1, `p5 debe estar en (0,1), fue ${p5}`);
  assert(p10 > 0 && p10 < 1, `p10 debe estar en (0,1), fue ${p10}`);
  assert(p10 < 0.85, `10/10 con prior 0.55 y m=15 debe contraerse a ~0.73, fue ${p10}`);
});
test('Probabilidad sin vig exacta 2-way (1.85 / 1.95) suma 1.0 entre Over y Under', () => {
  const nvOver = v2.computeNoVigProb(1.85, 1.95);
  const nvUnder = v2.computeNoVigProb(1.95, 1.85);
  assert.strictEqual(nvOver.method, 'exact_2way_proportional');
  approxEq(nvOver.prob + nvUnder.prob, 1.0, 1e-5);
});

console.log('\n--- 6. ShadowFeatureCollector (Fase 2.2): Schema, CLV, Nulls y Temporal Guard ---');
const tmpLedger = path.join(os.tmpdir(), `shadow_v2_test_${Date.now()}.json`);
const collector = new ShadowFeatureCollector(tmpLedger);

try {
  test('Temporal Guard: bloquea observación pre-partido con observedAt >= kickoffUtc', () => {
    const blocked = collector.recordPreMatchObservation({
      pickId: 'test_leak_01',
      matchId: 'match_leak_01',
      kickoffUtc: '2026-11-23T20:00:00.000Z',
      observedAt: '2026-11-23T20:05:00.000Z',
      approvalOdds: 1.80
    });
    assert.strictEqual(blocked.recorded, false);
    assert.strictEqual(blocked.reason, 'TEMPORAL_LEAKAGE_BLOCKED');
  });

  test('Registro pre-partido completo: guarda features, nulls reales y evita duplicados', () => {
    const res = collector.recordPreMatchObservation({
      pickId: 'shadow_pick_01',
      matchId: 'brentford-v-everton.0sg1wri',
      competition: 'Premier League (England)',
      match: 'Brentford vs Everton',
      kickoffUtc: '2026-11-23T20:00:00.000Z',
      observedAt: '2026-11-23T15:00:00.000Z',
      playerOrTeam: 'Thierno Barry',
      market: 'Remates al arco',
      line: 'Más de 0.5',
      bookmaker: 'Bet365',
      openingOdds: 1.62,
      approvalOdds: 1.57,
      overOdds: 1.57,
      underOdds: 2.35,
      market1X2: { homeOdds: 2.10, drawOdds: 3.40, awayOdds: 3.50 },
      handicap: { line: -0.5, homeOdds: 2.08, awayOdds: 1.82, source: 'StatsHub' },
      referee: null, // Ausente: debe quedar null y available: false
      minutesPerMatch: [90, 84, 90, 78, 90],
      expectedMinutes: 85,
      lineupStatus: 'PREDICTED',
      position: 'ST',
      historicalValues: [1, 2, 1, 1, 2, 0, 1, 1, 2, 1, 1, 0, 1, 2, 1]
    });
    assert.strictEqual(res.recorded, true);
    assert.strictEqual(res.record.oddsSnapshot.noVigMethod, 'exact_2way_proportional');
    assert.strictEqual(res.record.matchContext.market1X2.available, true);
    assert.strictEqual(res.record.matchContext.referee.available, false);
    assert.strictEqual(res.record.matchContext.referee.name, null, 'No debe inventar árbitro');
    assert.strictEqual(res.record.dataAvailability.windowL5, true);
    assert.strictEqual(res.record.dataAvailability.windowL10, true);
    assert.strictEqual(res.record.dataAvailability.windowL20, false, 'Solo hay 15 observaciones, L20 debe ser null');

    // Deduplicación
    const dup = collector.recordPreMatchObservation({
      pickId: 'shadow_pick_01',
      matchId: 'brentford-v-everton.0sg1wri',
      kickoffUtc: '2026-11-23T20:00:00.000Z',
      observedAt: '2026-11-23T15:10:00.000Z'
    });
    assert.strictEqual(dup.recorded, false);
    assert.strictEqual(dup.reason, 'DUPLICATE_PREVENTED');
  });

  test('Captura de cuota de cierre a T-5 min calcula CLV correctamente y bloquea post-kickoff', () => {
    const blocked = collector.recordClosingOdds('shadow_pick_01', {
      closingOdds: 1.50,
      capturedAt: '2026-11-23T20:01:00.000Z'
    });
    assert.strictEqual(blocked.updated, false);
    assert.strictEqual(blocked.reason, 'CLOSING_ODDS_AFTER_KICKOFF_BLOCKED');

    const ok = collector.recordClosingOdds('shadow_pick_01', {
      closingOdds: 1.50,
      closingOppositeOdds: 2.50,
      capturedAt: '2026-11-23T19:55:00.000Z'
    });
    assert.strictEqual(ok.updated, true);
    approxEq(ok.clvOddsPct, Number((((1.57 / 1.50) - 1) * 100).toFixed(2)), 1e-6);
    assert(ok.clvProbPp > 0, 'Bajar cuota de 1.57 a 1.50 implica CLV positivo en probabilidad');
  });

  test('Integridad de producción: V1 sigue intacto y V2 opera sin efectos colaterales', () => {
    const sampleCand = {
      id: 'compare_under_01',
      isTeamProp: true,
      playerOrTeam: 'Levante UD (Equipo)',
      match: 'Levante UD vs Elche',
      market: 'Córners de equipo',
      line: 'Menos de 5.5',
      bookmakerOdds: 1.67,
      researchData: {
        qualityStatus: 'COMPLETA',
        teamData: { observations: [4, 3, 5, 2, 6, 4, 3, 5, 4, 3, 2, 4, 5, 3, 4] }
      }
    };
    const r1 = v1.predictCandidate(sampleCand);
    const r2 = v2.predictCandidate(sampleCand);
    assert(r1.pProjected < 0.30, 'V1 interpreta Menos de 5.5 como Over 5.5 (bug documentado en producción intacta)');
    assert(r2.pShadowCombined > 0.70 && r2.pShadowCombined < 0.90, 'V2 evalúa correctamente Under 5.5 con shrinkage');
  });
} finally {
  try {
    if (fs.existsSync(tmpLedger)) fs.unlinkSync(tmpLedger);
  } catch (e) {}
}

console.log('\n==================================================================');
console.log(`🏁 RESULTADO FASES 2.1 & 2.2: ${passed} PASADAS, ${failed} FALLADAS`);
console.log('==================================================================');
if (failed > 0) process.exit(1);
