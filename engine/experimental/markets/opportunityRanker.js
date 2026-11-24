/**
 * UNIFIED MULTI-FAMILY OPPORTUNITY RANKER (FASE 7 — EXPERIMENTAL)
 *
 * Ranking común para comparar oportunidades de distintas familias de mercados
 * (1X2, Doble Oportunidad, Goles, BTTS, Estadísticas de Equipo, Props Individuales).
 *
 * Principios estrictos:
 *  1. NUNCA ordena solo por probabilidad de acierto.
 *  2. Aplica filtros duros obligatorios ANTES de puntuar y ordenar.
 *  3. Impide que un mercado con datos deficientes supere a uno con evidencia sólida
 *     mediante penalización multiplicativa por calidad de datos y muestra.
 *  4. Devuelve lista de oportunidades candidatas con motivo explícito de cada estado
 *     (APROBADA, EN_ESPERA, RECHAZADA) — NUNCA ejecuta apuestas automáticamente.
 */

'use strict';

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

const DEFAULT_RANKER_FILTERS = Object.freeze({
  minEvPct: 2.0,
  minDataQualityScore: 0.55,
  minSampleSize: 8,
  maxUncertainty: 0.38,
  maxOddsAgeMinutes: 360
});

/**
 * Evalúa filtros duros obligatorios previos al ranking.
 */
function runMandatoryPreFilters(item, filters = DEFAULT_RANKER_FILTERS) {
  const failures = [];

  if (item.riskManagerBlocked === true) {
    failures.push(`Bloqueado por Risk Manager: ${item.riskManagerReason || 'control de riesgo'}`);
  }
  if (!Number.isFinite(Number(item.bookmakerOdds)) || Number(item.bookmakerOdds) <= 1.01) {
    failures.push('Sin cuota disponible o válida');
  }
  if (!Number.isFinite(Number(item.evPct)) || Number(item.evPct) < filters.minEvPct) {
    failures.push(`EV insuficiente (${item.evPct ?? 'N/A'}% < ${filters.minEvPct}%)`);
  }
  const dq = Number(item.dataQualityScore ?? item.dataQuality?.score ?? 0);
  if (!Number.isFinite(dq) || dq < filters.minDataQualityScore) {
    failures.push(`Calidad de datos insuficiente (${dq} < ${filters.minDataQualityScore})`);
  }
  const sample = Number(item.sampleSize ?? Math.min(item.parameters?.homeSampleGames ?? 0, item.parameters?.awaySampleGames ?? 0));
  if (!Number.isFinite(sample) || sample < filters.minSampleSize) {
    failures.push(`Muestra insuficiente (${sample} < ${filters.minSampleSize})`);
  }
  if (item.uncertainty !== undefined && item.uncertainty !== null && Number(item.uncertainty) > filters.maxUncertainty) {
    failures.push(`Incertidumbre elevada (${(item.uncertainty * 100).toFixed(1)}% > ${(filters.maxUncertainty * 100).toFixed(0)}%)`);
  }
  if (item.oddsAgeMinutes !== undefined && item.oddsAgeMinutes !== null && Number(item.oddsAgeMinutes) > filters.maxOddsAgeMinutes) {
    failures.push(`Cuota desactualizada (${item.oddsAgeMinutes} min > ${filters.maxOddsAgeMinutes} min)`);
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Calcula una puntuación compuesta transparente (0..100) con compuerta multiplicativa de evidencia.
 * Un mercado con datos pobres sufre multiplicador severo para que JAMÁS supere a uno sólido.
 */
function computeCompositeScore(item) {
  const evPct = clamp(Number(item.evPct) || 0, 0, 20);
  const evNorm = evPct / 15; // 15%+ EV satura en 1.0

  const prob = clamp(Number(item.modelProb) || 0.5, 0.05, 0.95);
  const uncertainty = Number.isFinite(Number(item.uncertainty)) ? clamp(Number(item.uncertainty), 0, 1) : 0.20;
  const certaintyNorm = 1 - uncertainty;

  const dataQuality = clamp(Number(item.dataQualityScore ?? item.dataQuality?.score ?? 0.6), 0, 1);
  const consensus = clamp(Number(item.modelConsensus ?? 0.75), 0, 1);
  const calibration = clamp(Number(item.historicalCalibrationScore ?? 0.70), 0, 1);

  // Bonus moderado por CLV histórico positivo (si existe evidencia)
  const clvNorm = Number.isFinite(Number(item.historicalAvgClvPct))
    ? clamp((Number(item.historicalAvgClvPct) + 2) / 6, 0, 1)
    : 0.5;

  // Riesgo particular del mercado (penalización suave a mercados de alta varianza como tarjetas/empate puro)
  const marketRiskPenalty = Number(item.marketRiskPenalty ?? 0);

  // Suma ponderada base (0..100)
  const rawScore = (
    evNorm * 32 +
    certaintyNorm * 18 +
    dataQuality * 22 +
    consensus * 12 +
    calibration * 10 +
    clvNorm * 6
  ) - marketRiskPenalty;

  // Compuerta multiplicativa de evidencia: impide que dataQuality bajo + EV inflado domine
  const evidenceMultiplier = clamp(0.5 + 0.5 * dataQuality, 0.5, 1.0);
  const finalScore = clamp(rawScore * evidenceMultiplier, 0, 100);

  return {
    compositeScore: round(finalScore, 2),
    breakdown: {
      evComponent: round(evNorm * 32, 2),
      certaintyComponent: round(certaintyNorm * 18, 2),
      dataQualityComponent: round(dataQuality * 22, 2),
      consensusComponent: round(consensus * 12, 2),
      calibrationComponent: round(calibration * 10, 2),
      clvComponent: round(clvNorm * 6, 2),
      evidenceMultiplier: round(evidenceMultiplier, 3),
      probUsedForInfoOnly: round(prob, 4)
    }
  };
}

/**
 * Clasifica y ordena un conjunto heterogéneo de oportunidades multi-familia.
 */
function rankOpportunities(candidates = [], customFilters = {}) {
  const filters = { ...DEFAULT_RANKER_FILTERS, ...customFilters };
  const approvedCandidates = [];
  const waitingCandidates = [];
  const rejectedCandidates = [];

  for (const item of candidates) {
    if (item.riskStatus === 'EN_ESPERA') {
      waitingCandidates.push({
        ...item,
        rankingStatus: 'EN_ESPERA',
        rankingReason: item.riskManagerReason || 'En espera por control secuencial o ventana horaria.',
        compositeScore: null
      });
      continue;
    }

    const pre = runMandatoryPreFilters(item, filters);
    if (!pre.passed) {
      rejectedCandidates.push({
        ...item,
        rankingStatus: 'RECHAZADA',
        rankingReason: pre.failures.join(' | '),
        compositeScore: null
      });
      continue;
    }

    const scored = computeCompositeScore(item);
    approvedCandidates.push({
      ...item,
      rankingStatus: 'CANDIDATA_APROBADA',
      rankingReason: `Superó filtros obligatorios (EV +${item.evPct}%, calidad ${item.dataQualityScore ?? item.dataQuality?.score}).`,
      compositeScore: scored.compositeScore,
      scoreBreakdown: scored.breakdown,
      autoExecutionAllowed: false
    });
  }

  approvedCandidates.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

  return {
    generatedAt: new Date().toISOString(),
    autoExecutionAllowed: false,
    totalInput: candidates.length,
    approvedCount: approvedCandidates.length,
    waitingCount: waitingCandidates.length,
    rejectedCount: rejectedCandidates.length,
    approvedCandidates,
    waitingCandidates,
    rejectedCandidates
  };
}

module.exports = {
  DEFAULT_RANKER_FILTERS,
  runMandatoryPreFilters,
  computeCompositeScore,
  rankOpportunities
};
