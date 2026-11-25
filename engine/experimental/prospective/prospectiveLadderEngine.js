/**
 * DARADORBET — FASE 11: MOTOR PROSPECTIVO DE RETO ESCALERA (SIMULACIÓN — DINERO VIRTUAL)
 *
 * Parámetros:
 * - Capital virtual inicial: $50.000 ARS
 * - Objetivo: $10.000.000 ARS
 * - Reinversión teórica: 100%
 * - Cuota de referencia: 1.20
 * - Modalidad: SIMULACIÓN — DINERO VIRTUAL (realCapitalAllowed: false, autoExecutionAllowed: false)
 *
 * Reglas estrictas:
 * - Una sola apuesta abierta a la vez (bloquea segunda apuesta hasta liquidar la anterior).
 * - Requiere aprobación de Elena y ausencia de veto de Risk Manager.
 * - Mercados iniciales permitidos: "Remates totales" (con alineación T-60 CONFIRMADA) y "Córners de equipo".
 * - Excluye explícitamente: "Remates al arco de equipo", "Goles de equipo", "Remates de equipo".
 * - Registra TODAS las oportunidades evaluadas, incluyendo las descartadas con su motivo explícito.
 * - Separación absoluta respecto del replay histórico (+205.480,31 ARS jamás se suma al balance prospectivo).
 */

const fs = require('fs');
const path = require('path');

const SD = path.join(__dirname, '..', '..', 'storage_data');
const DEFAULT_LADDER_STATE_PATH = path.join(SD, 'fase11_prospective_ladder.json');

const ALLOWED_LADDER_MARKETS = new Set(['Remates totales', 'Córners de equipo']);
const EXCLUDED_LADDER_MARKETS = new Set(['Remates al arco de equipo', 'Goles de equipo', 'Remates de equipo']);

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

class ProspectiveLadderEngine {
  constructor(options = {}) {
    this.statePath = options.statePath || DEFAULT_LADDER_STATE_PATH;
    this.initialCapital = options.initialCapital ?? 50000;
    this.targetCapital = options.targetCapital ?? 10000000;
    this.referenceOdds = options.referenceOdds ?? 1.20;
  }

  _loadState() {
    if (!fs.existsSync(this.statePath)) {
      return {
        schemaVersion: '1.0.0',
        mode: 'SIMULACIÓN — DINERO VIRTUAL',
        simulationOnly: true,
        realCapitalAllowed: false,
        autoExecutionAllowed: false,
        initialCapital: this.initialCapital,
        currentCapital: this.initialCapital,
        targetCapital: this.targetCapital,
        reinvestmentPct: 100,
        referenceOdds: this.referenceOdds,
        currentStep: 1,
        currentCycle: 1,
        openBet: null,
        committedStake: 0,
        cumulativeProfit: 0,
        lastSettlement: null,
        stepHistory: [],
        evaluatedOpportunities: []
      };
    }
    return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
  }

  getState() {
    const s = this._loadState();
    const progressPct = Number(Math.min(100, (s.currentCapital / s.targetCapital) * 100).toFixed(4));
    return { ...s, progressPct };
  }

  /**
   * Evalúa si un snapshot prospectivo puede ingresar a RETO ESCALERA.
   * Si cumple todas las reglas y no hay apuesta abierta, abre la apuesta virtual.
   * Si no cumple, registra el motivo explícito en evaluatedOpportunities.
   */
  considerOpportunity(snapshot) {
    const state = this._loadState();
    const nowIso = new Date().toISOString();
    const reasons = [];

    if (snapshot.circuit === 'CONTRAFACTUAL') {
      reasons.push('CIRCUIT_BLOCKED: Oportunidad contrafactual no elegible para RETO ESCALERA prospectivo.');
    }
    if (String(snapshot.elenaDecision || '').toUpperCase() !== 'APROBADO') {
      reasons.push(`ELENA_NOT_APPROVED: Decisión de Elena = ${snapshot.elenaDecision || 'PENDIENTE'}.`);
    }
    if (String(snapshot.riskManagerDecision || '').toUpperCase() === 'RECHAZADO' || String(snapshot.riskManagerDecision || '').toUpperCase() === 'VETADO') {
      reasons.push(`RISK_MANAGER_VETO: Risk Manager = ${snapshot.riskManagerDecision}.`);
    }
    if (EXCLUDED_LADDER_MARKETS.has(snapshot.market)) {
      reasons.push(`MARKET_EXCLUDED_LADDER: Mercado "${snapshot.market}" excluido de RETO ESCALERA.`);
    } else if (!ALLOWED_LADDER_MARKETS.has(snapshot.market)) {
      reasons.push(`MARKET_NOT_PRIORITY_LADDER: Mercado "${snapshot.market}" fuera de mercados iniciales de RETO ESCALERA.`);
    }
    if (snapshot.market === 'Remates totales' && String(snapshot.lineupStatus || '').toUpperCase() !== 'CONFIRMADA') {
      reasons.push(`T60_LINEUP_REQUIRED: Remates totales requiere alineación T-60 CONFIRMADA (actual: ${snapshot.lineupStatus || 'PENDIENTE_T60'}).`);
    }
    if (state.openBet !== null) {
      reasons.push(`OPEN_BET_LOCKED: Ya existe una apuesta abierta (${state.openBet.betId}). Solo se permite 1 apuesta activa a la vez.`);
    }
    if (!Number.isFinite(Number(snapshot.odds)) || Number(snapshot.odds) < 1.05) {
      reasons.push('INVALID_ODDS: Cuota no válida para simulación.');
    }

    if (reasons.length > 0) {
      const entry = {
        evaluatedAtUtc: nowIso,
        snapshotId: snapshot.snapshotId,
        opportunityKey: snapshot.opportunityKey,
        match: snapshot.match,
        market: snapshot.market,
        selection: snapshot.selection,
        odds: snapshot.odds,
        enteredLadder: false,
        reasons
      };
      state.evaluatedOpportunities.push(entry);
      atomicWriteJson(this.statePath, state);
      return { entered: false, reasons, entry };
    }

    // Ingreso aprobado a RETO ESCALERA (100% reinversión virtual)
    const stake = Number(state.currentCapital.toFixed(2));
    const potentialReturn = Number((stake * Number(snapshot.odds)).toFixed(2));
    const bet = {
      betId: `ladder_bet_${Date.now()}_${state.stepHistory.length + 1}`,
      cycle: state.currentCycle,
      step: state.currentStep,
      snapshotId: snapshot.snapshotId,
      opportunityKey: snapshot.opportunityKey,
      match: snapshot.match,
      competition: snapshot.competition,
      market: snapshot.market,
      selection: snapshot.selection,
      line: snapshot.line,
      odds: Number(snapshot.odds),
      stake,
      potentialReturn,
      openedAtUtc: nowIso,
      status: 'OPEN'
    };

    state.openBet = bet;
    state.committedStake = stake;
    state.evaluatedOpportunities.push({
      evaluatedAtUtc: nowIso,
      snapshotId: snapshot.snapshotId,
      opportunityKey: snapshot.opportunityKey,
      match: snapshot.match,
      market: snapshot.market,
      selection: snapshot.selection,
      odds: snapshot.odds,
      enteredLadder: true,
      betId: bet.betId,
      reasons: ['ENTERED_LADDER_SIMULATION']
    });

    atomicWriteJson(this.statePath, state);
    return { entered: true, bet };
  }

  /**
   * Liquida la apuesta virtual abierta de forma idempotente.
   * No libera capital si confirmed !== true o si el estado es PENDING.
   */
  settleOpenBet(betId, settlementInput) {
    const state = this._loadState();
    const existing = state.stepHistory.find(h => h.betId === betId);
    if (existing) {
      return { settled: true, duplicate: true, record: existing, state: this.getState() };
    }
    if (!state.openBet || state.openBet.betId !== betId) {
      throw new Error(`OPEN_BET_NOT_FOUND: No hay apuesta abierta con ID ${betId}`);
    }

    const outcome = String(settlementInput.outcome || '').toUpperCase();
    if (settlementInput.confirmed !== true || outcome === 'PENDING') {
      return { settled: false, reason: 'UNCONFIRMED_RESULT: Capital bloqueado hasta confirmación oficial.' };
    }

    const bet = state.openBet;
    const capBefore = bet.stake;
    let capAfter = capBefore;
    let profitDelta = 0;

    if (outcome === 'WON') {
      capAfter = Number((capBefore * bet.odds).toFixed(2));
      profitDelta = Number((capAfter - capBefore).toFixed(2));
      state.currentCapital = capAfter;
      state.currentStep += 1;
    } else if (outcome === 'HALF_WON') {
      capAfter = Number((capBefore * (1 + (bet.odds - 1) / 2)).toFixed(2));
      profitDelta = Number((capAfter - capBefore).toFixed(2));
      state.currentCapital = capAfter;
      state.currentStep += 1;
    } else if (outcome === 'VOID') {
      capAfter = capBefore;
      profitDelta = 0;
      state.currentCapital = capBefore;
    } else if (outcome === 'HALF_LOST') {
      capAfter = Number((capBefore / 2).toFixed(2));
      profitDelta = Number((capAfter - capBefore).toFixed(2));
      state.currentCapital = capAfter;
    } else if (outcome === 'LOST') {
      capAfter = 0;
      profitDelta = -capBefore;
      state.currentCycle += 1;
      state.currentStep = 1;
      state.currentCapital = state.initialCapital;
    } else {
      return { settled: false, reason: `UNSUPPORTED_OUTCOME: ${outcome}` };
    }

    const settledRecord = {
      ...bet,
      status: outcome,
      capBefore,
      capAfter,
      profitDelta,
      settledAtUtc: settlementInput.settledAtUtc || new Date().toISOString(),
      source: settlementInput.source || 'StatsHub Oficial'
    };

    state.openBet = null;
    state.committedStake = 0;
    state.cumulativeProfit = Number((state.cumulativeProfit + profitDelta).toFixed(2));
    state.lastSettlement = settledRecord;
    state.stepHistory.push(settledRecord);

    atomicWriteJson(this.statePath, state);
    return { settled: true, duplicate: false, record: settledRecord, state: this.getState() };
  }
}

module.exports = {
  ProspectiveLadderEngine,
  ALLOWED_LADDER_MARKETS,
  EXCLUDED_LADDER_MARKETS,
  DEFAULT_LADDER_STATE_PATH
};
