/**
 * FASE 9.1 — SETTLEMENT PROCESSOR HARDENED (EVENTOS APPEND-ONLY + AH DE CUARTOS)
 *
 * Estados soportados:
 *   PENDING | WON | LOST | HALF_WON | HALF_LOST | VOID | PUSH | UNAVAILABLE | SETTLEMENT_ERROR
 *
 * Reglas estrictas:
 *  - Liquida exclusivamente con resultados confirmados (resultConfirmed === true y matchStatus === 'FINISHED').
 *  - Nunca interpreta un partido suspendido/postergado/cancelado como LOST.
 *  - Idempotencia atómica inter-proceso (via store.appendSettlementEvent bajo O_EXCL lock).
 *  - Soporta Hándicap Asiático completo: enteros (±0, ±1, ±2), medios (±0.5, ±1.5) y cuartos (±0.25, ±0.75, ±1.25...):
 *      * HALF_WON:  profit = (odds - 1) / 2
 *      * HALF_LOST: profit = -0.5
 *    Líneas no múltiplo de 0.25 devuelven UNAVAILABLE (nunca asigna pérdida completa incorrectamente).
 *  - Nunca muta el archivo inmutable de observaciones; agrega eventos encadenados append-only.
 */

'use strict';

const SETTLEMENT_STATES = Object.freeze({
  PENDING: 'PENDING',
  WON: 'WON',
  LOST: 'LOST',
  HALF_WON: 'HALF_WON',
  HALF_LOST: 'HALF_LOST',
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
 * Resuelve una mitad de Hándicap Asiático (entero o medio).
 */
function resolveSingleAsianLeg(goalDiff, legLine) {
  const adjusted = goalDiff + legLine;
  if (Math.abs(adjusted) < 1e-9) return 'PUSH';
  return adjusted > 0 ? 'WON' : 'LOST';
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
      return { status: SETTLEMENT_STATES.UNAVAILABLE, actual1X2, reason: 'Línea de hándicap ausente o inválida.' };
    }
    // Verificar que sea múltiplo exacto de 0.25 (entero, medio o cuarto)
    const quarters = h * 4;
    if (Math.abs(quarters - Math.round(quarters)) > 1e-6) {
      return { status: SETTLEMENT_STATES.UNAVAILABLE, actual1X2, reason: `Línea AH no múltiplo de 0.25 (${h}): no liquidable.` };
    }

    const goalDiff = sel === 'AWAY' ? (ag - hg) : (hg - ag);
    const isQuarter = Math.abs(Math.round(quarters) % 2) === 1;

    if (!isQuarter) {
      const leg = resolveSingleAsianLeg(goalDiff, h);
      return { status: SETTLEMENT_STATES[leg], actual1X2 };
    }

    // División exacta de apuesta en las dos líneas adyacentes (h - 0.25) y (h + 0.25)
    const legLow = resolveSingleAsianLeg(goalDiff, h - 0.25);
    const legHigh = resolveSingleAsianLeg(goalDiff, h + 0.25);

    if (legLow === 'WON' && legHigh === 'WON') return { status: SETTLEMENT_STATES.WON, actual1X2 };
    if (legLow === 'LOST' && legHigh === 'LOST') return { status: SETTLEMENT_STATES.LOST, actual1X2 };
    if ((legLow === 'WON' && legHigh === 'PUSH') || (legLow === 'PUSH' && legHigh === 'WON')) {
      return { status: SETTLEMENT_STATES.HALF_WON, actual1X2 };
    }
    if ((legLow === 'LOST' && legHigh === 'PUSH') || (legLow === 'PUSH' && legHigh === 'LOST')) {
      return { status: SETTLEMENT_STATES.HALF_LOST, actual1X2 };
    }
    return { status: SETTLEMENT_STATES.PUSH, actual1X2 };
  }

  return { status: SETTLEMENT_STATES.UNAVAILABLE, actual1X2, reason: `Familia sin regla de liquidación: ${marketFamily}` };
}

function computeFlatStakeProfit(status, odds) {
  const o = Number(odds);
  if (status === SETTLEMENT_STATES.WON) return round(o - 1, 4);
  if (status === SETTLEMENT_STATES.HALF_WON) return round((o - 1) / 2, 4);
  if (status === SETTLEMENT_STATES.HALF_LOST) return -0.5;
  if (status === SETTLEMENT_STATES.LOST) return -1;
  if (status === SETTLEMENT_STATES.VOID || status === SETTLEMENT_STATES.PUSH) return 0;
  return null;
}

class SettlementProcessor {
  constructor(observationStore) {
    this.store = observationStore;
  }

  /**
   * Liquida una observación de forma idempotente (append-only en el log de liquidaciones).
   */
  settleObservation(observationId, resultPayload) {
    const list = this.store.getObservations();
    const obs = list.find(o => o.observationId === observationId);
    if (!obs) return { settled: false, reason: 'OBSERVATION_NOT_FOUND' };

    if (obs.status !== SETTLEMENT_STATES.PENDING && obs.status !== SETTLEMENT_STATES.UNAVAILABLE) {
      return { settled: false, idempotent: true, reason: 'ALREADY_SETTLED', status: obs.status };
    }

    const matchStatus = String(resultPayload.matchStatus || '').toUpperCase();
    const confirmed = resultPayload.resultConfirmed === true;

    // Partido suspendido/postergado/cancelado NUNCA se liquida como LOST
    if (['SUSPENDED', 'POSTPONED', 'ABANDONED', 'CANCELLED'].includes(matchStatus)) {
      if (resultPayload.officiallyVoided === true) {
        const app = this.store.appendSettlementEvent({
          eventType: 'SETTLEMENT',
          observationId,
          status: SETTLEMENT_STATES.VOID,
          homeGoals: null,
          awayGoals: null,
          actual1X2: null,
          profitUnits: 0,
          resultSource: resultPayload.resultSource || 'official_void',
          settledAtUtc: resultPayload.settledAtUtc || new Date().toISOString()
        });
        if (!app.appended && app.idempotent) return { settled: false, idempotent: true, reason: 'ALREADY_SETTLED', status: app.status };
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

    // Solo liquidar con resultados confirmados
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

    const app = this.store.appendSettlementEvent({
      eventType: 'SETTLEMENT',
      observationId,
      status: resolved.status,
      homeGoals: Number.isFinite(Number(resultPayload.homeGoals)) ? Number(resultPayload.homeGoals) : null,
      awayGoals: Number.isFinite(Number(resultPayload.awayGoals)) ? Number(resultPayload.awayGoals) : null,
      actual1X2: resolved.actual1X2,
      profitUnits,
      resultSource: resultPayload.resultSource || 'statshub_match_details',
      settledAtUtc: resultPayload.settledAtUtc || new Date().toISOString()
    });

    if (!app.appended && app.idempotent) {
      return { settled: false, idempotent: true, reason: 'ALREADY_SETTLED', status: app.status };
    }

    return {
      settled: true,
      status: resolved.status,
      actual1X2: resolved.actual1X2,
      profitUnits
    };
  }

  /**
   * Registra una corrección posterior auditada como evento append-only sin sobrescribir la liquidación original.
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

    const app = this.store.appendSettlementEvent({
      eventType: 'CORRECTION',
      observationId,
      reason,
      previous,
      status: resolved.status,
      homeGoals: Number(newHomeGoals),
      awayGoals: Number(newAwayGoals),
      actual1X2: resolved.actual1X2,
      profitUnits: newProfit,
      resultSource: source,
      correctedAtUtc: new Date().toISOString()
    });

    if (!app.appended) return { corrected: false, reason: app.reason };

    const updated = this.store.getObservations().find(o => o.observationId === observationId);
    return {
      corrected: true,
      status: resolved.status,
      profitUnits: newProfit,
      correctionsCount: updated.settlement.corrections.length
    };
  }
}

module.exports = {
  SETTLEMENT_STATES,
  resolveSelectionStatus,
  computeFlatStakeProfit,
  SettlementProcessor
};
