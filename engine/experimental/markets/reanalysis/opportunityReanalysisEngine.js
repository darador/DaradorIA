/**
 * FASE 10.2 — OPPORTUNITY REANALYSIS ENGINE
 *
 * Evalúa valor (EV = prob * cuota - 1), detecta cambios significativos respecto a
 * versiones previas usando umbrales configurables, clasifica oportunidades en los
 * 7 estados oficiales e integra Elena + Risk Manager experimental (veto vinculante).
 *
 * Nunca sobrescribe versiones anteriores ni autoriza ejecución automática.
 */

'use strict';

const { buildElenaMarketPacket, evaluateElenaForMarket, validateMarketRisk } = require('../marketElenaRiskGuard');

const OPPORTUNITY_STATES = Object.freeze({
  OPPORTUNITY: 'OPPORTUNITY',
  WATCHLIST: 'WATCHLIST',
  REANALYSIS_REQUIRED: 'REANALYSIS_REQUIRED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  SUSPENDED: 'SUSPENDED'
});

const CHANGE_REASONS = Object.freeze({
  INITIAL_ANALYSIS: 'INITIAL_ANALYSIS',
  ODDS_IMPROVED: 'ODDS_IMPROVED',
  ODDS_DETERIORATED: 'ODDS_DETERIORATED',
  EV_BECAME_POSITIVE: 'EV_BECAME_POSITIVE',
  EV_BECAME_NEGATIVE: 'EV_BECAME_NEGATIVE',
  PROBABILITY_CHANGED: 'PROBABILITY_CHANGED',
  NEW_MARKET: 'NEW_MARKET',
  NEW_BOOKMAKER: 'NEW_BOOKMAKER',
  DATA_QUALITY_CHANGED: 'DATA_QUALITY_CHANGED',
  LINE_CHANGED: 'LINE_CHANGED',
  OPPORTUNITY_EXPIRED: 'OPPORTUNITY_EXPIRED',
  NO_SIGNIFICANT_CHANGE: 'NO_SIGNIFICANT_CHANGE'
});

/**
 * Umbrales iniciales documentados para evitar alertas por ruido menor:
 *  - oddsChangePctMin: 2.0% de variación mínima en cuota
 *  - probChangeAbsMin: 0.02 (2.0 puntos porcentuales) en probabilidad estimada
 *  - evChangePctMin:   1.5% en EV porcentual
 *  - dataQualityChangeMin: 0.10 en score de calidad
 */
const DEFAULT_CHANGE_THRESHOLDS = Object.freeze({
  oddsChangePctMin: 2.0,
  probChangeAbsMin: 0.02,
  evChangePctMin: 1.5,
  dataQualityChangeMin: 0.10
});

const DEFAULT_CLASSIFICATION_CONFIG = Object.freeze({
  minOpportunityEvPct: 2.5,
  minWatchlistEvPct: 0.5,
  minDataQualityScore: 0.55,
  minSampleGames: 8,
  maxOddsAgeMinutes: 360
});

function round(v, d = 6) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function buildOpportunityId({ matchId, marketFamily, selection, line = null }) {
  const ln = line !== null && line !== undefined ? String(line) : 'none';
  return `${String(matchId)}__${String(marketFamily)}__${String(selection).toUpperCase()}__${ln}`;
}

/**
 * Calcula métricas de valor: EV = (prob * cuota) - 1, fairOdds, impliedProb.
 */
function computeValueMetrics({ probability, odds, noVigProbability = null, previousOdds = null }) {
  const p = Number(probability);
  const o = Number(odds);
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !Number.isFinite(o) || o <= 1.0) {
    return { valid: false, reason: 'INVALID_PROB_OR_ODDS' };
  }
  const expectedValue = (p * o) - 1;
  const expectedValuePct = expectedValue * 100;
  const fairOdds = 1 / p;
  const impliedProbability = 1 / o;
  const oddsDelta = Number.isFinite(Number(previousOdds)) ? round(o - Number(previousOdds), 4) : null;
  const oddsDeltaPct = (Number.isFinite(Number(previousOdds)) && Number(previousOdds) > 0)
    ? round(((o - Number(previousOdds)) / Number(previousOdds)) * 100, 2)
    : null;

  return {
    valid: true,
    probability: round(p, 6),
    odds: round(o, 4),
    fairOdds: round(fairOdds, 4),
    impliedProbability: round(impliedProbability, 6),
    noVigProbability: Number.isFinite(Number(noVigProbability)) ? round(Number(noVigProbability), 6) : null,
    expectedValue: round(expectedValue, 6),
    expectedValuePct: round(expectedValuePct, 2),
    oddsDelta,
    oddsDeltaPct
  };
}

/**
 * Compara la nueva evaluación con la versión anterior y retorna motivos significativos.
 */
function detectSignificantChanges(current, previous, thresholds = DEFAULT_CHANGE_THRESHOLDS) {
  if (!previous) {
    return {
      isNew: true,
      hasSignificantChange: true,
      reasons: [CHANGE_REASONS.NEW_MARKET, CHANGE_REASONS.INITIAL_ANALYSIS],
      deltas: { oddsDelta: null, oddsDeltaPct: null, probDelta: null, evDeltaPct: null }
    };
  }

  const reasons = [];
  const oddsDelta = (Number.isFinite(current.odds) && Number.isFinite(previous.odds))
    ? round(current.odds - previous.odds, 4)
    : null;
  const oddsDeltaPct = (oddsDelta !== null && previous.odds > 0)
    ? round((oddsDelta / previous.odds) * 100, 2)
    : null;
  const probDelta = (Number.isFinite(current.probability) && Number.isFinite(previous.probability))
    ? round(current.probability - previous.probability, 6)
    : null;
  const evDeltaPct = (Number.isFinite(current.expectedValuePct) && Number.isFinite(previous.expectedValuePct))
    ? round(current.expectedValuePct - previous.expectedValuePct, 2)
    : null;

  if (oddsDeltaPct !== null && Math.abs(oddsDeltaPct) >= thresholds.oddsChangePctMin) {
    reasons.push(oddsDeltaPct > 0 ? CHANGE_REASONS.ODDS_IMPROVED : CHANGE_REASONS.ODDS_DETERIORATED);
  }
  if (Number.isFinite(previous.expectedValuePct) && Number.isFinite(current.expectedValuePct)) {
    if (previous.expectedValuePct <= 0 && current.expectedValuePct > 0) reasons.push(CHANGE_REASONS.EV_BECAME_POSITIVE);
    if (previous.expectedValuePct > 0 && current.expectedValuePct <= 0) reasons.push(CHANGE_REASONS.EV_BECAME_NEGATIVE);
  }
  if (probDelta !== null && Math.abs(probDelta) >= thresholds.probChangeAbsMin) {
    reasons.push(CHANGE_REASONS.PROBABILITY_CHANGED);
  }
  if (current.bookmaker && previous.bookmaker && current.bookmaker !== previous.bookmaker) {
    reasons.push(CHANGE_REASONS.NEW_BOOKMAKER);
  }
  if ((current.line ?? null) !== (previous.line ?? null)) {
    reasons.push(CHANGE_REASONS.LINE_CHANGED);
  }
  if (
    Number.isFinite(current.dataQualityScore) &&
    Number.isFinite(previous.dataQualityScore) &&
    Math.abs(current.dataQualityScore - previous.dataQualityScore) >= thresholds.dataQualityChangeMin
  ) {
    reasons.push(CHANGE_REASONS.DATA_QUALITY_CHANGED);
  }
  if (current.status === OPPORTUNITY_STATES.EXPIRED && previous.status !== OPPORTUNITY_STATES.EXPIRED) {
    reasons.push(CHANGE_REASONS.OPPORTUNITY_EXPIRED);
  }

  return {
    isNew: false,
    hasSignificantChange: reasons.length > 0,
    reasons: reasons.length > 0 ? reasons : [CHANGE_REASONS.NO_SIGNIFICANT_CHANGE],
    deltas: { oddsDelta, oddsDeltaPct, probDelta, evDeltaPct }
  };
}

/**
 * Reanaliza una oportunidad individual, integrando Elena + Risk Manager experimental
 * (maneja Elena no disponible sin simular aprobación) y compuerta estricta de calidad.
 */
function reanalyzeOpportunity({
  candidate,
  previousVersion = null,
  nowUtc = new Date().toISOString(),
  elenaEvaluator = evaluateElenaForMarket,
  riskValidator = validateMarketRisk,
  activeExposures = [],
  availableCapitalArs = 50000,
  historicalEvidence = null,
  config = DEFAULT_CLASSIFICATION_CONFIG,
  thresholds = DEFAULT_CHANGE_THRESHOLDS
}) {
  const opportunityId = buildOpportunityId(candidate);
  const nowMs = Date.parse(nowUtc);
  const koMs = Date.parse(candidate.kickoffUtc);

  // 1. Verificar evento suspendido o iniciado (EXPIRED / SUSPENDED)
  if (['SUSPENDED', 'POSTPONED', 'CANCELLED'].includes(String(candidate.matchStatus || '').toUpperCase())) {
    const changes = detectSignificantChanges({ ...candidate, status: OPPORTUNITY_STATES.SUSPENDED }, previousVersion, thresholds);
    return {
      opportunityId,
      status: OPPORTUNITY_STATES.SUSPENDED,
      classificationReason: `Evento en estado ${candidate.matchStatus}.`,
      changes,
      value: null,
      elenaVerdict: null,
      riskVerdict: null,
      compositeScore: null,
      autoExecutionAllowed: false
    };
  }

  if (Number.isFinite(koMs) && nowMs >= koMs) {
    const changes = detectSignificantChanges({ ...candidate, status: OPPORTUNITY_STATES.EXPIRED }, previousVersion, thresholds);
    return {
      opportunityId,
      status: OPPORTUNITY_STATES.EXPIRED,
      classificationReason: 'Evento ya iniciado: reanálisis prepartido bloqueado.',
      changes,
      value: null,
      elenaVerdict: null,
      riskVerdict: null,
      compositeScore: null,
      autoExecutionAllowed: false
    };
  }

  // 2. Compuerta estricta de calidad de datos y muestra (EV alto NUNCA compensa datos deficientes)
  const dqScore = Number(candidate.dataQualityScore ?? candidate.dataQuality?.score ?? 0);
  const sampleSize = Number(candidate.sampleSize ?? Math.min(candidate.parameters?.homeSampleGames ?? 0, candidate.parameters?.awaySampleGames ?? 0));
  if (candidate.dataCoverage === 'DATOS_INSUFICIENTES' || candidate.dataCoverage === 'NO_DISPONIBLE' || dqScore < config.minDataQualityScore || sampleSize < config.minSampleGames) {
    const changes = detectSignificantChanges({ ...candidate, status: OPPORTUNITY_STATES.INSUFFICIENT_DATA, dataQualityScore: dqScore }, previousVersion, thresholds);
    return {
      opportunityId,
      status: OPPORTUNITY_STATES.INSUFFICIENT_DATA,
      classificationReason: `Compuerta de evidencia: cobertura=${candidate.dataCoverage || 'N/A'}, calidad=${dqScore} (< ${config.minDataQualityScore}) o muestra=${sampleSize} (< ${config.minSampleGames}).`,
      changes,
      value: null,
      elenaVerdict: null,
      riskVerdict: null,
      compositeScore: null,
      autoExecutionAllowed: false
    };
  }

  // 3. Cálculo de valor
  const value = computeValueMetrics({
    probability: candidate.modelProb ?? candidate.probability,
    odds: candidate.bookmakerOdds ?? candidate.odds,
    noVigProbability: candidate.noVigProb ?? candidate.noVigProbability ?? null,
    previousOdds: previousVersion?.odds ?? null
  });

  if (!value.valid) {
    return {
      opportunityId,
      status: OPPORTUNITY_STATES.INSUFFICIENT_DATA,
      classificationReason: value.reason,
      changes: detectSignificantChanges({ ...candidate, status: OPPORTUNITY_STATES.INSUFFICIENT_DATA }, previousVersion, thresholds),
      value: null,
      elenaVerdict: null,
      riskVerdict: null,
      compositeScore: null,
      autoExecutionAllowed: false
    };
  }

  // 4. Detección de cambios vs análisis anterior
  const normalizedCurrent = {
    odds: value.odds,
    probability: value.probability,
    expectedValuePct: value.expectedValuePct,
    bookmaker: candidate.bookmaker || 'BOOKMAKER_UNAVAILABLE',
    line: candidate.line ?? null,
    dataQualityScore: dqScore
  };
  const changes = detectSignificantChanges(normalizedCurrent, previousVersion, thresholds);

  // 5. Evaluación de Elena (sin simular aprobación si no está disponible)
  let elenaVerdict;
  if (typeof elenaEvaluator !== 'function') {
    elenaVerdict = { agent: 'Elena', available: false, approved: false, status: 'UNAVAILABLE', reasons: ['ELENA_UNAVAILABLE: componente no disponible; no se simula aprobación.'] };
  } else {
    try {
      const packet = {
        ...buildElenaMarketPacket({
          ...candidate,
          dataQuality: candidate.dataQuality || { score: dqScore, tier: dqScore >= 0.85 ? 'ALTA' : 'MEDIA' },
          modelProb: value.probability,
          bookmakerOdds: value.odds,
          impliedProb: value.impliedProbability,
          noVigProb: value.noVigProbability,
          ev: value.expectedValue,
          evPct: value.expectedValuePct
        }, historicalEvidence),
        bookmaker: normalizedCurrent.bookmaker,
        changesFromPrevious: changes
      };
      elenaVerdict = { available: true, ...elenaEvaluator(packet, { minEvPct: config.minOpportunityEvPct }) };
    } catch (err) {
      elenaVerdict = { agent: 'Elena', available: false, approved: false, status: 'UNAVAILABLE', reasons: [`ELENA_ERROR: ${err.message}`] };
    }
  }

  // 6. Validación vinculante de Risk Manager
  const riskVerdict = riskValidator({
    candidate: { ...candidate, bookmakerOdds: value.odds, evPct: value.expectedValuePct, dataQuality: { score: dqScore, tier: candidate.dataQuality?.tier || 'MEDIA' } },
    elenaVerdict,
    activeExposures,
    availableCapitalArs,
    kickoffUtc: candidate.kickoffUtc,
    maxOddsAgeMinutes: config.maxOddsAgeMinutes,
    minSampleGames: config.minSampleGames
  });

  // 7. Clasificación final en los 7 estados oficiales
  let status;
  let classificationReason;

  if (!elenaVerdict.available) {
    status = OPPORTUNITY_STATES.REANALYSIS_REQUIRED;
    classificationReason = elenaVerdict.reasons.join(' | ');
  } else if (!riskVerdict.riskManagerApproved) {
    status = riskVerdict.finalStatus === 'EN_ESPERA' ? OPPORTUNITY_STATES.WATCHLIST : OPPORTUNITY_STATES.REJECTED;
    classificationReason = riskVerdict.finalDecisionReason;
  } else if (value.expectedValuePct >= config.minOpportunityEvPct && elenaVerdict.approved) {
    status = OPPORTUNITY_STATES.OPPORTUNITY;
    classificationReason = `EV +${value.expectedValuePct}% validado por Elena y Risk Manager (calidad ${dqScore}, bookmaker ${normalizedCurrent.bookmaker}).`;
  } else if (value.expectedValuePct >= config.minWatchlistEvPct) {
    status = OPPORTUNITY_STATES.WATCHLIST;
    classificationReason = `EV marginal (+${value.expectedValuePct}%): en seguimiento sin alcanzar umbral de oportunidad (+${config.minOpportunityEvPct}%).`;
  } else {
    status = OPPORTUNITY_STATES.REJECTED;
    classificationReason = `EV insuficiente (${value.expectedValuePct}% < +${config.minWatchlistEvPct}%).`;
  }

  // Puntuación compuesta con compuerta de calidad + trazabilidad de bookmaker
  const bookmakerPenalty = normalizedCurrent.bookmaker === 'BOOKMAKER_UNAVAILABLE' ? 8 : 0;
  const evNorm = Math.min(1, Math.max(0, value.expectedValuePct / 15));
  const rawScore = (evNorm * 45 + dqScore * 35 + (candidate.modelConsensus ?? 0.75) * 20) - bookmakerPenalty;
  const compositeScore = round(Math.max(0, Math.min(100, rawScore * (0.5 + 0.5 * dqScore))), 2);

  return {
    opportunityId,
    status,
    classificationReason,
    changes,
    value,
    elenaVerdict,
    riskVerdict,
    compositeScore,
    autoExecutionAllowed: false
  };
}

module.exports = {
  OPPORTUNITY_STATES,
  CHANGE_REASONS,
  DEFAULT_CHANGE_THRESHOLDS,
  DEFAULT_CLASSIFICATION_CONFIG,
  buildOpportunityId,
  computeValueMetrics,
  detectSignificantChanges,
  reanalyzeOpportunity
};
