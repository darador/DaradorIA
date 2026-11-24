/**
 * DARADORBET — SUITE DE TESTS: PROTECCIÓN TEMPORAL DE ELENA Y GUARDAS POST-KICKOFF
 *
 * Verifica:
 * 1. Evaluación justo antes del kickoff: permitida.
 * 2. Evaluación exactamente en kickoff: bloqueada.
 * 3. Evaluación después del kickoff: bloqueada.
 * 4. Partido finalizado: bloqueada.
 * 5. Horario no confirmado: no expirar automáticamente.
 * 6. Intento de reaprobar una selección expirada: bloqueado irreversiblemente.
 * 7. RiskManager rechazando aprobación tardía aunque LineupWatcher no haya actuado.
 * 8. Exportador syncRadar sin pendientes vencidos y preservando históricos.
 * 9. Frontend (index.html y dashboard.html) mostrando Elena: Expirada con tooltip.
 * 10. Históricos y 101 hashes SHA-256 intactos.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lineupWatcher = require('../scheduler/lineupWatcher');
const riskManager = require('../agents/riskManager');
const storage = require('../data/storage');
const syncRadar = require('../data/syncRadar');
const integrityGuard = require('../audit/integrityGuard');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

function makeGoodPrediction() {
  return {
    ev: 0.14,
    evPercentage: 14.0,
    uncertaintyIndex: 0.12,
    pProjected: 0.65,
    modelDivergence: 0.04
  };
}

function makeGoodReports() {
  return {
    playerAnalyst: { recommendation: 'FAVORABLE', risks: [] },
    teamAnalyst: { recommendation: 'FAVORABLE', risks: [] },
    matchContext: { recommendation: 'FAVORABLE' },
    oddsAnalyst: { recommendation: 'FAVORABLE' },
    matchIntel: { structuredSignals: { newsRiskDetected: false } }
  };
}

function extractFrontendFunctions(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const startIdx = html.indexOf('function getPickKickoffMeta(');
  const endIdx = html.indexOf('function resolveSportsResult(');
  assert(startIdx > 0 && endIdx > startIdx, `No se encontraron funciones en ${htmlPath}`);
  const snippet = `
    const TIMEZONE_ARGENTINA = 'America/Argentina/Buenos_Aires';
    ${html.slice(startIdx, endIdx)}
    module.exports = { getPickKickoffMeta, resolveMatchPhase, resolveElenaDecision };
  `;
  const sandbox = { module: { exports: {} }, Intl, Date, String, Number, Boolean };
  vm.runInNewContext(snippet, sandbox);
  return sandbox.module.exports;
}

(async () => {
  console.log('\n=== TEST SUITE: PROTECCIÓN TEMPORAL DE ELENA Y POST-KICKOFF ===\n');

  const KICKOFF_ISO = '2026-11-24T17:45:00.000Z';
  const KICKOFF_TS = new Date(KICKOFF_ISO).getTime();

  // Backup in-memory/file state for isolated LineupWatcher tests
  const origGetCandidates = storage.getCandidates.bind(storage);
  const origSaveCandidate = storage.saveCandidate.bind(storage);
  const origSaveApprovedPick = storage.saveApprovedPick.bind(storage);
  const origSaveRejectedPick = storage.saveRejectedPick.bind(storage);

  let mockCandidates = [];
  let savedApproved = [];

  function installStorageMocks(cands) {
    mockCandidates = cands.map(c => ({ ...c }));
    savedApproved = [];
    storage.getCandidates = () => mockCandidates;
    storage.saveCandidate = (cand) => {
      const idx = mockCandidates.findIndex(c => c.id === cand.id);
      if (idx >= 0) mockCandidates[idx] = { ...cand };
      else mockCandidates.push({ ...cand });
      return cand;
    };
    storage.saveApprovedPick = (pick, opts) => {
      // Ejecutar la validación real de saveApprovedPick sin escribir a disco
      const origRead = storage._readCollection.bind(storage);
      const origWrite = storage._writeCollection.bind(storage);
      storage._readCollection = () => [];
      storage._writeCollection = () => {};
      try {
        const res = origSaveApprovedPick(pick, opts);
        savedApproved.push(res);
        return res;
      } finally {
        storage._readCollection = origRead;
        storage._writeCollection = origWrite;
      }
    };
    storage.saveRejectedPick = (cand) => cand;
  }

  function restoreStorageMocks() {
    storage.getCandidates = origGetCandidates;
    storage.saveCandidate = origSaveCandidate;
    storage.saveApprovedPick = origSaveApprovedPick;
    storage.saveRejectedPick = origSaveRejectedPick;
  }

  // 1. Evaluación justo antes del kickoff: permitida
  await test('1. Evaluación justo antes del kickoff (T-1 min): permitida', async () => {
    const now = KICKOFF_TS - 60 * 1000;
    const cand = {
      id: 'cand_test_before_ko',
      matchId: 'match_t1',
      player: 'Aaron Wan-Bissaka',
      status: 'PENDIENTE_ALINEACION',
      eventDateUtc: KICKOFF_ISO,
      bookmakerOdds: 1.65,
      sampleSize: 15,
      researchData: { lineupData: { status: 'CONFIRMADA' } }
    };
    installStorageMocks([cand]);
    try {
      const res = await lineupWatcher.checkPendingLineups({
        candidateIds: [cand.id],
        now,
        skipSync: true,
        mockLineups: { match_t1: { starters: ['Aaron Wan-Bissaka'], bench: [] } }
      });
      assert.strictEqual(res.promotedCount, 1);
      assert.strictEqual(res.expiredCount, 0);
      assert.strictEqual(savedApproved.length, 1);
      assert.strictEqual(mockCandidates[0].status, 'APROBADO');

      const verdict = await riskManager.evaluate(cand, makeGoodPrediction(), makeGoodReports(), { now });
      assert.strictEqual(verdict.finalStatus, 'APROBADO');
    } finally {
      restoreStorageMocks();
    }
  });

  // 2. Evaluación exactamente en kickoff: bloqueada
  await test('2. Evaluación exactamente en kickoff (now === kickoffTs): bloqueada', async () => {
    const now = KICKOFF_TS;
    const cand = {
      id: 'cand_test_exact_ko',
      matchId: 'match_t2',
      player: 'Aaron Wan-Bissaka',
      status: 'PENDIENTE_ALINEACION',
      eventDateUtc: KICKOFF_ISO,
      bookmakerOdds: 1.65,
      sampleSize: 15,
      researchData: { lineupData: { status: 'CONFIRMADA' } }
    };
    installStorageMocks([cand]);
    try {
      const res = await lineupWatcher.checkPendingLineups({
        candidateIds: [cand.id],
        now,
        skipSync: true,
        mockLineups: { match_t2: { startingXI: ['Aaron Wan-Bissaka'], bench: [] } }
      });
      assert.strictEqual(res.promotedCount, 0);
      assert.strictEqual(res.expiredCount, 1);
      assert.strictEqual(savedApproved.length, 0);
      assert.strictEqual(mockCandidates[0].status, 'EXPIRADO_SIN_EVALUACION');
      assert.strictEqual(mockCandidates[0].checkpointStatus, 'MISSED');
      assert.strictEqual(mockCandidates[0].evaluationStatus, 'EXPIRED');
      assert.strictEqual(mockCandidates[0].evaluationExpired, true);
      assert.ok(mockCandidates[0].expiredAtUtc);

      const verdict = await riskManager.evaluate({ ...cand, status: 'PENDIENTE_ALINEACION', evaluationExpired: false }, makeGoodPrediction(), makeGoodReports(), { now });
      assert.strictEqual(verdict.finalStatus, 'RECHAZADO');
      assert.strictEqual(verdict.temporalVeto, true);
    } finally {
      restoreStorageMocks();
    }
  });

  // 3. Evaluación después del kickoff: bloqueada
  await test('3. Evaluación después del kickoff (T+15 min): bloqueada', async () => {
    const now = KICKOFF_TS + 15 * 60 * 1000;
    const cand = {
      id: 'cand_test_after_ko',
      matchId: 'match_t3',
      player: 'Aaron Wan-Bissaka',
      status: 'PENDIENTE_ALINEACION',
      eventDateUtc: KICKOFF_ISO,
      bookmakerOdds: 1.65,
      sampleSize: 15,
      researchData: { lineupData: { status: 'CONFIRMADA' } }
    };
    installStorageMocks([cand]);
    try {
      const res = await lineupWatcher.checkPendingLineups({
        candidateIds: [cand.id],
        now,
        skipSync: true,
        mockLineups: { match_t3: { startingXI: ['Aaron Wan-Bissaka'], bench: [] } }
      });
      assert.strictEqual(res.promotedCount, 0);
      assert.strictEqual(res.expiredCount, 1);
      assert.strictEqual(mockCandidates[0].status, 'EXPIRADO_SIN_EVALUACION');
    } finally {
      restoreStorageMocks();
    }
  });

  // 4. Partido finalizado: bloqueada
  await test('4. Partido finalizado (is_finished: true): bloqueada', async () => {
    const now = KICKOFF_TS - 30 * 60 * 1000; // incluso si reloj local difiere, is_finished bloquea
    const cand = {
      id: 'cand_test_finished',
      matchId: 'match_t4',
      player: 'Aaron Wan-Bissaka',
      status: 'PENDIENTE_ALINEACION',
      is_finished: true,
      bookmakerOdds: 1.65,
      sampleSize: 15,
      researchData: { lineupData: { status: 'CONFIRMADA' } }
    };
    installStorageMocks([cand]);
    try {
      const res = await lineupWatcher.checkPendingLineups({
        candidateIds: [cand.id],
        now,
        skipSync: true,
        mockLineups: { match_t4: { startingXI: ['Aaron Wan-Bissaka'], bench: [] } }
      });
      assert.strictEqual(res.promotedCount, 0);
      assert.strictEqual(res.expiredCount, 1);
      assert.strictEqual(mockCandidates[0].status, 'EXPIRADO_SIN_EVALUACION');
      assert.ok(mockCandidates[0].expirationReason.includes('PARTIDO_FINALIZADO'));

      const verdict = await riskManager.evaluate({ ...cand, status: 'PENDIENTE_ALINEACION', evaluationExpired: false }, makeGoodPrediction(), makeGoodReports(), { now });
      assert.strictEqual(verdict.finalStatus, 'RECHAZADO');
      assert.strictEqual(verdict.temporalVeto, true);
    } finally {
      restoreStorageMocks();
    }
  });

  // 5. Horario no confirmado: no expirar automáticamente
  await test('5. Horario no confirmado (sin kickoffUtc y !is_finished): no expira automáticamente', async () => {
    const now = KICKOFF_TS + 60 * 60 * 1000;
    const cand = {
      id: 'cand_test_unconfirmed_time',
      matchId: 'match_t5',
      player: 'Jugador Sin Hora',
      status: 'PENDIENTE_ALINEACION',
      elena_decision: 'PENDIENTE_ALINEACION',
      is_finished: false
    };
    installStorageMocks([cand]);
    try {
      const res = await lineupWatcher.checkPendingLineups({
        candidateIds: [cand.id],
        now,
        skipSync: true,
        mockLineups: {} // sin planilla todavía
      });
      assert.strictEqual(res.expiredCount, 0);
      assert.strictEqual(mockCandidates[0].status, 'PENDIENTE_ALINEACION');

      const exported = syncRadar._applyTemporalExpirationIfNeeded(cand, now);
      assert.strictEqual(exported.status, 'PENDIENTE_ALINEACION');
      assert.strictEqual(exported.elena_decision, 'PENDIENTE_ALINEACION');
    } finally {
      restoreStorageMocks();
    }
  });

  // 6. Intento de reaprobar una selección expirada: bloqueado irreversiblemente
  await test('6. Intento de reaprobar selección expirada: bloqueado irreversiblemente', async () => {
    const now = KICKOFF_TS - 30 * 60 * 1000; // incluso simulando reloj anterior
    const expiredCand = {
      id: 'cand_test_reapprove',
      matchId: 'match_t6',
      player: 'Aaron Wan-Bissaka',
      status: 'EXPIRADO_SIN_EVALUACION',
      elena_decision: 'EXPIRADO_SIN_EVALUACION',
      evaluationExpired: true,
      evaluationStatus: 'EXPIRED',
      checkpointStatus: 'MISSED',
      eventDateUtc: KICKOFF_ISO,
      bookmakerOdds: 1.65,
      sampleSize: 15,
      researchData: { lineupData: { status: 'CONFIRMADA' } }
    };
    installStorageMocks([expiredCand]);
    try {
      const res = await lineupWatcher.checkPendingLineups({
        candidateIds: [expiredCand.id],
        now,
        skipSync: true,
        mockLineups: { match_t6: { startingXI: ['Aaron Wan-Bissaka'], bench: [] } }
      });
      assert.strictEqual(res.promotedCount, 0);
      assert.strictEqual(res.expiredCount, 1);
      assert.strictEqual(mockCandidates[0].status, 'EXPIRADO_SIN_EVALUACION');

      const verdict = await riskManager.evaluate(expiredCand, makeGoodPrediction(), makeGoodReports(), { now });
      assert.strictEqual(verdict.finalStatus, 'EXPIRADO_SIN_EVALUACION');
      assert.strictEqual(verdict.temporalVeto, true);
      assert.ok(verdict.blockedApprovalAttempt);
      assert.ok(verdict.finalReason.includes('IRREVERSIBLE'));

      let threw = false;
      try {
        storage.saveApprovedPick(expiredCand, { now });
      } catch (e) {
        threw = e.message.includes('TEMPORAL_GUARD_BLOCKED');
      }
      assert.strictEqual(threw, true, 'storage.saveApprovedPick debe bloquear selección expirada');
    } finally {
      restoreStorageMocks();
    }
  });

  // 7. RiskManager rechazando aprobación tardía aunque LineupWatcher no haya actuado
  await test('7. RiskManager rechaza aprobación tardía aunque LineupWatcher no haya actuado', async () => {
    const now = KICKOFF_TS + 10 * 60 * 1000;
    const cand = {
      id: 'cand_test_rm_independent',
      player: 'Aaron Wan-Bissaka',
      status: 'PENDIENTE_ALINEACION',
      eventDateUtc: KICKOFF_ISO,
      bookmakerOdds: 1.65,
      sampleSize: 15,
      researchData: { lineupData: { status: 'CONFIRMADA' } }
    };
    const verdict = await riskManager.evaluate(cand, makeGoodPrediction(), makeGoodReports(), { now });
    assert.strictEqual(verdict.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdict.temporalVeto, true);
    assert.strictEqual(verdict.checkpointStatus, 'MISSED');
    assert.strictEqual(verdict.evaluationStatus, 'EXPIRED');
    assert.ok(verdict.finalReason.includes('VETO TEMPORAL POST-KICKOFF'));
  });

  // 8. Exportador sin pendientes vencidos + preservación de históricos
  await test('8. Exportador syncRadar expira pendientes vencidos y preserva históricos', async () => {
    const now = KICKOFF_TS + 148 * 60 * 1000;
    const pendingExpired = {
      id: 'cand_wan_bissaka',
      eventDateUtc: KICKOFF_ISO,
      status: 'PENDIENTE_ALINEACION',
      elena_decision: 'PENDIENTE_ALINEACION',
      is_settled: false
    };
    const out = syncRadar._applyTemporalExpirationIfNeeded(pendingExpired, now);
    assert.strictEqual(out.status, 'EXPIRADO_SIN_EVALUACION');
    assert.strictEqual(out.elena_decision, 'EXPIRADO_SIN_EVALUACION');
    assert.strictEqual(out.checkpointStatus, 'MISSED');
    assert.strictEqual(out.evaluationStatus, 'EXPIRED');
    assert.ok(out.expiredAtUtc);
    assert.ok(out.expirationReason);

    const historicalSettled = {
      id: 'cand_hist_settled',
      eventDateUtc: KICKOFF_ISO,
      status: 'ACERTADA',
      elena_decision: 'APROBADO',
      is_settled: true
    };
    const outHist = syncRadar._applyTemporalExpirationIfNeeded(historicalSettled, now);
    assert.strictEqual(outHist.status, 'ACERTADA');
    assert.strictEqual(outHist.elena_decision, 'APROBADO');
  });

  // 9. Frontend mostrando estado expirado (index.html y dashboard.html)
  await test('9. Frontend (index.html y dashboard.html) muestra Elena: Expirada post-kickoff', async () => {
    const root = path.join(__dirname, '..', '..');
    for (const fname of ['index.html', 'dashboard.html']) {
      const { getPickKickoffMeta, resolveElenaDecision } = extractFrontendFunctions(path.join(root, fname));
      const pick = {
        id: 'cand_real_statshub_20261124_wan_bissaka_tackles',
        eventDateUtc: KICKOFF_ISO,
        status: 'PENDIENTE_ALINEACION',
        elena_decision: 'PENDIENTE_ALINEACION'
      };

      // Antes del kickoff -> PENDIENTE_EVALUACION
      const metaPre = getPickKickoffMeta(pick, KICKOFF_TS - 30 * 60 * 1000);
      const decPre = resolveElenaDecision(pick, metaPre);
      assert.strictEqual(decPre.code, 'PENDIENTE_EVALUACION', `${fname} pre-kickoff`);

      // En curso -> EXPIRADO
      const metaLive = getPickKickoffMeta(pick, KICKOFF_TS + 20 * 60 * 1000);
      const decLive = resolveElenaDecision(pick, metaLive);
      assert.strictEqual(decLive.code, 'EXPIRADO', `${fname} en curso`);
      assert.ok(decLive.badgeHtml.includes('Elena: Expirada'), `${fname} badge en curso`);
      assert.ok(decLive.badgeHtml.includes('data-tooltip='), `${fname} tooltip en curso`);

      // Finalizado -> EXPIRADO
      const metaFin = getPickKickoffMeta(pick, KICKOFF_TS + 148 * 60 * 1000);
      const decFin = resolveElenaDecision(pick, metaFin);
      assert.strictEqual(decFin.code, 'EXPIRADO', `${fname} finalizado`);
      assert.ok(decFin.badgeHtml.includes('Elena: Expirada'), `${fname} badge finalizado`);
    }
  });

  // 10. Históricos y 101 hashes SHA-256 intactos
  await test('10. Integridad de registros históricos y 101 hashes SHA-256 intactos', async () => {
    const tracker = require('../prediction/observationTracker');
    const audit = tracker.verifyIntegrity();
    assert.strictEqual(audit.alteredCount, 0, `Se detectaron ${audit.alteredCount} registros alterados`);
    assert.strictEqual(audit.violations.length, 0, 'Se detectaron violaciones de integridad SHA-256');
    assert.strictEqual(audit.intactCount, 101, `Se esperaban 101 hashes intactos, se obtuvieron ${audit.intactCount}`);
  });

  console.log(`\n=== RESULTADO: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
