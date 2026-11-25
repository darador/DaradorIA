/**
 * SUITE DE PRUEBAS - FASE 4: AI RESEARCH TEAM & MATCH INTELLIGENCE
 * Verifica:
 * 1. Análisis individual de Player Analyst (minutos, titularidad, inconsistencias)
 * 2. Análisis colectivo de Team Analyst (concesión del rival, localía)
 * 3. Contexto de partido de Match Context Analyst (bajas, alineación, árbitro)
 * 4. Análisis de cuota y CLV de Odds Analyst
 * 5. Inteligencia periodística y duelos tácticos de Match Intelligence Analyst
 * 6. Potestad de VETO del Risk Manager (matemático, alineación, contradicción)
 * 7. Orquestación concurrente y persistencia relacional completa
 */
const playerAnalyst = require('../agents/playerAnalyst');
const teamAnalyst = require('../agents/teamAnalyst');
const matchContextAnalyst = require('../agents/matchContextAnalyst');
const oddsAnalyst = require('../agents/oddsAnalyst');
const matchIntelligenceAnalyst = require('../agents/matchIntelligenceAnalyst');
const riskManager = require('../agents/riskManager');
const orchestrator = require('../agents/orchestrator');
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');

async function runAgentTests() {
  console.log('====================================================');
  console.log('🤖 INICIANDO PRUEBAS DE FASE 4: AI RESEARCH TEAM');
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

  const mockCandidate = {
    id: 'cand_test_agent_01',
    playerOrTeam: 'Gabriel Barbosa',
    isTeamProp: false,
    match: 'Coritiba vs Santos',
    team: 'Santos',
    opponent: 'Coritiba',
    competition: 'Brasileirão Série A',
    market: 'Remates totales',
    line: 'Más de 3.5',
    rawLine: 3.5,
    bookmakerOdds: 1.80,
    bookmaker: 'bet365',
    researchData: {
      playerData: {
        playerName: 'Gabriel Barbosa',
        starts: 18,
        avgMinutes: 79.5,
        projectedMinutes: 80,
        statPer90: 4.8,
        historicalValues: [5, 4, 6, 3, 5, 4, 7, 3, 4, 5, 4, 6]
      },
      opponentData: {
        opponentName: 'Coritiba',
        concessionRatio: 1.18,
        isVulnerable: true,
        defensiveRank: 'VULNERABLE (Percentil bajo)'
      },
      lineupData: {
        status: 'CONFIRMADA',
        certainty: 1.0
      },
      refereeData: {
        refereeName: 'Wilton Sampaio',
        avgFouls: 27.5,
        favorsOvers: true
      }
    }
  };

  const mockPrediction = {
    pProjected: 0.725,
    fairOdds: 1.38,
    ev: 0.305,
    evPercentage: 30.5,
    uncertaintyIndex: 0.18,
    decision: 'APROBADO'
  };

  // 1. Player Analyst
  console.log('--- 1. Player Analyst ---');
  const pReport = await playerAnalyst.analyze(mockCandidate, mockPrediction);
  assert(pReport.recommendation === 'FAVORABLE', 'Player Analyst emite recomendación FAVORABLE para jugador con 18 titularidades y 4.8 remates p90');
  assert(pReport.favorableFindings.length >= 2, 'Player Analyst registra hallazgos cuantitativos favorables');

  // 2. Team Analyst
  console.log('\n--- 2. Team Analyst ---');
  const tReport = await teamAnalyst.analyze(mockCandidate, mockPrediction);
  assert(tReport.recommendation === 'FAVORABLE', 'Team Analyst detecta vulnerabilidad defensiva del rival (1.18x)');
  assert(tReport.advantages.some(a => a.includes('concede')), 'Team Analyst registra concesión defensiva del rival');

  // 3. Match Context Analyst
  console.log('\n--- 3. Match Context Analyst ---');
  const mContextReport = await matchContextAnalyst.analyze(mockCandidate, mockPrediction);
  assert(mContextReport.recommendation === 'FAVORABLE', 'Match Context Analyst confirma alineación verificada');
  assert(mContextReport.impactAnalysis.includes('Bajo riesgo'), 'Match Context Analyst valida bajo riesgo de rotación');

  // 4. Odds Analyst
  console.log('\n--- 4. Odds Analyst ---');
  const oReport = await oddsAnalyst.analyze(mockCandidate, mockPrediction);
  assert(oReport.recommendation === 'FAVORABLE', 'Odds Analyst detecta valor de cuota 1.80 frente a cuota justa 1.38');
  assert(oReport.fairOdds === 1.38, 'Odds Analyst preserva la cuota justa matemática');

  // 5. Match Intelligence Analyst (Lucía 2.0)
  console.log('\n--- 5. Match Intelligence Analyst ---');
  const mIntelReport = await matchIntelligenceAnalyst.analyze(mockCandidate, mockPrediction, { persistHistory: false });
  assert(mIntelReport.version === '2.0.0', 'Match Intelligence Analyst opera en versión 2.0.0');
  assert(mIntelReport.structuredSignals && typeof mIntelReport.structuredSignals.newsRiskDetected === 'boolean', 'Match Intelligence emite structuredSignals válidos');
  assert(Array.isArray(mIntelReport.findings) && Array.isArray(mIntelReport.tacticalDuels), 'Match Intelligence preserva compatibilidad estructural de arrays sin inventar hallazgos');

  // 6. Risk Manager (Veto y Consenso)
  console.log('\n--- 6. Risk Manager (Veredicto y Veto) ---');
  const agentReportsSuccess = {
    playerAnalyst: pReport,
    teamAnalyst: tReport,
    matchContext: mContextReport,
    oddsAnalyst: oReport,
    matchIntel: mIntelReport
  };

  const riskApproval = await riskManager.evaluate(mockCandidate, mockPrediction, agentReportsSuccess);
  assert(riskApproval.finalStatus === 'APROBADO', 'Risk Manager aprueba selección cuando convergen números y consenso favorable');
  assert(riskApproval.vetoApplied === false, 'Ningún veto aplicado en selección unánime');

  // Prueba de VETO estricto por EV bajo
  const mockLowEV = { ...mockPrediction, ev: 0.02, evPercentage: 2.0 };
  const riskVetoMath = await riskManager.evaluate(mockCandidate, mockLowEV, agentReportsSuccess);
  assert(riskVetoMath.finalStatus === 'RECHAZADO' && riskVetoMath.vetoApplied === true, 'Risk Manager aplica VETO INMEDIATO si EV < +7.0%');

  // Prueba de VETO por suplencia
  const mockBench = {
    ...mockCandidate,
    researchData: {
      ...mockCandidate.researchData,
      lineupData: { status: 'SUPLENTE_CONFIRMADO' }
    }
  };
  const riskVetoBench = await riskManager.evaluate(mockBench, mockPrediction, agentReportsSuccess);
  assert(riskVetoBench.finalStatus === 'RECHAZADO', 'Risk Manager aplica VETO si el jugador es confirmado suplente');

  // Prueba de Estado PENDIENTE por alineación no confirmada
  const mockProbable = {
    ...mockCandidate,
    researchData: {
      ...mockCandidate.researchData,
      lineupData: { status: 'PROBABLE' }
    }
  };
  const riskPending = await riskManager.evaluate(mockProbable, mockPrediction, agentReportsSuccess);
  assert(riskPending.finalStatus === 'PENDIENTE', 'Risk Manager marca PENDIENTE si falta confirmación oficial de planilla');

  // 7. Orquestador Integrado
  console.log('\n--- 7. Orquestación Concurrente y Persistencia ---');
  const orchestratedResult = await orchestrator.evaluateSingleCandidate(mockCandidate, mockPrediction);
  assert(orchestratedResult.riskVerdict && orchestratedResult.agentReports, 'Orquestador consolidó reportes de los 6 agentes');

  const savedReports = storage.getAgentReports(mockCandidate.id);
  assert(savedReports.length >= 1, `Reportes de agentes persistidos relacionalmente en Storage (${savedReports.length})`);

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO FASE 4: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log('====================================================');

  mcpClient.close();
  process.exit(failed > 0 ? 1 : 0);
}

runAgentTests().catch(e => {
  console.error('Error fatal en pruebas de Fase 4:', e);
  process.exit(1);
});
