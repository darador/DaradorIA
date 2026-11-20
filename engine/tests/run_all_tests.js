/**
 * MASTER TEST RUNNER - AUTONOMOUS SPORTS RESEARCH ENGINE
 * Ejecuta de forma secuencial y estructurada las suites de prueba de las 7 Fases
 */
const { execSync } = require('child_process');
const path = require('path');

const suites = [
  { name: 'Fase 1: Data Engine (Governor, Cache, Storage, MCP)', file: 'test_data_engine.js' },
  { name: 'Fase 2: Discovery Engine (Screeners, Trends, Outliers)', file: 'test_discovery_engine.js' },
  { name: 'Fase 3: Deep Research & Prediction Engine (Poisson, EV, Cuota Justa)', file: 'test_prediction_engine.js' },
  { name: 'Integridad de Muestreo & StatsHub MCP (20/30 Partidos, Ventanas L5-L20, Calidad)', file: 'test_sampling_integrity.js' },
  { name: 'Fase 4: AI Research Team & Match Intelligence (6 Agentes & Veto)', file: 'test_agents_orchestration.js' },
  { name: 'Fase 5: Integración con Radar Web (4ta Pestaña & Modal de Auditoría)', file: 'test_radar_integration.js' },
  { name: 'Fase 6: Scheduler, Alineaciones y Liquidación (Settlement & Cron)', file: 'test_scheduler_and_settlement.js' },
  { name: 'Fase 7: Calibración y Backtesting (Brier Score, Log-Loss, Yield)', file: 'test_backtest_evaluation.js' }
];

console.log('======================================================================');
console.log('🏆 EJECUTANDO SUITE COMPLETA DE PRUEBAS DEL MOTOR AUTÓNOMO (FASES 1-7)');
console.log('======================================================================\n');

let totalPassedSuites = 0;

for (const suite of suites) {
  const filePath = path.join(__dirname, suite.file);
  console.log(`\n▶️  Ejecutando: ${suite.name}...`);
  try {
    const output = execSync(`node "${filePath}"`, { stdio: 'pipe', encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    console.log(output);
    console.log(`✨ ${suite.name}: SUPERADA`);
    totalPassedSuites++;
  } catch (err) {
    console.error(`💥 ${suite.name}: FALLÓ`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    console.error(err.message);
    process.exit(1);
  }
}

console.log('\n======================================================================');
console.log(`🎉 TODAS LAS SUITES SUPERADAS: ${totalPassedSuites} / ${suites.length} FASES VERIFICADAS`);
console.log('======================================================================\n');
