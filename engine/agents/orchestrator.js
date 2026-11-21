/**
 * AGENT ORCHESTRATOR - COORDINADOR DEL TRIBUNAL DE IA
 * Coordina la ejecución concurrente de los 5 analistas especializados,
 * recopila y consolida sus hallazgos, y somete la oportunidad al veredicto
 * del Risk Manager con potestad de veto final.
 */
const playerAnalyst = require('./playerAnalyst');
const teamAnalyst = require('./teamAnalyst');
const matchContextAnalyst = require('./matchContextAnalyst');
const oddsAnalyst = require('./oddsAnalyst');
const matchIntelligenceAnalyst = require('./matchIntelligenceAnalyst');
const riskManager = require('./riskManager');
const storage = require('../data/storage');
const observationTracker = require('../prediction/observationTracker');

class AgentOrchestrator {
  constructor() {
    this.version = '1.0.0';
  }

  /**
   * Ejecuta el tribunal completo de IA sobre una lista de candidatos evaluados
   */
  async processCandidates(evaluatedList) {
    console.log(`[Orchestrator] Convocando al Tribunal de IA para ${evaluatedList.length} selecciones...`);
    const results = [];

    for (const item of evaluatedList) {
      const candidate = item.candidate || item;
      const prediction = item.prediction || candidate.prediction || {};

      try {
        console.log(`[Orchestrator] Evaluando selección: ${candidate.playerOrTeam} (${candidate.market} en ${candidate.match})...`);
        const evaluation = await this.evaluateSingleCandidate(candidate, prediction);
        results.push(evaluation);
      } catch (err) {
        console.error(`[Orchestrator] Error en evaluación del candidato ${candidate.id}:`, err.message);
      }
    }

    return results;
  }

  /**
   * Coordina el análisis individual de los 6 agentes para un candidato
   */
  async evaluateSingleCandidate(candidate, prediction) {
    // 1. Ejecución concurrente de los 5 analistas
    const [pReport, tReport, mContextReport, oReport, mIntelReport] = await Promise.all([
      playerAnalyst.analyze(candidate, prediction).catch(err => ({
        agentName: 'Player Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      teamAnalyst.analyze(candidate, prediction).catch(err => ({
        agentName: 'Team Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      matchContextAnalyst.analyze(candidate, prediction).catch(err => ({
        agentName: 'Match Context Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      oddsAnalyst.analyze(candidate, prediction).catch(err => ({
        agentName: 'Odds Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      matchIntelligenceAnalyst.analyze(candidate, prediction).catch(err => ({
        agentName: 'Match Intelligence Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      }))
    ]);

    const agentReports = {
      playerAnalyst: pReport,
      teamAnalyst: tReport,
      matchContext: mContextReport,
      oddsAnalyst: oReport,
      matchIntel: mIntelReport
    };

    // 2. Persistir los reportes de los analistas en Storage
    storage.saveAgentReport({
      candidateId: candidate.id,
      playerOrTeam: candidate.playerOrTeam,
      match: candidate.match,
      reports: agentReports
    });

    // 3. Veredicto del Risk Manager (Potestad de Veto)
    const riskVerdict = await riskManager.evaluate(candidate, prediction, agentReports);

    // 4. Actualizar estado del candidato y persistir en la colección correspondiente
    candidate.status = riskVerdict.finalStatus; // APROBADO, PENDIENTE, RECHAZADO
    candidate.riskVerdict = riskVerdict;
    candidate.agentReports = agentReports;

    const isTestCandidate = candidate.isTest || (candidate.id && (candidate.id.startsWith('cand_test_') || candidate.id.startsWith('test_')));
    if (!isTestCandidate) {
      storage.saveCandidate(candidate);

      if (riskVerdict.finalStatus === 'APROBADO') {
        storage.saveApprovedPick({
          id: candidate.id,
          partido: candidate.match,
          liga: candidate.competition,
          seleccion: candidate.playerOrTeam,
          mercado: candidate.market,
          linea: candidate.line,
          cuota: candidate.bookmakerOdds,
          pProjected: prediction.pProjected,
          evPercentage: prediction.evPercentage,
          fair_odds: prediction.fairOdds,
          status: 'APROBADO',
          rationale: riskVerdict.finalReason,
          analyst_verdict: riskVerdict.finalReason,
          team_analysis: tReport.tacticalSummary,
          player_analysis: pReport.summary,
          match_intel: mIntelReport.summary
        });
      } else if (riskVerdict.finalStatus === 'RECHAZADO') {
        storage.saveRejectedPick({
          candidateId: candidate.id,
          partido: candidate.match,
          seleccion: candidate.playerOrTeam,
          mercado: candidate.market,
          cuota: candidate.bookmakerOdds,
          reason: riskVerdict.finalReason,
          vetoApplied: riskVerdict.vetoApplied,
          agentReports
        });
      }
    }

    // 5. Shadow Mode (Fase 10): Congelar observación inmutable (aprobados y rechazados)
    try {
      observationTracker.freezeObservation(candidate, prediction, {
        agentReports,
        riskVerdict,
        modelVersion: 'v2.0-shadow-mode'
      });
    } catch (obsErr) {
      console.warn(`[Orchestrator] Advertencia registrando observación Shadow para ${candidate.id}:`, obsErr.message);
    }

    return {
      candidate,
      prediction,
      agentReports,
      riskVerdict
    };
  }
}

module.exports = new AgentOrchestrator();
