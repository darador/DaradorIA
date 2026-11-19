/**
 * BACKTESTER RUNNER
 * Fase 7: Permite simular y evaluar el desempeño del modelo sobre muestras históricas
 * para medir la robustez matemática, Brier Score y ROI acumulado.
 */
const evaluator = require('./evaluator');
const fs = require('fs');
const path = require('path');
const config = require('../config');

class Backtester {
  /**
   * Genera o carga un dataset de prueba histórico y calcula todas las métricas de calibración
   * @param {Array} customDataset
   * @returns {Object} Reporte de backtest
   */
  runBacktest(customDataset = null) {
    let dataset = customDataset;

    if (!dataset) {
      // Si no se provee dataset, leer historial existente o generar muestra de validación
      const historialFile = config.paths.historialPicks;
      if (fs.existsSync(historialFile)) {
        try {
          const histData = JSON.parse(fs.readFileSync(historialFile, 'utf8'));
          dataset = histData.history || [];
        } catch (e) {
          dataset = [];
        }
      }
    }

    console.log(`[Backtest] Evaluando muestra histórica de ${dataset.length} selecciones...`);
    const report = evaluator.evaluatePerformance(dataset);
    return report;
  }
}

module.exports = new Backtester();
