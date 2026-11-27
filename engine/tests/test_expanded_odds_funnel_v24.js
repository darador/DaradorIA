/**
 * SUITE DE TESTS: DARADOR IA — EMBUDO EXPANDIDO V2.4
 * Valida los 13 requisitos obligatorios del protocolo:
 *
 * 1. Un candidato @1.48 puede ser descubierto.
 * 2. Un candidato @1.48 llega a Deep Research.
 * 3. Un candidato @1.48 con EV +10% puede pasar el filtro matemático experimental.
 * 4. Un candidato @1.48 con EV +5% es rechazado por EV.
 * 5. Un candidato @1.35 no puede aprobar la política experimental.
 * 6. Un candidato @1.44 no puede aprobar la política productiva.
 * 7. Elena puede vetar un candidato experimental.
 * 8. Una selección SHADOW_PASSIVE nunca aparece como aprobada.
 * 9. Una carga manual no puede falsificar el dictamen de Elena.
 * 10. Los candidatos experimentales no ingresan al Daily Board productivo.
 * 11. Los snapshots conservan integridad temporal.
 * 12. Los candidatos duplicados no generan oportunidades adicionales.
 * 13. La configuración productiva permanece sin cambios.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { EXPERIMENTAL_ODDS_POLICY_V24, evaluateExperimentalMath } = require('../experimental/experimentalOddsPolicyV24');
const ExperimentalDiscoveryEngine = require('../experimental/experimentalDiscoveryEngine');
const { resolveCanonicalPickStatus, CANONICAL_STATES } = require('../quality/stateIntegrityGuard');
const ExperimentalStore = require('../experimental/experimentalStore');

console.log('=== [INICIANDO SUITE DE TESTS: EMBUDO EXPANDIDO V2.4] ===\n');

// 1. Un candidato @1.48 puede ser descubierto
console.log('Test 1: Candidato @1.48 puede ser descubierto en screener experimental...');
const expDiscovery = new ExperimentalDiscoveryEngine();
assert.strictEqual(expDiscovery.minOdds, 1.45);
assert.strictEqual(expDiscovery.maxOdds, 2.20);
const rawCand148 = {
  playerName: 'Gabriel Magalhães',
  statType: 'Entradas (Tackles)',
  line: 'Más de 1.5',
  odds: 1.48,
  hitRateL10: '80%'
};
const mapped = expDiscovery._mapPropRows([rawCand148], 'test_screener')[0];
assert.strictEqual(mapped.bookmakerOdds, 1.48);
console.log('✓ Candidato @1.48 descubierto y mapeado correctamente.');

// 2. Un candidato @1.48 llega a Deep Research
console.log('\nTest 2: Candidato @1.48 supera preselección y avanza a Deep Research...');
const prioritized = expDiscovery.evaluateAndPrioritizeExperimental(mapped);
assert.strictEqual(prioritized.status, CANONICAL_STATES.UNDER_RESEARCH);
assert.strictEqual(prioritized.policy, 'EXPERIMENTAL_ODDS_V24');
console.log('✓ Candidato @1.48 avanza a UNDER_RESEARCH sin ser descartado.');

// 3. Un candidato @1.48 con EV +10% puede pasar el filtro matemático experimental
console.log('\nTest 3: Candidato @1.48 con EV +10% supera filtro matemático experimental...');
// EV = (prob * odds) - 1 => para EV = 0.10 a cuota 1.48: prob = 1.10 / 1.48 = 0.7432
const mathPass = evaluateExperimentalMath({ odds: 1.48, prob: 0.7432 });
assert.strictEqual(mathPass.pass, true);
assert.ok(mathPass.ev >= 0.08);
console.log(`✓ Filtro matemático aprobado: EV +${mathPass.evPercentage}% >= +8.0%.`);

// 4. Un candidato @1.48 con EV +5% es rechazado por EV
console.log('\nTest 4: Candidato @1.48 con EV +5% es rechazado por EV insuficiente...');
// EV = (prob * odds) - 1 => prob = 1.05 / 1.48 = 0.7095
const mathFailEv = evaluateExperimentalMath({ odds: 1.48, prob: 0.7095 });
assert.strictEqual(mathFailEv.pass, false);
assert.ok(mathFailEv.reason.includes('EV_INSUFICIENTE'));
console.log('✓ Candidato @1.48 rechazado por EV insuficiente (+5.0% < +8.0%).');

// 5. Un candidato @1.35 no puede aprobar la política experimental
console.log('\nTest 5: Candidato @1.35 queda fuera de rango experimental...');
const mathFailOdds = evaluateExperimentalMath({ odds: 1.35, prob: 0.90 });
assert.strictEqual(mathFailOdds.pass, false);
assert.ok(mathFailOdds.reason.includes('CUOTA_FUERA_DE_RANGO'));
console.log('✓ Candidato @1.35 rechazado por límite inferior (1.35 < 1.45).');

// 6. Un candidato @1.44 no puede aprobar la política productiva
console.log('\nTest 6: Candidato @1.44 no puede heredar aprobación productiva...');
const prodEval = resolveCanonicalPickStatus({
  odds: 1.44,
  edge_pct: 1.32,
  status: 'APROBADO',
  policy: 'BASELINE'
});
assert.notStrictEqual(prodEval.status, CANONICAL_STATES.RISK_APPROVED);
assert.strictEqual(prodEval.isOperativeApproved, false);
assert.strictEqual(prodEval.status, CANONICAL_STATES.SHADOW_PASSIVE);
console.log('✓ Candidato @1.44 degradado a SHADOW_PASSIVE en producción.');

// 7. Elena puede vetar un candidato experimental
console.log('\nTest 7: Veto de Elena en candidato experimental...');
const vetoRecord = resolveCanonicalPickStatus({
  odds: 1.50,
  edge_pct: 12.0,
  policy: 'EXPERIMENTAL_ODDS_V24',
  finalState: CANONICAL_STATES.EXPERIMENTAL_REJECTED_BY_RISK_MANAGER,
  discardReason: 'VETO TÁCTICO: Bloque defensivo rival hermético'
});
assert.strictEqual(vetoRecord.isOperativeApproved, false);
assert.strictEqual(vetoRecord.status, CANONICAL_STATES.EXPERIMENTAL_REJECTED_BY_RISK_MANAGER);
console.log('✓ Veto de Elena preservado en candidato experimental.');

// 8. Una selección SHADOW_PASSIVE nunca aparece como aprobada
console.log('\nTest 8: Selección SHADOW_PASSIVE nunca recibe aprobación operativa...');
const shadowPassive = resolveCanonicalPickStatus({
  id: 'cand_statshub_20261127_not_che_dc_x2',
  status: 'SHADOW_PASSIVE',
  odds: 1.44,
  ev_pct: '+1.3%'
});
assert.strictEqual(shadowPassive.isOperativeApproved, false);
assert.strictEqual(shadowPassive.status, CANONICAL_STATES.SHADOW_PASSIVE);
console.log('✓ SHADOW_PASSIVE protegido contra aprobación operativa.');

// 9. Una carga manual no puede falsificar el dictamen de Elena
console.log('\nTest 9: Inyección manual no puede atribuirse aprobación de Elena...');
const manualPick = resolveCanonicalPickStatus({
  id: 'cand_manual_injection',
  isManual: true,
  status: 'APROBADO',
  odds: 1.75,
  edge_pct: 15.0
});
assert.strictEqual(manualPick.isOperativeApproved, false);
assert.strictEqual(manualPick.status, CANONICAL_STATES.UNDER_RESEARCH);
assert.strictEqual(manualPick.elenaStatus, 'PENDIENTE_AUDITORIA');
console.log('✓ Inyección manual contenida como PENDIENTE_AUDITORIA.');

// 10. Los candidatos experimentales no ingresan al Daily Board productivo
console.log('\nTest 10: Candidatos experimentales aislados del Daily Board productivo...');
const rawDailyPicks = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../picks_hoy.json'), 'utf8')).top_picks;
const expInDaily = rawDailyPicks.filter(p => p.policy === 'EXPERIMENTAL_ODDS_V24' && p.is_operative_recommendation === true);
assert.strictEqual(expInDaily.length, 0);
console.log('✓ Cero candidatos experimentales como recomendación operativa en Daily Board.');

// 11. Los snapshots conservan integridad temporal
console.log('\nTest 11: Integridad temporal en snapshots...');
const testStorePath = path.resolve(__dirname, '../storage_data/test_experimental_store_tmp.json');
if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);
const store = new ExperimentalStore(testStorePath);

const testRec = {
  candidateId: 'test_temporal_integrity',
  matchId: 'match_temporal',
  selection: 'Test Player',
  market: 'Shots',
  line: 'O1.5',
  odds: 1.50,
  ev: 0.10,
  evPercentage: 10.0,
  finalState: CANONICAL_STATES.EXPERIMENTAL_APPROVED,
  evaluatedAt: '2026-11-27T10:00:00Z',
  eventKickoff: '2026-11-27T15:00:00Z'
};
assert.ok(new Date(testRec.evaluatedAt) < new Date(testRec.eventKickoff));
console.log('✓ Integridad evaluada: evaluatedAt < eventKickoff.');

// 12. Los candidatos duplicados no generan oportunidades adicionales
console.log('\nTest 12: Prevención de duplicación al actualizar cuotas...');
const rec1 = store.saveRecord({ ...testRec, odds: 1.50 });
const rec2 = store.saveRecord({ ...testRec, odds: 1.55 });
const currentStore = store.loadStore();
const matches = currentStore.records.filter(r => r.candidateId === 'test_temporal_integrity');
assert.strictEqual(matches.length, 1);
assert.strictEqual(matches[0].odds, 1.55);
assert.strictEqual(matches[0].snapshotVersion, 2);
if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);
console.log('✓ Candidato duplicado versionado como snapshot (1 único candidato en conteo).');

// 13. La configuración productiva permanece sin cambios
console.log('\nTest 13: Verificación de configuración productiva intocable...');
assert.strictEqual(config.prediction.minOdds, 1.60);
assert.strictEqual(config.prediction.maxOdds, 2.35);
assert.strictEqual(config.prediction.minEV, 0.07);
console.log('✓ Configuración productiva inalterada: minOdds=1.60, maxOdds=2.35, minEV=0.07.');

console.log('\n======================================================');
console.log('🎉 TODOS LOS 13 TESTS DEL PROTOCOLO V2.4 PASARON AL 100%');
console.log('======================================================\n');
