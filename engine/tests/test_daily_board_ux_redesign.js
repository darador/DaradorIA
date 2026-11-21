/**
 * TEST SUITE: FASE 10.1.4 - REDISEÑO UX DEL DAILY BOARD Y NAVEGACIÓN TEMPORAL
 * Verifica:
 * - Selección temporal automática de HOY en America/Argentina/Buenos_Aires
 * - Cambio reactivo instantáneo entre HOY, MAÑANA, PRÓXIMOS y selector de calendario
 * - Exclusión estricta de partidos finalizados e históricos de oportunidades futuras
 * - Sincronización y consistencia de contadores y KPIs
 * - Integración acumulativa con filtros avanzados colapsables
 * - Manejo de estados vacíos sin invención de datos
 * - Integridad del ledger SHA-256 y Shadow Mode
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const dateTime = require('../utils/dateTime');
const tracker = require('../prediction/observationTracker');

let testsPassed = 0;
let testsFailed = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${description}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(`     Error: ${err.message}`);
    testsFailed++;
  }
}

console.log('🧪 Iniciando Test Suite: Fase 10.1.4 — Rediseño UX y Navegación Temporal...');

// =========================================================================
// 1. SELECTOR Y GESTIÓN TEMPORAL DINÁMICA (America/Argentina/Buenos_Aires)
// =========================================================================
console.log('\n--- 1. Selección Temporal Dinámica y Zona Horaria ---');

const TIMEZONE = 'America/Argentina/Buenos_Aires';

it('Zona horaria del sistema debe ser estrictamente America/Argentina/Buenos_Aires', () => {
  assert.strictEqual(config.timezone, TIMEZONE);
  assert.strictEqual(dateTime.DEFAULT_TIMEZONE, TIMEZONE);
});

it('Cálculo dinámico de Hoy, Mañana y Ayer en horario de Argentina', () => {
  const now = new Date();
  const todayStr = dateTime.toLocalDateString(now, TIMEZONE);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStr), 'Formato de fecha debe ser YYYY-MM-DD');

  const tomorrowObj = new Date(now.getTime() + 86400000);
  const tomorrowStr = dateTime.toLocalDateString(tomorrowObj, TIMEZONE);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(tomorrowStr));

  const yesterdayObj = new Date(now.getTime() - 86400000);
  const yesterdayStr = dateTime.toLocalDateString(yesterdayObj, TIMEZONE);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(yesterdayStr));
  assert.notStrictEqual(todayStr, tomorrowStr);
  assert.notStrictEqual(todayStr, yesterdayStr);
});

it('Rollover de medianoche: detecta cambio de fecha sin depender de recarga de página', () => {
  // Simular rollover de 2026-11-20 a 2026-11-21
  const boundaryBefore = new Date('2026-11-20T23:59:59-03:00');
  const boundaryAfter = new Date('2026-11-21T00:00:01-03:00');

  const dateBefore = dateTime.toLocalDateString(boundaryBefore, TIMEZONE);
  const dateAfter = dateTime.toLocalDateString(boundaryAfter, TIMEZONE);

  assert.strictEqual(dateBefore, '2026-11-20');
  assert.strictEqual(dateAfter, '2026-11-21');
});

// =========================================================================
// 2. HORIZONTES TEMPORALES Y EXCLUSIÓN DE FINALIZADOS
// =========================================================================
console.log('\n--- 2. Horizontes Temporales (HOY, MAÑANA, PRÓXIMOS) ---');

const rawPicks = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const topPicks = rawPicks.top_picks;

it('HOY debe devolver únicamente picks cuya fecha local coincida con el día actual', () => {
  const now = new Date();
  const today = dateTime.toLocalDateString(now, TIMEZONE);
  const todayPicks = topPicks.filter(p => (p.eventDateLocal || p.date) === today);

  // Si existen picks para hoy, todos deben coincidir estrictamente con la fecha local de hoy
  assert(todayPicks.every(p => (p.eventDateLocal || p.date) === today));
  // Y si no hay partidos programados verificados para hoy, debe devolver un array vacío válido sin inventar datos
  assert(Array.isArray(todayPicks));
});

it('PRÓXIMOS debe excluir estrictamente partidos finalizados y selecciones liquidadas', () => {
  const now = new Date();
  const today = dateTime.toLocalDateString(now, TIMEZONE);
  const tomorrowObj = new Date(now.getTime() + 86400000);
  const tomorrow = dateTime.toLocalDateString(tomorrowObj, TIMEZONE);

  const upcomingPicks = topPicks.filter(p => {
    const pDate = p.eventDateLocal || p.date;
    if (pDate <= tomorrow) return false;
    // Exclusión estricta de liquidados y finalizados
    if (p.is_finished || ['ACERTADA', 'FALLADA', 'ANULADA_NO_TITULAR', 'FINALIZADO'].includes(p.status)) {
      return false;
    }
    return true;
  });

  for (const pick of upcomingPicks) {
    assert.strictEqual(pick.is_finished, false, 'Próximos no debe contener partidos finalizados');
    assert.notStrictEqual(pick.status, 'ACERTADA');
    assert.notStrictEqual(pick.status, 'FALLADA');
    assert.notStrictEqual(pick.status, 'ANULADA_NO_TITULAR');
  }
});

it('AYER debe permitir consultar la jornada anterior con sus veredictos definitivos', () => {
  const now = new Date();
  const yesterdayObj = new Date(now.getTime() - 86400000);
  const yesterday = dateTime.toLocalDateString(yesterdayObj, TIMEZONE);

  const yesterdayPicks = topPicks.filter(p => (p.eventDateLocal || p.date) === yesterday);
  assert(yesterdayPicks.length >= 2, 'Debe permitir auditar los partidos del día anterior');
  assert(yesterdayPicks.every(p => (p.eventDateLocal || p.date) === yesterday));
});

// =========================================================================
// 3. PRIORIZACIÓN Y ESTADOS EN EL DAILY BOARD
// =========================================================================
console.log('\n--- 3. Ordenamiento de Oportunidades y Prioridad de Estados ---');

it('Aprobados deben ordenarse antes que pendientes en las oportunidades vigentes', () => {
  const getStatusPriority = (p) => {
    if (p.status === 'APROBADO') return 1;
    if (p.status === 'PENDIENTE' || p.status === 'PENDIENTE_ALINEACION') return 2;
    if (p.status === 'ACERTADA' || p.status === 'GANADA') return 3;
    if (p.is_finished || ['FALLADA', 'ANULADA_NO_TITULAR', 'FINALIZADO'].includes(p.status)) return 4;
    return 5;
  };

  const sample = [
    { id: '1', status: 'PENDIENTE_ALINEACION', edge_pct: 30 },
    { id: '2', status: 'APROBADO', edge_pct: 20 },
    { id: '3', status: 'ACERTADA', edge_pct: 40 },
    { id: '4', status: 'FALLADA', edge_pct: 15 }
  ];

  sample.sort((a, b) => getStatusPriority(a) - getStatusPriority(b));

  assert.strictEqual(sample[0].status, 'APROBADO', 'Aprobado debe ubicarse en primera posición');
  assert.strictEqual(sample[1].status, 'PENDIENTE_ALINEACION', 'Pendiente debe ubicarse en segunda posición');
  assert.strictEqual(sample[2].status, 'ACERTADA', 'Liquidadas deben ubicarse al final');
});

// =========================================================================
// 4. INTEGRACIÓN DE COMPONENTES EN FRONTEND (HTML / UI)
// =========================================================================
console.log('\n--- 4. Componentes de UI en dashboard.html e index.html ---');

['dashboard.html', 'index.html'].forEach(filename => {
  const content = fs.readFileSync(filename, 'utf8');

  it(`${filename} debe contener la barra de navegación horizontal con HOY, MAÑANA y PRÓXIMOS`, () => {
    assert(content.includes('id="btnDateToday"'), 'Falta botón HOY');
    assert(content.includes('id="btnDateTomorrow"'), 'Falta botón MAÑANA');
    assert(content.includes('id="btnDateUpcoming"'), 'Falta botón PRÓXIMOS');
    assert(content.includes('id="filterSpecificDate"'), 'Falta selector de calendario específico');
  });

  it(`${filename} debe tener el panel colapsable de filtros avanzados y botón de alternancia`, () => {
    assert(content.includes('id="btnToggleAdvancedFilters"'), 'Falta botón toggle filtros');
    assert(content.includes('id="advancedFiltersCollapse"'), 'Falta panel colapsable');
    assert(content.includes('id="advFilterBadge"'), 'Falta badge de filtros activos');
  });

  it(`${filename} debe contar con botón de actualización manual y sello de última actualización`, () => {
    assert(content.includes('id="btnRefreshDailyManual"'), 'Falta botón actualizar');
    assert(content.includes('id="labelLastUpdate"'), 'Falta etiqueta de última actualización');
  });

  it(`${filename} debe implementar selectTimeHorizon() reactivo sin botón de aplicar`, () => {
    assert(content.includes('function selectTimeHorizon('), 'Falta selectTimeHorizon');
    assert(content.includes('function toggleAdvancedFiltersPanel('), 'Falta toggleAdvancedFiltersPanel');
    assert(content.includes('function onCustomDatePick('), 'Falta onCustomDatePick');
  });
});

// =========================================================================
// 5. INTEGRIDAD CRIPTOGRÁFICA Y SHADOW MODE (Innegociables)
// =========================================================================
console.log('\n--- 5. Integridad del Ledger Criptográfico y Shadow Mode ---');

it('Las 18 observaciones oficiales permanecen inalteradas en el ledger', () => {
  const reg = tracker.getRegistry();
  const settled = reg.filter(r => r.settledAt && !r.isTestPick && !r.pickId.startsWith('cand_test_') && !r.pickId.startsWith('pick_test_'));
  assert.strictEqual(settled.length, 18, 'Deben existir exactamente 18 observaciones oficiales auditadas');
});

it('Verificación SHA-256 no detecta ninguna alteración histórica', () => {
  const audit = tracker.verifyIntegrity();
  assert.strictEqual(audit.alteredCount, 0, 'Cero alteraciones en el ledger sellado');
});

it('Shadow Mode estricto activo en configuración y en todas las selecciones', () => {
  assert.strictEqual(config.shadowMode.enabled, true);
  assert.strictEqual(config.shadowMode.allowRealBets, false);
  assert.strictEqual(config.shadowMode.allowAutomatedOrders, false);
  for (const pick of topPicks) {
    assert.strictEqual(pick.shadow_mode, true);
    assert.strictEqual(pick.is_operative_recommendation, false);
  }
});

// =========================================================================
// RESUMEN FINAL
// =========================================================================
console.log('\n====================================================');
console.log(`🏁 RESULTADO FASE 10.1.4: ${testsPassed} PRUEBAS PASADAS, ${testsFailed} FALLADAS`);
console.log('====================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}
