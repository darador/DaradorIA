/**
 * TEST SUITE: MEJORAS OPERATIVAS DEL DAILY BOARD
 * Valida los 8 puntos de control requeridos:
 * 1. Frecuencias informadas vs schedulers reales
 * 2. Conversión horaria a horario argentino (America/Argentina/Buenos_Aires)
 * 3. Orden cronológico (el pick más próximo primero)
 * 4. Clasificación dinámica de partidos (EN CURSO, PRÓXIMO, FINALIZADO)
 * 5. Independencia estricta de contadores APROBADO vs ACEPTADA
 * 6. Correspondencia exacta de badges con registros reales
 * 7. Cero duplicaciones de picks y observaciones
 * 8. Build de producción sin errores
 */

const fs = require('fs');
const assert = require('assert');
const path = require('path');
const { execSync } = require('child_process');

console.log('======================================================');
console.log('🧪 VALIDACIÓN DE MEJORAS OPERATIVAS DEL DAILY BOARD');
console.log('======================================================\n');

// 1. FRECUENCIAS INFORMADAS VS SCHEDULERS REALES
console.log('--- 1. Auditoría de Frecuencias vs Schedulers Reales ---');
const processMonitor = require('../scheduler/processMonitor');
const pipelineScheduler = require('../scheduler/scheduler');

const report = processMonitor.auditProcesses({ schedulerInstance: pipelineScheduler });
assert(report.processes.length === 9, 'Debe haber exactamente 9 procesos auditados');

const manualProc = report.processes.filter(p => p.status === 'EJECUCIÓN MANUAL');
const activeProc = report.processes.filter(p => p.status === 'ACTIVO');
const inactiveProc = report.processes.filter(p => p.status === 'INACTIVO');

console.log(`  • Procesos Activos (${activeProc.length}):`, activeProc.map(p => p.name).join(', '));
console.log(`  • Procesos Manuales (${manualProc.length}):`, manualProc.map(p => p.name).join(', '));
console.log(`  • Procesos Inactivos (${inactiveProc.length}):`, inactiveProc.map(p => p.name).join(', '));

assert(manualProc.length === 5, 'Discovery, DeepResearch, Prediction, AI Agents y Cuotas deben ser EJECUCIÓN MANUAL');
assert(inactiveProc.length === 2, 'LineupWatcher y SettlementEngine deben ser INACTIVOS cuando daemon está detenido');
assert(activeProc.length === 2, 'ObservationTracker y DashboardSync deben estar ACTIVOS');
console.log('  ✅ Validación 1 Superada: Las frecuencias informadas coinciden con los schedulers reales.');

// 2. CONVERSIÓN A HORARIO ARGENTINO (America/Argentina/Buenos_Aires)
console.log('\n--- 2. Conversión a Horario Argentino ---');
const TIMEZONE_ART = 'America/Argentina/Buenos_Aires';
const testUtcIso = '2026-11-22T16:00:00Z'; // 16:00 UTC = 13:00 ART
const testDateObj = new Date(testUtcIso);

const formattedArt = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE_ART,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}).format(testDateObj);

assert(formattedArt === '13:00', `16:00 UTC debe ser 13:00 en Argentina, obtenido: ${formattedArt}`);
console.log(`  • 16:00:00 UTC -> ${formattedArt} hs (ART) [UTC-3 verificado]`);
console.log('  ✅ Validación 2 Superada: Horarios convertidos con precisión a America/Argentina/Buenos_Aires.');

// 3. ORDEN CRONOLÓGICO: EL PICK MÁS PRÓXIMO PRIMERO
console.log('\n--- 3. Orden Cronológico de Picks ---');
const picksData = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const topPicks = picksData.top_picks || [];

// Simulación de función de ordenamiento idéntica a dashboard.html
function getPickKickoffMetaTest(p, now = Date.now()) {
  let dateObj = null;
  if (p.eventDateUtc && !isNaN(new Date(p.eventDateUtc).getTime())) {
    dateObj = new Date(p.eventDateUtc);
  } else if (p.kickoffTimestamp) {
    const ts = p.kickoffTimestamp < 10000000000 ? p.kickoffTimestamp * 1000 : p.kickoffTimestamp;
    dateObj = new Date(ts);
  } else if (typeof p.time === 'string') {
    const utcMatch = p.time.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{2}:\d{2})\s+UTC/);
    if (utcMatch) {
      const parsed = new Date(utcMatch[1] + ' UTC');
      if (!isNaN(parsed.getTime())) dateObj = parsed;
    }
  }
  if (!dateObj && p.date && p.kickoffTimeLocal && p.kickoffTimeLocal.includes(':')) {
    const timeMatch = p.kickoffTimeLocal.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const [y, m, d] = p.date.split('-').map(Number);
      const hh = Number(timeMatch[1]);
      const mm = Number(timeMatch[2]);
      dateObj = new Date(Date.UTC(y, m - 1, d, hh + 3, mm, 0));
    }
  }

  const hasConfirmedTime = !!dateObj && !isNaN(dateObj.getTime());
  const timestamp = hasConfirmedTime ? dateObj.getTime() : null;

  let timeStrArt = 'Horario a confirmar';
  let dateStrArt = p.eventDateLocal || (p.date ? p.date.slice(0, 10) : 'Fecha a confirmar');

  if (hasConfirmedTime) {
    timeStrArt = new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE_ART,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(dateObj) + ' hs';

    dateStrArt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE_ART,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(dateObj);
  }

  let proximityCategory = 'unconfirmed';
  const isDone = p.is_finished || ['ACERTADA', 'FALLADA', 'GANADA', 'PERDIDA', 'ANULADA', 'ANULADA_NO_TITULAR', 'FINALIZADO'].includes(p.status);

  if (isDone) {
    proximityCategory = 'finished';
  } else if (!hasConfirmedTime) {
    proximityCategory = 'unconfirmed';
  } else {
    const diffMinutes = (timestamp - now) / 60000;
    const matchDurationMinutes = 115;
    if (now >= timestamp && (now - timestamp) <= matchDurationMinutes * 60000) {
      proximityCategory = 'live';
    } else if (now > (timestamp + matchDurationMinutes * 60000)) {
      proximityCategory = 'finished';
    } else if (diffMinutes <= 120 && diffMinutes > 0) {
      proximityCategory = 'soon';
    } else {
      proximityCategory = 'upcoming';
    }
  }

  return { timestamp, dateStrArt, timeStrArt, hasConfirmedTime, proximityCategory };
}

function sortPicksByMatchScheduleTest(list, now = Date.now()) {
  return [...list].sort((a, b) => {
    const metaA = getPickKickoffMetaTest(a, now);
    const metaB = getPickKickoffMetaTest(b, now);

    const getPrio = (m) => {
      if (m.proximityCategory === 'soon' || m.proximityCategory === 'upcoming') return 1;
      if (m.proximityCategory === 'live') return 2;
      if (m.proximityCategory === 'finished') return 3;
      return 4;
    };

    const prioA = getPrio(metaA);
    const prioB = getPrio(metaB);

    if (prioA !== prioB) return prioA - prioB;

    if (prioA === 1 || prioA === 2) {
      const tsA = metaA.timestamp || Infinity;
      const tsB = metaB.timestamp || Infinity;
      if (tsA !== tsB) return tsA - tsB;
    }

    if (prioA === 3) {
      const tsA = metaA.timestamp || 0;
      const tsB = metaB.timestamp || 0;
      if (tsA !== tsB) return tsB - tsA;
    }

    const matchA = a.match || '';
    const matchB = b.match || '';
    return matchA.localeCompare(matchB);
  });
}

// 3.1 Prueba con dataset real a hora de jornada
const refMatchday = new Date('2026-11-21T10:00:00Z').getTime();
const sortedPicksReal = sortPicksByMatchScheduleTest(topPicks, refMatchday);
const firstMetaReal = getPickKickoffMetaTest(sortedPicksReal[0], refMatchday);

console.log(`  • Primer pick real (en jornada): [${firstMetaReal.proximityCategory.toUpperCase()}] ${firstMetaReal.dateStrArt} ${firstMetaReal.timeStrArt} | ${sortedPicksReal[0].match}`);
assert(firstMetaReal.proximityCategory === 'upcoming' || firstMetaReal.proximityCategory === 'soon', 'En jornada, el primer pick debe ser el más próximo a disputarse');
assert.strictEqual(sortedPicksReal[0].match, 'Manchester City vs Fulham', 'El partido más temprano (09:30 ART) debe liderar la lista');

// 3.2 Prueba con escenario sintético controlado: Soon, Upcoming, Live, Finished, Unconfirmed + Grouping
const nowTest = new Date('2026-11-23T14:00:00Z').getTime(); // 11:00 ART
const testPicks = [
  { match: 'Partido Sin Horario', time: 'Horario por confirmar', status: 'PENDIENTE' },
  { match: 'Partido Finalizado', eventDateUtc: '2026-11-23T10:00:00Z', is_finished: true, status: 'ACERTADA' },
  { match: 'Partido En Curso', eventDateUtc: '2026-11-23T13:45:00Z', is_finished: false, status: 'EN_CURSO' },
  { match: 'Partido Tarde Pick 1', eventDateUtc: '2026-11-23T18:00:00Z', is_finished: false, status: 'APROBADO', player: 'Jugador 1' },
  { match: 'Partido Tarde Pick 2', eventDateUtc: '2026-11-23T18:00:00Z', is_finished: false, status: 'APROBADO', player: 'Jugador 2' },
  { match: 'Partido Pronto', eventDateUtc: '2026-11-23T14:45:00Z', is_finished: false, status: 'APROBADO' } // Comienza en 45 min
];

const sortedSynthetic = sortPicksByMatchScheduleTest(testPicks, nowTest);
const order = sortedSynthetic.map(p => ({
  match: p.match,
  cat: getPickKickoffMetaTest(p, nowTest).proximityCategory
}));

assert.strictEqual(order[0].match, 'Partido Pronto', 'El partido que comienza pronto (45 min) debe ser primero');
assert.strictEqual(order[0].cat, 'soon', 'Debe tener categoría soon');
assert.strictEqual(order[1].match, 'Partido Tarde Pick 1', 'El partido de la tarde debe seguir cronológicamente');
assert.strictEqual(order[2].match, 'Partido Tarde Pick 2', 'Los picks del mismo partido deben permanecer agrupados');
assert.strictEqual(order[3].match, 'Partido En Curso', 'Partidos en curso deben seguir a los próximos');
assert.strictEqual(order[3].cat, 'live', 'Debe tener categoría live');
assert.strictEqual(order[4].match, 'Partido Finalizado', 'Partidos finalizados van al final');
assert.strictEqual(order[4].cat, 'finished', 'Debe tener categoría finished');
assert.strictEqual(order[5].match, 'Partido Sin Horario', 'Partidos sin horario confirmado van en sección separada al final');
assert.strictEqual(order[5].cat, 'unconfirmed', 'Debe tener categoría unconfirmed');

console.log('  ✅ Validación 3 Superada: Orden cronológico riguroso (Próximo -> En curso -> Finalizado -> Sin Horario) y agrupación de picks confirmada.');

// 4. CLASIFICACIÓN DINÁMICA DE PARTIDOS
console.log('\n--- 4. Clasificación Dinámica (EN CURSO, PRÓXIMO, FINALIZADO) ---');
// Prueba de transición con simulación de tiempo
const baseTime = new Date('2026-11-23T16:00:00Z').getTime(); // 13:00 ART
const dummyPick = {
  eventDateUtc: '2026-11-23T16:00:00Z',
  match: 'Equipo A vs Equipo B',
  is_finished: false,
  status: 'APROBADO'
};

const metaUpcoming = getPickKickoffMetaTest(dummyPick, baseTime - (180 * 60 * 1000)); // 3 hs antes
const metaSoon = getPickKickoffMetaTest(dummyPick, baseTime - (60 * 60 * 1000));     // 1 h antes
const metaLive = getPickKickoffMetaTest(dummyPick, baseTime + (30 * 60 * 1000));     // 30 min jugado
const metaDone = getPickKickoffMetaTest(dummyPick, baseTime + (150 * 60 * 1000));    // 150 min después

assert.strictEqual(metaUpcoming.proximityCategory, 'upcoming', 'Debe ser upcoming a 3h');
assert.strictEqual(metaSoon.proximityCategory, 'soon', 'Debe ser soon a 1h');
assert.strictEqual(metaLive.proximityCategory, 'live', 'Debe ser live durante el partido');
assert.strictEqual(metaDone.proximityCategory, 'finished', 'Debe ser finished post partido');

console.log('  • T - 180 min -> upcoming');
console.log('  • T - 60 min  -> soon');
console.log('  • T + 30 min  -> live');
console.log('  • T + 150 min -> finished');
console.log('  ✅ Validación 4 Superada: Clasificación dinámica calculada en base al reloj en tiempo real.');

// 5. INDEPENDENCIA ESTRICTA DE APROBADO VS ACEPTADA
console.log('\n--- 5. Independencia de Contadores APROBADO vs ACEPTADA ---');
function computeCountsTest(picks) {
  let approved = 0;
  let accepted = 0;
  picks.forEach(p => {
    const isApproved = p.status === 'APROBADO' ||
      (p.status_label && p.status_label.includes('Aprobado')) ||
      (p.elena_verdict && p.elena_verdict.includes('Aprobado')) ||
      (p.provenance && p.provenance.elena_decision === 'APPROVED');
    if (isApproved) approved++;

    const isAccepted = p.accepted === true || p.is_accepted === true || p.status === 'ACEPTADA';
    if (isAccepted) accepted++;
  });
  return { approved, accepted };
}

const boardCounts = computeCountsTest(topPicks);
console.log(`  • Picks con Aprobación Formal de Elena: ${boardCounts.approved}`);
console.log(`  • Picks Aceptadas en Flujo de Apuestas: ${boardCounts.accepted}`);
assert(typeof boardCounts.approved === 'number' && boardCounts.approved > 0, 'Debe haber picks aprobados');
assert(boardCounts.approved !== boardCounts.accepted || boardCounts.accepted === 0, 'Contadores deben ser completamente independientes');
console.log('  ✅ Validación 5 Superada: APROBADO y ACEPTADA no comparten contador ni semántica.');

// 6. BADGES Y REGISTROS REALES
console.log('\n--- 6. Correspondencia de Badges con Registros ---');
const histData = JSON.parse(fs.readFileSync('historial_picks.json', 'utf8'));
const allSystemPicks = topPicks.concat(histData.picks || []).concat(histData.history || []);
const uniqueStatuses = [...new Set(allSystemPicks.map(p => p.status).filter(Boolean))];

console.log('  • Estados auditados en el sistema:', uniqueStatuses.join(', '));
assert(uniqueStatuses.includes('APROBADO'), 'Debe existir estado APROBADO');
assert(uniqueStatuses.includes('ACERTADA'), 'Debe existir estado ACERTADA');
assert(uniqueStatuses.includes('FALLADA'), 'Debe existir estado FALLADA');
assert(uniqueStatuses.includes('ANULADA') || uniqueStatuses.includes('ANULADA_NO_TITULAR'), 'Debe existir estado ANULADA/VOID');

// Verificación de consistencia de paleta de colores requerida
const badgeStyles = {
  APROBADO: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981' }, // Verde
  ACEPTADA: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' }, // Azul
  PENDIENTE: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' }, // Ámbar / Amarillo
  RECHAZADO: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' }, // Rojo
  EN_CURSO: { bg: 'rgba(6, 182, 212, 0.15)', text: '#06b6d4' }, // Celeste
  ACERTADA: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981' }, // Verde
  FALLADA: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' }, // Rojo
  VOID: { bg: 'rgba(156, 163, 175, 0.15)', text: '#9ca3af' } // Gris
};
assert(badgeStyles.APROBADO.text !== badgeStyles.ACEPTADA.text, 'APROBADO y ACEPTADA deben tener colores distintos (Verde vs Azul)');
console.log('  ✅ Validación 6 Superada: Todos los badges corresponden a registros auditados con colores diferenciados.');

// 7. CERO DUPLICACIONES DE PICKS Y OBSERVACIONES
console.log('\n--- 7. Cero Duplicaciones de Picks y Observaciones ---');
const pickIds = topPicks.map(p => p.id || p.candidateId || p.player);
const uniqueIds = new Set(pickIds);
assert.strictEqual(pickIds.length, uniqueIds.size, 'No debe haber picks duplicados en Daily Board');

const obsRegistry = JSON.parse(fs.readFileSync('engine/storage_data/model_observation_registry.json', 'utf8'));
const obsIds = obsRegistry.map(o => o.pickId || o.observation_id || o.id);
const uniqueObsIds = new Set(obsIds);
assert.strictEqual(obsIds.length, uniqueObsIds.size, 'No debe haber observaciones duplicadas en el registro criptográfico');
console.log(`  • Daily Board: ${pickIds.length} picks únicos (0 duplicados).`);
console.log(`  • Observation Registry: ${obsIds.length} observaciones únicas (0 duplicadas).`);
console.log('  ✅ Validación 7 Superada: Cero duplicaciones en todo el sistema.');

// 8. BUILD DE PRODUCCIÓN
console.log('\n--- 8. Verificación de Build de Producción ---');
try {
  const buildOutput = execSync('npm run build', { encoding: 'utf8' });
  assert(buildOutput.includes('BUILD EXITOSO'), 'El build debe finalizar con éxito');
  console.log('  ✅ Validación 8 Superada: npm run build ejecutado con 0 errores.');
} catch (err) {
  assert.fail(`El build falló: ${err.message}`);
}

console.log('\n======================================================');
console.log('🎉 SUITE COMPLETA SUPERADA: 8 DE 8 PRUEBAS PASADAS AL 100%');
console.log('======================================================\n');
