/**
 * FASE 9 — SETTLEMENT PROCESSOR INDEPENDIENTE
 *
 * Estados soportados:
 *   PENDING | WON | LOST | VOID | PUSH | UNAVAILABLE | SETTLEMENT_ERROR
 *
 * Reglas estrictas:
 *  - Liquida exclusivamente con resultados confirmados (resultConfirmed === true y matchStatus === 'FINISHED').
 *  - Nunca interpreta un partido suspendido/postergado como LOST.
 *  - Idempotencia estricta: no liquida dos veces la misma observación.
 *  - Soporta PUSH (líneas enteras / AH entero) y VOID (stake devuelto, profit 0).
 *  - Mantiene trazabilidad completa de cualquier corrección posterior en settlement.corrections[].
 */

'use strict';

const SETTLEMENT_STATES = Object.freeze({
  PENDING: 'PENDING',
  WON: 'WON',
  LOST: 'LOST',
  VOID: 'VOID',
  PUSH: 'PUSH',
  UNAVAILABLE: 'UNAVAILABLE',
  SETTLEMENT_ERROR: 'SETTLEMENT_ERROR'
});

function round(v, d = 4) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/**
 * Resuelve el resultado de una selección respetando las reglas específicas de cada familia de mercado.
 */
function resolveSelectionStatus({ marketFamily, selection, line = null, homeGoals, awayGoals }) {
  const hg = Number(homeGoals);
  const ag = Number(awayGoals);
  if (!Number.isFinite(hg) || !Number.isFinite(ag) || hg < 0 || ag < 0) {
    return { status: SETTLEMENT_STATES.UNAVAILABLE, actual1X2: null, reason: 'Marcador ausente o inválido.' };
  }

  const actual1X2 = hg > ag ? '1' : (hg === ag ? 'X' : '2');
  const sel = String(selection || '').toUpperCase().trim();

  if (marketFamily === 'match_1x2') {
    if (!['1', 'X', '2'].includes(sel)) {
      return { status: SETTLEMENT_STATES.SETTLEMENT_ERROR, actual1X2, reason: `Selección 1X2 inválida: ${sel}` };
    }
    return { status: sel === actual1X2 ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
  }

  if (marketFamily === 'double_chance') {
    const winMap = {
      '1X': actual1X2 === '1' || actual1X2 === 'X',
      'X2': actual1X2 === 'X' || actual1X2 === '2',
      '12': actual1X2 === '1' || actual1X2 === '2'
    };
    if (!(sel in winMap)) {
      return { status: SETTLEMENT_STATES.SETTLEMENT_ERROR, actual1X2, reason: `Selección DC inválida: ${sel}` };
    }
    return { status: winMap[sel] ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
  }

  if (marketFamily === 'btts') {
    const bothScored = hg > 0 && ag > 0;
    if (sel === 'YES' || sel === 'SI' || sel === 'SÍ') {
      return { status: bothScored ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
    }
    if (sel === 'NO') {
      return { status: !bothScored ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
    }
    return { status: SETTLEMENT_STATES.SETTLEMENT_ERROR, actual1X2, reason: `Selección BTTS inválida: ${sel}` };
  }

  if (marketFamily === 'match_goals') {
    const total = hg + ag;
    const numLine = Number(line);
    if (!Number.isFinite(numLine)) {
      return { status: SETTLEMENT_STATES.SETTLEMENT_ERROR, actual1X2, reason: 'Línea numérica ausente en match_goals.' };
    }
    if (Math.abs(total - numLine) < 1e-9) {
      return { status: SETTLEMENT_STATES.PUSH, actual1X2 };
    }
    if (sel.startsWith('OVER')) {
      return { status: total > numLine ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
    }
    if (sel.startsWith('UNDER')) {
      return { status: total < numLine ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
    }
    return { status: SETTLEMENT_STATES.SETTLEMENT_ERROR, actual1X2, reason: `Selección match_goals inválida: ${sel}` };
  }

  if (marketFamily === 'asian_handicap') {
    const h = Number(line);
    if (!Number.isFinite(h)) {
      return { status: SETTLEMENT_STATES.SETTLEMENT_ERROR, actual1X2, reason: 'Línea de hándicap ausente.' };
    }
    const diff = sel === 'AWAY' ? (ag - hg) + h : (hg - ag) + h;
    if (Math.abs(diff) < 1e-9) return { status: SETTLEMENT_STATES.PUSH, actual1X2 };
    return { status: diff > 0 ? SETTLEMENT_STATES.WON : SETTLEMENT_STATES.LOST, actual1X2 };
  }

  return { status: SETTLEMENT_STATES.UNAVAILABLE, actual1X2, reason: `Familia sin regla de liquidación: ${marketFamily}` };
}

function computeFlatStakeProfit(status, odds) {
  if (status === SETTLEMENT_STATES.WON) return round(Number(odds) - 1, 4);
  if (status === SETTLEMENT_STATES.LOST) return -1;
  if (status === SETTLEMENT_STATES.VOID || status === SETTLEMENT_STATES.PUSH) return 0;
  return null;
}

class SettlementProcessor {
  constructor(observationStore) {
    this.store = observationStore;
  }

  /**
   * Liquida una observación de forma idempotente y segura.
   */
  settleObservation(observationId, resultPayload) {
    const list = this.store.getObservations();
    const obs = list.find(o => o.observationId === observationId);
    if (!obs) return { settled: false, reason: 'OBSERVATION_NOT_FOUND' };

    // Idempotencia estricta
    if (obs.status !== SETTLEMENT_STATES.PENDING && obs.status !== SETTLEMENT_STATES.UNAVAILABLE) {
      return { settled: false, idempotent: true, reason: 'ALREADY_SETTLED', status: obs.status };
    }

    const matchStatus = String(resultPayload.matchStatus || '').toUpperCase();
    const confirmed = resultPayload.resultConfirmed === true;

    // Regla crítica: partido suspendido/postergado NUNCA se interpreta como LOST
    if (['SUSPENDED', 'POSTPONED', 'ABANDONED', 'CANCELLED'].includes(matchStatus)) {
      if (resultPayload.officiallyVoided === true) {
        obs.status = SETTLEMENT_STATES.VOID;
        obs.settlement = {
          ...obs.settlement,
          status: SETTLEMENT_STATES.VOID,
          homeGoals: null,
          awayGoals: null,
          actual1X2: null,
          profitUnits: 0,
          resultSource: resultPayload.resultSource || 'official_void',
          settledAtUtc: resultPayload.settledAtUtc || new Date().toISOString()
        };
        this.store._writeJsonArray(this.store.obsPath, list);
        return { settled: true, status: SETTLEMENT_STATES.VOID, profitUnits: 0 };
      }
      this.store.logQualityAlert({
        code: 'UNCONFIRMED_OR_SUSPENDED_SETTLEMENT',
        severity: 'WARNING',
        matchId: obs.matchId,
        observationId,
        message: `Partido en estado ${matchStatus}: no se liquida como LOST, permanece PENDING.`
      });
      return { settled: false, status: SETTLEMENT_STATES.PENDING, reason: `MATCH_${matchStatus}_NOT_LOST` };
    }

    // Regla crítica: solo liquidar con resultados confirmados
    if (!confirmed || matchStatus !== 'FINISHED') {
      this.store.logQualityAlert({
        code: 'UNCONFIRMED_RESULT_BLOCKED',
        severity: 'WARNING',
        matchId: obs.matchId,
        observationId,
        message: `Liquidación rechazada: resultado no confirmado (status=${matchStatus}, confirmed=${confirmed}).`
      });
      return { settled: false, status: SETTLEMENT_STATES.PENDING, reason: 'RESULT_NOT_CONFIRMED' };
    }

    const resolved = resolveSelectionStatus({
      marketFamily: obs.marketFamily,
      selection: obs.selection,
      line: obs.line,
      homeGoals: resultPayload.homeGoals,
      awayGoals: resultPayload.awayGoals
    });

    const profitUnits = computeFlatStakeProfit(resolved.status, obs.odds);

    obs.status = resolved.status;
    obs.settlement = {
      ...obs.settlement,
      status: resolved.status,
      homeGoals: Number.isFinite(Number(resultPayload.homeGoals)) ? Number(resultPayload.homeGoals) : null,
      awayGoals: Number.isFinite(Number(resultPayload.awayGoals)) ? Number(resultPayload.awayGoals) : null,
      actual1X2: resolved.actual1X2,
      profitUnits,
      resultSource: resultPayload.resultSource || 'statshub_match_details',
      settledAtUtc: resultPayload.settledAtUtc || new Date().toISOString()
    };

    this.store._writeJsonArray(this.store.obsPath, list);
    return {
      settled: true,
      status: resolved.status,
      actual1X2: resolved.actual1X2,
      profitUnits
    };
  }

  /**
   * Registra una corrección posterior auditada sin borrar el historial original de liquidación.
   */
  recordSettlementCorrection(observationId, { newHomeGoals, newAwayGoals, reason, source = 'official_correction' }) {
    const list = this.store.getObservations();
    const obs = list.find(o => o.observationId === observationId);
    if (!obs) return { corrected: false, reason: 'OBSERVATION_NOT_FOUND' };

    const previous = {
      status: obs.settlement.status,
      homeGoals: obs.settlement.homeGoals,
      awayGoals: obs.settlement.awayGoals,
      profitUnits: obs.settlement.profitUnits,
      settledAtUtc: obs.settlement.settledAtUtc
    };

    const resolved = resolveSelectionStatus({
      marketFamily: obs.marketFamily,
      selection: obs.selection,
      line: obs.line,
      homeGoals: newHomeGoals,
      awayGoals: newAwayGoals
    });
    const newProfit = computeFlatStakeProfit(resolved.status, obs.odds);

    obs.settlement.corrections = Array.isArray(obs.settlement.corrections) ? obs.settlement.corrections : [];
    obs.settlement.corrections.push({
      correctedAtUtc: new Date().toISOString(),
      reason,
      source,
      previous,
      updated: { status: resolved.status, homeGoals: newHomeGoals, awayGoals: newAwayGoals, profitUnits: newProfit }
    });

    obs.status = resolved.status;
    obs.settlement.status = resolved.status;
    obs.settlement.homeGoals = Number(newHomeGoals);
    obs.settlement.awayGoals = Number(newAwayGoals);
    obs.settlement.actual1X2 = resolved.actual1X2;
    obs.settlement.profitUnits = newProfit;

    this.store._writeJsonArray(this.store.obsPath, list);
    return { corrected: true, status: resolved.status, profitUnits: newProfit, correctionsCount: obs.settlement.corrections.length };
  }
}

module.exports = {
  SETTLEMENT_STATES,
  resolveSelectionStatus,
  computeFlatStakeProfit,
  SettlementProcessor
};
