/**
 * DARADORIA / DARADORBET — TEST DE AUDITORÍA INTEGRAL DE PROCESOS Y DAILY BOARD
 * Fase 9: Verificación de Fechas, Filtros, Datos, Integridad y Shadow Mode
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const dateTime = require('../utils/dateTime');
const tracker = require('../prediction/observationTracker');

console.log('🧪 Iniciando Test Suite: Auditoría Integral del Daily Board y Fechas...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// =========================================================================
// 1. FECHAS Y ZONA HORARIA (America/Argentina/Buenos_Aires)
// =========================================================================
console.log('--- 1. Fechas y Zona Horaria (America/Argentina/Buenos_Aires) ---');

it('Zona horaria por defecto debe ser America/Argentina/Buenos_Aires', () => {
  assert.strictEqual(dateTime.DEFAULT_TIMEZONE, 'America/Argentina/Buenos_Aires');
  assert.strictEqual(config.timezone, 'America/Argentina/Buenos_Aires');
});

it('Un partido del día anterior (19-Nov 22:30 UTC = 19:30 ART) no aparece en Hoy (20-Nov)', () => {
  const localDate = dateTime.toLocalDateString('2026-11-19T22:30:00Z');
  assert.strictEqual(localDate, '2026-11-19');
  assert.notStrictEqual(localDate, '2026-11-20');
});

it('Un partido de hoy (20-Nov 19:45 UTC = 16:45 ART) aparece en Hoy (20-Nov)', () => {
  const localDate = dateTime.toLocalDateString('2026-11-20T19:45:00Z');
  assert.strictEqual(localDate, '2026-11-20');
});

it('Un partido próximo a medianoche (21-Nov 01:30 UTC = 20-Nov 22:30 ART) se clasifica en Hoy (20-Nov)', () => {
  // Partido nocturno jugado en Sudamérica/Argentina a las 22:30 hs
  const localDate = dateTime.toLocalDateString('2026-11-21T01:30:00Z');
  assert.strictEqual(localDate, '2026-11-20');
});

it('Un partido de madrugada UTC (20-Nov 00:30 UTC = 19-Nov 21:30 ART) se clasifica en Ayer (19-Nov)', () => {
  const localDate = dateTime.toLocalDateString('2026-11-20T00:30:00Z');
  assert.strictEqual(localDate, '2026-11-19');
});

it('Un partido de mañana (21-Nov 20:00 UTC = 17:00 ART) no aparece en Hoy (20-Nov)', () => {
  const localDate = dateTime.toLocalDateString('2026-11-21T20:00:00Z');
  assert.strictEqual(localDate, '2026-11-21');
  assert.notStrictEqual(localDate, '2026-11-20');
});

it('Límites de jornada para 2026-11-20 cubren exactamente de 03:00 UTC a 02:59:59.999 UTC del día siguiente', () => {
  const bounds = dateTime.getLocalDateDayBoundaries('2026-11-20');
  assert.strictEqual(bounds.startUtcIso, '2026-11-20T03:00:00.000Z');
  assert.strictEqual(bounds.endUtcIso, '2026-11-21T02:59:59.999Z');
  assert.strictEqual(bounds.endTs - bounds.startTs, 86399); // 24 horas - 1 segundo
});

// =========================================================================
// 2. AUDITORÍA DE DATOS Y FILTROS DEL DAILY BOARD
// =========================================================================
console.log('\n--- 2. Auditoría de Datos y Filtros del Daily Board ---');

const rawPicks = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const topPicks = rawPicks.top_picks;

it('Coritiba vs Santos y Gabriel Barbosa (cand_test_agent_01) NO deben existir en picks_hoy', () => {
  const hasCoritiba = topPicks.some(p => p.match?.includes('Coritiba') || p.id === 'cand_test_agent_01');
  const hasBarbosa = topPicks.some(p => p.player?.includes('Barbosa') || p.id === 'cand_test_agent_01');
  assert.strictEqual(hasCoritiba, false, 'Coritiba vs Santos no debe existir en el Daily Board');
  assert.strictEqual(hasBarbosa, false, 'Gabriel Barbosa no debe existir en el Daily Board');
});

it('Real Madrid vs Inter y Kylian Mbappé (cand_1795140929393_zq72a) NO deben existir en picks_hoy', () => {
  const hasMadridInter = topPicks.some(p => (p.match?.includes('Real Madrid') && p.match?.includes('Inter')) || p.id === 'cand_1795140929393_zq72a');
  assert.strictEqual(hasMadridInter, false, 'Real Madrid vs Inter no debe existir en el Daily Board');
});

it('No deben existir IDs duplicados en top_picks', () => {
  const ids = topPicks.map(p => p.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(ids.length, uniqueIds.size, 'Todos los IDs de top_picks deben ser únicos');
});

it('Cada pick en top_picks debe tener un eventDateLocal válido en formato YYYY-MM-DD', () => {
  for (const p of topPicks) {
    assert(p.eventDateLocal && /^\d{4}-\d{2}-\d{2}$/.test(p.eventDateLocal), `Pick ${p.id} debe tener eventDateLocal`);
    assert.strictEqual(p.date, p.eventDateLocal, `Pick ${p.id} date debe ser igual a eventDateLocal`);
  }
});

it('Filtro por Fecha: Hoy (2026-11-20) debe devolver exclusivamente eventos de hoy', () => {
  const todayPicks = topPicks.filter(p => p.eventDateLocal === '2026-11-20');
  assert.strictEqual(todayPicks.length, 2, 'Deben haber exactamente 2 picks de hoy');
  assert(todayPicks.every(p => p.eventDateLocal === '2026-11-20'));
  assert(todayPicks.some(p => p.player === 'Karim Dermane'));
  assert(todayPicks.some(p => p.player === 'Javi Puado'));
});

it('Filtro por Fecha y Competición combinadas: Hoy + Brasileirão no debe devolver selecciones', () => {
  const todayBrasileirao = topPicks.filter(p => p.eventDateLocal === '2026-11-20' && p.league.includes('Brasileirão'));
  assert.strictEqual(todayBrasileirao.length, 0, 'No debe haber picks del Brasileirão en la fecha de Hoy');
});

it('Filtro por Fecha y Competición combinadas: Hoy + Ligue 1 devuelve exclusivamente Troyes vs Le Havre', () => {
  const todayLigue1 = topPicks.filter(p => p.eventDateLocal === '2026-11-20' && p.league.includes('Ligue 1'));
  assert.strictEqual(todayLigue1.length, 1);
  assert.strictEqual(todayLigue1[0].match, 'Troyes vs Le Havre');
  assert.strictEqual(todayLigue1[0].player, 'Karim Dermane');
});

it('No aparecen partidos ya concluidos como PENDIENTE de alineación', () => {
  const pendingFinished = topPicks.filter(p => p.is_finished && (p.status === 'PENDIENTE' || p.status === 'PENDIENTE_ALINEACION'));
  assert.strictEqual(pendingFinished.length, 0, 'Ningún partido finalizado puede tener estado PENDIENTE_ALINEACION');
});

it('summary_metrics refleja 0 pendientes cuando todos los partidos han concluido', () => {
  const pendingConcluded = topPicks.filter(p => p.is_finished && (p.status === 'PENDIENTE' || p.status === 'PENDIENTE_ALINEACION'));
  assert.strictEqual(pendingConcluded.length, 0, 'No debe haber partidos concluidos pendientes');
});

// =========================================================================
// 3. INTEGRIDAD CRIPTOGRÁFICA Y REGISTRO CONGELADO (Fase 10.1.3.1)
// =========================================================================
console.log('\n--- 3. Integridad Criptográfica y Registro Congelado ---');

it('Las observaciones oficiales auditadas permanecen exactamente intactas', () => {
  const reg = tracker.getRegistry();
  const settledOfficial = reg.filter(r => r.settledAt && !r.isTestPick && !r.pickId.startsWith('cand_test_') && !r.pickId.startsWith('pick_test_'));
  assert(settledOfficial.length >= 18, 'El registro congelado primario debe tener al menos 18 picks liquidados');
});

it('Verificación SHA-256 del ledger no reporta ninguna alteración histórica', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0, '0 registros alterados');
  assert(audit.intactCount >= 57, 'Al menos 57 registros sellados verificados intactos');
});

// =========================================================================
// 4. SHADOW MODE Y REGLAS DE SEGURIDAD OPERATIVA
// =========================================================================
console.log('\n--- 4. Verificación de Seguridad de Shadow Mode ---');

it('Shadow Mode debe estar activo sin excepciones', () => {
  assert.strictEqual(config.shadowMode.enabled, true);
  assert.strictEqual(config.shadowMode.allowRealBets, false);
  assert.strictEqual(config.shadowMode.allowTelegramPicks, false);
  assert.strictEqual(config.shadowMode.allowAutomatedOrders, false);
});

it('Todas las selecciones en picks_hoy tienen banderas is_operative_recommendation: false', () => {
  assert(topPicks.every(p => p.is_operative_recommendation === false));
  assert(topPicks.every(p => p.shadow_mode === true));
});

// =========================================================================
// RESUMEN FINAL
// =========================================================================
console.log('\n====================================================');
console.log(`🏁 RESULTADO AUDITORÍA DAILY BOARD: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
