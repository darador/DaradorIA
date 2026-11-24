/**
 * DARADORBET — THE LADDER (GRAN ESCALERA)
 * Esquema conceptual, configuración oficial de referencia y proyección teórica (FASE VISUAL — NO OPERATIVO).
 *
 * Configuración oficial:
 * - Capital inicial: 50.000 ARS
 * - Objetivo final: 10.000.000 ARS
 * - Reinversión teórica: 100% (capital_siguiente = capital_actual * cuota_obtenida)
 * - Cuota de referencia de simulación: 1.20 (escenario teórico de 30 escalones; no es obligación operativa)
 * - Probabilidad mínima de referencia: 95% (pendiente de validación estadística)
 */

const LADDER_CONFIG = Object.freeze({
  currency: 'ARS',
  locale: 'es-AR',
  initialCapitalArs: 50000,            // $ 50.000 ARS
  targetCapitalArs: 10000000,          // $ 10.000.000 ARS
  referenceSimulationOdds: 1.20,       // Escenario teórico de simulación (no obligación operativa)
  theoreticalStepsCount: 30            // 50.000 * 1.20^30 ≈ 11.868.816 ARS (> 10.000.000 ARS)
});

const LADDER_RULES = Object.freeze({
  maxActiveLadders: 1,
  reinvestmentRatio: 1.0,              // Reinversión teórica del 100% del retorno
  maxDailySelections: 2,               // Máximo 1–2 selecciones diarias
  minReferenceProbability: 0.95,       // Probabilidad mínima de referencia: 95% (pendiente validación estadística)
  requireElenaApproval: true,
  requireRiskManagerValidation: true,
  autoExecutionAllowed: false,         // Ninguna apuesta se ejecuta automáticamente
  noBetDayPreservesCapital: true       // Los días sin apuesta no modifican el capital
});

const LADDER_STEP_STATUSES = Object.freeze([
  'PENDIENTE',
  'APROBADO',
  'EJECUTADO',
  'GANADO',
  'PERDIDO',
  'ANULADO'
]);

const LADDER_DISCIPLINE_STATES = Object.freeze([
  'OPORTUNIDAD_DISPONIBLE',
  'ESPERANDO',
  'DIA_SIN_APUESTA'
]);

/**
 * Calcula la progresión teórica paso a paso:
 * capital_siguiente = capital_actual * cuota_obtenida
 */
function buildTheoreticalProgression(
  initialCapital = LADDER_CONFIG.initialCapitalArs,
  simOdds = LADDER_CONFIG.referenceSimulationOdds,
  totalSteps = LADDER_CONFIG.theoreticalStepsCount
) {
  const steps = [];
  let cap = initialCapital;
  for (let i = 1; i <= totalSteps; i++) {
    const startCap = cap;
    const endCap = startCap * simOdds;
    steps.push({
      step: i,
      startCapitalArs: Math.round(startCap),
      projectedOdds: simOdds,
      endCapitalArs: Math.round(endCap),
      reachesTarget: endCap >= LADDER_CONFIG.targetCapitalArs
    });
    cap = endCap;
  }
  return steps;
}

function createEmptyLadderState() {
  return {
    schemaVersion: 'ladder-v1.1-design',
    isOperative: false,
    isDemoData: false,
    config: { ...LADDER_CONFIG },
    rules: { ...LADDER_RULES },
    activeSession: {
      ladderId: null,
      status: 'READY_TO_INITIALIZE',
      createdAtUtc: null,
      initialCapitalArs: LADDER_CONFIG.initialCapitalArs,
      currentCapitalArs: LADDER_CONFIG.initialCapitalArs,
      targetCapitalArs: LADDER_CONFIG.targetCapitalArs,
      currentStep: 0,
      totalPlannedSteps: LADDER_CONFIG.theoreticalStepsCount,
      progressPct: 0,
      daysWithoutBet: 0,
      consecutiveNoBetDays: 0,
      disciplineState: 'ESPERANDO'
    },
    nextOpportunity: null,
    steps: buildTheoreticalProgression(),
    history: [],
    statistics: {
      totalEvaluatedDays: 0,
      daysWithSelection: 0,
      daysWithoutBet: 0,
      stepsWon: 0,
      stepsLost: 0,
      stepsVoid: 0,
      avgOddsReached: null,
      avgEstimatedProb: null
    }
  };
}

module.exports = {
  LADDER_CONFIG,
  LADDER_RULES,
  LADDER_STEP_STATUSES,
  LADDER_DISCIPLINE_STATES,
  buildTheoreticalProgression,
  createEmptyLadderState
};
