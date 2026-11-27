/**
 * EXPERIMENTAL ODDS POLICY V2.4 - CONFIGURATION & POLICY ENGINE
 * Entorno: EXPERIMENTAL_ODDS_POLICY_V24
 *
 * Objetivo: Permitir exploración e investigación rigurosa en el rango [1.45, 2.20] con EV >= +8.0%
 * manteniendo la producción estándar intocable.
 */

const crypto = require('crypto');

const EXPERIMENTAL_ODDS_POLICY_V24 = {
  policyId: 'EXPERIMENTAL_ODDS_V24',
  cohortId: 'EXPERIMENTAL_ODDS_POLICY_V24',
  storageFileName: 'experimental_odds_policy_v24.json',
  minOdds: 1.45,
  maxOdds: 2.20,
  minEV: 0.08, // +8.0% EV requerido
  strategy: 'BALANCED',
  screeningRanges: {
    oddsFrom: 1.45,
    oddsTo: 2.20,
    minHitRate: 60,
    hitRateScope: 'all',
    type: 'over'
  },
  // Canonical State Enum (Sección 8 de la directiva)
  STATES: {
    DISCOVERED: 'DISCOVERED',
    UNDER_RESEARCH: 'UNDER_RESEARCH',
    MATHEMATICAL_PASS: 'MATHEMATICAL_PASS',
    COMMITTEE_APPROVED: 'COMMITTEE_APPROVED',
    RISK_APPROVED: 'RISK_APPROVED',
    SHADOW_PASSIVE: 'SHADOW_PASSIVE',
    EXPERIMENTAL_APPROVED: 'EXPERIMENTAL_APPROVED',
    EXPERIMENTAL_REJECTED_BY_RISK_MANAGER: 'EXPERIMENTAL_REJECTED_BY_RISK_MANAGER',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
    VOID: 'VOID'
  }
};

/**
 * Genera el hash de configuración inmutable
 */
function getPolicyConfigHash() {
  const payload = JSON.stringify({
    policyId: EXPERIMENTAL_ODDS_POLICY_V24.policyId,
    minOdds: EXPERIMENTAL_ODDS_POLICY_V24.minOdds,
    maxOdds: EXPERIMENTAL_ODDS_POLICY_V24.maxOdds,
    minEV: EXPERIMENTAL_ODDS_POLICY_V24.minEV,
    strategy: EXPERIMENTAL_ODDS_POLICY_V24.strategy
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Validador estricto de elegibilidad matemática para política experimental
 */
function evaluateExperimentalMath({ odds, prob, dqeStatus = 'VALID', sampleSize = 10 }) {
  const numOdds = Number(odds);
  const numProb = Number(prob);

  if (!Number.isFinite(numOdds) || !Number.isFinite(numProb)) {
    return {
      pass: false,
      reason: 'PARÁMETROS_INVÁLIDOS: cuota o probabilidad no numérica.',
      ev: 0,
      evPercentage: 0,
      fairOdds: 0
    };
  }

  const fairOdds = numProb > 0 ? Number((1 / numProb).toFixed(3)) : null;
  const impliedProb = Number((1 / numOdds).toFixed(4));
  // EV = (probabilidad_modelo * cuota) - 1
  const ev = Number(((numProb * numOdds) - 1).toFixed(4));
  const evPercentage = Number((ev * 100).toFixed(2));

  // 1. Rango de cuotas [1.45, 2.20]
  if (numOdds < EXPERIMENTAL_ODDS_POLICY_V24.minOdds || numOdds > EXPERIMENTAL_ODDS_POLICY_V24.maxOdds) {
    return {
      pass: false,
      reason: `CUOTA_FUERA_DE_RANGO: @${numOdds.toFixed(2)} fuera de [${EXPERIMENTAL_ODDS_POLICY_V24.minOdds}, ${EXPERIMENTAL_ODDS_POLICY_V24.maxOdds}]`,
      ev,
      evPercentage,
      fairOdds,
      impliedProb
    };
  }

  // 2. Umbral mínimo de EV (+8.0%)
  if (ev < EXPERIMENTAL_ODDS_POLICY_V24.minEV) {
    return {
      pass: false,
      reason: `EV_INSUFICIENTE: +${evPercentage}% inferior al umbral mínimo de +${(EXPERIMENTAL_ODDS_POLICY_V24.minEV * 100).toFixed(1)}%`,
      ev,
      evPercentage,
      fairOdds,
      impliedProb
    };
  }

  // 3. Calidad de datos (DQE)
  if (dqeStatus === 'INVALID') {
    return {
      pass: false,
      reason: 'DQE_INVALID: Datos no confiables o corruptos.',
      ev,
      evPercentage,
      fairOdds,
      impliedProb
    };
  }

  return {
    pass: true,
    reason: `APROBADO_MATEMÁTICO: EV +${evPercentage}% (cuota justa @${fairOdds} vs mercado @${numOdds.toFixed(2)})`,
    ev,
    evPercentage,
    fairOdds,
    impliedProb
  };
}

module.exports = {
  EXPERIMENTAL_ODDS_POLICY_V24,
  getPolicyConfigHash,
  evaluateExperimentalMath
};
