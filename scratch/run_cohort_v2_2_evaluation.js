const fs = require('fs');
const path = require('path');
const ShadowLabRunnerV2_2 = require('../engine/experimental/shadowLabRunnerV2_2');
const ShadowLabStore = require('../engine/experimental/shadowLabStore');
const ShadowLabEvaluator = require('../engine/experimental/shadowLabEvaluator');

const cohortPath = path.join(__dirname, '../engine/storage_data/shadow_lab_cohort_v2_2.json');
const store = new ShadowLabStore(cohortPath);
const runner = new ShadowLabRunnerV2_2({ store });

const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));

console.log('=== EVALUACIÓN COMPARATIVA COHORTE SHADOW V2.2 HISTORICAL INTEGRATION ===\n');

// 1. Vincular liquidaciones reales
let settledCount = 0;
picksHoy.top_picks.forEach(p => {
  if (p.is_settled || p.sports_result === 'ACERTADA' || p.sports_result === 'FALLADA' || p.sports_result === 'ANULADA_LINEUP') {
    const isWon = p.sports_result === 'ACERTADA';
    const isVoid = p.sports_result === 'ANULADA_LINEUP' || (p.status && p.status.includes('ANULADA'));
    const isLost = !isWon && !isVoid;
    const odds = Number(p.odds || 1.80);
    const pnl = isWon ? Number((odds - 1).toFixed(2)) : (isVoid ? 0.0 : -1.0);

    store.settlePrediction(p.id, {
      status: isWon ? 'ACERTADA' : (isVoid ? 'ANULADA' : 'FALLADA'),
      actualOutcome: isWon ? 1 : 0,
      isWon,
      isVoid,
      profit: pnl,
      closingOdds: odds,
      settledAt: new Date().toISOString()
    });
    settledCount++;
  }
});

console.log('Total de predicciones liquidadas en Cohorte V2.2:', settledCount);

// 2. Ejecutar evaluador probabilístico con 5,000 réplicas
const evaluator = new ShadowLabEvaluator(store);
const report = evaluator.evaluatePerformance({ replications: 5000 });

console.log('\n--- MÉTRICAS PROBABILÍSTICAS V1 VS V2.2 (5,000 Réplicas Cluster Bootstrap) ---');
console.log('Muestra total evaluada (no nula):', report.sampleSize);
console.log('Eventos nulos auditados (VOID):', report.voidCount);
console.log('Partidos independientes (Clusters matchId):', report.independentMatchesCount);

console.log('\nBrier Score:');
console.log('  V1 (Producción):', report.probabilisticComparison.brierScore.v1);
console.log('  V2.2 (Calibrado):', report.probabilisticComparison.brierScore.v2);
console.log('  Diferencia (V2.2 - V1):', report.probabilisticComparison.brierScore.diffPointEstimate);
console.log('  Intervalo de Confianza 95% Bootstrap:', report.probabilisticComparison.brierScore.diff95Ci);
console.log('  ¿Es V2.2 superior en Brier?:', report.probabilisticComparison.brierScore.isV2Better);
console.log('  ¿Estadísticamente significativo al 95%?:', report.probabilisticComparison.brierScore.isStatisticallySignificant);

console.log('\nLog Loss:');
console.log('  V1 (Producción):', report.probabilisticComparison.logLoss.v1);
console.log('  V2.2 (Calibrado):', report.probabilisticComparison.logLoss.v2);
console.log('  Diferencia (V2.2 - V1):', report.probabilisticComparison.logLoss.diffPointEstimate);
console.log('  Intervalo de Confianza 95% Bootstrap:', report.probabilisticComparison.logLoss.diff95Ci);
console.log('  ¿Es V2.2 superior en LogLoss?:', report.probabilisticComparison.logLoss.isV2Better);
console.log('  ¿Estadísticamente significativo al 95%?:', report.probabilisticComparison.logLoss.isStatisticallySignificant);

console.log('\nExpected Calibration Error (ECE):');
console.log('  ECE V1:', report.probabilisticComparison.calibration.eceV1 + '%');
console.log('  ECE V2.2:', report.probabilisticComparison.calibration.eceV2 + '%');

console.log('\nCurva de Calibración V2.2 por Decilos:');
console.table(report.probabilisticComparison.calibration.curveV2);
