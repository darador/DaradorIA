/**
 * TEST DE VERIFICACIÓN DE FASE 7: EVALUACIÓN Y BACKTESTING
 * Valida:
 * 1. Brier Score exacto
 * 2. Log-Loss (Entropía cruzada)
 * 3. Rendimiento financiero (Yield, Win Rate, Max Drawdown)
 * 4. Calibración por deciles
 * 5. Desglose por mercado
 */
const assert = require('assert');
const evaluator = require('../evaluation/evaluator');
const backtester = require('../evaluation/backtester');

console.log('🧪 Iniciando verificación de Fase 7: Evaluación y Backtesting...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// Dataset controlado para verificación matemática
const testDataset = [
  {
    id: 'bet_01',
    status: 'GANADA',
    odds: 1.80,
    stake: 1.0,
    profit: 0.80,
    pProjected: 0.70, // (0.70 - 1)^2 = 0.09
    market: 'Remates al arco'
  },
  {
    id: 'bet_02',
    status: 'PERDIDA',
    odds: 1.90,
    stake: 1.0,
    profit: -1.0,
    pProjected: 0.60, // (0.60 - 0)^2 = 0.36
    market: 'Remates al arco'
  },
  {
    id: 'bet_03',
    status: 'GANADA',
    odds: 1.75,
    stake: 1.0,
    profit: 0.75,
    pProjected: 0.80, // (0.80 - 1)^2 = 0.04
    market: 'Faltas cometidas'
  },
  {
    id: 'bet_04',
    status: 'GANADA',
    odds: 2.00,
    stake: 1.0,
    profit: 1.00,
    pProjected: 0.65, // (0.65 - 1)^2 = 0.1225
    market: 'Remates al arco'
  }
];

const report = evaluator.evaluatePerformance(testDataset);

// 1. Verificación de Brier Score
// Suma Brier = 0.09 + 0.36 + 0.04 + 0.1225 = 0.6125 / 4 = 0.153125
it('Brier Score debe calcularse exactamente según la fórmula cuadrática', () => {
  assert(report.probabilisticMetrics.brierScore !== null, 'Brier score no debe ser null');
  const expectedBrier = 0.1531;
  const diff = Math.abs(report.probabilisticMetrics.brierScore - expectedBrier);
  assert(diff < 0.001, `Brier esperado ${expectedBrier}, obtenido ${report.probabilisticMetrics.brierScore}`);
  assert.strictEqual(report.probabilisticMetrics.brierEvaluation, 'Excelente (Alta resolución)');
});

// 2. Verificación de Log-Loss
it('Log-Loss debe calcular la entropía cruzada probabilística', () => {
  assert(report.probabilisticMetrics.logLoss !== null, 'LogLoss no debe ser null');
  assert(report.probabilisticMetrics.logLoss > 0, 'LogLoss debe ser positivo');
});

// 3. Verificación de Métricas Financieras
// Total Staked = 4.0
// Total Profit = 0.80 - 1.00 + 0.75 + 1.00 = +1.55
// Yield = (1.55 / 4.0) * 100 = 38.75% -> 38.8%
// Win Rate = 3 / 4 = 75.0%
it('Métricas financieras (Yield, Win Rate, Balance) deben ser exactas', () => {
  const fin = report.financialMetrics;
  assert.strictEqual(fin.totalStakedUnits, 4.0);
  assert.strictEqual(fin.netProfitUnits, 1.55);
  assert.strictEqual(fin.yieldPct, 38.8);
  assert.strictEqual(fin.winRatePct, 75.0);
  assert.strictEqual(fin.wonBets, 3);
  assert.strictEqual(fin.lostBets, 1);
});

// 4. Verificación de Drawdown
// Evolución balance:
// 1: +0.80 (peak = 0.80, dd = 0)
// 2: -0.20 (peak = 0.80, dd = 1.00)
// 3: +0.55 (peak = 0.80, dd = 0.25)
// 4: +1.55 (peak = 1.55, dd = 0)
// Max Drawdown = 1.00
it('Maximum Drawdown debe calcular la caída máxima acumulada', () => {
  assert.strictEqual(report.financialMetrics.maxDrawdownUnits, 1.00);
});

// 5. Verificación de Calibración por Deciles
it('Calibración por deciles debe agrupar pronósticos en rangos de probabilidad', () => {
  assert(Array.isArray(report.calibrationByDecile), 'Debe ser un array de deciles');
  assert(report.calibrationByDecile.length === 5, 'Debe haber 5 intervalos');
  const bin7080 = report.calibrationByDecile.find(d => d.range === '70% - 80%');
  assert(bin7080, 'Intervalo 70-80% debe existir');
  assert.strictEqual(bin7080.sampleSize, 1); // bet_01 (0.70)
});

// 6. Verificación de Desglose por Mercado
it('Debe clasificar el rendimiento por mercado individual', () => {
  assert(Array.isArray(report.byMarket), 'byMarket debe ser un array');
  const shotsMarket = report.byMarket.find(m => m.market === 'Remates al arco');
  assert(shotsMarket, 'Mercado de Remates al arco debe existir');
  assert.strictEqual(shotsMarket.total, 3);
  assert.strictEqual(shotsMarket.wonRate, undefined);
  assert.strictEqual(shotsMarket.winRate, 66.7);
});

// 7. Verificación del Runner Backtester
it('Backtester runner debe ejecutar el análisis sin errores', () => {
  const backtestReport = backtester.runBacktest(testDataset);
  assert(backtestReport.sampleSize === 4, 'Muestra debe ser 4');
  assert(backtestReport.financialMetrics.netProfitUnits === 1.55);
});

console.log(`\n========================================`);
console.log(`RESULTADO FINAL DE PRUEBAS DE FASE 7:`);
console.log(`Pasadas: ${passed} | Fallidas: ${failed}`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 FASE 7 COMPLETAMENTE VERIFICADA Y SUPERADA CON ÉXITO.');
}
