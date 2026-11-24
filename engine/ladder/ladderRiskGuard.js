/**
 * DARADORBET — THE LADDER RISK GUARD (AISLADO)
 * Extensión aislada de validación de riesgo y ventanas horarias para THE LADDER.
 * NO modifica engine/agents/riskManager.js (producción intacta).
 *
 * Principio vinculante:
 * La aprobación de Elena NUNCA puede saltarse un bloqueo de Risk Manager.
 */

const { LADDER_RULES, SPORT_WINDOW_MINUTES } = require('./ladderSchema');

const BLOCKED_EVENT_STATUSES = new Set([
  'SUSPENDED',
  'POSTPONED',
  'DELAYED',
  'CANCELLED',
  'ABANDONED',
  'FINISHED_UNSETTLED',
  'UNKNOWN'
]);

/**
 * Calcula la ventana temporal completa de exposición de un evento:
 * [startMs, endMs] contemplando zona horaria (UTC), duración base, tiempo adicional,
 * posible prórroga/extensión y margen de confirmación de liquidación.
 */
function computeEventWindow(event) {
  if (!event || !event.kickoffUtc) {
    return { valid: false, reason: 'MISSING_KICKOFF_UTC' };
  }
  const startMs = Date.parse(event.kickoffUtc);
  if (!Number.isFinite(startMs)) {
    return { valid: false, reason: 'INVALID_KICKOFF_UTC' };
  }

  const sportKey = String(event.sport || 'football').toLowerCase();
  const profile = SPORT_WINDOW_MINUTES[sportKey] || SPORT_WINDOW_MINUTES.default;

  const baseMin = Number.isFinite(event.estimatedDurationMin) ? event.estimatedDurationMin : profile.base;
  const stoppageMin = Number.isFinite(event.additionalTimeMin) ? event.additionalTimeMin : profile.stoppage;
  const extraMin = event.canHaveOvertime ? (Number.isFinite(event.overtimeMin) ? event.overtimeMin : profile.extraTime) : 0;
  const settleMin = Number.isFinite(event.settlementBufferMin) ? event.settlementBufferMin : profile.settlementBuffer;

  const totalMinutes = baseMin + stoppageMin + extraMin + settleMin;
  const endMs = startMs + totalMinutes * 60 * 1000;

  return {
    valid: true,
    sport: sportKey,
    timeZone: event.timeZone || 'UTC',
    kickoffUtc: new Date(startMs).toISOString(),
    estimatedEndUtc: new Date(endMs).toISOString(),
    startMs,
    endMs,
    totalMinutes
  };
}

/**
 * Verifica si dos ventanas horarias se superponen (inclusivo en bordes).
 */
function windowsOverlap(winA, winB) {
  if (!winA || !winB || !winA.valid || !winB.valid) return true; // Conservador ante incertidumbre
  return winA.startMs < winB.endMs && winB.startMs < winA.endMs;
}

/**
 * Evalúa si una oportunidad puede aprobarse/ejecutarse en THE LADDER.
 * Retorna { allowed, action: 'ALLOW' | 'WAIT' | 'REJECT' | 'DISCARD', code, reason, window }.
 */
function validateLadderOpportunity(state, opportunity, options = {}) {
  const session = state.activeSession;
  const rules = state.rules || LADDER_RULES;

  // 0. Escalera detenida (p. ej. tras escalón perdido)
  if (session.ladderState === 'DETENIDA' || session.availableCapitalArs <= 0 && session.committedCapitalArs <= 0) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'LADDER_HALTED',
      reason: 'La Gran Escalera se encuentra detenida sin capital disponible.'
    };
  }

  // 1. Integridad de datos mínimos
  if (!opportunity || !opportunity.id || !opportunity.match || !opportunity.market) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'INSUFFICIENT_DATA',
      reason: 'Datos incompletos de evento o mercado para evaluación de riesgo.'
    };
  }

  const odds = Number(opportunity.currentOdds ?? opportunity.odds);
  if (!Number.isFinite(odds) || odds <= 1.01) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'INVALID_ODDS',
      reason: 'Cuota inválida o no disponible.'
    };
  }

  if (opportunity.sampleSize !== undefined && opportunity.sampleSize < 8) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'INSUFFICIENT_SAMPLE',
      reason: `Muestra estadística insuficiente (${opportunity.sampleSize} < 8 observaciones).`
    };
  }

  // 2. Estado del evento (suspendido, postergado, demorado o inconsistente)
  const evStatus = String(opportunity.eventStatus || 'SCHEDULED').toUpperCase();
  if (BLOCKED_EVENT_STATUSES.has(evStatus)) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'EVENT_STATUS_INCONSISTENT',
      reason: `Evento bloqueado por estado operativo inconsistente (${evStatus}).`
    };
  }

  // 3. Ventana horaria válida
  const candidateWindow = computeEventWindow(opportunity);
  if (!candidateWindow.valid) {
    return {
      allowed: false,
      action: 'REJECT',
      code: candidateWindow.reason,
      reason: 'Horario de inicio o zona horaria del evento inválidos.'
    };
  }

  // 4. Cambio de cuota respecto a evaluación previa (exige reevaluación)
  if (opportunity.evaluatedOdds !== undefined && opportunity.evaluatedOdds !== null) {
    const prevOdds = Number(opportunity.evaluatedOdds);
    if (Number.isFinite(prevOdds) && prevOdds > 1) {
      const drift = Math.abs(odds - prevOdds) / prevOdds;
      if (drift > (rules.maxOddsDriftPct || 0.05) && !options.isReevaluation) {
        return {
          allowed: false,
          action: 'DISCARD',
          code: 'ODDS_CHANGED_REEVAL_REQUIRED',
          reason: `La cuota cambió de ${prevOdds.toFixed(2)} a ${odds.toFixed(2)} (${(drift * 100).toFixed(1)}% > ${(rules.maxOddsDriftPct * 100).toFixed(0)}%). Requiere reevaluación.`
        };
      }
    }
  }

  // 5. Criterios cuantitativos mínimos (EV y probabilidad de referencia / umbral configurado)
  const evPct = Number(opportunity.evPct);
  const prob = Number(opportunity.estimatedProb);
  const minProb = Number(options.minProbOverride ?? rules.minReferenceProbability ?? 0.95);
  if (!Number.isFinite(evPct) || evPct <= 0) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'CRITERIA_NO_LONGER_MET',
      reason: `EV insuficiente (${Number.isFinite(evPct) ? evPct.toFixed(1) + '%' : 'N/D'} <= 0%).`
    };
  }
  if (!Number.isFinite(prob) || prob < minProb) {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'PROBABILITY_BELOW_THRESHOLD',
      reason: `Probabilidad estimada (${Number.isFinite(prob) ? (prob * 100).toFixed(1) + '%' : 'N/D'}) por debajo del umbral de referencia (${(minProb * 100).toFixed(0)}%).`
    };
  }

  // 6. Bloqueo explícito de Risk Manager externo (Elena NUNCA puede saltarlo)
  if (opportunity.riskManagerVeto === true || opportunity.riskManagerStatus === 'REJECTED') {
    return {
      allowed: false,
      action: 'REJECT',
      code: 'RISK_MANAGER_VETO',
      reason: opportunity.riskManagerReason || 'Rechazada por Risk Manager (bloqueo vinculante sobre Elena).'
    };
  }

  // 7. Liquidación pendiente o evento activo suspendido -> bloquea progresión
  if (session.ladderState === 'LIQUIDACION_PENDIENTE') {
    return {
      allowed: false,
      action: 'WAIT',
      code: 'PENDING_SETTLEMENT_BLOCK',
      reason: 'Existe una liquidación pendiente o evento suspendido/demorado. No se habilita el siguiente escalón hasta confirmación oficial.',
      window: candidateWindow
    };
  }

  // 8. Apuesta activa comprometida -> secuencialidad estricta + chequeo de superposición horaria
  if (session.ladderState === 'APUESTA_ACTIVA' || session.committedCapitalArs > 0) {
    const overlaps = session.activeEventWindow && windowsOverlap(session.activeEventWindow, candidateWindow);
    return {
      allowed: false,
      action: 'WAIT',
      code: overlaps ? 'TIME_WINDOW_OVERLAP' : 'ACTIVE_BET_OPEN',
      reason: overlaps
        ? `Ventana horaria superpuesta con el escalón activo (${session.activeEventWindow.kickoffUtc} – ${session.activeEventWindow.estimatedEndUtc}).`
        : 'Existe un escalón comprometido con capital activo. La oportunidad queda EN ESPERA hasta la liquidación confirmada.',
      window: candidateWindow
    };
  }

  // 9. Verificación de superposición contra cualquier otra oportunidad ya EJECUTADA no liquidada
  const openExecuted = (state.opportunities || []).filter(
    o => o.id !== opportunity.id && o.state === 'EJECUTADA'
  );
  for (const openOpp of openExecuted) {
    const openWin = openOpp.eventWindow || computeEventWindow(openOpp);
    if (windowsOverlap(openWin, candidateWindow)) {
      return {
        allowed: false,
        action: 'WAIT',
        code: 'TIME_WINDOW_OVERLAP',
        reason: `Ventana horaria superpuesta con la apuesta ejecutada ${openOpp.id}.`,
        window: candidateWindow
      };
    }
  }

  return {
    allowed: true,
    action: 'ALLOW',
    code: 'OK',
    reason: 'Validación de Risk Manager y ventana horaria aprobada.',
    window: candidateWindow
  };
}

module.exports = {
  computeEventWindow,
  windowsOverlap,
  validateLadderOpportunity
};
