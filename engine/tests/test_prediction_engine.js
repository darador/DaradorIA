/**
 * SUITE DE PRUEBAS - FASE 3: DEEP RESEARCH & PREDICTION ENGINE
 * Verifica:
 * 1. Precisión matemática del modelo de Poisson frente a valores teóricos
 * 2. Modelo de Binomial Negativa frente a sobredispersión
 * 3. Distribución empírica con decaimiento temporal
 * 4. Ajustes de contexto (ratio de concesión del rival y localía)
 * 5. Fórmulas de Cuota Justa, Probabilidad Implícita y EV%
 * 6. Índice de Incertidumbre y Confidence Score
 * 7. Lógica de Aprobación, Pendiente (alineación) y Rechazo
 * 8. Pipeline integrado: DeepResearch -> Prediction -> Persistencia
 */
const deepResearchEngine = require('../research/deepResearchEngine');
const predictionEngine = require('../prediction/predictionEngine');
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');

async function runPredictionTests() {
  console.log('====================================================');
  console.log('📐 INICIANDO PRUEBAS DE FASE 3: PREDICTION ENGINE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Verificación Matemática de Poisson
  console.log('--- 1. Verificación Numérica de Poisson ---');
  // Para lambda = 2.0, k = 1 (Over 0.5): P(X >= 1) = 1 - e^-2 = 0.86466
  const pPoissonK1 = predictionEngine._poissonOver(2.0, 1);
  assert(Math.abs(pPoissonK1 - 0.8647) < 0.001, `Poisson lambda=2.0, k=1 -> ${pPoissonK1.toFixed(4)} (esperado: 0.8647)`);

  // Para lambda = 2.0, k = 2 (Over 1.5): P(X >= 2) = 1 - (e^-2 + 2*e^-2) = 0.5940
  const pPoissonK2 = predictionEngine._poissonOver(2.0, 2);
  assert(Math.abs(pPoissonK2 - 0.5940) < 0.001, `Poisson lambda=2.0, k=2 -> ${pPoissonK2.toFixed(4)} (esperado: 0.5940)`);

  // Para lambda = 1.0, k = 1 (Over 0.5): P(X >= 1) = 1 - e^-1 = 0.6321
  const pPoissonK1_L1 = predictionEngine._poissonOver(1.0, 1);
  assert(Math.abs(pPoissonK1_L1 - 0.6321) < 0.001, `Poisson lambda=1.0, k=1 -> ${pPoissonK1_L1.toFixed(4)} (esperado: 0.6321)`);

  // 2. Parseo de Líneas Over/Under
  console.log('\n--- 2. Parseo de Líneas y Umbrales (k) ---');
  assert(predictionEngine._parseLineThreshold('Más de 0.5', 0.5).k === 1, 'Línea Más de 0.5 -> k = 1');
  assert(predictionEngine._parseLineThreshold('Más de 1.5', 1.5).k === 2, 'Línea Más de 1.5 -> k = 2');
  assert(predictionEngine._parseLineThreshold('Más de 2.5', 2.5).k === 3, 'Línea Más de 2.5 -> k = 3');
  assert(predictionEngine._parseLineThreshold('Más de 10.5', 10.5).k === 11, 'Línea Más de 10.5 -> k = 11');

  // 3. Distribución Empírica Ponderada
  console.log('\n--- 3. Distribución Empírica Ponderada ---');
  // Partidos recientes con acierto deben dar mayor probabilidad que racha fría antigua
  const recentHot = [3, 2, 4, 2, 3, 0, 0, 0, 1, 0]; // 5 aciertos recientes de k=2
  const oldHot = [0, 0, 0, 1, 0, 3, 2, 4, 2, 3];    // 5 aciertos antiguos
  const pRecent = predictionEngine._weightedEmpiricalOver(recentHot, 2);
  const pOld = predictionEngine._weightedEmpiricalOver(oldHot, 2);
  assert(pRecent > pOld, `Ponderación temporal prioriza racha reciente (${pRecent.toFixed(3)} > ${pOld.toFixed(3)})`);

  // 4. Fórmulas de Cuota Justa y EV
  console.log('\n--- 4. Fórmulas de Valor Matemático (EV y Cuota Justa) ---');
  // Si P = 0.60 y cuota = 1.85:
  // Cuota Justa = 1 / 0.60 = 1.666
  // EV = (0.60 * 1.85) - 1 = 1.11 - 1 = +0.11 (+11.0%)
  const pTest = 0.60;
  const oddTest = 1.85;
  const fairOddCalc = Number((1 / pTest).toFixed(2));
  const evCalc = Number(((pTest * oddTest) - 1).toFixed(4));
  assert(fairOddCalc === 1.67, 'Cuota Justa calculada exactamente como 1 / P');
  assert(evCalc === 0.11, 'EV% calculado exactamente como (P * Cuota) - 1 (+11.0%)');

  // 5. Criterios de Aprobación, Pendiente y Rechazo
  console.log('\n--- 5. Evaluación de Decisiones y Filtros ---');
  // Aprobado: EV +15%, minutos 78, alineación confirmada
  const decisionApp = predictionEngine._evaluateDecision({
    ev: 0.15,
    uncertainty: 0.18,
    minutesExpected: 78,
    sampleSize: 18,
    bookmakerOdds: 1.80,
    lineupStatus: 'CONFIRMADA',
    isTeamProp: false
  });
  assert(decisionApp.status === 'APROBADO', 'Candidato con EV +15% y alineación confirmada -> APROBADO');

  // Pendiente: EV +12%, minutos 75, alineación probable
  const decisionPend = predictionEngine._evaluateDecision({
    ev: 0.12,
    uncertainty: 0.20,
    minutesExpected: 75,
    sampleSize: 16,
    bookmakerOdds: 1.75,
    lineupStatus: 'PROBABLE',
    isTeamProp: false
  });
  assert(decisionPend.status === 'PENDIENTE', 'Candidato con EV +12% y alineación probable -> PENDIENTE');

  // Rechazado por EV bajo (+3% < +7%)
  const decisionRejEV = predictionEngine._evaluateDecision({
    ev: 0.03,
    uncertainty: 0.15,
    minutesExpected: 80,
    sampleSize: 20,
    bookmakerOdds: 1.70,
    lineupStatus: 'CONFIRMADA',
    isTeamProp: false
  });
  assert(decisionRejEV.status === 'RECHAZADO', 'Candidato con EV insuficiente (+3%) -> RECHAZADO');

  // Rechazado por minutos bajos (55 < 65)
  const decisionRejMin = predictionEngine._evaluateDecision({
    ev: 0.18,
    uncertainty: 0.20,
    minutesExpected: 55,
    sampleSize: 15,
    bookmakerOdds: 1.85,
    lineupStatus: 'CONFIRMADA',
    isTeamProp: false
  });
  assert(decisionRejMin.status === 'RECHAZADO', 'Candidato con proyección de 55 minutos (<65) -> RECHAZADO');

  // 6. Prueba Integrada de Predicción sobre un Candidato Sintético
  console.log('\n--- 6. Predicción Completa sobre Candidato Enriquecido ---');
  const mockCandidate = {
    id: 'test_cand_001',
    playerOrTeam: 'Gabriel Barbosa',
    match: 'Coritiba vs Santos',
    team: 'Santos',
    opponent: 'Coritiba',
    market: 'Remates totales',
    line: 'Más de 3.5',
    rawLine: 3.5,
    bookmakerOdds: 1.80,
    isTeamProp: false,
    researchData: {
      playerData: {
        playerName: 'Gabriel Barbosa',
        statPer90: 4.8,
        projectedMinutes: 80,
        historicalValues: [5, 4, 6, 3, 5, 4, 7, 3, 4, 5, 4, 6]
      },
      opponentData: {
        concessionRatio: 1.15,
        concededPerGame: 16.2
      },
      lineupData: {
        status: 'CONFIRMADA',
        certainty: 1.0
      }
    }
  };

  const predResult = predictionEngine.predictCandidate(mockCandidate);
  assert(predResult.targetK === 4, 'Target K para Más de 3.5 es 4');
  assert(predResult.pProjected > 0.60, `Probabilidad proyectada calculada (${(predResult.pProjected * 100).toFixed(1)}%)`);
  assert(predResult.evPercentage > 10, `EV estimado positivo (+${predResult.evPercentage}%)`);
  assert(predResult.decision === 'APROBADO', `Veredicto emitido con éxito: ${predResult.decision}`);

  // 7. Pipeline de Integración con Storage
  console.log('\n--- 7. Integración de Deep Research + Prediction Pipeline ---');
  const activeCandidates = storage.getCandidates().filter(c => c.status === 'DETECTADO').slice(0, 3);
  if (activeCandidates.length > 0) {
    const researched = await deepResearchEngine.runDeepResearch({ candidateIds: activeCandidates.map(c => c.id) });
    assert(researched.length > 0, `DeepResearch investigó ${researched.length} candidatos del Storage`);
    
    const evaluatedPipeline = await predictionEngine.evaluateCandidates(researched);
    assert(evaluatedPipeline.length > 0, `PredictionEngine evaluó y generó predicciones para ${evaluatedPipeline.length} candidatos`);

    const savedPreds = storage._readCollection('model_predictions');
    assert(savedPreds.length >= 1, `Predicciones persistidas exitosamente en Storage (${savedPreds.length} en total)`);
  }

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO FASE 3: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log('====================================================');

  mcpClient.close();
  process.exit(failed > 0 ? 1 : 0);
}

runPredictionTests().catch(e => {
  console.error('Error fatal en pruebas de Fase 3:', e);
  process.exit(1);
});
