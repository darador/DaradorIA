/**
 * DARADORBET — MOTOR OFICIAL DE RETO ESCALERA (SIMULACIÓN — DINERO VIRTUAL)
 *
 * Parámetros oficiales:
 * - Capital inicial: $50.000 ARS
 * - Objetivo: $10.000.000 ARS
 * - Reinversión: 100%
 * - Rango de cuotas inclusivo: [1.10, 1.25] (objetivo: 1.20)
 * - EV mínimo: +7.0%
 * - Una apuesta abierta a la vez; sin obligación diaria.
 * - Al alcanzar o superar $10.000.000 -> OBJECTIVE_REACHED (bloquea nuevas apuestas, sin reinicio automático).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SD = path.join(ROOT, 'engine', 'storage_data');
const DEFAULT_LADDER_STATE_PATH = path.join(SD, 'fase11_prospective_ladder.json');
const CALIBRATION_REPORT_PATH = path.join(ROOT, 'api', 'calibration_audit_report.json');

const OFFICIAL_PARAMS = {
  initialCapital: 50000,
  targetCapital: 10000000,
  reinvestmentPct: 100,
  minOdds: 1.10,
  targetOdds: 1.20,
  maxOdds: 1.25,
  minEvPct: 7.0
};

const ALLOWED_LADDER_MARKETS = new Set([
  'Remates totales',
  'Córners de equipo',
  'Ganador del partido (1X2)',
  'Doble oportunidad',
  'Entradas (Tackles)',
  'Faltas cometidas',
  'Faltas ganadas'
]);

const PLAYER_T60_MARKETS = new Set([
  'Remates totales',
  'Entradas (Tackles)',
  'Faltas cometidas',
  'Faltas ganadas'
]);

const EXCLUDED_LADDER_MARKETS = new Set([
  'Remates al arco de equipo',
  'Goles de equipo',
  'Remates de equipo'
]);

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadCalibrationMetrics() {
  try {
    return JSON.parse(fs.readFileSync(CALIBRATION_REPORT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

class ProspectiveLadderEngine {
  constructor(options = {}) {
    this.statePath = options.statePath || DEFAULT_LADDER_STATE_PATH;
    this.initialCapital = options.initialCapital ?? OFFICIAL_PARAMS.initialCapital;
    this.targetCapital = options.targetCapital ?? OFFICIAL_PARAMS.targetCapital;
    this.minOdds = options.minOdds ?? OFFICIAL_PARAMS.minOdds;
    this.targetOdds = options.targetOdds ?? OFFICIAL_PARAMS.targetOdds;
    this.maxOdds = options.maxOdds ?? OFFICIAL_PARAMS.maxOdds;
    this.minEvPct = options.minEvPct ?? OFFICIAL_PARAMS.minEvPct;
  }

  _loadState() {
    if (!fs.existsSync(this.statePath)) {
      return {
        schemaVersion: '2.0.0',
        mode: 'SIMULACIÓN — DINERO VIRTUAL',
        simulationOnly: true,
        realCapitalAllowed: false,
        autoExecutionAllowed: false,
        objectiveStatus: 'IN_PROGRESS', // IN_PROGRESS | OBJECTIVE_REACHED
        initialCapital: this.initialCapital,
        currentCapital: this.initialCapital,
        targetCapital: this.targetCapital,
        reinvestmentPct: 100,
        minOdds: this.minOdds,
        referenceOdds: this.targetOdds,
        maxOdds: this.maxOdds,
        minEvPct: this.minEvPct,
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
    const st = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    if (!st.objectiveStatus) {
      st.objectiveStatus = st.currentCapital >= (st.targetCapital || this.targetCapital) ? 'OBJECTIVE_REACHED' : 'IN_PROGRESS';
    }
    return st;
  }

  getState() {
    const s = this._loadState();
    const progressPct = Number(Math.min(100, (s.currentCapital / s.targetCapital) * 100).toFixed(4));
    return { ...s, progressPct };
  }

  /**
   * Obtiene el factor de confiabilidad de calibración del mercado desde api/calibration_audit_report.json.
   * No inventa un margen universal; reutiliza ECE y Brier/LogLoss reales disponibles.
   */
  _getMarketCalibrationFactor(market) {
    const cal = loadCalibrationMetrics();
    const mStats = cal?.byMarket?.[market];
    if (!mStats || !mStats.n) {
      return { reliabilityWeight: 0.75, requiredProbMargin: 0.03, hasCalibrationEvidence: false };
    }
    const ece = typeof mStats.ece === 'number' ? mStats.ece : 0.15;
    const reliabilityWeight = Number(Math.max(0.4, 1 - ece).toFixed(3));
    const requiredProbMargin = Number(Math.max(0.02, Math.min(0.06, ece * 0.3)).toFixed(4));
    return { reliabilityWeight, requiredProbMargin, hasCalibrationEvidence: true, ece };
  }

  /**
   * Valida las 7 reglas oficiales de elegibilidad antes de abrir una apuesta.
   */
  validateOpportunity(snapshot, state = null) {
    const st = state || this._loadState();
    const reasons = [];

    if (st.objectiveStatus === 'OBJECTIVE_REACHED' || st.currentCapital >= st.targetCapital) {
      reasons.push('OBJECTIVE_REACHED_LOCKED: Objetivo de $10.000.000 ARS alcanzado. Nuevas apuestas bloqueadas automáticamente.');
    }
    const hasActiveOpenBet = Boolean(st.openBet && st.openBet.legacyStatus !== 'LEGACY_OUT_OF_RULES');
    if (hasActiveOpenBet) {
      reasons.push(`OPEN_BET_LOCKED: Ya existe una apuesta abierta (${st.openBet.betId}). Solo 1 apuesta abierta a la vez.`);
    }
    if (snapshot.circuit === 'CONTRAFACTUAL') {
      reasons.push('CIRCUIT_BLOCKED: Oportunidad contrafactual no elegible para RETO ESCALERA.');
    }
    if (String(snapshot.elenaDecision || '').toUpperCase() !== 'APROBADO') {
      reasons.push(`ELENA_NOT_APPROVED: Decisión de Elena = ${snapshot.elenaDecision || 'PENDIENTE'}.`);
    }
    if (['RECHAZADO', 'VETADO'].includes(String(snapshot.riskManagerDecision || '').toUpperCase())) {
      reasons.push(`RISK_MANAGER_VETO: Risk Manager = ${snapshot.riskManagerDecision}.`);
    }
    if (EXCLUDED_LADDER_MARKETS.has(snapshot.market)) {
      reasons.push(`MARKET_EXCLUDED_LADDER: Mercado "${snapshot.market}" excluido de RETO ESCALERA.`);
    } else if (!ALLOWED_LADDER_MARKETS.has(snapshot.market)) {
      reasons.push(`MARKET_NOT_ALLOWED_LADDER: Mercado "${snapshot.market}" fuera de mercados habilitados.`);
    }
    if (PLAYER_T60_MARKETS.has(snapshot.market) && String(snapshot.lineupStatus || '').toUpperCase() !== 'CONFIRMADA') {
      reasons.push(`T60_LINEUP_REQUIRED: "${snapshot.market}" requiere alineación T-60 CONFIRMADA (actual: ${snapshot.lineupStatus || 'PENDIENTE_T60'}).`);
    }

    const odds = Number(snapshot.odds);
    if (!Number.isFinite(odds) || odds < this.minOdds || odds > this.maxOdds) {
      reasons.push(`ODDS_OUT_OF_RANGE: Cuota ${odds || 'N/D'} fuera del rango oficial [${this.minOdds.toFixed(2)}, ${this.maxOdds.toFixed(2)}].`);
    }

    const prob = snapshot.modelProbability != null ? Number(snapshot.modelProbability) : null;
    const evPct = snapshot.expectedValuePct != null
      ? Number(snapshot.expectedValuePct)
      : (Number.isFinite(odds) && prob ? Number(((prob * odds - 1) * 100).toFixed(2)) : null);

    if (prob === null || !Number.isFinite(prob) || prob <= 0 || prob >= 1) {
      reasons.push('INSUFFICIENT_DATA: Falta probabilidad estimada verificable.');
    }
    if (evPct === null || evPct < this.minEvPct) {
      reasons.push(`EV_BELOW_THRESHOLD: EV (${evPct !== null ? evPct + '%' : 'N/D'}) inferior al mínimo oficial (+${this.minEvPct}%).`);
    }

    const calInfo = this._getMarketCalibrationFactor(snapshot.market);
    if (Number.isFinite(odds) && odds > 1 && prob !== null) {
      const breakEven = 1 / odds;
      if (prob < breakEven + calInfo.requiredProbMargin) {
        reasons.push(`INSUFFICIENT_PROB_MARGIN: Prob. ${(prob * 100).toFixed(1)}% sin margen suficiente sobre equilibrio ${(breakEven * 100).toFixed(1)}% (+${(calInfo.requiredProbMargin * 100).toFixed(1)}% por calibración).`);
      }
    }

    const compositeScore = (evPct !== null && prob !== null)
      ? Number((evPct * calInfo.reliabilityWeight * prob).toFixed(4))
      : -Infinity;

    return { valid: reasons.length === 0, reasons, evPct, prob, odds, calInfo, compositeScore };
  }

  /**
   * Devuelve únicamente las oportunidades elegibles que cumplen TODAS las reglas oficiales
   * de RETO ESCALERA, ordenadas por el ranking calibrado (EV * confiabilidad * prob).
   * Nunca incluye descartadas ni legacyBets.
   */
  getEligibleRankedOpportunities(snapshots) {
    const state = this._loadState();
    const eligible = [];
    for (const snap of (snapshots || [])) {
      const check = this.validateOpportunity(snap, state);
      if (check.valid) {
        eligible.push({
          snapshotId: snap.snapshotId,
          opportunityKey: snap.opportunityKey,
          match: snap.match,
          competition: snap.competition,
          kickoffUtc: snap.kickoffUtc || null,
          market: snap.market,
          selection: snap.selection,
          line: snap.line,
          odds: check.odds,
          modelProbability: check.prob,
          expectedValuePct: check.evPct,
          elenaDecision: snap.elenaDecision,
          riskManagerDecision: snap.riskManagerDecision,
          compositeScore: check.compositeScore
        });
      }
    }
    eligible.sort((a, b) => b.compositeScore - a.compositeScore);
    return eligible.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      isTopRecommended: idx === 0
    }));
  }

  /**
   * Devuelve candidatos prometedores que cumplen cuotas [1.10 - 1.25] y EV >= +7.0%
   * pero están pausados a la espera de confirmación oficial de alineación (T-60).
   */
  getPendingLineupOpportunities(snapshots) {
    const pending = [];
    for (const snap of (snapshots || [])) {
      if (snap.circuit === 'CONTRAFACTUAL') continue;
      const odds = Number(snap.odds);
      if (!Number.isFinite(odds) || odds < this.minOdds || odds > this.maxOdds) continue;
      const prob = snap.modelProbability != null ? Number(snap.modelProbability) : null;
      const evPct = snap.expectedValuePct != null
        ? Number(snap.expectedValuePct)
        : (Number.isFinite(odds) && prob ? Number(((prob * odds - 1) * 100).toFixed(2)) : null);
      if (evPct === null || evPct < this.minEvPct) continue;

      const isPlayerMarket = PLAYER_T60_MARKETS.has(snap.market);
      const isPendingLineup = isPlayerMarket && String(snap.lineupStatus || '').toUpperCase() !== 'CONFIRMADA';

      if (isPendingLineup) {
        const calInfo = this._getMarketCalibrationFactor(snap.market);
        const compositeScore = (evPct !== null && prob !== null)
          ? Number((evPct * calInfo.reliabilityWeight * prob).toFixed(4))
          : 0;
        pending.push({
          snapshotId: snap.snapshotId,
          opportunityKey: snap.opportunityKey,
          match: snap.match,
          competition: snap.competition,
          kickoffUtc: snap.kickoffUtc || null,
          market: snap.market,
          selection: snap.selection,
          line: snap.line,
          odds,
          modelProbability: prob,
          expectedValuePct: evPct,
          elenaDecision: snap.elenaDecision,
          riskManagerDecision: snap.riskManagerDecision,
          lineupStatus: snap.lineupStatus || 'PROBABLE',
          statusBadge: 'ESPERANDO FORMACIÓN DE EQUIPO',
          compositeScore
        });
      }
    }
    pending.sort((a, b) => b.compositeScore - a.compositeScore);
    return pending;
  }

  /**
   * Evalúa un conjunto de oportunidades elegibles, elige una única definitiva por
   * EV + calibración/confiabilidad, y registra los descartes con su motivo.
   */
  selectAndOpenBestOpportunity(snapshots) {
    const state = this._loadState();
    const validCandidates = [];
    const discarded = [];

    for (const snap of (snapshots || [])) {
      const check = this.validateOpportunity(snap, state);
      if (check.valid) {
        validCandidates.push({ snap, check });
      } else {
        discarded.push({ snap, reasons: check.reasons });
      }
    }

    // Registrar descartes
    const nowIso = new Date().toISOString();
    for (const d of discarded) {
      state.evaluatedOpportunities.push({
        evaluatedAtUtc: nowIso,
        snapshotId: d.snap.snapshotId,
        opportunityKey: d.snap.opportunityKey,
        match: d.snap.match,
        market: d.snap.market,
        selection: d.snap.selection,
        odds: d.snap.odds,
        evPct: d.snap.expectedValuePct ?? null,
        enteredLadder: false,
        reasons: d.reasons
      });
    }

    if (validCandidates.length === 0) {
      atomicWriteJson(this.statePath, state);
      return { entered: false, selected: null, discardedCount: discarded.length };
    }

    // Ordenar por score compuesto (EV * confiabilidad calibrada * prob)
    validCandidates.sort((a, b) => b.check.compositeScore - a.check.compositeScore);
    const winner = validCandidates[0];

    // Registrar los elegibles no seleccionados como desplazados por ranking
    for (let i = 1; i < validCandidates.length; i++) {
      const loser = validCandidates[i].snap;
      state.evaluatedOpportunities.push({
        evaluatedAtUtc: nowIso,
        snapshotId: loser.snapshotId,
        opportunityKey: loser.opportunityKey,
        match: loser.match,
        market: loser.market,
        selection: loser.selection,
        odds: loser.odds,
        evPct: loser.expectedValuePct ?? null,
        enteredLadder: false,
        reasons: [`RANKED_BELOW_SELECTED: Superada en EV/calibración por ${winner.snap.selection} (${winner.snap.match}).`]
      });
    }

    atomicWriteJson(this.statePath, state);
    return this.considerOpportunity(winner.snap);
  }

  /**
   * Abre manualmente una apuesta en vivo/personalizada para el escalón activo.
   * Valida cuotas, capital disponible y que no exista otra apuesta abierta.
   */
  openManualBet(input) {
    const state = this._loadState();
    const nowIso = new Date().toISOString();

    if (state.objectiveStatus === 'OBJECTIVE_REACHED' || state.currentCapital >= state.targetCapital) {
      throw new Error('OBJECTIVE_REACHED_LOCKED: Meta de $10.000.000 ARS alcanzada. Nuevas apuestas bloqueadas.');
    }
    const hasActiveOpenBet = Boolean(state.openBet && state.openBet.legacyStatus !== 'LEGACY_OUT_OF_RULES');
    if (hasActiveOpenBet) {
      throw new Error(`OPEN_BET_LOCKED: Ya existe una apuesta abierta (${state.openBet.betId}) para el Escalón ${state.currentStep}. Solo 1 apuesta abierta a la vez.`);
    }

    const odds = Number(input.odds);
    if (!Number.isFinite(odds) || odds < 1.01) {
      throw new Error(`ODDS_INVALID: Cuota inválida (${input.odds}). Debe ser mayor a 1.00.`);
    }

    const match = (input.match || '').trim();
    if (!match) throw new Error('MATCH_REQUIRED: Debe especificarse el partido o evento.');
    const selection = (input.selection || '').trim();
    if (!selection) throw new Error('SELECTION_REQUIRED: Debe especificarse la selección o jugador.');
    const market = (input.market || 'Apuesta en Vivo').trim();
    const line = (input.line || '').trim();
    const competition = (input.competition || 'En Vivo').trim();

    const stake = Number(state.currentCapital.toFixed(2));
    const potentialReturn = Number((stake * odds).toFixed(2));
    const betId = `ladder_manual_${Date.now()}_step${state.currentStep}`;

    const bet = {
      betId,
      cycle: state.currentCycle,
      step: state.currentStep,
      snapshotId: `manual_live_${Date.now()}`,
      opportunityKey: `manual_${Date.now()}`,
      match,
      competition,
      market,
      selection,
      line,
      odds,
      modelProbability: input.modelProbability ? Number(input.modelProbability) : null,
      expectedValuePct: input.expectedValuePct ? Number(input.expectedValuePct) : null,
      elenaDecision: 'APROBADO_MANUAL',
      riskManagerDecision: 'APROBADO_MANUAL',
      origin: 'MANUAL_LIVE',
      manualNotes: input.notes || 'Pick agregado manualmente por el usuario en vivo.',
      stake,
      potentialReturn,
      openedAtUtc: nowIso,
      status: 'OPEN'
    };

    state.openBet = bet;
    state.committedStake = stake;
    state.evaluatedOpportunities.push({
      evaluatedAtUtc: nowIso,
      snapshotId: bet.snapshotId,
      opportunityKey: bet.opportunityKey,
      match,
      market,
      selection,
      odds,
      enteredLadder: true,
      betId,
      reasons: ['ENTERED_LADDER_MANUAL_LIVE']
    });

    atomicWriteJson(this.statePath, state);
    return { entered: true, bet, state: this.getState() };
  }

  /**
   * Confirma todos los requisitos en el instante de apertura y abre la apuesta virtual.
   */
  considerOpportunity(snapshot) {
    const state = this._loadState();
    const nowIso = new Date().toISOString();
    const check = this.validateOpportunity(snapshot, state);

    if (!check.valid) {
      const entry = {
        evaluatedAtUtc: nowIso,
        snapshotId: snapshot.snapshotId,
        opportunityKey: snapshot.opportunityKey,
        match: snapshot.match,
        market: snapshot.market,
        selection: snapshot.selection,
        odds: snapshot.odds,
        evPct: check.evPct,
        enteredLadder: false,
        reasons: check.reasons
      };
      state.evaluatedOpportunities.push(entry);
      atomicWriteJson(this.statePath, state);
      return { entered: false, reasons: check.reasons, entry };
    }

    const stake = Number(state.currentCapital.toFixed(2));
    const potentialReturn = Number((stake * check.odds).toFixed(2));
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
      odds: check.odds,
      modelProbability: check.prob,
      expectedValuePct: check.evPct,
      elenaDecision: snapshot.elenaDecision,
      riskManagerDecision: snapshot.riskManagerDecision,
      stake,
      potentialReturn,
      openedAtUtc: nowIso,
      status: 'OPEN',
      definitiveSnapshot: { ...snapshot, confirmedAtUtc: nowIso }
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
      odds: check.odds,
      evPct: check.evPct,
      enteredLadder: true,
      betId: bet.betId,
      reasons: ['ENTERED_LADDER_SIMULATION']
    });

    atomicWriteJson(this.statePath, state);
    return { entered: true, bet };
  }

  /**
   * Liquida la apuesta virtual abierta de forma idempotente.
   * Si el capital alcanza o supera $10.000.000 -> OBJECTIVE_REACHED y bloquea nuevas apuestas.
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

    if (state.currentCapital >= state.targetCapital) {
      state.objectiveStatus = 'OBJECTIVE_REACHED';
    }

    const settledRecord = {
      ...bet,
      status: outcome,
      capBefore,
      capAfter,
      profitDelta,
      settledAtUtc: settlementInput.settledAtUtc || new Date().toISOString(),
      source: settlementInput.source || 'StatsHub Oficial',
      settlementType: settlementInput.settlementType || (settlementInput.source?.toLowerCase().includes('manual') ? 'MANUAL' : 'AUTOMATIC'),
      settledBy: settlementInput.settledBy || (settlementInput.source?.toLowerCase().includes('manual') ? 'Usuario (Manual)' : 'Motor Automático'),
      manualNotes: settlementInput.manualNotes || null
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
  OFFICIAL_PARAMS,
  ALLOWED_LADDER_MARKETS,
  PLAYER_T60_MARKETS,
  EXCLUDED_LADDER_MARKETS,
  DEFAULT_LADDER_STATE_PATH
};
