/**
 * DARADORBET — THE LADDER (GRAN ESCALERA)
 * Esquema y reglas operativas actualizadas (v2.0 — Oportunidades Dinámicas y Ejecución Secuencial).
 * Modo experimental / no operativo: sin ejecución automática ni apuestas reales.
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
  maxDailySelections: null,            // SIN límite artificial diario: depende exclusivamente de oportunidades válidas
  sequentialExecutionOnly: true,       // Solo 1 escalón comprometido con capital activo a la vez
  maxConcurrentCommittedSteps: 1,
  allowOverlappingWindows: false,      // Prohibida superposición horaria entre apuestas activas
  requireConfirmedSettlement: true,    // Nunca avanzar solo porque venció la hora estimada de fin
  minReferenceProbability: 0.95,       // Umbral de referencia pendiente de validación estadística
  maxOddsDriftPct: 0.05,               // Tolerancia máxima de cambio de cuota (5%) antes de exigir reevaluación
  requireElenaApproval: true,
  requireRiskManagerValidation: true,  // Elena nunca puede saltarse un bloqueo de Risk Manager
  autoExecutionAllowed: false,         // Ejecución estrictamente manual
  noBetDayPreservesCapital: true
});

const LADDER_STATES = Object.freeze([
  'DISPONIBLE',
  'OPORTUNIDAD_EN_EVALUACION',
  'EN_ESPERA',
  'APUESTA_ACTIVA',
  'LIQUIDACION_PENDIENTE',
  'DETENIDA'
]);

const OPPORTUNITY_STATES = Object.freeze([
  'DETECTADA',
  'EN_EVALUACION',
  'APROBADA',
  'EN_ESPERA',
  'DESCARTADA',
  'RECHAZADA',
  'EJECUTADA',
  'LIQUIDADA'
]);

const LADDER_STEP_STATUSES = Object.freeze([
  'PENDIENTE',
  'APROBADO',
  'EJECUTADO',
  'GANADO',
  'PERDIDO',
  'ANULADO'
]);

/**
 * Duraciones estimadas + margen de tiempo adicional y prórroga por deporte (en minutos).
 * Se usa para construir la ventana horaria completa de exposición [inicio, finEstimadoConProrroga].
 */
const SPORT_WINDOW_MINUTES = Object.freeze({
  football:   { base: 105, stoppage: 15, extraTime: 45, settlementBuffer: 15 }, // 180 min si puede haber prórroga, 135 min regular
  basketball: { base: 135, stoppage: 15, extraTime: 30, settlementBuffer: 15 },
  tennis:     { base: 150, stoppage: 20, extraTime: 60, settlementBuffer: 15 },
  default:    { base: 120, stoppage: 15, extraTime: 35, settlementBuffer: 15 }
});

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
    schemaVersion: 'ladder-v2.0-sequential',
    isOperative: false,
    isDemoData: false,
    stateVersion: 1,
    config: { ...LADDER_CONFIG },
    rules: { ...LADDER_RULES },
    activeSession: {
      ladderId: 'ladder_exp_01',
      ladderState: 'DISPONIBLE',
      blockReason: null,
      createdAtUtc: new Date().toISOString(),
      initialCapitalArs: LADDER_CONFIG.initialCapitalArs,
      availableCapitalArs: LADDER_CONFIG.initialCapitalArs,
      committedCapitalArs: 0,
      targetCapitalArs: LADDER_CONFIG.targetCapitalArs,
      currentStep: 0,
      activeStepId: null,
      activeOpportunityId: null,
      activeEventWindow: null,
      totalPlannedSteps: LADDER_CONFIG.theoreticalStepsCount,
      progressPct: 0,
      daysWithoutBet: 0,
      consecutiveNoBetDays: 0
    },
    opportunities: [],
    steps: [],
    transitions: [],
    processedIdempotencyKeys: [],
    metrics: {
      detected: 0,
      evaluated: 0,
      approved: 0,
      rejected: 0,
      waiting: 0,
      executed: 0,
      settled: 0,
      discardedByConditionChange: 0,
      totalResolutionMinutes: 0,
      avgResolutionMinutes: null,
      stepsWon: 0,
      stepsLost: 0,
      stepsVoid: 0
    }
  };
}

module.exports = {
  LADDER_CONFIG,
  LADDER_RULES,
  LADDER_STATES,
  OPPORTUNITY_STATES,
  LADDER_STEP_STATUSES,
  SPORT_WINDOW_MINUTES,
  buildTheoreticalProgression,
  createEmptyLadderState
};
