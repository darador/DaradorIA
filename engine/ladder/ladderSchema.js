/**
 * DARADORBET — THE LADDER (GRAN ESCALERA)
 * Esquema conceptual y modelo de datos propuesto (Fase de Diseño Visual — NO OPERATIVO).
 *
 * Reglas de integridad:
 * - No duplica Prediction Engine, Elena ni Risk Manager (solo referencia sus IDs/dictámenes).
 * - No ejecuta apuestas reales ni modifica datos productivos o históricos.
 * - Datos de demostración estrictamente marcados con `isDemoData: true` y `isOperative: false`.
 */

const LADDER_RULES = Object.freeze({
  maxActiveLadders: 1,
  reinvestmentRatio: 1.0,              // Reinversión teórica del 100% del retorno
  maxDailySelections: 2,               // Máximo 1–2 selecciones diarias
  minReferenceProbability: 0.95,       // Probabilidad mínima de referencia: 95% (pendiente validación estadística)
  requireElenaApproval: true,
  requireRiskManagerValidation: true,
  autoExecutionAllowed: false,         // Ninguna apuesta se ejecuta automáticamente
  noBetDayPreservesCapital: true       // Días sin apuesta no modifican capital
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
 * Plantilla de estructura de datos propuesta para persistencia futura
 * (engine/storage_data/ladder_state.json cuando se autorice fase operativa).
 */
function createEmptyLadderState() {
  return {
    schemaVersion: 'ladder-v1.0-design',
    isOperative: false,
    isDemoData: false,
    rules: { ...LADDER_RULES },
    activeSession: {
      ladderId: null,
      status: 'NOT_INITIALIZED',
      createdAtUtc: null,
      initialCapital: null,     // Por definir por el usuario
      currentCapital: null,
      targetCapital: null,      // Por definir por el usuario
      currentStep: 0,
      totalPlannedSteps: null,
      progressPct: 0,
      daysWithoutBet: 0,
      consecutiveNoBetDays: 0,
      disciplineState: 'ESPERANDO'
    },
    nextOpportunity: null,      // Referencia de solo lectura a pickId + dictamen Elena/Risk Manager
    steps: [],                  // Array de LadderStep auditables
    history: [],                // Historial cronológico inmutable de progresión y días sin apuesta
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
  LADDER_RULES,
  LADDER_STEP_STATUSES,
  LADDER_DISCIPLINE_STATES,
  createEmptyLadderState
};
