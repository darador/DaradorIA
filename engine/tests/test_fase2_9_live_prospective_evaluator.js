import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  initProspectiveStore,
  loadProspectiveStore,
  ingestProspectiveCandidate,
  computeCanonicalPayloadHash
} from '../experimental/liveProspectiveCapturer.js';
import {
  LiveProspectiveEvaluator,
  registerMatchOutcome
} from '../experimental/liveProspectiveEvaluator.js';
import { MatchOutcomeResolver } from '../experimental/matchOutcomeResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PROSP_PATH = path.resolve(__dirname, '../storage_data/test_fase2_9_prospective.json');
const TEST_OUTCOMES_PATH = path.resolve(__dirname, '../storage_data/test_fase2_9_outcomes.json');

function cleanup() {
  if (fs.existsSync(TEST_PROSP_PATH)) fs.unlinkSync(TEST_PROSP_PATH);
  if (fs.existsSync(TEST_OUTCOMES_PATH)) fs.unlinkSync(TEST_OUTCOMES_PATH);
}

async function runTestSuite() {
  console.log('=== [PHASE 2.9 TEST SUITE: LIVE PROSPECTIVE EVALUATOR] ===\n');
  cleanup();

  initProspectiveStore(TEST_PROSP_PATH);
  const outcomeResolver = new MatchOutcomeResolver({ outcomesStorePath: TEST_OUTCOMES_PATH });
  const evaluator = new LiveProspectiveEvaluator({
    prospectiveStorePath: TEST_PROSP_PATH,
    outcomesStorePath: TEST_OUTCOMES_PATH
  });

  const baseKickoff = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const baseTime = new Date(Date.now() - 3600 * 1000).toISOString();

  // Test 1: Snapshot Inicial
  console.log('Test 1: Snapshot inicial capture...');
  const cand1 = {
    candidateId: 'T29_MATCH1_O25',
    matchId: 'match_t29_001',
    eventKickoff: baseKickoff,
    sourceEventTimestamp: baseTime,
    dataCutoffTimestamp: baseTime,
    ingestedAt: baseTime,
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.5,
    odds: 1.80,
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 6,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.5714,
    probabilityV22: 0.6000,
    fairOddsV1: 1.750,
    fairOddsV22: 1.667,
    evV1: 0.0285,
    evV22: 0.0800,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: baseTime
  };
  const res1 = ingestProspectiveCandidate(cand1, TEST_PROSP_PATH);
  assert.strictEqual(res1.action, 'INGESTED_SUCCESSFULLY');
  console.log('✓ Snapshot inicial correctamente registrado.');

  // Test 2 & 3: Cambio de cuota y múltiples cambios de cuota
  console.log('\nTest 2 & 3: Múltiples cambios de cuotas antes del kickoff...');
  const cand1Update1 = {
    ...cand1,
    odds: 1.85,
    ingestedAt: new Date(Date.now() - 1800 * 1000).toISOString()
  };
  const resUp1 = ingestProspectiveCandidate(cand1Update1, TEST_PROSP_PATH);
  assert.strictEqual(resUp1.action, 'UPDATED_SNAPSHOT');
  assert.strictEqual(resUp1.snapshotVersion, 2);

  const cand1Update2 = {
    ...cand1,
    odds: 1.90,
    ingestedAt: new Date(Date.now() - 900 * 1000).toISOString()
  };
  const resUp2 = ingestProspectiveCandidate(cand1Update2, TEST_PROSP_PATH);
  assert.strictEqual(resUp2.action, 'UPDATED_SNAPSHOT');
  assert.strictEqual(resUp2.snapshotVersion, 3);
  console.log('✓ Evolución de snapshots (v1 -> v2 -> v3) preservada sin sobreescribir original.');

  // Test 13: Exclusión de snapshots reemplazados del conteo de candidatos únicos
  console.log('\nTest 13: Exclusión de snapshots reemplazados del conteo único...');
  const auditSnapshots = evaluator.auditSnapshotIntegrity();
  assert.strictEqual(auditSnapshots.totalRecords, 3);
  assert.strictEqual(auditSnapshots.supersededCount, 2);
  assert.strictEqual(auditSnapshots.uniqueCandidateCount, 1);
  console.log(`✓ 3 snapshots totales corresponden a exactamente 1 candidato único (2 superseded).`);

  // Test Policies: FIRST_CAPTURE vs LAST_VALID_PRE_KICKOFF
  console.log('\nTest Policies: Verificación de políticas FIRST_CAPTURE vs LAST_VALID_PRE_KICKOFF...');
  const evFirst = evaluator.resolveEvaluations('FIRST_CAPTURE');
  const evLast = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  assert.strictEqual(evFirst[0].odds, 1.80);
  assert.strictEqual(evLast[0].odds, 1.90);
  console.log(`✓ FIRST_CAPTURE usa cuota ${evFirst[0].odds} y LAST_VALID_PRE_KICKOFF usa cuota ${evLast[0].odds}.`);

  // Test 12: Candidato con dos mercados del mismo partido
  console.log('\nTest 12: Candidatos con dos mercados del mismo partido...');
  const cand1Market2 = {
    candidateId: 'T29_MATCH1_DC_X2',
    matchId: 'match_t29_001',
    eventKickoff: baseKickoff,
    sourceEventTimestamp: baseTime,
    dataCutoffTimestamp: baseTime,
    ingestedAt: baseTime,
    market: 'DOUBLE_CHANCE',
    selection: 'DRAW_OR_AWAY',
    line: 0.5,
    odds: 1.50,
    historicalContract: 'BINARY_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 7,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.6429,
    probabilityV22: 0.6600,
    fairOddsV1: 1.556,
    fairOddsV22: 1.515,
    evV1: -0.0356,
    evV22: -0.0100,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: baseTime
  };
  ingestProspectiveCandidate(cand1Market2, TEST_PROSP_PATH);
  const audit2Mkts = evaluator.auditSnapshotIntegrity();
  assert.strictEqual(audit2Mkts.uniqueCandidateCount, 2);
  console.log('✓ Dos mercados del mismo partido identificados con la misma matchId.');

  // Test 4: Resultado WON
  console.log('\nTest 4: Liquidación de resultado WON...');
  outcomeResolver.settleOutcome({
    matchId: 'match_t29_001',
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.5,
    status: 'WON',
    settledAt: new Date().toISOString(),
    source: 'OFFICIAL_TEST_FEED',
    actualScore: '2-1',
    closingOdds: 1.85
  });
  const evSettledWon = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  const targetWon = evSettledWon.find(c => c.candidateId === 'T29_MATCH1_O25');
  assert.strictEqual(targetWon.status, 'WON');
  assert.strictEqual(targetWon.outcome.actualScore, '2-1');
  assert.ok(targetWon.clv !== null);
  console.log(`✓ Resultado WON correctamente vinculado y liquidado. CLV calculado: ${(targetWon.clv * 100).toFixed(2)}%`);

  // Test 5: Resultado LOST
  console.log('\nTest 5: Liquidación de resultado LOST...');
  outcomeResolver.settleOutcome({
    matchId: 'match_t29_001',
    market: 'DOUBLE_CHANCE',
    selection: 'DRAW_OR_AWAY',
    line: 0.5,
    status: 'LOST',
    settledAt: new Date().toISOString(),
    source: 'OFFICIAL_TEST_FEED',
    actualScore: '2-1'
  });
  const evSettledLost = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  const targetLost = evSettledLost.find(c => c.candidateId === 'T29_MATCH1_DC_X2');
  assert.strictEqual(targetLost.status, 'LOST');
  console.log('✓ Resultado LOST correctamente vinculado.');

  // Test 6: Resultado PUSH (Línea entera con empate)
  console.log('\nTest 6: Resultado PUSH en línea entera...');
  const candPush = {
    candidateId: 'T29_MATCH2_PUSH_O20',
    matchId: 'match_t29_002',
    eventKickoff: baseKickoff,
    sourceEventTimestamp: baseTime,
    dataCutoffTimestamp: baseTime,
    ingestedAt: baseTime,
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.0,
    odds: 1.95,
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 6,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.60,
    probabilityV22: 0.62,
    fairOddsV1: 1.667,
    fairOddsV22: 1.613,
    evV1: 0.17,
    evV22: 0.209,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: baseTime
  };
  ingestProspectiveCandidate(candPush, TEST_PROSP_PATH);
  outcomeResolver.settleOutcome({
    matchId: 'match_t29_002',
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.0,
    status: 'PUSH',
    settledAt: new Date().toISOString(),
    source: 'OFFICIAL_TEST_FEED',
    actualScore: '1-1'
  });
  const evPush = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  const targetPush = evPush.find(c => c.candidateId === 'T29_MATCH2_PUSH_O20');
  assert.strictEqual(targetPush.status, 'PUSH');
  console.log('✓ Resultado PUSH conservado fielmente sin transformarse en victoria o derrota.');

  // Test 7: VOID por no participación
  console.log('\nTest 7: VOID por no participación de jugador...');
  const candPlayer = {
    candidateId: 'T29_MATCH3_PROP_SALAH',
    matchId: 'match_t29_003',
    eventKickoff: baseKickoff,
    sourceEventTimestamp: baseTime,
    dataCutoffTimestamp: baseTime,
    ingestedAt: baseTime,
    market: 'PLAYER_SHOTS',
    selection: 'OVER',
    line: 2.5,
    odds: 1.85,
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 7,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.65,
    probabilityV22: 0.66,
    fairOddsV1: 1.538,
    fairOddsV22: 1.515,
    evV1: 0.20,
    evV22: 0.22,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: baseTime
  };
  ingestProspectiveCandidate(candPlayer, TEST_PROSP_PATH);
  outcomeResolver.settleOutcome({
    matchId: 'match_t29_003',
    market: 'PLAYER_SHOTS',
    selection: 'OVER',
    line: 2.5,
    status: 'VOID_NO_PARTICIPATION',
    settledAt: new Date().toISOString(),
    source: 'OFFICIAL_TEST_FEED'
  });
  const evVoidPart = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  const targetVoidPart = evVoidPart.find(c => c.candidateId === 'T29_MATCH3_PROP_SALAH');
  assert.strictEqual(targetVoidPart.status, 'VOID_NO_PARTICIPATION');
  console.log('✓ VOID_NO_PARTICIPATION registrado y excluido de brier evaluable.');

  // Test 8: Partido suspendido
  console.log('\nTest 8: Partido suspendido...');
  const candSuspended = {
    candidateId: 'T29_MATCH4_SUSP',
    matchId: 'match_t29_004',
    eventKickoff: baseKickoff,
    sourceEventTimestamp: baseTime,
    dataCutoffTimestamp: baseTime,
    ingestedAt: baseTime,
    market: 'TOTAL_GOALS',
    selection: 'UNDER',
    line: 2.5,
    odds: 2.05,
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 5,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.50,
    probabilityV22: 0.49,
    fairOddsV1: 2.00,
    fairOddsV22: 2.04,
    evV1: 0.025,
    evV22: 0.0045,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: baseTime
  };
  ingestProspectiveCandidate(candSuspended, TEST_PROSP_PATH);
  outcomeResolver.settleOutcome({
    matchId: 'match_t29_004',
    market: 'TOTAL_GOALS',
    selection: 'UNDER',
    line: 2.5,
    status: 'VOID_SUSPENDED',
    settledAt: new Date().toISOString(),
    source: 'OFFICIAL_TEST_FEED'
  });
  const evSusp = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  const targetSusp = evSusp.find(c => c.candidateId === 'T29_MATCH4_SUSP');
  assert.strictEqual(targetSusp.status, 'VOID_SUSPENDED');
  console.log('✓ VOID_SUSPENDED registrado correctamente.');

  // Test 9: Resultado vinculado a otro evento (no debe cruzarse)
  console.log('\nTest 9: Resultado vinculado a otro evento...');
  outcomeResolver.settleOutcome({
    matchId: 'match_foreign_999',
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.5,
    status: 'WON',
    settledAt: new Date().toISOString(),
    source: 'FOREIGN_FEED'
  });
  // Verify that an unrelated pending candidate does not link to foreign event
  const candUnrelated = {
    candidateId: 'T29_MATCH5_PENDING',
    matchId: 'match_t29_005',
    eventKickoff: baseKickoff,
    sourceEventTimestamp: baseTime,
    dataCutoffTimestamp: baseTime,
    ingestedAt: baseTime,
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.5,
    odds: 1.75,
    historicalContract: 'COUNT_HISTORY',
    historicalSampleSize: 10,
    historicalSuccesses: 6,
    priorAlpha: 2,
    priorBeta: 2,
    probabilityV1: 0.57,
    probabilityV22: 0.58,
    fairOddsV1: 1.754,
    fairOddsV22: 1.724,
    evV1: -0.002,
    evV22: 0.015,
    dqeStatus: 'VALID',
    modelVersion: 'V2.2_LIVE',
    sourceVersion: 'STATSHUB',
    tribunalDecision: 'SHADOW_PASSIVE',
    tribunalDecisionTimestamp: baseTime
  };
  ingestProspectiveCandidate(candUnrelated, TEST_PROSP_PATH);
  const evUnrel = evaluator.resolveEvaluations('LAST_VALID_PRE_KICKOFF');
  const targetUnrel = evUnrel.find(c => c.candidateId === 'T29_MATCH5_PENDING');
  assert.strictEqual(targetUnrel.status, 'PENDING');
  console.log('✓ Candidato permanece PENDING; no se contamina con resultados de otros partidos.');

  // Test 10: Resultado duplicado (actualiza sin duplicar fila)
  console.log('\nTest 10: Resultado duplicado...');
  const outStoreBefore = JSON.parse(fs.readFileSync(TEST_OUTCOMES_PATH, 'utf-8'));
  const countBefore = outStoreBefore.outcomes.length;
  outcomeResolver.settleOutcome({
    matchId: 'match_t29_001',
    market: 'TOTAL_GOALS',
    selection: 'OVER',
    line: 2.5,
    status: 'WON',
    settledAt: new Date().toISOString(),
    source: 'OFFICIAL_TEST_FEED_UPDATED',
    actualScore: '2-1'
  });
  const outStoreAfter = JSON.parse(fs.readFileSync(TEST_OUTCOMES_PATH, 'utf-8'));
  assert.strictEqual(outStoreAfter.outcomes.length, countBefore);
  console.log('✓ Resultado duplicado procesado de manera idempotente (mismo conteo de filas).');

  // Test 11: Hash alterado (Detección de manipulación)
  console.log('\nTest 11: Detección de SHA-256 alterado...');
  const storeRaw = JSON.parse(fs.readFileSync(TEST_PROSP_PATH, 'utf-8'));
  // Alterar cuota de un registro sin actualizar hash
  storeRaw.records[0].odds = 99.99;
  fs.writeFileSync(TEST_PROSP_PATH, JSON.stringify(storeRaw, null, 2), 'utf-8');
  
  const tamperedAudit = evaluator.auditSnapshotIntegrity();
  assert.strictEqual(tamperedAudit.tamperedRecords.length, 1);
  assert.strictEqual(tamperedAudit.tamperedRecords[0].candidateId, storeRaw.records[0].candidateId);
  console.log(`✓ Detección exitosa de manipulación no autorizada: ${tamperedAudit.tamperedRecords[0].candidateId}`);

  // Restaurar cuota original
  storeRaw.records[0].odds = 1.80;
  fs.writeFileSync(TEST_PROSP_PATH, JSON.stringify(storeRaw, null, 2), 'utf-8');

  // Métricas comparativas y advertencia de muestra insuficiente
  console.log('\nTest Métricas: Verificación de Brier, LogLoss y advertencia de muestra...');
  const metrics = evaluator.computeComparativeMetrics('LAST_VALID_PRE_KICKOFF');
  assert.strictEqual(metrics.isSampleSufficient, false);
  assert.ok(metrics.warning.includes('Muestra insuficiente'));
  assert.strictEqual(metrics.evaluableCount, 2); // 1 WON, 1 LOST
  assert.strictEqual(metrics.pushCount, 1);
  assert.strictEqual(metrics.voidCount, 2);
  assert.strictEqual(metrics.pendingCount, 1);
  console.log(`✓ Métricas calculadas para N=${metrics.evaluableCount} con advertencia de muestra insuficiente activa.`);

  cleanup();
  console.log('\n=== ALL PHASE 2.9 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTestSuite();
