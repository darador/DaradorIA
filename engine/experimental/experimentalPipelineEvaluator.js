/**
 * EXPERIMENTAL PIPELINE EVALUATOR V2.4
 * Orquesta la evaluación aislada de la cohorte EXPERIMENTAL_ODDS_POLICY_V24.
 *
 * Flujo riguroso:
 * 1. Deep Research con validación DQE y contratos estadísticos.
 * 2. Prediction Engine V2.4 (EV = p*odds - 1, minEV >= +8.0%, cuota 1.45-2.20).
 * 3. Comité de 6 Agentes (Sofía, Valentina, Camila, Renata, Lucía, Elena).
 * 4. Preservación estricta de las reglas y vetos de Elena.
 * 5. Asignación inequívoca de estados (DISCOVERED, MATHEMATICAL_PASS, EXPERIMENTAL_APPROVED, etc.).
 */

const crypto = require('crypto');
const { EXPERIMENTAL_ODDS_POLICY_V24, evaluateExperimentalMath, getPolicyConfigHash } = require('./experimentalOddsPolicyV24');
const playerAnalyst = require('../agents/playerAnalyst');
const teamAnalyst = require('../agents/teamAnalyst');
const matchContextAnalyst = require('../agents/matchContextAnalyst');
const oddsAnalyst = require('../agents/oddsAnalyst');
const matchIntelligenceAnalyst = require('../agents/matchIntelligenceAnalyst');
const riskManager = require('../agents/riskManager');

class ExperimentalPipelineEvaluator {
  constructor() {
    this.policy = EXPERIMENTAL_ODDS_POLICY_V24;
    this.configHash = getPolicyConfigHash();
  }

  /**
   * Evalúa un candidato completo bajo la política experimental V2.4
   */
  async evaluateCandidate(rawCandidate, researchData = {}) {
    const odds = Number(rawCandidate.bookmakerOdds || rawCandidate.odds || 0);
    const candidateId = rawCandidate.id || rawCandidate.candidateId || `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const matchId = rawCandidate.matchId || rawCandidate.match || 'unknown_match';
    const kickoff = rawCandidate.eventKickoff || rawCandidate.eventDateUtc || rawCandidate.matchTime || new Date(Date.now() + 86400000).toISOString();

    const baseCandidate = {
      ...rawCandidate,
      candidateId,
      id: candidateId,
      matchId,
      eventKickoff: kickoff,
      policy: this.policy.policyId,
      environment: 'EXPERIMENTAL_ODDS_POLICY_V24',
      dqeStatus: rawCandidate.dqeStatus || 'VALID',
      sampleSize: rawCandidate.sampleSize || rawCandidate.sample_size || 10
    };

    // 1. Evaluación matemática V1 y V2.2
    const probV1 = Number(rawCandidate.probV1 || rawCandidate.probabilityV1 || (rawCandidate.real_prob ? rawCandidate.real_prob / 100 : 0.70));
    const probV22 = Number(rawCandidate.probV22 || rawCandidate.probabilityV22 || probV1);

    const mathEval = evaluateExperimentalMath({
      odds,
      prob: probV22,
      dqeStatus: baseCandidate.dqeStatus,
      sampleSize: baseCandidate.sampleSize
    });

    const prediction = {
      probabilityV1: probV1,
      probabilityV22: probV22,
      pProjected: probV22,
      fairOdds: mathEval.fairOdds,
      impliedProb: mathEval.impliedProb,
      ev: mathEval.ev,
      evPercentage: mathEval.evPercentage,
      mathematicalPass: mathEval.pass,
      decisionReason: mathEval.reason,
      modelVersion: 'V2.2_LIVE_PROSPECTIVE'
    };

    // Si no supera el filtro matemático (cuota fuera de rango o EV < +8.0%)
    if (!mathEval.pass) {
      return this._buildRecord({
        candidate: baseCandidate,
        prediction,
        agentReports: null,
        riskVerdict: {
          finalStatus: this.policy.STATES.REJECTED,
          finalReason: mathEval.reason,
          vetoApplied: true
        },
        finalState: this.policy.STATES.REJECTED,
        statusLabel: 'RECHAZADO_MATEMÁTICO'
      });
    }

    // 2. Ejecución completa del Comité de 6 Agentes
    const agentReports = await this._runFullCommittee(baseCandidate, prediction, researchData);

    // 3. Evaluación de Elena (Risk Manager)
    const riskVerdict = await riskManager.evaluate(baseCandidate, prediction, agentReports);

    // 4. Determinación del estado canónico inequívoco
    let finalState;
    let statusLabel;

    if (riskVerdict.vetoApplied || riskVerdict.finalStatus === 'RECHAZADO') {
      finalState = this.policy.STATES.EXPERIMENTAL_REJECTED_BY_RISK_MANAGER;
      statusLabel = 'VETADO_POR_RISK_MANAGER';
    } else if (riskVerdict.finalStatus === 'EXPIRADO_SIN_EVALUACION' || riskVerdict.temporalVeto) {
      finalState = this.policy.STATES.EXPIRED;
      statusLabel = 'EXPIRADO';
    } else if (riskVerdict.finalStatus === 'APROBADO') {
      finalState = this.policy.STATES.EXPERIMENTAL_APPROVED;
      statusLabel = 'APROBADO_EXPERIMENTAL_V24';
    } else {
      finalState = this.policy.STATES.UNDER_RESEARCH;
      statusLabel = 'PENDIENTE_CONFIRMACION';
    }

    return this._buildRecord({
      candidate: baseCandidate,
      prediction,
      agentReports,
      riskVerdict,
      finalState,
      statusLabel
    });
  }

  async _runFullCommittee(candidate, prediction, researchData) {
    const enrichedCandidate = { ...candidate, ...researchData };

    const [pReport, tReport, mContextReport, oReport] = await Promise.all([
      playerAnalyst.analyze(enrichedCandidate, prediction).catch(err => ({
        agentName: 'Player Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      teamAnalyst.analyze(enrichedCandidate, prediction).catch(err => ({
        agentName: 'Team Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      matchContextAnalyst.analyze(enrichedCandidate, prediction).catch(err => ({
        agentName: 'Match Context Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      })),
      oddsAnalyst.analyze(enrichedCandidate, prediction).catch(err => ({
        agentName: 'Odds Analyst',
        error: err.message,
        recommendation: 'NEUTRAL'
      }))
    ]);

    const mIntelReport = await matchIntelligenceAnalyst.analyze(enrichedCandidate, prediction, {
      otherAgentReports: {
        playerAnalyst: pReport,
        teamAnalyst: tReport,
        matchContext: mContextReport,
        oddsAnalyst: oReport
      }
    }).catch(err => ({
      agentName: 'Match Intelligence Analyst',
      error: err.message,
      recommendation: 'NEUTRAL'
    }));

    return {
      sofia: pReport,
      valentina: tReport,
      camila: mContextReport,
      renata: oReport,
      lucia: mIntelReport
    };
  }

  _buildRecord({ candidate, prediction, agentReports, riskVerdict, finalState, statusLabel }) {
    const nowIso = new Date().toISOString();
    const payload = {
      candidateId: candidate.candidateId,
      matchId: candidate.matchId,
      eventKickoff: candidate.eventKickoff,
      market: candidate.market,
      selection: candidate.playerOrTeam || candidate.selection,
      line: candidate.line,
      odds: Number(candidate.bookmakerOdds || candidate.odds),
      bookmaker: candidate.bookmaker || 'Bet365',
      probabilityV1: prediction.probabilityV1,
      probabilityV22: prediction.probabilityV22,
      fairOdds: prediction.fairOdds,
      ev: prediction.ev,
      evPercentage: prediction.evPercentage,
      dqeStatus: candidate.dqeStatus,
      policy: this.policy.policyId,
      configHash: this.configHash,
      evaluatedAt: nowIso
    };

    const sha256 = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    return {
      ...payload,
      agentReports,
      riskVerdict,
      finalState,
      statusLabel,
      sha256,
      snapshotVersion: 1,
      isOperativeRecommendation: false, // PRODUCCIÓN TOTALMENTE AISLADA
      shadowMode: true
    };
  }
}

module.exports = ExperimentalPipelineEvaluator;
