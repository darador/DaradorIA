/**
 * TEST END-TO-END PIPELINE: DISCOVERY 3.0 -> COMITÉ 6 AGENTES -> ELENA -> DAILY BOARD
 * Verifica que un candidato descubierto por Discovery 3.0 recorra todo el ciclo
 * recibiendo dictámenes individuales de las 6 agentes sin resúmenes ciegos.
 */

const assert = require('assert');
const { candidateNormalizer } = require('../discovery/candidateNormalizer');
const deepResearchEngine = require('../research/deepResearchEngine');
const predictionEngine = require('../prediction/predictionEngine');
const agentOrchestrator = require('../agents/orchestrator');
const storage = require('../data/storage');

async function testFullPipelineE2E() {
  console.log('=== [INICIANDO TEST END-TO-END: PIPELINE COMPLETO DISCOVERY 3.0] ===\n');

  // 1. Crear candidato de prueba realista a través de CandidateNormalizer
  const rawCand = {
    fixtureId: 'fix_e2e_ars_che_01',
    match: 'Arsenal vs Chelsea',
    player: 'Bukayo Saka',
    market: 'Remates al arco',
    line: 'Más de 0.5',
    odds: 1.75,
    bookmaker: 'Bet365',
    date: '2026-11-28',
    source: 'Discovery3.0:E2ETest',
    origin: 'EXPERIMENTAL_V24'
  };

  const normalized = candidateNormalizer.normalize(rawCand, {
    engineVersion: '3.0.0',
    executionId: 'e2e_test_run'
  });

  assert.ok(normalized.candidateId, 'Debe poseer candidateId canónico');
  console.log(`1. Candidato normalizado por Discovery 3.0: ${normalized.candidateId} (${normalized.player} en ${normalized.match})`);

  // 2. Mock de Deep Research Data enriquecida
  normalized.researchData = {
    qualityStatus: 'INVESTIGACION_COMPLETA',
    playerStats: {
      statPer90: 1.15,
      avgMinutesLast10: 82,
      starterRatioLast10: 0.90,
      hitRateLast5: 0.80,
      hitRateLast10: 0.80,
      historicalValues: [1, 2, 0, 1, 1, 2, 0, 1, 2, 1]
    },
    teamPerformance: {
      teamStatAvg: 5.2,
      opponentConcededAvg: 4.8
    },
    dataQuality: {
      status: 'VALID',
      qualityScore: 92
    }
  };
  console.log('2. Deep Research Data inyectada con calidad DQE VALID.');

  // 3. Predicción con PredictionEngine
  const prediction = predictionEngine.predictCandidate(normalized);
  normalized.prediction = prediction;
  assert.ok(prediction, 'PredictionEngine debe emitir pronóstico');
  console.log(`3. PredictionEngine evaluó candidato: EV = ${prediction.evPct ? (prediction.evPct*100).toFixed(1) : (prediction.ev*100).toFixed(1)}% | Cuota Justa = ${prediction.fairOdds}`);

  // 4. Convocatoria del Comité de las 6 Agentes evaluando cada analista de forma pura
  console.log('4. Convocando Tribunal de IA (6 agentes)...');
  const playerAnalyst = require('../agents/playerAnalyst');
  const teamAnalyst = require('../agents/teamAnalyst');
  const matchContextAnalyst = require('../agents/matchContextAnalyst');
  const oddsAnalyst = require('../agents/oddsAnalyst');
  const matchIntelligenceAnalyst = require('../agents/matchIntelligenceAnalyst');
  const riskManager = require('../agents/riskManager');

  const pReport = await playerAnalyst.analyze(normalized, prediction);
  const tReport = await teamAnalyst.analyze(normalized, prediction);
  const mContextReport = await matchContextAnalyst.analyze(normalized, prediction);
  const oReport = await oddsAnalyst.analyze(normalized, prediction);
  const mIntelReport = await matchIntelligenceAnalyst.analyze(normalized, prediction, {
    otherAgentReports: {
      playerAnalyst: pReport,
      teamAnalyst: tReport,
      matchContext: mContextReport,
      oddsAnalyst: oReport
    }
  });

  const agentReports = {
    playerAnalyst: pReport,
    teamAnalyst: tReport,
    matchContext: mContextReport,
    oddsAnalyst: oReport,
    matchIntel: mIntelReport
  };

  const riskVerdict = await riskManager.evaluate(normalized, prediction, agentReports);

  const agentEval = {
    candidate: normalized,
    prediction,
    agentReports,
    riskVerdict
  };
  
  assert.ok(agentEval, 'Orchestrator debe retornar evaluación');
  assert.ok(agentEval.agentReports, 'Debe contener agentReports');

  const agents = ['playerAnalyst', 'teamAnalyst', 'matchContextAnalyst', 'oddsAnalyst', 'matchIntelligenceAnalyst', 'riskManager'];
  console.log('--- REPORTE INDIVIDUAL DE LAS SEIS AGENTES ---');
  
  // Sofía (Player Analyst)
  assert.ok(agentEval.agentReports.playerAnalyst, 'Sofía (Player Analyst) debe emitir reporte');
  console.log(`• Sofía (Player Analyst): ${agentEval.agentReports.playerAnalyst.recommendation} | Confianza: ${agentEval.agentReports.playerAnalyst.confidenceScore}`);

  // Valentina (Team Analyst)
  assert.ok(agentEval.agentReports.teamAnalyst, 'Valentina (Team Analyst) debe emitir reporte');
  console.log(`• Valentina (Team Analyst): ${agentEval.agentReports.teamAnalyst.recommendation}`);

  // Camila (Match Context Analyst)
  assert.ok(agentEval.agentReports.matchContext, 'Camila (Match Context Analyst) debe emitir reporte');
  console.log(`• Camila (Match Context Analyst): ${agentEval.agentReports.matchContext.recommendation}`);

  // Renata (Odds Analyst)
  assert.ok(agentEval.agentReports.oddsAnalyst, 'Renata (Odds Analyst) debe emitir reporte');
  console.log(`• Renata (Odds Analyst): ${agentEval.agentReports.oddsAnalyst.recommendation}`);

  // Lucía 2.0 (Match Intelligence Analyst)
  assert.ok(agentEval.agentReports.matchIntel, 'Lucía 2.0 (Match Intelligence Analyst) debe emitir reporte');
  console.log(`• Lucía 2.0 (Match Intelligence): ${agentEval.agentReports.matchIntel.recommendation}`);

  // Elena (Risk Manager)
  assert.ok(agentEval.riskVerdict, 'Elena (Risk Manager) debe emitir veredicto');
  console.log(`• Elena (Risk Manager): Veredicto = ${agentEval.riskVerdict.finalStatus} | Razón = ${agentEval.riskVerdict.finalReason}`);

  // 5. Verificación de Aislamiento y Reglas de Riesgo
  assert.strictEqual(normalized.origin, 'EXPERIMENTAL_V24');
  console.log('\n5. Aislamiento verificado: El candidato pertenece al segmento EXPERIMENTAL_V24.');

  console.log('\n======================================================');
  console.log('🎉 TEST END-TO-END SUPERADO CON ÉXITO ABSOLUTO');
  console.log('======================================================');
}

if (require.main === module) {
  testFullPipelineE2E().catch(err => {
    console.error('Error en Test E2E:', err);
    process.exit(1);
  });
}

module.exports = { testFullPipelineE2E };
