/**
 * TEST DE VERIFICACIÓN FASE 10.1: SESGO DE SELECCIÓN, AUDITORÍA CONTRAFACTUAL Y CORRELACIÓN DE EVENTOS
 * Valida:
 * 1. 5 Universos de Observación: Descubiertas, Investigadas, Elegibles, Aprobadas y Rechazadas.
 * 2. Probabilidades y EVs Independientes: Modelo B, Modelo C y Ensamble calculados y congelados por separado.
 * 3. Auditoría de Correlación: Agrupación canónica por partido (N picks vs N eventos independientes).
 * 4. Evaluación Contrafactual: Desempeño separado de aprobadas, rechazadas y descartadas por EV.
 * 5. Aislamiento Operativo: Bloqueo de apuestas, telegram y órdenes automatizadas bajo Shadow Mode.
 */

const assert = require('assert');
const config = require('../config');
const tracker = require('../prediction/observationTracker');
const candidates = require('../storage_data/research_candidates.json');
const predictions = require('../storage_data/model_predictions.json');
const results = require('../storage_data/pick_results.json');
const fs = require('fs');

console.log('🧪 Iniciando verificación de Fase 10.1: Sesgo de Selección y Evaluación Contrafactual...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

async function runTests() {
  // Inicializar tracker con datos consolidados
  tracker.initializeFromHistory(candidates, predictions, results);
  const registry = tracker.getRegistry().filter(o => !o.isTestPick);

  // --- 1. SEPARACIÓN DE LOS 5 UNIVERSOS DE OBSERVACIÓN ---
  console.log('--- 1. Separación de los 5 Universos de Observación ---');

  const report = tracker.generateCheckpointReport();
  const u = report.universesCount;

  it('Debe registrar de forma diferenciada candidatos descubiertos', () => {
    assert(u.discovered >= 40, `Candidatos descubiertos deben ser >= 40 (Actual: ${u.discovered})`);
  });

  it('Debe registrar candidatos investigados con datos suficientes', () => {
    assert(u.investigated >= 35, `Candidatos investigados deben ser >= 35 (Actual: ${u.investigated})`);
  });

  it('Debe registrar candidatos elegibles según filtro EV (+7.0%)', () => {
    assert(u.eligible >= 30, `Candidatos elegibles deben ser >= 30 (Actual: ${u.eligible})`);
  });

  it('Debe registrar candidatos aprobados explícitamente por Elena', () => {
    assert(u.approved >= 10, `Candidatos aprobados deben ser >= 10 (Actual: ${u.approved})`);
  });

  it('Debe registrar candidatos rechazados por Elena o filtros', () => {
    assert(u.rejected >= 2, `Candidatos rechazados deben ser >= 2 (Actual: ${u.rejected})`);
  });

  // --- 2. REGISTRO INDEPENDIENTE DE PROBABILIDADES Y EVS ---
  console.log('\n--- 2. Registro Independiente de Probabilidades y EVs ---');

  const sampleObs = registry.find(o => o.pickId === 'cand_1795110774831_6k1oex');
  it('Debe almacenar probModelB, probModelC y originalProb (ensamble) por separado', () => {
    assert.strictEqual(sampleObs.probModelB, 0.70);
    assert.strictEqual(sampleObs.probModelC, 0.60);
    assert.strictEqual(sampleObs.originalProb, 0.9684);
  });

  it('Debe calcular y congelar evModelB, evModelC y evEnsemble de forma independiente', () => {
    // Bruno Gomes cuota 1.83
    // EV_B = (0.70 * 1.83) - 1 = +28.1%
    // EV_C = (0.60 * 1.83) - 1 = +9.8%
    // EV_Ens = (0.9684 * 1.83) - 1 = +77.2%
    assert.strictEqual(sampleObs.evPercentageModelB, 28.1);
    assert.strictEqual(sampleObs.evPercentageModelC, 9.8);
    assert.strictEqual(sampleObs.evPercentageEnsemble, 77.2);
  });

  // --- 3. AUDITORÍA DE CORRELACIÓN ENTRE SELECCIONES Y EVENTOS ---
  console.log('\n--- 3. Auditoría de Correlación y Eventos Independientes ---');

  const eventAudit = tracker.auditEventCorrelation();

  it('Debe contabilizar tanto el número de picks como el número de eventos únicos', () => {
    assert.strictEqual(eventAudit.totalPicks, 18);
    assert.strictEqual(eventAudit.uniqueEvents, 8);
    assert.strictEqual(eventAudit.ratioPicksPerEvent, 2.25);
  });

  it('Debe identificar partidos con múltiples picks (multi-pick matches)', () => {
    assert(eventAudit.multiPickEventsCount >= 3, 'Debe haber al menos 3 partidos con múltiples selecciones');
  });

  it('Debe identificar resultados adversos explicados por eventos compartidos', () => {
    // Internacional vs Vasco concentró 3 fallos en el mismo partido
    // Arsenal vs Lyon concentró 2 fallos en el mismo partido
    assert(eventAudit.sharedAdverseEventsCount >= 2, 'Debe identificar al menos 2 partidos con pérdidas agrupadas');
  });

  it('Debe identificar selecciones altamente correlacionadas en el mismo evento', () => {
    const interCluster = eventAudit.highlyCorrelatedClusters.find(c => c.eventId === 'internacional__vasco da gama');
    assert(interCluster, 'Debe detectar el cluster de remates de Internacional');
    assert.strictEqual(interCluster.correlatedPicksCount, 2);
  });

  // --- 4. EVALUACIÓN CONTRAFACTUAL ---
  console.log('\n--- 4. Evaluación Contrafactual de Filtros ---');

  const counterfactuals = tracker.evaluateCounterfactuals();

  it('Debe evaluar contrafactualmente candidatos investigados vs elegibles vs aprobados', () => {
    assert(counterfactuals.investigatedDiscovered, 'Debe evaluar investigados');
    assert(counterfactuals.passedEV, 'Debe evaluar passedEV');
    assert(counterfactuals.approvedByElena, 'Debe evaluar approvedByElena');
    assert.strictEqual(counterfactuals.investigatedDiscovered.N, 18);
    assert.strictEqual(counterfactuals.passedEV.N, 18);
    assert.strictEqual(counterfactuals.approvedByElena.N, 13);
  });

  it('Debe auditar el comportamiento de candidatos con EV < +7.0% en Model C', () => {
    // 4 picks tuvieron EV_C < 7% (Gustavo Marques Alves, Gustavo Marques faltas, Progreso corners, Inter remates)
    const lowEVC = counterfactuals.discardedByLowEV_ModelC;
    assert.strictEqual(lowEVC.N, 4);
    assert.strictEqual(lowEVC.hits, 3);
    assert.strictEqual(lowEVC.losses, 1);
    assert.strictEqual(lowEVC.profitUnits, 1.18);
    assert.strictEqual(lowEVC.yieldPct, 29.5);
  });

  // --- 5. AISLAMIENTO OPERATIVO DE SHADOW MODE ---
  console.log('\n--- 5. Aislamiento Operativo de Shadow Mode ---');

  it('Configuración debe prohibir apuestas reales, telegram y órdenes automatizadas', () => {
    assert.strictEqual(config.shadowMode.allowRealBets, false);
    assert.strictEqual(config.shadowMode.allowTelegramPicks, false);
    assert.strictEqual(config.shadowMode.allowAutomatedOrders, false);
  });

  it('Archivo picks_hoy.json debe contener marcas explícitas de simulación', () => {
    const picksData = JSON.parse(fs.readFileSync(config.paths.picksHoy, 'utf8'));
    assert.strictEqual(picksData.shadow_mode, true);
    assert.strictEqual(picksData.is_operative_recommendation, false);
    assert(picksData.top_picks.every(p => p.shadow_mode === true && p.is_operative_recommendation === false));
  });

  it('Ningún candidato vetado por Elena puede ingresar a top_picks', () => {
    const picksData = JSON.parse(fs.readFileSync(config.paths.picksHoy, 'utf8'));
    const rejectedIds = new Set(candidates.filter(c => c.status === 'RECHAZADO' || c.riskVerdict?.finalStatus === 'RECHAZADO').map(c => c.id));
    const leaked = picksData.top_picks.filter(p => rejectedIds.has(p.id));
    assert.strictEqual(leaked.length, 0);
  });

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO FASE 10.1: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando pruebas:', err);
  process.exit(1);
});
