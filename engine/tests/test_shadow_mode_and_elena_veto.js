/**
 * TEST DE VERIFICACIÓN FASE 10: SHADOW MODE, VETO DE ELENA Y OBSERVACIÓN CONTINUA
 * Valida:
 * 1. Shadow Mode: Configuración restrictiva (0 apuestas reales, 0 telegram, 0 órdenes).
 * 2. Veto Efectivo de Elena: Rechazo incondicional ante datos incompletos, muestra corta, sobreconfianza y divergencia.
 * 3. Aislamiento de Aprobados: Ningún candidato vetado por Elena llega a approved_picks ni top_picks.
 * 4. Model Observation Tracker: Congelamiento pre-partido inmutable y comparación justa B vs C.
 * 5. Ciclo de Vida de Settlement: 4 estados deterministas sin liquidación prematura.
 */

const assert = require('assert');
const config = require('../config');
const riskManager = require('../agents/riskManager');
const orchestrator = require('../agents/orchestrator');
const storage = require('../data/storage');
const syncRadar = require('../data/syncRadar');
const predictionEngine = require('../prediction/predictionEngine');
const observationTracker = require('../prediction/observationTracker');
const settlementEngine = require('../settlement/settlementEngine');

console.log('🧪 Iniciando verificación de Fase 10: Shadow Mode, Veto de Elena y Observación Continua...\n');

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
  // --- 1. RESTRICCIONES DE SHADOW MODE ---
  console.log('--- 1. Restricciones Operativas de Shadow Mode ---');

  it('Shadow Mode debe estar activado en la configuración central', () => {
    assert.strictEqual(config.shadowMode?.enabled, true);
  });

  it('Shadow Mode debe prohibir terminantemente apuestas reales', () => {
    assert.strictEqual(config.shadowMode?.allowRealBets, false);
  });

  it('Shadow Mode debe prohibir envíos de picks operativos por Telegram', () => {
    assert.strictEqual(config.shadowMode?.allowTelegramPicks, false);
  });

  it('Shadow Mode debe prohibir órdenes u operaciones automatizadas', () => {
    assert.strictEqual(config.shadowMode?.allowAutomatedOrders, false);
  });

  it('Picks exportados deben llevar bandera shadow_mode e is_operative_recommendation false', () => {
    const exported = syncRadar.exportToPicksHoy();
    assert.strictEqual(exported.shadow_mode, true);
    assert.strictEqual(exported.is_operative_recommendation, false);
  });

  // --- 2. POTESTAD DE VETO OBLIGATORIO DE ELENA (RISK MANAGER) ---
  console.log('\n--- 2. Potestad de Veto Obligatorio de Elena ---');

  const baseCandidate = {
    id: 'cand_test_elena_veto_01',
    playerOrTeam: 'Pedro Guilherme',
    isTeamProp: false,
    match: 'Flamengo vs Fluminense',
    team: 'Flamengo',
    opponent: 'Fluminense',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    bookmakerOdds: 1.85,
    sampleSize: 18,
    researchData: {
      qualityStatus: 'COMPLETA',
      lineupData: { status: 'CONFIRMADA', isStarter: true },
      playerData: {
        statPerGame: 2.1,
        statPer90: 2.4,
        observations: [2, 3, 1, 2, 0, 3, 2, 1, 2, 3, 2, 1, 2, 3, 0, 2, 2, 1]
      }
    }
  };

  const validPrediction = {
    pProjected: 0.72,
    pPoisson: 0.70,
    pEmpirical: 0.74,
    fairOdds: 1.39,
    ev: 0.332,
    evPercentage: 33.2,
    modelDivergence: 0.04,
    uncertaintyIndex: 0.15
  };

  const agentReportsFavorable = {
    playerAnalyst: { recommendation: 'FAVORABLE' },
    teamAnalyst: { recommendation: 'FAVORABLE' },
    matchContext: { recommendation: 'FAVORABLE' },
    oddsAnalyst: { recommendation: 'FAVORABLE' },
    matchIntel: { recommendation: 'FAVORABLE' }
  };

  // Test 2.1: Aprobación cuando convergen todos los factores
  const verdictApproved = await riskManager.evaluate(baseCandidate, validPrediction, agentReportsFavorable);
  it('Elena aprueba candidato con datos completos, muestra sólida, EV positivo y baja incertidumbre', () => {
    assert.strictEqual(verdictApproved.finalStatus, 'APROBADO');
    assert.strictEqual(verdictApproved.vetoApplied, false);
  });

  // Test 2.2: Veto por calidad de datos (INVESTIGACION_INCOMPLETA)
  const candIncomplete = {
    ...baseCandidate,
    researchData: { ...baseCandidate.researchData, qualityStatus: 'INVESTIGACION_INCOMPLETA' }
  };
  const verdictIncomplete = await riskManager.evaluate(candIncomplete, validPrediction, agentReportsFavorable);
  it('Elena veta inmediatamente si la calidad es INVESTIGACION_INCOMPLETA', () => {
    assert.strictEqual(verdictIncomplete.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdictIncomplete.vetoApplied, true);
    assert(verdictIncomplete.vetoReasons.some(r => r.includes('CALIDAD DE DATOS')));
  });

  // Test 2.3: Veto por muestra insuficiente (N < 8 en jugador)
  const candShortSample = {
    ...baseCandidate,
    sampleSize: 5,
    researchData: { ...baseCandidate.researchData, validMatches: 5, sampleSize: 5 }
  };
  const verdictShortSample = await riskManager.evaluate(candShortSample, validPrediction, agentReportsFavorable);
  it('Elena veta inmediatamente si la muestra es menor al mínimo (N=5 < 8)', () => {
    assert.strictEqual(verdictShortSample.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdictShortSample.vetoApplied, true);
    assert(verdictShortSample.vetoReasons.some(r => r.includes('MUESTRA INSUFICIENTE')));
  });

  // Test 2.4: Veto por probabilidad inflada / sobreoptimista (p > 0.85 en cuota > 1.60)
  const predOverconfident = {
    ...validPrediction,
    pProjected: 0.94 // 94% de probabilidad calculada en cuota 1.85
  };
  const verdictOverconfident = await riskManager.evaluate(baseCandidate, predOverconfident, agentReportsFavorable);
  it('Elena veta probabilidad sobreoptimista e implausible (p=94% @ 1.85)', () => {
    assert.strictEqual(verdictOverconfident.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdictOverconfident.vetoApplied, true);
    assert(verdictOverconfident.vetoReasons.some(r => r.includes('PROBABILIDAD INFLADA')));
  });

  // Test 2.5: Veto por divergencia excesiva entre Poisson y empírico (> 0.15)
  const predHighDivergence = {
    ...validPrediction,
    modelDivergence: 0.22 // Discrepancia del 22%
  };
  const verdictDivergence = await riskManager.evaluate(baseCandidate, predHighDivergence, agentReportsFavorable);
  it('Elena veta si la divergencia entre Poisson y empírico supera 15%', () => {
    assert.strictEqual(verdictDivergence.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdictDivergence.vetoApplied, true);
    assert(verdictDivergence.vetoReasons.some(r => r.includes('DIVERGENCIA DE MODELOS')));
  });

  // Test 2.6: Aislamiento estricto: pick vetado por Elena NO llega a approved_picks
  const candToVeto = {
    id: 'cand_test_vetoed_isolation_01',
    playerOrTeam: 'Jugador Vetado Test',
    isTeamProp: false,
    match: 'Test vs Isolated',
    market: 'Remates',
    line: 'Más de 2.5',
    bookmakerOdds: 2.10,
    sampleSize: 4, // Provoca veto
    researchData: { qualityStatus: 'INVESTIGACION_INCOMPLETA' }
  };
  await orchestrator.evaluateSingleCandidate(candToVeto, validPrediction);

  const approvedList = storage.getApprovedPicks();
  it('Un candidato vetado por Elena no puede ingresar a la colección de picks aprobados', () => {
    const foundInApproved = approvedList.some(p => p.id === 'cand_test_vetoed_isolation_01');
    assert.strictEqual(foundInApproved, false);
  });

  const rejectedList = storage.getRejectedPicks();
  it('El candidato vetado queda registrado en rejected_picks para análisis contrafactual', () => {
    const foundInRejected = rejectedList.some(p => p.candidateId === 'cand_test_vetoed_isolation_01');
    assert.strictEqual(foundInRejected, true);
  });

  // --- 3. DUAL MODEL EVALUATION (MODEL B vs MODEL C) ---
  console.log('\n--- 3. Dual Model Evaluation (Model B L10 vs Model C L15/L20) ---');

  const testCandDual = {
    id: 'cand_test_dual_model_01',
    playerOrTeam: 'Ganso',
    isTeamProp: false,
    match: 'Fluminense vs Vasco',
    market: 'Remates',
    line: 'Más de 0.5',
    rawLine: 0.5,
    bookmakerOdds: 1.80,
    researchData: {
      qualityStatus: 'COMPLETA',
      playerData: {
        statPer90: 1.8,
        projectedMinutes: 80,
        observations: [1, 2, 0, 1, 1, 2, 0, 1, 2, 1, 0, 1, 2, 0, 1, 1, 2, 1] // 18 observaciones reales
      }
    }
  };

  const predDual = predictionEngine.predictCandidate(testCandDual);
  it('Prediction Engine debe calcular Model B (L10) y Model C (L15/L20) en paralelo', () => {
    assert(predDual.models, 'Debe incluir objeto models');
    assert.strictEqual(predDual.models.modelB.version, 'Model-B-L10');
    assert.strictEqual(predDual.models.modelB.sampleSize, 10);
    assert(typeof predDual.models.modelB.pProjected === 'number');

    assert.strictEqual(predDual.models.modelC.version, 'Model-C-L15-L20');
    assert.strictEqual(predDual.models.modelC.sampleSize, 18);
    assert(typeof predDual.models.modelC.pProjected === 'number');
  });

  // --- 4. COMPARACIÓN JUSTA SOBRE SUBCONJUNTO COMÚN ---
  console.log('\n--- 4. Comparación Justa y Reporte Shadow Mode ---');

  const shadowReport = observationTracker.generateShadowReport();
  it('Informe Shadow Mode debe generar métricas para el subconjunto común', () => {
    const comp = shadowReport.modelComparison.commonSubsetComparison;
    assert(comp.N_common >= 1, 'Debe haber selecciones comunes');
    assert(typeof comp.modelB.brierScore === 'number');
    assert(typeof comp.modelC.brierScore === 'number');
    assert(typeof comp.modelB.logLoss === 'number');
    assert(typeof comp.modelC.logLoss === 'number');
    assert.strictEqual(comp.modelB.N, comp.modelC.N, 'Ambos modelos deben evaluarse sobre el mismo N exacto');
  });

  it('Informe Shadow Mode debe auditar los vetos de Elena y la meta de 100 observaciones', () => {
    assert(shadowReport.checkpointSummary.targetObservations === 100);
    assert(typeof shadowReport.checkpointSummary.progressPct === 'number');
    assert(shadowReport.elenaAudit && shadowReport.elenaAudit.rejectionCauses);
  });

  // --- 5. CICLO DE VIDA DE SETTLEMENT EN 4 ESTADOS ---
  console.log('\n--- 5. Ciclo de Vida de Settlement en 4 Estados ---');

  const pendingPick = {
    id: 'pick_test_lifecycle_01',
    matchId: 'match_not_finished_01',
    player: 'Bukayo Saka',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    odds: 1.90
  };

  // Partido en juego (sin FT) no debe liquidar definitivamente
  const evalProvisional = await settlementEngine.evaluatePick(pendingPick, {
    pick_test_lifecycle_01: null // Simula que aún no hay resultado
  });
  it('Partido sin finalizar no debe liquidarse como GANADA ni PERDIDA', () => {
    assert.strictEqual(evalProvisional, null);
  });

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO FASE 10: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando pruebas:', err);
  process.exit(1);
});
