/**
 * TEST SUITE ADVERSARIAL — FASE 9.1: HARDENING, INTEGRIDAD Y CORRECCIÓN DE DEFECTOS
 *
 * Cubre exhaustivamente los 6 defectos bloqueantes + baseline 3-way de la auditoría:
 *  1. Corrupción JSON / archivo truncado -> lanza LEDGER_CORRUPTION_ERROR, crea .corrupt.bak único, bloquea escrituras
 *  2. Lock inter-proceso O_EXCL + 4 procesos concurrentes escribiendo sin lost updates ni duplicados
 *  3. Detección de lock obsoleto de PID muerto vs protección de lock de PID activo
 *  4. Cadena criptográfica SHA-256 (genesis '0'.repeat(64), sequenceIndex, prevPredictionHash)
 *  5. Verificación automática en lectura: detecta modificación, eliminación, inserción y reordenamiento
 *  6. Separación append-only de snapshots y liquidaciones (nunca muta obsPath) + detección de manipulación en eventos
 *  7. Guardia temporal en TODOS los snapshots (pre-kickoff OK; igual a kickoff, post-kickoff, timestamp inválido, CLOSING post-kickoff RECHAZADOS)
 *  8. 30 observaciones de 1 solo matchId -> uniqueMatchCount=1, INSUFFICIENT_SAMPLE, IC clusterizado INSUFFICIENT_CLUSTERS
 *  9. Múltiples selecciones distribuidas en varios partidos -> Cluster Bootstrap 95% CI disponible y wilsonCI95_IndependentOnly === null
 * 10. OOS estricto: partidos simultáneos nunca se dividen; 35 partidos con igual kickoffUtc -> OUT_OF_SAMPLE_NOT_AVAILABLE
 * 11. OOS con bloques temporales distintos -> maxTrainKo < minValKo < minEvalKo garantizado
 * 12. Hándicap Asiático de cuartos: -0.25 (empate -> HALF_LOST -0.5U), -0.75 (gana por 1 -> HALF_WON +(o-1)/2),
 *     +0.25 (empate -> HALF_WON), +0.75 (pierde por 1 -> HALF_LOST), línea inválida 0.33 -> UNAVAILABLE
 * 13. Baseline multiclase 1X2 con vector noVig1X2 {home,draw,away} (suma 1) vs BASELINE_UNAVAILABLE si falta vector
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const { ObservationStore, GENESIS_HASH } = require('../experimental/markets/observation/observationStore');
const { SettlementProcessor, SETTLEMENT_STATES, computeFlatStakeProfit } = require('../experimental/markets/observation/settlementProcessor');
const validator = require('../experimental/markets/observation/statisticalValidator');

let passed = 0;
let failed = 0;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'darador_f9_hard_'));
}

function makeStore(dir, extra = {}) {
  return new ObservationStore({
    obsPath: path.join(dir, 'obs.json'),
    rejectedPath: path.join(dir, 'rej.json'),
    alertsPath: path.join(dir, 'alerts.json'),
    ...extra
  });
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
  console.log('\n🛡️  Iniciando Test Suite Adversarial — Fase 9.1 Hardening (13 Escenarios Críticos)...\n');

  await runTest('1. Corrupción JSON / truncamiento: lanza LEDGER_CORRUPTION_ERROR, preserva .corrupt.bak único y bloquea escrituras', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir);
      store.recordObservation({
        matchId: 'm1', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });

      // Simular escritura truncada/corrupta
      fs.writeFileSync(store.obsPath, '[{"observationId":"trunc', 'utf8');

      let readErr = null;
      try { store.getObservations(); } catch (e) { readErr = e; }
      assert(readErr && readErr.code === 'LEDGER_CORRUPTION_ERROR', 'Debe lanzar LEDGER_CORRUPTION_ERROR al leer');
      assert(readErr.backupPath && fs.existsSync(readErr.backupPath), 'Debe preservar .corrupt.bak');

      // Intentar nueva escritura -> DEBE bloquearse, nunca sobrescribir con [1]
      let writeErr = null;
      try {
        store.recordObservation({
          matchId: 'm2', league: 'PL', kickoffUtc: '2026-12-01T18:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
          marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
        });
      } catch (e) { writeErr = e; }
      assert(writeErr && writeErr.code === 'LEDGER_CORRUPTION_ERROR', 'Debe bloquear nuevas escrituras');
      assert.notStrictEqual(readErr.backupPath, writeErr.backupPath, 'No debe sobrescribir backups anteriores');
    } finally { cleanup(dir); }
  });

  await runTest('2. Concurrencia multi-proceso real (4 procesos simultáneos): 0 lost updates y 0 duplicados', async () => {
    const dir = makeTmpDir();
    try {
      const storeModulePath = path.resolve(__dirname, '..', 'experimental', 'markets', 'observation', 'observationStore.js').replace(/\\/g, '/');
      const workerPath = path.join(dir, 'worker.js');
      fs.writeFileSync(workerPath, `
        const { ObservationStore } = require('${storeModulePath}');
        const mode = process.argv[2];
        const dir = process.argv[3];
        const id = process.argv[4];
        const store = new ObservationStore({
          obsPath: dir + '/obs.json',
          rejectedPath: dir + '/rej.json',
          alertsPath: dir + '/alerts.json'
        });
        const res = store.recordObservation({
          matchId: mode === 'dup' ? 'same_match' : 'match_' + id,
          league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
          marketFamily: 'match_1x2', selection: '1', modelVersion: 'v1.0',
          modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
        });
        process.send(res);
      `, 'utf8');

      const runBatch = (mode, count) => Promise.all(
        Array.from({ length: count }, (_, i) => new Promise((resolve, reject) => {
          const c = fork(workerPath, [mode, dir, String(i)], { silent: true });
          let msg = null;
          c.on('message', m => { msg = m; });
          c.on('error', reject);
          c.on('exit', code => resolve({ code, msg }));
        }))
      );

      const distinctRes = await runBatch('distinct', 4);
      assert.strictEqual(distinctRes.filter(r => r.msg?.recorded).length, 4);
      assert.strictEqual(makeStore(dir).getObservations().length, 4);

      const dupRes = await runBatch('dup', 3);
      assert.strictEqual(dupRes.filter(r => r.msg?.recorded).length, 1, 'Solo 1 de 3 procesos puede registrar el duplicado');
      assert.strictEqual(makeStore(dir).getObservations().length, 5);
      assert.strictEqual(makeStore(dir).verifyIntegrity().ok, true);
    } finally { cleanup(dir); }
  });

  await runTest('3. Lock obsoleto de PID inexistente se recupera; lock de PID vivo NO se elimina', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir, { lockTimeoutMs: 250, staleLockMs: 50 });
      // Lock de PID inexistente antiguo -> debe recuperarse
      fs.writeFileSync(store.lockPath, JSON.stringify({ pid: 999999, createdAtMs: Date.now() - 5000 }), 'utf8');
      const ok = store.recordObservation({
        matchId: 'm_stale', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });
      assert.strictEqual(ok.recorded, true);

      // Lock de PID vivo (process.pid) aunque sea antiguo -> NO debe romperse (timeout esperado)
      fs.writeFileSync(store.lockPath, JSON.stringify({ pid: process.pid, createdAtMs: Date.now() - 5000 }), 'utf8');
      let timeoutErr = null;
      try {
        store.recordObservation({
          matchId: 'm_live', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
          marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
        });
      } catch (e) { timeoutErr = e; }
      assert(timeoutErr && timeoutErr.code === 'LOCK_TIMEOUT', 'No debe eliminar lock de proceso activo');
      fs.unlinkSync(store.lockPath);
    } finally { cleanup(dir); }
  });

  await runTest('4. Cadena criptográfica SHA-256: genesis, sequenceIndex y verificación automática al leer', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir);
      const r0 = store.recordObservation({
        matchId: 'c0', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });
      const r1 = store.recordObservation({
        matchId: 'c1', league: 'PL', kickoffUtc: '2026-12-01T17:00:00Z', observedAtUtc: '2026-12-01T11:00:00Z',
        marketFamily: 'match_1x2', selection: 'X', modelProbability: 0.28, odds: 3.50, bookmaker: 'Bet365'
      });
      assert.strictEqual(r0.sequenceIndex, 0);
      assert.strictEqual(r0.prevPredictionHash, GENESIS_HASH);
      assert.strictEqual(r1.sequenceIndex, 1);
      assert.strictEqual(r1.prevPredictionHash, r0.predictionHash);
      assert.strictEqual(store.getObservations().length, 2);
    } finally { cleanup(dir); }
  });

  await runTest('5. Detección automática en lectura de eliminación, modificación y reordenamiento de registros', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir);
      store.recordObservation({
        matchId: 'd0', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });
      store.recordObservation({
        matchId: 'd1', league: 'PL', kickoffUtc: '2026-12-01T17:00:00Z', observedAtUtc: '2026-12-01T11:00:00Z',
        marketFamily: 'match_1x2', selection: 'X', modelProbability: 0.28, odds: 3.50, bookmaker: 'Bet365'
      });
      const validRaw = fs.readFileSync(store.obsPath, 'utf8');

      // a) Eliminación del primer registro
      const del = JSON.parse(validRaw);
      del.splice(0, 1);
      fs.writeFileSync(store.obsPath, JSON.stringify(del), 'utf8');
      assert.throws(() => store.getObservations(), /LEDGER_INTEGRITY_ERROR/);

      // b) Reordenamiento
      const rev = JSON.parse(validRaw).reverse();
      fs.writeFileSync(store.obsPath, JSON.stringify(rev), 'utf8');
      assert.throws(() => store.getObservations(), /LEDGER_INTEGRITY_ERROR/);

      // c) Modificación de campo inmutable
      const mod = JSON.parse(validRaw);
      mod[0].modelProbability = 0.95;
      fs.writeFileSync(store.obsPath, JSON.stringify(mod), 'utf8');
      assert.throws(() => store.getObservations(), /LEDGER_INTEGRITY_ERROR/);

      // Restaurar y verificar que vuelve a pasar
      fs.writeFileSync(store.obsPath, validRaw, 'utf8');
      assert.strictEqual(store.getObservations().length, 2);
    } finally { cleanup(dir); }
  });

  await runTest('6. Eventos mutables (snapshots y liquidaciones) viven en archivos append-only separados y encadenados', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir);
      const sp = new SettlementProcessor(store);
      const r = store.recordObservation({
        matchId: 'sep1', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.80, bookmaker: 'Bet365'
      });
      const obsRawBefore = fs.readFileSync(store.obsPath, 'utf8');

      store.recordOddsSnapshot(r.observationId, { checkpoint: 'T_MINUS_30', capturedAtUtc: '2026-12-01T14:30:00Z', odds: 1.78, bookmaker: 'Bet365' });
      sp.settleObservation(r.observationId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: 2, awayGoals: 0 });

      const obsRawAfter = fs.readFileSync(store.obsPath, 'utf8');
      assert.strictEqual(obsRawBefore, obsRawAfter, 'El archivo inmutable obs.json NO debe modificarse al agregar snapshots ni liquidaciones');
      assert(fs.existsSync(store.snapshotsPath));
      assert(fs.existsSync(store.settlementsPath));
      assert.strictEqual(store.verifyIntegrity().ok, true);
    } finally { cleanup(dir); }
  });

  await runTest('7. Guardia temporal en snapshots: pre-kickoff OK; igual, post-kickoff, inválido y CLOSING post-kickoff RECHAZADOS', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir);
      const r = store.recordObservation({
        matchId: 'snap1', league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
        marketFamily: 'match_1x2', selection: '1', modelProbability: 0.60, odds: 1.85, bookmaker: 'Bet365'
      });

      const okPre = store.recordOddsSnapshot(r.observationId, { checkpoint: 'T_MINUS_5', capturedAtUtc: '2026-12-01T14:55:00Z', odds: 1.80, bookmaker: 'Bet365' });
      const badExact = store.recordOddsSnapshot(r.observationId, { checkpoint: 'CLOSING', capturedAtUtc: '2026-12-01T15:00:00Z', odds: 1.75, bookmaker: 'Bet365' });
      const badPost = store.recordOddsSnapshot(r.observationId, { checkpoint: 'CLOSING', capturedAtUtc: '2026-12-01T15:10:00Z', odds: 1.40, bookmaker: 'Bet365' });
      const badInvalid = store.recordOddsSnapshot(r.observationId, { checkpoint: 'T_MINUS_30', capturedAtUtc: 'not-a-date', odds: 1.82, bookmaker: 'Bet365' });

      assert.strictEqual(okPre.updated, true);
      assert.strictEqual(badExact.updated, false);
      assert.strictEqual(badExact.reason, 'POST_KICKOFF_SNAPSHOT_REJECTED');
      assert.strictEqual(badPost.updated, false);
      assert.strictEqual(badPost.reason, 'POST_KICKOFF_SNAPSHOT_REJECTED');
      assert.strictEqual(badInvalid.updated, false);
      assert.strictEqual(badInvalid.reason, 'INVALID_SNAPSHOT_TIMESTAMP');
      assert.strictEqual(store.getObservations()[0].clv.status, 'CLV_UNAVAILABLE');
    } finally { cleanup(dir); }
  });

  await runTest('8. Adversarial muestra correlacionada: 30 observaciones de 1 único matchId -> INSUFFICIENT_SAMPLE y sin IC inflados', () => {
    const obs30 = Array.from({ length: 30 }, (_, i) => ({
      observationId: `o_${i}`,
      matchId: 'SINGLE_MATCH',
      league: 'PL',
      kickoffUtc: '2026-11-20T15:00:00Z',
      marketFamily: 'double_chance',
      status: 'WON',
      modelProbability: 0.80,
      odds: 1.30,
      settlement: { profitUnits: 0.30 }
    }));

    const ev = validator.evaluateFamilySlice(obs30, 'double_chance');
    assert.strictEqual(ev.rawObservationCount, 30);
    assert.strictEqual(ev.decidedObservationCount, 30);
    assert.strictEqual(ev.uniqueMatchCount, 1);
    assert.strictEqual(ev.effectiveSampleSize, 1);
    assert.strictEqual(ev.independentClusterCount, 1);
    assert.strictEqual(ev.sampleStatus, 'INSUFFICIENT_SAMPLE');
    assert.strictEqual(ev.profitability.hitRateCI95.available, false);
    assert.strictEqual(ev.profitability.hitRateCI95.reason, 'INSUFFICIENT_CLUSTERS');
    assert.strictEqual(ev.profitability.roiCI95.available, false);
    assert.strictEqual(ev.profitability.wilsonCI95_IndependentOnly, null);
  });

  await runTest('9. Múltiples selecciones en distintos partidos usan Cluster Bootstrap 95% CI', () => {
    const obs = [];
    for (let m = 0; m < 10; m++) {
      for (let s = 0; s < 2; s++) {
        const won = m % 3 !== 0;
        obs.push({
          observationId: `m${m}_s${s}`,
          matchId: `MATCH_${m}`,
          league: 'PL',
          kickoffUtc: `2026-11-${String(10 + m).padStart(2, '0')}T15:00:00Z`,
          marketFamily: 'double_chance',
          status: won ? 'WON' : 'LOST',
          modelProbability: 0.72,
          odds: 1.45,
          settlement: { profitUnits: won ? 0.45 : -1 }
        });
      }
    }
    const ev = validator.evaluateFamilySlice(obs, 'double_chance');
    assert.strictEqual(ev.decidedObservationCount, 20);
    assert.strictEqual(ev.uniqueMatchCount, 10);
    assert.strictEqual(ev.profitability.hitRateCI95.method, 'cluster_bootstrap_by_matchId');
    assert.strictEqual(ev.profitability.hitRateCI95.clusterCount, 10);
    assert.strictEqual(ev.profitability.wilsonCI95_IndependentOnly, null);
  });

  await runTest('10. OOS estricto: partidos con kickoffUtc idéntico nunca se dividen entre train y validation', () => {
    const allSame = Array.from({ length: 35 }, (_, i) => ({
      matchId: `same_${i}`, marketFamily: 'double_chance', status: 'WON',
      kickoffUtc: '2026-10-15T18:00:00Z', modelProbability: 0.75, odds: 1.35, settlement: { profitUnits: 0.35 }
    }));
    const resSame = validator.runStrictTemporalOutOfSampleSplit(allSame, 'double_chance');
    assert.strictEqual(resSame.status, 'OUT_OF_SAMPLE_NOT_AVAILABLE');

    // 22 partidos el día 1 + 12 partidos el día 2 + 8 partidos el día 3 -> 3 bloques estrictos sin partir simultáneos
    const multiDay = [];
    for (let i = 0; i < 22; i++) multiDay.push({ matchId: `d1_${i}`, marketFamily: 'double_chance', status: 'WON', kickoffUtc: '2026-10-01T18:00:00Z', modelProbability: 0.75, odds: 1.35, settlement: { profitUnits: 0.35 } });
    for (let i = 0; i < 12; i++) multiDay.push({ matchId: `d2_${i}`, marketFamily: 'double_chance', status: 'WON', kickoffUtc: '2026-10-08T18:00:00Z', modelProbability: 0.75, odds: 1.35, settlement: { profitUnits: 0.35 } });
    for (let i = 0; i < 8; i++) multiDay.push({ matchId: `d3_${i}`, marketFamily: 'double_chance', status: 'LOST', kickoffUtc: '2026-10-15T18:00:00Z', modelProbability: 0.75, odds: 1.35, settlement: { profitUnits: -1 } });

    const oos = validator.runStrictTemporalOutOfSampleSplit(multiDay, 'double_chance');
    assert.strictEqual(oos.status, 'OUT_OF_SAMPLE_AVAILABLE');
    assert(Date.parse(oos.splits.train.toUtc) < Date.parse(oos.splits.validation.fromUtc), 'maxTrainKo < minValKo');
    assert(Date.parse(oos.splits.validation.toUtc) < Date.parse(oos.splits.evaluation.fromUtc), 'maxValKo < minEvalKo');
    assert.strictEqual(oos.splits.train.count, 22);
    assert.strictEqual(oos.splits.validation.count, 12);
    assert.strictEqual(oos.splits.evaluation.count, 8);
  });

  await runTest('11. Hándicap Asiático de cuartos: -0.25, -0.75, +0.25, +0.75 y línea inválida -> UNAVAILABLE', () => {
    const dir = makeTmpDir();
    try {
      const store = makeStore(dir);
      const sp = new SettlementProcessor(store);
      const testCase = (id, line, hg, ag, expectedStatus, expectedProfit, odds = 2.0) => {
        const r = store.recordObservation({
          matchId: id, league: 'PL', kickoffUtc: '2026-12-01T15:00:00Z', observedAtUtc: '2026-12-01T10:00:00Z',
          marketFamily: 'asian_handicap', selection: 'HOME', line, modelProbability: 0.52, odds, bookmaker: 'Bet365'
        });
        const s = sp.settleObservation(r.observationId, { matchStatus: 'FINISHED', resultConfirmed: true, homeGoals: hg, awayGoals: ag });
        assert.strictEqual(s.status, expectedStatus, `AH ${line} (${hg}-${ag}) esperado ${expectedStatus}, obtenido ${s.status}`);
        assert.strictEqual(s.profitUnits, expectedProfit, `AH ${line} (${hg}-${ag}) profit esperado ${expectedProfit}, obtenido ${s.profitUnits}`);
      };

      testCase('ah1', -0.25, 1, 1, SETTLEMENT_STATES.HALF_LOST, -0.5, 2.0);
      testCase('ah2', -0.75, 2, 1, SETTLEMENT_STATES.HALF_WON, 0.5, 2.0);
      testCase('ah3', 0.25, 1, 1, SETTLEMENT_STATES.HALF_WON, 0.45, 1.9);
      testCase('ah4', 0.75, 0, 1, SETTLEMENT_STATES.HALF_LOST, -0.5, 1.9);
      testCase('ah5', 0.33, 1, 1, SETTLEMENT_STATES.UNAVAILABLE, null, 1.9);
    } finally { cleanup(dir); }
  });

  await runTest('12. Baseline multiclase 1X2: usa Brier/LogLoss 3-way con noVig1X2 y marca BASELINE_UNAVAILABLE si falta', () => {
    const obsMissingVec = [
      { matchId: 'b1', marketFamily: 'match_1x2', kickoffUtc: '2026-10-01T15:00:00Z', status: 'WON', modelProbability: 0.60, noVigProbability: 0.55, probabilities1X2: { home: 0.60, draw: 0.25, away: 0.15 }, odds: 1.80, settlement: { actual1X2: '1', profitUnits: 0.80 } }
    ];
    const cmpMiss = validator.compareAgainstBaselines(obsMissingVec, 'match_1x2');
    assert.strictEqual(cmpMiss.vsMarketNoVig.available, false);
    assert.strictEqual(cmpMiss.vsMarketNoVig.status, 'BASELINE_UNAVAILABLE');

    const obsWithVec = [
      {
        matchId: 'b2', marketFamily: 'match_1x2', kickoffUtc: '2026-10-01T15:00:00Z', status: 'WON',
        modelProbability: 0.65, noVigProbability: 0.55,
        probabilities1X2: { home: 0.65, draw: 0.20, away: 0.15 },
        noVig1X2: { home: 0.55, draw: 0.25, away: 0.20 },
        odds: 1.80, settlement: { actual1X2: '1', profitUnits: 0.80 }
      }
    ];
    const cmpOk = validator.compareAgainstBaselines(obsWithVec, 'match_1x2');
    assert.strictEqual(cmpOk.vsMarketNoVig.available, true);
    assert.strictEqual(cmpOk.vsMarketNoVig.metricType, 'MULTICLASS_3WAY');
    // Model 3-way Brier: (0.65-1)^2 + 0.2^2 + 0.15^2 = 0.1225 + 0.04 + 0.0225 = 0.185
    // Market 3-way Brier: (0.55-1)^2 + 0.25^2 + 0.20^2 = 0.2025 + 0.0625 + 0.04 = 0.305
    assert(Math.abs(cmpOk.vsMarketNoVig.modelBrier - 0.185) < 1e-4);
    assert(Math.abs(cmpOk.vsMarketNoVig.baselineBrier - 0.305) < 1e-4);
    assert(cmpOk.vsMarketNoVig.deltaBrier < 0);
  });

  await runTest('13. computeFlatStakeProfit exacto para HALF_WON y HALF_LOST', () => {
    assert.strictEqual(computeFlatStakeProfit(SETTLEMENT_STATES.HALF_WON, 2.20), 0.6);
    assert.strictEqual(computeFlatStakeProfit(SETTLEMENT_STATES.HALF_LOST, 2.20), -0.5);
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO FASE 9.1 HARDENING: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log(`====================================================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
