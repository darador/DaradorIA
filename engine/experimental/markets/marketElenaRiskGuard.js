/**
 * MARKET ELENA & RISK MANAGER GUARD (FASE 6 — EXPERIMENTAL / AISLADO)
 *
 * Permite que Elena evalúe oportunidades de resultado (1X2) y Doble Oportunidad
 * con información específica del mercado, y aplica los controles vinculantes del
 * Risk Manager (reutilizando computeEventWindow / windowsOverlap de ladderRiskGuard.js).
 *
 * REGLA INVIOLABLE: La aprobación de Elena NUNCA puede omitir un bloqueo del Risk Manager.
 * NO modifica engine/agents/orchestrator.js ni engine/agents/riskManager.js productivos.
 */

'use strict';

const { computeEventWindow, windowsOverlap } = require('../../ladder/ladderRiskGuard');

const DEFAULT_MIN_EV_PCT_1X2_DC = 2.5;
const DEFAULT_MAX_ODDS_AGE_MINUTES = 360; // 6 horas máx de frescura
const DEFAULT_MIN_SAMPLE_GAMES = 8;

/**
 * Construye el paquete estructurado específico del mercado que recibe Elena.
 */
function buildElenaMarketPacket(candidate, historicalEvidence = null) {
  return {
    match: candidate.match,
    matchId: candidate.matchId || null,
    league: candidate.league,
    sport: candidate.sport || 'football',
    marketFamily: candidate.marketFamily,
    market: candidate.market,
    selection: candidate.selection,
    odds: candidate.bookmakerOdds,
    estimatedProb: candidate.modelProb,
    impliedProb: candidate.impliedProb,
    noVigProb: candidate.noVigProb ?? null,
    ev: candidate.ev,
    evPct: candidate.evPct,
    dataQuality: candidate.dataQuality || { score: 0, tier: 'BAJA' },
    modelConsensus: candidate.modelConsensus ?? null,
    historicalEvidence: historicalEvidence || {
      sampleCount: 0,
      sampleStatus: 'INSUFFICIENT_SAMPLE',
      roiPct: null,
      avgClvPct: null
    }
  };
}

/**
 * Evaluación de Elena sobre oportunidades de 1X2 / Doble Oportunidad.
 * Nunca aprueba Doble Oportunidad automáticamente por tener probabilidad alta sin EV positivo.
 */
function evaluateElenaForMarket(packet, options = {}) {
  const minEvPct = options.minEvPct ?? DEFAULT_MIN_EV_PCT_1X2_DC;
  const reasons = [];

  if (!Number.isFinite(packet.evPct) || packet.evPct < minEvPct) {
    reasons.push(`EV insuficiente (+${packet.evPct ?? 'N/A'}% < mínimo +${minEvPct}%). Probabilidad alta sin EV positivo no justifica entrada.`);
  }
  if ((packet.dataQuality?.score ?? 0) < 0.55) {
    reasons.push(`Calidad de datos insuficiente (score ${packet.dataQuality?.score ?? 0} < 0.55).`);
  }
  if (packet.modelConsensus !== null && packet.modelConsensus < 0.60) {
    reasons.push(`Consenso entre modelos bajo (${(packet.modelConsensus * 100).toFixed(0)}% < 60%).`);
  }

  if (reasons.length > 0) {
    return {
      agent: 'Elena (Market Evaluation Experimental)',
      approved: false,
      status: 'RECHAZADO',
      reasons,
      packet
    };
  }

  return {
    agent: 'Elena (Market Evaluation Experimental)',
    approved: true,
    status: 'APROBADO',
    reasons: [`EV positivo validado (+${packet.evPct}%), calidad de datos ${packet.dataQuality.tier} y precio coherente.`],
    packet
  };
}

/**
 * Validación vinculante de Risk Manager para oportunidades de mercado (1X2 / Doble Oportunidad / otros).
 * Reutiliza ventanas horarias y detección de superposición de ladderRiskGuard.js.
 */
function validateMarketRisk({
  candidate,
  elenaVerdict,
  activeExposures = [],     // [{ matchId, kickoffUtc, sport, capitalCommittedArs }]
  availableCapitalArs = 50000,
  requiredCapitalArs = 0,
  kickoffUtc = null,
  maxOddsAgeMinutes = DEFAULT_MAX_ODDS_AGE_MINUTES,
  minSampleGames = DEFAULT_MIN_SAMPLE_GAMES
}) {
  const blockReasons = [];
  const waitReasons = [];

  // 1. Integridad y suficiencia de datos
  const homeN = candidate.parameters?.homeSampleGames ?? candidate.sampleSize ?? 0;
  const awayN = candidate.parameters?.awaySampleGames ?? candidate.sampleSize ?? 0;
  if (homeN < minSampleGames || awayN < minSampleGames) {
    blockReasons.push(`BLOQUEO_DATOS_INSUFICIENTES: Muestra histórica insuficiente (Local=${homeN}, Visitante=${awayN}, mín=${minSampleGames}).`);
  }
  if ((candidate.dataQuality?.score ?? 0) < 0.50) {
    blockReasons.push(`BLOQUEO_CALIDAD_DATOS: Calidad de datos deficiente (${candidate.dataQuality?.score ?? 0}).`);
  }

  // 2. Validación de cuota y frescura
  if (!Number.isFinite(Number(candidate.bookmakerOdds)) || Number(candidate.bookmakerOdds) <= 1.01) {
    blockReasons.push('BLOQUEO_CUOTA_INVALIDA: Cuota de mercado ausente o inválida.');
  }
  if (candidate.oddsAgeMinutes !== null && candidate.oddsAgeMinutes !== undefined && candidate.oddsAgeMinutes > maxOddsAgeMinutes) {
    blockReasons.push(`BLOQUEO_CUOTA_DESACTUALIZADA: Cuota con antigüedad de ${candidate.oddsAgeMinutes} min (máx ${maxOddsAgeMinutes} min).`);
  }

  // 3. Disponibilidad de capital
  if (availableCapitalArs <= 0 || (requiredCapitalArs > 0 && availableCapitalArs < requiredCapitalArs)) {
    blockReasons.push(`BLOQUEO_CAPITAL_NO_DISPONIBLE: Capital disponible ($ ${availableCapitalArs}) insuficiente.`);
  }

  // 4. Control de ventanas horarias y ausencia de superposición
  let candidateWindow = null;
  if (kickoffUtc) {
    candidateWindow = computeEventWindow(kickoffUtc, candidate.sport || 'football');
    for (const exp of activeExposures) {
      if (!exp.kickoffUtc) continue;
      const expWindow = computeEventWindow(exp.kickoffUtc, exp.sport || 'football');
      if (windowsOverlap(candidateWindow, expWindow)) {
        waitReasons.push(`BLOQUEO_SUPERPOSICION_HORARIA: Ventana superpuesta con exposición activa (${exp.matchId || exp.match || 'evento activo'}).`);
      }
    }
  }

  // 5. Decisión final combinada: Risk Manager SIEMPRE prevalece sobre Elena
  let finalStatus;
  let finalDecisionReason;
  const riskManagerBlocked = blockReasons.length > 0 || waitReasons.length > 0;

  if (blockReasons.length > 0) {
    finalStatus = 'RECHAZADO';
    finalDecisionReason = `VETO RISK MANAGER (vinculante): ${blockReasons.join(' | ')}`;
  } else if (waitReasons.length > 0) {
    finalStatus = 'EN_ESPERA';
    finalDecisionReason = `ESPERA RISK MANAGER (vinculante): ${waitReasons.join(' | ')}`;
  } else if (!elenaVerdict?.approved) {
    finalStatus = 'RECHAZADO';
    finalDecisionReason = `RECHAZO ELENA: ${(elenaVerdict?.reasons || ['No aprobada']).join(' | ')}`;
  } else {
    finalStatus = 'APROBADO';
    finalDecisionReason = `APROBADO (Elena + Risk Manager): EV +${candidate.evPct}%, sin superposición horaria y datos validados.`;
  }

  return {
    finalStatus,
    approvedForManualReview: finalStatus === 'APROBADO',
    autoExecutionAllowed: false,
    elenaApproved: Boolean(elenaVerdict?.approved),
    riskManagerApproved: !riskManagerBlocked,
    riskManagerPrevailed: Boolean(elenaVerdict?.approved && riskManagerBlocked),
    blockReasons,
    waitReasons,
    candidateWindow,
    finalDecisionReason
  };
}

module.exports = {
  buildElenaMarketPacket,
  evaluateElenaForMarket,
  validateMarketRisk
};
