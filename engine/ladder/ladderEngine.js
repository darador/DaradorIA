/**
 * DARADORBET — THE LADDER SEQUENTIAL ENGINE (EXPERIMENTAL / NO OPERATIVO)
 *
 * Garantías:
 * - Sin límite artificial diario de oportunidades.
 * - Ejecución estrictamente secuencial: máximo 1 escalón comprometido con capital activo a la vez.
 * - Control estricto de superposición de ventanas horarias (inicio + duración + prórroga + liquidación).
 * - Gestión explícita de estados de oportunidades (DETECTADA -> EN_EVALUACION -> APROBADA / EN_ESPERA / RECHAZADA / DESCARTADA -> EJECUTADA -> LIQUIDADA).
 * - Concurrencia e idempotencia (bloqueo optimista por `stateVersion` + `idempotencyKey` para evitar doble compromiso o doble liquidación).
 * - Registro inmutable de transiciones para auditoría.
 * - Ejecución 100% manual (nunca dispara apuestas automáticas ni toca producción).
 */

const { createEmptyLadderState } = require('./ladderSchema');
const { computeEventWindow, validateLadderOpportunity } = require('./ladderRiskGuard');

class LadderEngine {
  constructor(initialState = null) {
    this.state = initialState ? JSON.parse(JSON.stringify(initialState)) : createEmptyLadderState();
    this._commitLock = false;
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  _recordTransition(entityType, entityId, fromState, toState, reason, actor = 'LadderEngine', tsUtc = null) {
    this.state.transitions.push({
      timestampUtc: tsUtc || new Date().toISOString(),
      entityType,
      entityId,
      fromState,
      toState,
      reason,
      actor
    });
  }

  _recomputeWaitingMetric() {
    this.state.metrics.waiting = this.state.opportunities.filter(o => o.state === 'EN_ESPERA').length;
  }

  /**
   * Registra un día evaluado sin oportunidades válidas: el capital permanece intacto.
   */
  recordNoOpportunityDay(dateStr, reason = 'Ninguna oportunidad cumplió criterios estadísticos y de riesgo.') {
    this.state.activeSession.daysWithoutBet += 1;
    this.state.activeSession.consecutiveNoBetDays += 1;
    this._recordTransition(
      'SESSION',
      this.state.activeSession.ladderId,
      this.state.activeSession.ladderState,
      this.state.activeSession.ladderState,
      `Día sin apuesta (${dateStr}): ${reason} Capital intacto: ${this.state.activeSession.availableCapitalArs} ARS.`,
      'DisciplineTracker'
    );
    return {
      recorded: true,
      daysWithoutBet: this.state.activeSession.daysWithoutBet,
      availableCapitalArs: this.state.activeSession.availableCapitalArs
    };
  }

  /**
   * Evalúa una oportunidad detectada (Elena + LadderRiskGuard) sin ejecutarla automáticamente.
   */
  evaluateOpportunity(rawOpp, options = {}) {
    const nowUtc = options.nowUtc || new Date().toISOString();
    const opp = {
      id: rawOpp.id,
      match: rawOpp.match,
      competition: rawOpp.competition || 'Competición',
      sport: rawOpp.sport || 'football',
      market: rawOpp.market,
      selection: rawOpp.selection,
      kickoffUtc: rawOpp.kickoffUtc,
      timeZone: rawOpp.timeZone || 'UTC',
      canHaveOvertime: Boolean(rawOpp.canHaveOvertime),
      estimatedDurationMin: rawOpp.estimatedDurationMin,
      eventStatus: rawOpp.eventStatus || 'SCHEDULED',
      odds: Number(rawOpp.odds),
      currentOdds: Number(rawOpp.currentOdds ?? rawOpp.odds),
      evaluatedOdds: Number(rawOpp.odds),
      estimatedProb: Number(rawOpp.estimatedProb),
      evPct: Number(rawOpp.evPct),
      sampleSize: rawOpp.sampleSize ?? 20,
      elenaDecision: String(rawOpp.elenaDecision || 'PENDIENTE').toUpperCase(),
      elenaReason: rawOpp.elenaReason || null,
      riskManagerVeto: Boolean(rawOpp.riskManagerVeto),
      riskManagerStatus: rawOpp.riskManagerStatus || 'PENDING',
      riskManagerReason: rawOpp.riskManagerReason || null,
      eventWindow: computeEventWindow(rawOpp),
      state: 'DETECTADA',
      blockCode: null,
      blockReason: null,
      detectedAtUtc: nowUtc,
      evaluatedAtUtc: nowUtc,
      executedAtUtc: null,
      settledAtUtc: null
    };

    this.state.opportunities.push(opp);
    this.state.metrics.detected += 1;
    this._recordTransition('OPPORTUNITY', opp.id, null, 'DETECTADA', 'Oportunidad ingresada a evaluación.', 'DiscoveryRef', nowUtc);

    // Transición a EN_EVALUACION
    opp.state = 'EN_EVALUACION';
    this.state.metrics.evaluated += 1;
    this._recordTransition('OPPORTUNITY', opp.id, 'DETECTADA', 'EN_EVALUACION', 'Iniciando validación Elena + Risk Manager.', 'LadderEngine', nowUtc);

    // 1. Validación de Risk Manager primero (Elena NUNCA puede saltarse un bloqueo de Risk Manager)
    const rmCheck = validateLadderOpportunity(this.state, opp, options);
    if (!rmCheck.allowed) {
      if (rmCheck.action === 'WAIT') {
        opp.state = 'EN_ESPERA';
        opp.blockCode = rmCheck.code;
        opp.blockReason = rmCheck.reason;
        this._recordTransition('OPPORTUNITY', opp.id, 'EN_EVALUACION', 'EN_ESPERA', rmCheck.reason, 'LadderRiskGuard', nowUtc);
        this._recomputeWaitingMetric();
        return { status: 'EN_ESPERA', code: rmCheck.code, reason: rmCheck.reason, opportunity: opp };
      }

      opp.state = 'RECHAZADA';
      opp.blockCode = rmCheck.code;
      opp.blockReason = rmCheck.reason;
      this.state.metrics.rejected += 1;
      this._recordTransition('OPPORTUNITY', opp.id, 'EN_EVALUACION', 'RECHAZADA', rmCheck.reason, 'LadderRiskGuard', nowUtc);
      return { status: 'RECHAZADA', code: rmCheck.code, reason: rmCheck.reason, opportunity: opp };
    }

    // 2. Validación de Elena
    if (opp.elenaDecision !== 'APROBADO') {
      opp.state = 'RECHAZADA';
      opp.blockCode = 'ELENA_NOT_APPROVED';
      opp.blockReason = opp.elenaReason || `Dictamen de Elena no aprobado (${opp.elenaDecision}).`;
      this.state.metrics.rejected += 1;
      this._recordTransition('OPPORTUNITY', opp.id, 'EN_EVALUACION', 'RECHAZADA', opp.blockReason, 'Elena', nowUtc);
      return { status: 'RECHAZADA', code: opp.blockCode, reason: opp.blockReason, opportunity: opp };
    }

    // 3. Ambas aprobaciones superadas -> APROBADA (lista para decisión MANUAL del usuario)
    opp.state = 'APROBADA';
    opp.riskManagerStatus = 'VALIDADO';
    opp.eventWindow = rmCheck.window;
    this.state.metrics.approved += 1;
    this._recordTransition('OPPORTUNITY', opp.id, 'EN_EVALUACION', 'APROBADA', 'Aprobada por Elena y validada por Risk Manager. Lista para decisión manual.', 'LadderRiskGuard', nowUtc);
    return { status: 'APROBADA', code: 'OK', reason: 'Lista para decisión manual del usuario.', opportunity: opp };
  }

  /**
   * Compromete el capital en un único escalón tras decisión MANUAL del usuario.
   * Implementa control de concurrencia (expectedVersion + mutex) e idempotencia.
   */
  executeStepManual(opportunityId, { expectedVersion = null, idempotencyKey = null, nowUtc = null } = {}) {
    const ts = nowUtc || new Date().toISOString();

    // Idempotencia estricta
    if (idempotencyKey && this.state.processedIdempotencyKeys.includes(idempotencyKey)) {
      return { executed: false, code: 'IDEMPOTENT_DUPLICATE', reason: 'Operación ya procesada anteriormente (idempotencia).' };
    }

    // Bloqueo optimista + mutex contra dos procesos simultáneos
    if (this._commitLock || (expectedVersion !== null && expectedVersion !== this.state.stateVersion)) {
      return { executed: false, code: 'CONCURRENCY_LOCK_CONFLICT', reason: 'Conflicto de concurrencia: otro proceso ya comprometió o actualizó este escalón.' };
    }

    this._commitLock = true;
    try {
      const opp = this.state.opportunities.find(o => o.id === opportunityId);
      if (!opp) {
        return { executed: false, code: 'OPPORTUNITY_NOT_FOUND', reason: 'Oportunidad no encontrada.' };
      }

      if (opp.state !== 'APROBADA') {
        return {
          executed: false,
          code: 'OPPORTUNITY_NOT_APPROVED',
          reason: `Solo se pueden ejecutar oportunidades en estado APROBADA (actual: ${opp.state}).`
        };
      }

      // Re-verificar Risk Manager justo antes de comprometer capital (defensa en profundidad)
      const rmFinal = validateLadderOpportunity(this.state, opp);
      if (!rmFinal.allowed) {
        return { executed: false, code: rmFinal.code, reason: rmFinal.reason };
      }

      const session = this.state.activeSession;
      const stakeCapital = session.availableCapitalArs;
      const nextStepNum = session.currentStep + 1;
      const stepId = `ladder_step_${nextStepNum}_${opp.id}`;

      const step = {
        stepId,
        stepNumber: nextStepNum,
        opportunityId: opp.id,
        match: opp.match,
        market: opp.market,
        selection: opp.selection,
        startCapitalArs: stakeCapital,
        odds: opp.currentOdds,
        settledOdds: null,
        endCapitalArs: null,
        status: 'EJECUTADO',
        eventStatus: opp.eventStatus,
        eventWindow: rmFinal.window,
        executedAtUtc: ts,
        settledAtUtc: null
      };

      session.availableCapitalArs = 0;
      session.committedCapitalArs = stakeCapital;
      session.activeStepId = stepId;
      session.activeOpportunityId = opp.id;
      session.activeEventWindow = rmFinal.window;
      session.ladderState = 'APUESTA_ACTIVA';
      session.blockReason = `Escalón ${nextStepNum} activo (${opp.match}). Esperando liquidación confirmada.`;
      session.consecutiveNoBetDays = 0;

      opp.state = 'EJECUTADA';
      opp.executedAtUtc = ts;

      this.state.steps.push(step);
      this.state.metrics.executed += 1;
      this.state.stateVersion += 1;
      if (idempotencyKey) this.state.processedIdempotencyKeys.push(idempotencyKey);

      this._recordTransition('OPPORTUNITY', opp.id, 'APROBADA', 'EJECUTADA', `Decisión manual ejecutada. Capital comprometido: ${stakeCapital} ARS.`, 'ManualUser', ts);
      this._recordTransition('SESSION', session.ladderId, 'DISPONIBLE', 'APUESTA_ACTIVA', `Escalón ${nextStepNum} comprometido.`, 'LadderEngine', ts);

      return { executed: true, code: 'OK', step, stateVersion: this.state.stateVersion };
    } finally {
      this._commitLock = false;
    }
  }

  /**
   * Actualiza estado operativo del evento activo (p. ej. SUSPENDED, POSTPONED, FINISHED_UNSETTLED).
   * NUNCA libera el capital automáticamente por vencimiento del horario estimado.
   */
  updateActiveEventStatus(eventStatus, reason = null, nowUtc = null) {
    const ts = nowUtc || new Date().toISOString();
    const session = this.state.activeSession;
    const step = this.state.steps.find(s => s.stepId === session.activeStepId);
    if (!step) return { updated: false, code: 'NO_ACTIVE_STEP' };

    const norm = String(eventStatus || '').toUpperCase();
    step.eventStatus = norm;

    if (['SUSPENDED', 'POSTPONED', 'DELAYED', 'FINISHED_UNSETTLED'].includes(norm)) {
      const prev = session.ladderState;
      session.ladderState = 'LIQUIDACION_PENDIENTE';
      session.blockReason = reason || `Evento en estado ${norm}: capital bloqueado hasta confirmación oficial de liquidación.`;
      this._recordTransition('SESSION', session.ladderId, prev, 'LIQUIDACION_PENDIENTE', session.blockReason, 'EventMonitor', ts);
    }

    return {
      updated: true,
      ladderState: session.ladderState,
      committedCapitalArs: session.committedCapitalArs,
      availableCapitalArs: session.availableCapitalArs
    };
  }

  /**
   * Confirma liquidación definitiva (WON | LOST | VOID).
   * Idempotente: el capital se actualiza UNA SOLA VEZ.
   */
  confirmSettlement(stepId, { outcome, settledOdds = null, settledAtUtc = null, idempotencyKey = null } = {}) {
    const ts = settledAtUtc || new Date().toISOString();

    if (idempotencyKey && this.state.processedIdempotencyKeys.includes(idempotencyKey)) {
      return { settled: false, code: 'IDEMPOTENT_DUPLICATE', reason: 'Liquidación ya aplicada (idempotencia).' };
    }

    const step = this.state.steps.find(s => s.stepId === stepId);
    if (!step) return { settled: false, code: 'STEP_NOT_FOUND', reason: 'Escalón no encontrado.' };
    if (['GANADO', 'PERDIDO', 'ANULADO'].includes(step.status)) {
      return { settled: false, code: 'ALREADY_SETTLED', reason: 'El escalón ya fue liquidado previamente.' };
    }

    const opp = this.state.opportunities.find(o => o.id === step.opportunityId);
    const session = this.state.activeSession;
    const normOut = String(outcome || '').toUpperCase();
    const finalOdds = Number(settledOdds ?? step.odds);

    const prevSessionState = session.ladderState;

    if (normOut === 'WON' || normOut === 'GANADO') {
      const newCapital = Math.round(step.startCapitalArs * finalOdds);
      step.status = 'GANADO';
      step.settledOdds = finalOdds;
      step.endCapitalArs = newCapital;
      step.settledAtUtc = ts;

      session.currentStep = step.stepNumber;
      session.availableCapitalArs = newCapital;
      session.committedCapitalArs = 0;
      session.activeStepId = null;
      session.activeOpportunityId = null;
      session.activeEventWindow = null;
      session.ladderState = 'DISPONIBLE';
      session.blockReason = null;
      session.progressPct = Number(((this.state.metrics.stepsWon + 1) / session.totalPlannedSteps * 100).toFixed(1));

      this.state.metrics.stepsWon += 1;
    } else if (normOut === 'LOST' || normOut === 'PERDIDO') {
      step.status = 'PERDIDO';
      step.settledOdds = finalOdds;
      step.endCapitalArs = 0;
      step.settledAtUtc = ts;

      session.availableCapitalArs = 0;
      session.committedCapitalArs = 0;
      session.activeStepId = null;
      session.activeOpportunityId = null;
      session.activeEventWindow = null;
      session.ladderState = 'DETENIDA';
      session.blockReason = `Escalón ${step.stepNumber} perdido. Progresión detenida.`;

      this.state.metrics.stepsLost += 1;
    } else if (normOut === 'VOID' || normOut === 'ANULADO') {
      step.status = 'ANULADO';
      step.settledOdds = 1.0;
      step.endCapitalArs = step.startCapitalArs;
      step.settledAtUtc = ts;

      session.availableCapitalArs = step.startCapitalArs;
      session.committedCapitalArs = 0;
      session.activeStepId = null;
      session.activeOpportunityId = null;
      session.activeEventWindow = null;
      session.ladderState = 'DISPONIBLE';
      session.blockReason = null;

      this.state.metrics.stepsVoid += 1;
    } else {
      return { settled: false, code: 'INVALID_OUTCOME', reason: `Resultado inválido: ${outcome}` };
    }

    if (opp) {
      opp.state = 'LIQUIDADA';
      opp.settledAtUtc = ts;
      const execMs = Date.parse(opp.executedAtUtc || '');
      const setMs = Date.parse(ts);
      if (Number.isFinite(execMs) && Number.isFinite(setMs) && setMs >= execMs) {
        const mins = (setMs - execMs) / 60000;
        this.state.metrics.totalResolutionMinutes += mins;
        const settledTotal = this.state.metrics.settled + 1;
        this.state.metrics.avgResolutionMinutes = Number((this.state.metrics.totalResolutionMinutes / settledTotal).toFixed(1));
      }
      this._recordTransition('OPPORTUNITY', opp.id, 'EJECUTADA', 'LIQUIDADA', `Liquidación confirmada: ${step.status}.`, 'SettlementRef', ts);
    }

    this.state.metrics.settled += 1;
    this.state.stateVersion += 1;
    if (idempotencyKey) this.state.processedIdempotencyKeys.push(idempotencyKey);

    this._recordTransition('SESSION', session.ladderId, prevSessionState, session.ladderState, `Liquidación ${step.status}. Capital disponible: ${session.availableCapitalArs} ARS.`, 'LadderEngine', ts);

    return {
      settled: true,
      stepStatus: step.status,
      availableCapitalArs: session.availableCapitalArs,
      ladderState: session.ladderState,
      stateVersion: this.state.stateVersion
    };
  }

  /**
   * Reevalúa una oportunidad EN ESPERA cuando se libera la escalera.
   * Comprueba disponibilidad del evento, cambio de cuota, prob/EV, Elena, Risk Manager y ventana horaria.
   */
  reevaluateWaitingOpportunity(opportunityId, freshSnapshot = {}, nowUtc = null) {
    const ts = nowUtc || new Date().toISOString();
    const opp = this.state.opportunities.find(o => o.id === opportunityId);
    if (!opp) return { reevaluated: false, code: 'OPPORTUNITY_NOT_FOUND' };
    if (opp.state !== 'EN_ESPERA') {
      return { reevaluated: false, code: 'NOT_WAITING', reason: `Estado actual: ${opp.state}` };
    }

    const prevOdds = opp.evaluatedOdds;
    if (freshSnapshot.currentOdds !== undefined) opp.currentOdds = Number(freshSnapshot.currentOdds);
    if (freshSnapshot.estimatedProb !== undefined) opp.estimatedProb = Number(freshSnapshot.estimatedProb);
    if (freshSnapshot.evPct !== undefined) opp.evPct = Number(freshSnapshot.evPct);
    if (freshSnapshot.eventStatus !== undefined) opp.eventStatus = freshSnapshot.eventStatus;
    if (freshSnapshot.elenaDecision !== undefined) opp.elenaDecision = String(freshSnapshot.elenaDecision).toUpperCase();
    if (freshSnapshot.riskManagerVeto !== undefined) opp.riskManagerVeto = Boolean(freshSnapshot.riskManagerVeto);
    if (freshSnapshot.riskManagerReason !== undefined) opp.riskManagerReason = freshSnapshot.riskManagerReason;

    // 1. Verificar si la cuota cambió fuera de tolerancia y no fue revalidada con prob/EV frescos
    const drift = prevOdds > 1 ? Math.abs(opp.currentOdds - prevOdds) / prevOdds : 0;
    const oddsDrifted = drift > (this.state.rules.maxOddsDriftPct || 0.05);

    const rmCheck = validateLadderOpportunity(this.state, opp, { isReevaluation: true });
    if (!rmCheck.allowed) {
      if (rmCheck.action === 'WAIT') {
        opp.blockCode = rmCheck.code;
        opp.blockReason = rmCheck.reason;
        return { reevaluated: true, state: 'EN_ESPERA', code: rmCheck.code, reason: rmCheck.reason };
      }
      opp.state = 'DESCARTADA';
      opp.blockCode = rmCheck.code;
      opp.blockReason = rmCheck.reason;
      this.state.metrics.discardedByConditionChange += 1;
      this._recomputeWaitingMetric();
      this._recordTransition('OPPORTUNITY', opp.id, 'EN_ESPERA', 'DESCARTADA', rmCheck.reason, 'LadderRiskGuard', ts);
      return { reevaluated: true, state: 'DESCARTADA', code: rmCheck.code, reason: rmCheck.reason };
    }

    if (oddsDrifted && freshSnapshot.revalidatedAfterOddsChange !== true) {
      opp.state = 'DESCARTADA';
      opp.blockCode = 'ODDS_CHANGED_UNREVALIDATED';
      opp.blockReason = `Cuota cambió de ${prevOdds.toFixed(2)} a ${opp.currentOdds.toFixed(2)} (${(drift * 100).toFixed(1)}%) sin revalidación estadística.`;
      this.state.metrics.discardedByConditionChange += 1;
      this._recomputeWaitingMetric();
      this._recordTransition('OPPORTUNITY', opp.id, 'EN_ESPERA', 'DESCARTADA', opp.blockReason, 'LadderRiskGuard', ts);
      return { reevaluated: true, state: 'DESCARTADA', code: opp.blockCode, reason: opp.blockReason };
    }

    if (opp.elenaDecision !== 'APROBADO') {
      opp.state = 'DESCARTADA';
      opp.blockCode = 'ELENA_REVOKED';
      opp.blockReason = 'Elena no revalidó la oportunidad tras el período de espera.';
      this.state.metrics.discardedByConditionChange += 1;
      this._recomputeWaitingMetric();
      this._recordTransition('OPPORTUNITY', opp.id, 'EN_ESPERA', 'DESCARTADA', opp.blockReason, 'Elena', ts);
      return { reevaluated: true, state: 'DESCARTADA', code: opp.blockCode, reason: opp.blockReason };
    }

    opp.evaluatedOdds = opp.currentOdds;
    opp.state = 'APROBADA';
    opp.blockCode = null;
    opp.blockReason = null;
    opp.evaluatedAtUtc = ts;
    this.state.metrics.approved += 1;
    this._recomputeWaitingMetric();
    this._recordTransition('OPPORTUNITY', opp.id, 'EN_ESPERA', 'APROBADA', 'Reevaluación superada (datos, cuota, ventana horaria, Elena y Risk Manager).', 'LadderEngine', ts);
    return { reevaluated: true, state: 'APROBADA', code: 'OK', opportunity: opp };
  }
}

module.exports = { LadderEngine };
