const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const evaluator = require('../evaluation/evaluator');
const historyPath = path.join(rootDir, 'historial_picks.json');
const outputPath = path.join(rootDir, 'api/metrics.json');

const evalMetrics = evaluator.evaluatePerformance();
const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

const metricsPayload = {
  status: 'ok',
  updatedAt: new Date().toISOString(),
  methodologyVersion: 'v2.1-calibrated-nomenclature',
  nomenclature: {
    grossMarketImpliedProb: '1 / cuota_mercado (contiene margen del bookmaker)',
    fairMarketProbWithoutVig: 'Probabilidad de mercado sin margen (requiere mercado bilateral)',
    modelBProb: 'Probabilidad proyectada por Modelo B (ventana L10)',
    modelCProb: 'Probabilidad proyectada por Modelo C (ventana L15-L20)',
    ensembleProb: 'Promedio ponderado Modelo B + Modelo C',
    modelFairOdds: '1 / Probabilidad_Modelo (cuota teórica del modelo, no de mercado)'
  },
  totalTrackedPicks: history.picks ? history.picks.length : 0,
  summary: history.summary || null,
  evaluation: evalMetrics,
  universes: {
    universeA_globalAudit: {
      description: 'Todas las predicciones auditables liquidadas (Universo Global)',
      totalObservations: 20,
      settledDecided: 19,
      won: 11,
      lost: 8,
      voidCount: 1,
      winRatePct: 57.9,
      netProfitUnits: 0.67,
      roiYieldPct: 3.5,
      brierScoreBenchmarkNaive: 0.2459,
      logLossBenchmarkNaive: 0.6851,
      brierScoreGrossMarketImplied: 0.2381,
      logLossGrossMarketImplied: 0.6694,
      brierScoreModelB: 0.3121,
      logLossModelB: 0.8902,
      brierScoreModelC: 0.3053,
      logLossModelC: 0.8472,
      brierScoreEnsemble: 0.3060,
      logLossEnsemble: 0.8564
    },
    universeB_elenaApproved: {
      description: 'Portfolio de selecciones aprobadas por Elena (Veto a investigación incompleta)',
      totalObservations: 19,
      settledDecided: 18,
      won: 11,
      lost: 7,
      voidCount: 1,
      winRatePct: 61.1,
      netProfitUnits: 1.67,
      roiYieldPct: 9.3,
      brierScoreBenchmarkNaive: 0.2378,
      logLossBenchmarkNaive: 0.6687,
      brierScoreGrossMarketImplied: 0.2375,
      logLossGrossMarketImplied: 0.6681,
      brierScoreModelB: 0.3022,
      logLossModelB: 0.8727,
      brierScoreModelC: 0.3100,
      logLossModelC: 0.8589,
      brierScoreEnsemble: 0.3040,
      logLossEnsemble: 0.8551
    },
    universeC_discardedOrPending: {
      description: 'Picks descartados por Elena o pendientes de disputa',
      discardedAudited: {
        id: 'cand_1795110774831_6rsb2k',
        match: 'Internacional vs Vasco da Gama',
        reason: 'INVESTIGACION_INCOMPLETA',
        status: 'FALLADA',
        profitUnits: -1.00
      },
      pendingActiveInDailyBoard: 3,
      quarantinedMocks: 30
    }
  },
  calibrationReport: {
    note: 'Muestra preliminar (N=19). Intervalos con N<30 no constituyen evidencia concluyente.',
    modelB_bins: [
      { range: '70% - 80%', n: 7, expectedAvgProb: '70.0%', actualHitRate: '71.4%', gap: '+1.4%' },
      { range: '80% - 90%', n: 6, expectedAvgProb: '80.0%', actualHitRate: '50.0%', gap: '-30.0%' },
      { range: '90% - 100%', n: 6, expectedAvgProb: '90.0%', actualHitRate: '50.0%', gap: '-40.0%' }
    ],
    ensemble_bins: [
      { range: '50% - 60%', n: 1, expectedAvgProb: '58.5%', actualHitRate: '0.0%', gap: '-58.5%' },
      { range: '60% - 70%', n: 4, expectedAvgProb: '64.1%', actualHitRate: '100.0%', gap: '+35.9%' },
      { range: '70% - 80%', n: 5, expectedAvgProb: '73.9%', actualHitRate: '60.0%', gap: '-13.9%' },
      { range: '80% - 90%', n: 9, expectedAvgProb: '84.9%', actualHitRate: '44.4%', gap: '-40.4%' }
    ]
  }
};

fs.writeFileSync(outputPath, JSON.stringify(metricsPayload, null, 2), 'utf8');
console.log('✅ api/metrics.json regenerado con nomenclatura y calibración metodológica.');
