/**
 * DARADORBET — TEST SUITE: AMPLIACIÓN DE MERCADOS 1X2 Y DOBLE OPORTUNIDAD
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  MARKET_1X2,
  MARKET_DC,
  CANONICAL_SELECTIONS,
  deVig1X2,
  computeCoherentProbabilities,
  evaluateMatch1X2AndDC,
  settleMatchResultSelection,
  deduplicateBoardEntries,
  computeSeparateMarketMetrics
} = require('../experimental/markets/matchResultBoardBridge');
const { ProspectiveLadderEngine } = require('../experimental/prospective/prospectiveLadderEngine');
const tracker = require('../prediction/observationTracker');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

console.log('\n=== TEST SUITE: MERCADOS 1X2 Y DOBLE OPORTUNIDAD ===\n');

test('1. Identificación canónica de los 6 tipos de selección (1, X, 2, 1X, X2, 12)', () => {
  assert.strictEqual(Object.keys(CANONICAL_SELECTIONS).length, 6);
  assert.strictEqual(CANONICAL_SELECTIONS['1'].market, MARKET_1X2);
  assert.strictEqual(CANONICAL_SELECTIONS['X'].market, MARKET_1X2);
  assert.strictEqual(CANONICAL_SELECTIONS['2'].market, MARKET_1X2);
  assert.strictEqual(CANONICAL_SELECTIONS['1X'].market, MARKET_DC);
  assert.strictEqual(CANONICAL_SELECTIONS['X2'].market, MARKET_DC);
  assert.strictEqual(CANONICAL_SELECTIONS['12'].market, MARKET_DC);
});

test('2. Probabilidades coherentes: P(1)+P(X)+P(2)=1 y Doble Oportunidad derivada', () => {
  const probs = computeCoherentProbabilities({ probabilities1X2: { home: 0.50, draw: 0.28, away: 0.22 } });
  assert.strictEqual(probs.coherentSum, 1);
  assert.strictEqual(probs['1X'], 0.78);
  assert.strictEqual(probs['X2'], 0.5);
  assert.strictEqual(probs['12'], 0.72);
});

test('3. De-vig 1X2 y cálculo de EV sin inventar cuotas faltantes', () => {
  const nv = deVig1X2(2.10, 3.40, 3.60);
  assert.ok(nv.overroundPct > 0);
  assert.ok(Math.abs(nv.p1 + nv.pX + nv.p2 - 1) < 0.002);

  const res = evaluateMatch1X2AndDC(
    { matchId: 'm_ucl_1', homeTeam: 'Inter', awayTeam: 'VfB Stuttgart', league: 'UCL', probabilities1X2: { home: 0.55, draw: 0.25, away: 0.20 } },
    { '1': 2.10, 'X': 3.50, '2': 3.60, '1X': 1.38 } // X2 y 12 sin cuota -> no inventar
  );
  assert.strictEqual(res.evaluated.length, 4);
  assert.strictEqual(res.missingOdds.length, 2);
  const pick1 = res.evaluated.find(e => e.selectionCode === '1');
  assert.strictEqual(pick1.elena_decision, 'APROBADO'); // 0.55 * 2.10 - 1 = +15.5%
  const pick2 = res.evaluated.find(e => e.selectionCode === '2');
  assert.strictEqual(pick2.elena_decision, 'RECHAZADO'); // 0.20 * 3.60 - 1 = -28%
});

test('4. Liquidación exacta de 1, X, 2', () => {
  assert.strictEqual(settleMatchResultSelection('1', 2, 1), 'WON');
  assert.strictEqual(settleMatchResultSelection('1', 1, 1), 'LOST');
  assert.strictEqual(settleMatchResultSelection('X', 1, 1), 'WON');
  assert.strictEqual(settleMatchResultSelection('X', 2, 0), 'LOST');
  assert.strictEqual(settleMatchResultSelection('2', 0, 2), 'WON');
  assert.strictEqual(settleMatchResultSelection('2', 1, 1), 'LOST');
});

test('5. Liquidación exacta de 1X, X2, 12', () => {
  assert.strictEqual(settleMatchResultSelection('1X', 2, 1), 'WON');
  assert.strictEqual(settleMatchResultSelection('1X', 1, 1), 'WON');
  assert.strictEqual(settleMatchResultSelection('1X', 0, 1), 'LOST');
  assert.strictEqual(settleMatchResultSelection('X2', 1, 1), 'WON');
  assert.strictEqual(settleMatchResultSelection('X2', 0, 2), 'WON');
  assert.strictEqual(settleMatchResultSelection('X2', 2, 0), 'LOST');
  assert.strictEqual(settleMatchResultSelection('12', 2, 0), 'WON');
  assert.strictEqual(settleMatchResultSelection('12', 0, 2), 'WON');
  assert.strictEqual(settleMatchResultSelection('12', 1, 1), 'LOST');
});

test('6. Ausencia de duplicados por ID estable', () => {
  const arr = deduplicateBoardEntries([{ id: 'a', odds: 2.0 }, { id: 'a', odds: 2.1 }, { id: 'b', odds: 1.5 }]);
  assert.strictEqual(arr.length, 2);
});

test('7. Métricas separadas para 1X2 vs Doble oportunidad (nunca combinadas)', () => {
  const m = computeSeparateMarketMetrics([
    { market: MARKET_1X2, outcome: 'WON', odds: 2.1, real_prob: 55, implied_prob_novig: 48 },
    { market: MARKET_DC, outcome: 'LOST', odds: 1.4, real_prob: 75, implied_prob_novig: 70 }
  ]);
  assert.strictEqual(m[MARKET_1X2].nSettled, 1);
  assert.strictEqual(m[MARKET_1X2].hitRatePct, 100);
  assert.strictEqual(m[MARKET_DC].nSettled, 1);
  assert.strictEqual(m[MARKET_DC].hitRatePct, 0);
  assert.strictEqual(m[MARKET_1X2].sampleConclusive, false);
});

test('8. Protección de RETO ESCALERA: 1X2 y Doble oportunidad en observación (no ingresan automáticamente)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_1x2_lad_'));
  const ladder = new ProspectiveLadderEngine({ statePath: path.join(dir, 'ladder.json') });
  const r1 = ladder.considerOpportunity({
    snapshotId: 's1', opportunityKey: 'k1', circuit: 'RETO_ESCALERA',
    match: 'Inter vs Stuttgart', market: MARKET_1X2, selection: 'Inter (1)', odds: 2.1,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  const r2 = ladder.considerOpportunity({
    snapshotId: 's2', opportunityKey: 'k2', circuit: 'RETO_ESCALERA',
    match: 'Inter vs Stuttgart', market: MARKET_DC, selection: '1X', odds: 1.38,
    elenaDecision: 'APROBADO', riskManagerDecision: 'APROBADO'
  });
  assert.strictEqual(r1.entered, false);
  assert.strictEqual(r2.entered, false);
  assert.ok(r1.reasons.some(x => x.includes('MARKET_OBSERVATION_ONLY_LADDER')));
  assert.ok(r2.reasons.some(x => x.includes('MARKET_OBSERVATION_ONLY_LADDER')));
  assert.strictEqual(ladder.getState().openBet, null);
  assert.strictEqual(ladder.getState().currentCapital, 50000);
});

test('9. Integridad de los 101 hashes SHA-256 históricos intactos', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0);
  assert.strictEqual(audit.intactCount, 101);
});

console.log(`\n=== RESULTADO 1X2 & DOBLE OPORTUNIDAD: ${passed} PASS | ${failed} FAIL ===\n`);
process.exit(failed > 0 ? 1 : 0);
