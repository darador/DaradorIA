/**
 * SUITE DE TESTS OBLIGATORIOS — FASE 1: DATA QUALITY & VALUE ENGINE
 * 
 * Verifica rigurosamente los casos exigidos:
 * 1. Frecuencia histórica 10/10 (prevención de Mirage Trend sin recortar a la fuerza).
 * 2. Frecuencia histórica 0/10 (prevención de probabilidad cero).
 * 3. Muestras pequeñas (n=3, n=5) vs Muestras sólidas (n=20).
 * 4. Tratamiento de datos faltantes e inconsistentes (DQE).
 * 5. Casos de cuotas 1.50, 1.80, 2.00 y 2.20.
 * 6. Validación matemática de EV bruto vs EV ajustado por incertidumbre.
 * 7. Mercados binarios y de conteo (Poisson vs Binomial Negativa).
 * 8. Detección de EV extraordinario (> +25% en cuotas > 1.80) con etiquetado de anomalía.
 */

const DataQualityEngine = require('../quality/dataQualityEngine');
const CalibratedProbabilityModel = require('../quality/calibratedProbabilityModel');
const ValueEngine = require('../value/valueEngine');

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 INICIANDO SUITE DE TESTS: FASE 1 (QUALITY & VALUE ENGINES)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failed++;
    }
  }

  const dqe = new DataQualityEngine();
  const probModel = new CalibratedProbabilityModel();
  const ve = new ValueEngine();

  // --- TEST 1: FRECUENCIA HISTÓRICA 10/10 (SHRINKAGE BAYESIANO) ---
  console.log('--- 1. Caso 10/10: Racha Perfecta y Shrinkage ---');
  const res10 = probModel.calculateBetaBinomialShrinkage(10, 10, 'remates totales');
  assert(res10.pPosterior < 1.0, `Probabilidad posterior es estrictamente menor a 1.0 (obtenido: ${res10.pPosterior})`);
  assert(res10.pPosterior >= 0.75 && res10.pPosterior <= 0.88, `Probabilidad regularizada en rango realista para n=10 (obtenido: ${res10.pPosterior})`);
  assert(res10.shrinkageApplied > 0.10, `Shrinkage significativo aplicado frente a racha 100% (reducción: -${res10.shrinkageApplied})`);

  // --- TEST 2: FRECUENCIA HISTÓRICA 0/10 (PREVENCIÓN DE PROBABILIDAD CERO) ---
  console.log('\n--- 2. Caso 0/10: Racha Negativa y Prior ---');
  const res0 = probModel.calculateBetaBinomialShrinkage(0, 10, 'remates totales');
  assert(res0.pPosterior > 0.0, `Probabilidad posterior es estrictamente mayor a 0.0 (obtenido: ${res0.pPosterior})`);
  assert(res0.pPosterior >= 0.15 && res0.pPosterior <= 0.35, `Probabilidad no colapsa a cero gracias al prior (obtenido: ${res0.pPosterior})`);

  // --- TEST 3: TAMAÑO DE MUESTRA Y CONVERGENCIA ASINTÓTICA ---
  console.log('\n--- 3. Tamaño de Muestra: n=3 vs n=10 vs n=50 ---');
  const resSmall = probModel.calculateBetaBinomialShrinkage(3, 3, 'remates totales');
  const resMed = probModel.calculateBetaBinomialShrinkage(10, 10, 'remates totales');
  const resLarge = probModel.calculateBetaBinomialShrinkage(50, 50, 'remates totales');
  assert(resSmall.pPosterior < resMed.pPosterior, `Muestra pequeña n=3 tiene menor confianza que n=10 (${resSmall.pPosterior} < ${resMed.pPosterior})`);
  assert(resMed.pPosterior < resLarge.pPosterior, `Muestra grande n=50 prevalece sobre el prior (${resMed.pPosterior} < ${resLarge.pPosterior})`);
  assert(resLarge.pPosterior > 0.90, `Con n=50 observaciones favorables, la evidencia empírica domina al prior (${resLarge.pPosterior})`);

  // --- TEST 4: DATA QUALITY ENGINE (VALIDACIÓN DE INTEGRIDAD Y ESTADOS) ---
  console.log('\n--- 4. Data Quality Engine: VALID, LIMITED e INVALID ---');
  // Candidato completo y válido
  const candValid = {
    playerOrTeam: 'Kylian Mbappé',
    match: 'Real Madrid vs Barcelona',
    market: 'Remates totales',
    line: 'Más de 2.5',
    historicalValues: [4, 3, 5, 2, 4, 3, 5, 4, 3, 4, 2, 5, 3, 4, 3], // n=15
    starts: 14,
    avgMinutes: 84
  };
  const qValid = dqe.assessQuality(candValid);
  assert(qValid.status === 'VALID', `Candidato completo clasificado como VALID (${qValid.status}, score: ${qValid.qualityScore})`);

  // Candidato con muestra reducida (LIMITED)
  const candLimited = {
    playerOrTeam: 'Julián Álvarez',
    match: 'Atlético Madrid vs Sevilla',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    historicalValues: [2, 1, 3, 2, 1, 2, 1, 2], // n=8
    starts: 6,
    avgMinutes: 70
  };
  const qLimited = dqe.assessQuality(candLimited);
  assert(qLimited.status === 'LIMITED', `Candidato con n=8 clasificado como LIMITED (${qLimited.status}, warnings: ${qLimited.warnings.length})`);

  // Candidato con datos inconsistentes / sin minutos (INVALID)
  const candInvalid = {
    playerOrTeam: 'Suplente FC',
    match: 'Equipo A vs Equipo B',
    market: 'Faltas cometidas',
    line: 'Más de 0.5',
    historicalValues: [],
    starts: 0,
    avgMinutes: 12
  };
  const qInvalid = dqe.assessQuality(candInvalid);
  assert(qInvalid.status === 'INVALID', `Candidato sin histórico clasificado como INVALID (${qInvalid.status}, issues: ${qInvalid.issues.length})`);

  // --- TEST 5: EVALUACIÓN DE DISTRIBUCIONES DE CONTEO (POISSON VS BINOMIAL NEGATIVA) ---
  console.log('\n--- 5. Distribuciones de Conteo: Poisson vs Binomial Negativa ---');
  // Serie homogénea (Poisson)
  const homValues = [2, 2, 3, 2, 1, 2, 3, 2, 2, 1]; // Var ~ Mean
  const homDist = probModel.calculateCountDistribution(homValues, 2);
  assert(homDist.modelUsed === 'Poisson Ajustado', `Serie con baja dispersión usa Poisson (${homDist.modelUsed}, Var/Mean: ${homDist.varianceToMean})`);

  // Serie con alta sobredispersión (0, 0, 8, 0, 7, 0, 9)
  const overValues = [0, 0, 7, 0, 1, 8, 0, 0, 6, 0];
  const overDist = probModel.calculateCountDistribution(overValues, 2);
  assert(overDist.modelUsed.includes('Binomial Negativa'), `Serie sobredispersa activa Binomial Negativa (${overDist.modelUsed}, Var/Mean: ${overDist.varianceToMean})`);

  // --- TEST 6: VALUE ENGINE Y CUOTAS (1.50, 1.80, 2.00, 2.20) ---
  console.log('\n--- 6. Value Engine: Cuotas 1.50, 1.80, 2.00 y 2.20 ---');
  const v150 = ve.evaluateValue({ pCalibrated: 0.72, odds: 1.50, uncertaintyIndex: 0.12 });
  assert(v150.grossEvPct === 8.0, `Cuota 1.50 con p=0.72 calcula EV bruto exacto +8.0% (obtenido: ${v150.grossEvPct}%)`);
  assert(v150.fairOdds === 1.39, `Cuota justa calculada correctamente: 1.39 (obtenido: ${v150.fairOdds})`);

  const v180 = ve.evaluateValue({ pCalibrated: 0.60, odds: 1.80, uncertaintyIndex: 0.15 });
  assert(v180.grossEvPct === 8.0, `Cuota 1.80 con p=0.60 calcula EV bruto exacto +8.0% (obtenido: ${v180.grossEvPct}%)`);
  assert(v180.adjustedEv < v180.grossEv, `EV ajustado por incertidumbre es conservador respecto al bruto (${v180.adjustedEvPct}% < ${v180.grossEvPct}%)`);

  const v200 = ve.evaluateValue({ pCalibrated: 0.55, odds: 2.00, uncertaintyIndex: 0.18 });
  assert(v200.grossEvPct === 10.0, `Cuota 2.00 con p=0.55 calcula EV bruto +10.0% (obtenido: ${v200.grossEvPct}%)`);

  const v220 = ve.evaluateValue({ pCalibrated: 0.50, odds: 2.20, uncertaintyIndex: 0.18 });
  assert(v220.grossEvPct === 10.0, `Cuota 2.20 con p=0.50 calcula EV bruto +10.0% (obtenido: ${v220.grossEvPct}%)`);

  // --- TEST 7: DETECCIÓN DE ANOMALÍAS DE EV EXTRAORDINARIO (> +25% en cuota > 1.80) ---
  console.log('\n--- 7. Detección de Anomalías de EV Extraordinario ---');
  // Simular un pick con EV del 40% (ej. p=0.70 en cuota 2.00)
  const vExtraordinary = ve.evaluateValue({ pCalibrated: 0.70, odds: 2.00, uncertaintyIndex: 0.22, sampleSize: 10 });
  assert(vExtraordinary.anomaly.detected === true, `Detecta correctamente la anomalía de EV extraordinario (+${vExtraordinary.grossEvPct}% en @2.00)`);
  assert(vExtraordinary.valueRating === 'SUSPICIOUS_HIGH_VALUE', `Clasifica el rating como SUSPICIOUS_HIGH_VALUE para forzar re-validación`);
  assert(vExtraordinary.grossEvPct === 40.0, `No recorta artificialmente el EV matemático (mantiene +40.0% íntegro)`);

  // Pick con EV normal no dispara anomalía
  const vNormal = ve.evaluateValue({ pCalibrated: 0.58, odds: 1.90, uncertaintyIndex: 0.14, sampleSize: 20 });
  assert(vNormal.anomaly.detected === false, `EV normal (+10.2% en @1.90) no dispara falsa anomalía`);
  assert(vNormal.valueRating === 'STRONG_VALUE', `Califica oportunidad estándar como STRONG_VALUE`);

  console.log('\n================================================================');
  console.log(`📊 RESUMEN FINAL: ${passed} pruebas superadas de ${passed + failed}`);
  console.log(`Resultado: ${failed === 0 ? '🟢 TODAS LAS PRUEBAS PASARON EXITOSAMENTE' : '🔴 FALLOS ENCONTRADOS'}`);
  console.log('================================================================\n');

  return { passed, failed, success: failed === 0 };
}

if (require.main === module) {
  runTestSuite().then(res => {
    if (!res.success) process.exit(1);
  });
}

module.exports = runTestSuite;
