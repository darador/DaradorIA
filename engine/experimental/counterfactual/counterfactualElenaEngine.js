/**
 * DARADORBET — CIRCUITO CONTRAFACTUAL INDEPENDIENTE DE ELENA
 *
 * Permite que Elena evalúe selecciones de partidos que ya comenzaron (LIVE),
 * finalizaron (FINISHED) o tienen kickoff vencido, con fines EXCLUSIVOS de
 * investigación, validación estadística y medición de efectividad.
 *
 * GARANTÍAS DE AISLAMIENTO:
 * - Nunca llama a storage.saveApprovedPick() ni escribe en approved_picks.
 * - Nunca modifica bankroll, capital, staking, Telegram ni RETO ESCALERA.
 * - Nunca altera el circuito prepartido ni las guardas post-kickoff operativas.
 * - No fabrica alineaciones T-60 ni cuotas históricas inexistentes.
 */

const fs = require('fs');
const path = require('path');
const { CounterfactualStore } = require('./counterfactualStore');

const CIRCUIT_STATES = {
  PREMATCH: {
    PENDING: 'PREMATCH_PENDING',
    APPROVED: 'PREMATCH_APPROVED',
    REJECTED: 'PREMATCH_REJECTED',
    EXPIRED: 'PREMATCH_EXPIRED'
  },
  COUNTERFACTUAL: {
    PENDING: 'COUNTERFACTUAL_PENDING',
    APPROVED: 'COUNTERFACTUAL_APPROVED',
    REJECTED: 'COUNTERFACTUAL_REJECTED',
    WON: 'COUNTERFACTUAL_WON',
    LOST: 'COUNTERFACTUAL_LOST',
    VOID: 'COUNTERFACTUAL_VOID',
    UNAVAILABLE: 'COUNTERFACTUAL_UNAVAILABLE'
  }
};

const ELENA_CF_VERSION = '2.0.0-counterfactual';
const MIN_EV_PCT = 7.0; // Misma barrera matemática de Elena (+7.0% EV)
const MAX_UNCERTAINTY = 0.38;
const DEFAULT_EXPORT_PATH = path.join(__dirname, '..', '..', '..', 'api', 'counterfactual_elena.json');

class CounterfactualElenaEngine {
  constructor(options = {}) {
    this.store = options.store || new CounterfactualStore(options);
    this.exportPath = options.exportPath || DEFAULT_EXPORT_PATH;
    this.minEvPct = options.minEvPct ?? MIN_EV_PCT;
    this.maxUncertainty = options.maxUncertainty ?? MAX_UNCERTAINTY;
  }

  _extractKickoffTs(pick) {
    if (!pick) return null;
    if (pick.kickoffTimestamp || pick.kickoff_timestamp) {
      const raw = pick.kickoffTimestamp || pick.kickoff_timestamp;
      return raw < 10000000000 ? raw * 1000 : raw;
    }
    const iso = pick.eventDateUtc || pick.kickoffUtc || pick.kickoff_utc || pick.eventDate;
    if (iso) {
      const ts = new Date(iso).getTime();
      if (!isNaN(ts)) return ts;
    }
    return null;
  }

  /**
   * Determina si el evento es elegible para el circuito contrafactual (post-kickoff / LIVE / FINISHED).
   */
  detectMatchStateAtEvaluation(pick, now = Date.now()) {
    const ms = String(pick.matchStatus || pick.match_status || pick.status || '').toUpperCase();
    const isFinished =
      pick.is_finished === true ||
      pick.isFinished === true ||
      ms === 'FINALIZADO' ||
      ms === 'FINISHED';
    if (isFinished) return 'FINISHED';

    const isLive =
      pick.isLive === true ||
      pick.is_live === true ||
      ms === 'EN_CURSO' ||
      ms === 'LIVE' ||
      ms === 'IN_PLAY' ||
      ms === 'STARTED';

    const kickoffTs = this._extractKickoffTs(pick);
    if (kickoffTs !== null) {
      const elapsedMin = (now - kickoffTs) / 60000;
      if (elapsedMin >= 115) return 'FINISHED';
      if (elapsedMin >= 0) return 'LIVE';
      return 'PREMATCH';
    }

    if (isLive) return 'LIVE';
    return 'PREMATCH';
  }

  /**
   * Evalúa contrafactualmente una selección usando SOLO los datos realmente disponibles.
   * Nunca inventa información T-60 ni cuotas inexistentes.
   */
  evaluateCounterfactual(pick, options = {}) {
    const now = typeof options.now === 'number' ? options.now : Date.now();
    const evaluatedAtUtc = new Date(now).toISOString();
    const kickoffTs = this._extractKickoffTs(pick);
    const kickoffUtc = kickoffTs !== null ? new Date(kickoffTs).toISOString() : null;
    const matchState = options.matchStateOverride || this.detectMatchStateAtEvaluation(pick, now);

    if (matchState === 'PREMATCH') {
      throw new Error(`COUNTERFACTUAL_ONLY_POST_KICKOFF: El pick ${pick.id} aún está en ventana PREMATCH; debe evaluarse por el circuito prepartido.`);
    }

    const odds = Number(pick.odds ?? pick.bookmakerOdds ?? pick.cuota);
    const hasValidOdds = Number.isFinite(odds) && odds > 1.01;

    const rawProb =
      pick.real_prob !== undefined && pick.real_prob !== null
        ? Number(pick.real_prob) / 100
        : (pick.prediction?.pProjected !== undefined ? Number(pick.prediction.pProjected) : null);
    const hasValidProb = rawProb !== null && Number.isFinite(rawProb) && rawProb > 0 && rawProb < 1;

    const isTeamProp = pick.isTeamProp === true || String(pick.player || '').includes('(Equipo)');
    const sampleSize = Number(pick.sample_size ?? pick.sampleSize ?? 0);
    const minSample = isTeamProp ? 10 : 8;
    const uncertainty = pick.uncertainty_index ?? pick.prediction?.uncertaintyIndex ?? null;

    // Captura honesta de los datos realmente disponibles (sin fabricar T-60)
    const availableDataSnapshot = {
      hasConfirmedKickoff: kickoffUtc !== null,
      t60LineupAvailable: Boolean(pick.researchData?.lineupData?.status === 'CONFIRMADA' || pick.lineupStatus === 'CONFIRMADA'),
      hasOdds: hasValidOdds,
      hasModelProbability: hasValidProb,
      sampleSize,
      hitRateL5: pick.hit_rate_l5 || null,
      hitRateL10: pick.hit_rate_l10 || null,
      uncertaintyIndex: uncertainty,
      modelApplied: pick.model_applied || pick.prediction?.modelApplied || null,
      note: 'Evaluación contrafactual con datos reales disponibles en evaluatedAtUtc; no se reconstruyeron alineaciones T-60 ni cuotas históricas.'
    };

    const decisionReasons = [];
    let decision = CIRCUIT_STATES.COUNTERFACTUAL.REJECTED;
    let dataSufficiency = 'SUFFICIENT';
    let expectedValuePct = null;

    if (!hasValidOdds || !hasValidProb) {
      dataSufficiency = 'INSUFFICIENT_DATA';
      decision = CIRCUIT_STATES.COUNTERFACTUAL.REJECTED;
      decisionReasons.push('INSUFFICIENT_DATA: Faltan cuota válida o probabilidad estimada del modelo al momento de evaluar.');
    } else {
      expectedValuePct = Number(((rawProb * odds - 1) * 100).toFixed(2));

      if (sampleSize > 0 && sampleSize < minSample) {
        dataSufficiency = 'INSUFFICIENT_DATA';
        decisionReasons.push(`INSUFFICIENT_DATA: Muestra insuficiente (N=${sampleSize} < mínimo ${minSample}).`);
      }

      if (expectedValuePct < this.minEvPct) {
        decisionReasons.push(`VETO MATEMÁTICO CONTRAFACTUAL: EV (${expectedValuePct >= 0 ? '+' : ''}${expectedValuePct}%) inferior al umbral de Elena (+${this.minEvPct.toFixed(1)}%).`);
      }

      if (uncertainty !== null && Number.isFinite(Number(uncertainty)) && Number(uncertainty) > this.maxUncertainty) {
        decisionReasons.push(`VETO POR INCERTIDUMBRE: Dispersión (${(Number(uncertainty) * 100).toFixed(1)}%) supera el máximo (${(this.maxUncertainty * 100).toFixed(0)}%).`);
      }

      if (rawProb > 0.85 && odds > 1.60) {
        decisionReasons.push(`VETO POR PROBABILIDAD INFLADA: Probabilidad ${(rawProb * 100).toFixed(1)}% implausible para cuota ${odds}.`);
      }

      if (decisionReasons.length === 0) {
        decision = CIRCUIT_STATES.COUNTERFACTUAL.APPROVED;
        decisionReasons.push(
          `CONTRAFACTUAL APROBADA POR ELENA: EV +${expectedValuePct}% (p=${(rawProb * 100).toFixed(1)}% @ ${odds}, N=${sampleSize || 'N/D'}) bajo datos disponibles en ${matchState}. NO constituye apuesta operativa prepartido.`
        );
      }
    }

    const record = this.store.appendEvaluation({
      originalPickId: pick.id,
      matchId: pick.matchId || pick.fixtureId || null,
      match: pick.match || pick.partido || null,
      league: pick.league || pick.competition || null,
      market: pick.market || pick.mercado || null,
      selection: `${pick.player || pick.playerOrTeam || pick.seleccion || ''} — ${pick.line || pick.linea || ''}`.trim(),
      line: pick.line || pick.linea || null,
      evaluatedAtUtc,
      kickoffUtc,
      matchStateAtEvaluation: matchState,
      availableDataSnapshot,
      odds: hasValidOdds ? odds : null,
      oddsTimestampUtc: pick.oddsTimestampUtc || pick.updated_at || null,
      elenaProbability: hasValidProb ? Number(rawProb.toFixed(4)) : null,
      expectedValuePct,
      decision,
      dataSufficiency,
      decisionReasons,
      settlementResult: null,
      modelVersion: pick.model_applied || 'Beta-Binomial + Shadow v2.3',
      elenaVersion: ELENA_CF_VERSION
    });

    return record;
  }

  /**
   * Liquidación virtual de una evaluación COUNTERFACTUAL_APPROVED.
   * Condiciones estrictas:
   * - Solo tras FINISHED confirmado.
   * - Idempotente (no duplica resultados).
   * - Nunca modifica liquidaciones reales ni bankroll.
   */
  settleCounterfactual(evaluationId, officialResult, options = {}) {
    const evaluations = this.store.getAllEvaluations();
    const evalRec = evaluations.find(e => e.evaluationId === evaluationId);
    if (!evalRec) {
      throw new Error(`COUNTERFACTUAL_NOT_FOUND: No existe evaluación ${evaluationId}`);
    }
    if (evalRec.decision !== CIRCUIT_STATES.COUNTERFACTUAL.APPROVED) {
      throw new Error(`COUNTERFACTUAL_NOT_APPROVED: Solo se liquidan evaluaciones COUNTERFACTUAL_APPROVED (actual: ${evalRec.decision})`);
    }

    const matchStatus = String(officialResult?.matchStatus || '').toUpperCase();
    const isConfirmedFinished = matchStatus === 'FINISHED' && officialResult?.confirmed === true;
    if (!isConfirmedFinished) {
      return {
        settled: false,
        reason: 'MATCH_NOT_CONFIRMED_FINISHED: No se permite liquidar virtualmente antes de FINISHED confirmado.'
      };
    }

    // Idempotencia: si ya existe liquidación, devolverla sin duplicar
    const existing = this.store.getSettlementByEvaluationId(evaluationId);
    if (existing) {
      return { settled: true, duplicate: true, record: existing };
    }

    const stakeVirtual = options.stakeVirtual ?? 1.0;
    const odds = evalRec.odds;
    let status = CIRCUIT_STATES.COUNTERFACTUAL.UNAVAILABLE;
    let profitVirtual = 0;

    const outcome = String(officialResult.outcome || '').toUpperCase();
    if (outcome === 'WON') {
      status = CIRCUIT_STATES.COUNTERFACTUAL.WON;
      profitVirtual = odds ? Number(((odds - 1) * stakeVirtual).toFixed(4)) : 0;
    } else if (outcome === 'LOST') {
      status = CIRCUIT_STATES.COUNTERFACTUAL.LOST;
      profitVirtual = -stakeVirtual;
    } else if (outcome === 'VOID' || outcome === 'PUSH') {
      status = CIRCUIT_STATES.COUNTERFACTUAL.VOID;
      profitVirtual = 0;
    } else {
      status = CIRCUIT_STATES.COUNTERFACTUAL.UNAVAILABLE;
      profitVirtual = 0;
    }

    const { record, duplicate } = this.store.appendSettlement({
      evaluationId,
      originalPickId: evalRec.originalPickId,
      matchId: evalRec.matchId,
      match: evalRec.match,
      market: evalRec.market,
      league: evalRec.league,
      odds,
      elenaProbability: evalRec.elenaProbability,
      stakeVirtual,
      status,
      actualStat: officialResult.actualStat ?? null,
      profitVirtual,
      settledAtUtc: options.settledAtUtc || new Date().toISOString(),
      source: officialResult.source || 'official_result',
      reason: officialResult.reason || `Liquidación virtual ${status}`
    });

    return { settled: true, duplicate, record };
  }

  /**
   * Calcula métricas virtuales 100% independientes del circuito operativo.
   */
  computeVirtualMetrics() {
    const latest = this.store.getLatestEvaluationsByPick();
    const settlements = this.store.getAllSettlements();
    const settleMap = new Map(settlements.map(s => [s.evaluationId, s]));

    const approved = latest.filter(e => e.decision === CIRCUIT_STATES.COUNTERFACTUAL.APPROVED);
    const rejected = latest.filter(e => e.decision === CIRCUIT_STATES.COUNTERFACTUAL.REJECTED);
    const insufficientData = rejected.filter(e => e.dataSufficiency === 'INSUFFICIENT_DATA');

    const settledValid = settlements.filter(s => s.status === CIRCUIT_STATES.COUNTERFACTUAL.WON || s.status === CIRCUIT_STATES.COUNTERFACTUAL.LOST);
    const won = settlements.filter(s => s.status === CIRCUIT_STATES.COUNTERFACTUAL.WON);
    const lost = settlements.filter(s => s.status === CIRCUIT_STATES.COUNTERFACTUAL.LOST);
    const voided = settlements.filter(s => s.status === CIRCUIT_STATES.COUNTERFACTUAL.VOID);

    const totalStaked = settledValid.reduce((acc, s) => acc + (s.stakeVirtual || 1), 0);
    const totalProfit = settledValid.reduce((acc, s) => acc + (s.profitVirtual || 0), 0);
    const hitRatePct = settledValid.length > 0 ? Number(((won.length / settledValid.length) * 100).toFixed(2)) : null;
    const virtualRoiPct = totalStaked > 0 ? Number(((totalProfit / totalStaked) * 100).toFixed(2)) : null;
    const virtualYieldPct = virtualRoiPct;

    // Brier Score & Log Loss sobre liquidaciones WON/LOST con probabilidad de Elena
    const probSettled = settledValid.filter(s => typeof s.elenaProbability === 'number' && s.elenaProbability > 0 && s.elenaProbability < 1);
    let brierScore = null;
    let logLoss = null;
    if (probSettled.length > 0) {
      let brierSum = 0;
      let logSum = 0;
      for (const s of probSettled) {
        const y = s.status === CIRCUIT_STATES.COUNTERFACTUAL.WON ? 1 : 0;
        const p = Math.min(Math.max(s.elenaProbability, 1e-6), 1 - 1e-6);
        brierSum += Math.pow(p - y, 2);
        logSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      }
      brierScore = Number((brierSum / probSettled.length).toFixed(4));
      logLoss = Number((logSum / probSettled.length).toFixed(4));
    }

    const groupBy = (keyFn) => {
      const groups = {};
      for (const e of latest) {
        const k = keyFn(e) || 'Sin especificar';
        if (!groups[k]) groups[k] = { evaluated: 0, approved: 0, rejected: 0, settled: 0, won: 0, lost: 0, hitRatePct: null };
        groups[k].evaluated++;
        if (e.decision === CIRCUIT_STATES.COUNTERFACTUAL.APPROVED) groups[k].approved++;
        else groups[k].rejected++;
        const st = settleMap.get(e.evaluationId);
        if (st && (st.status === CIRCUIT_STATES.COUNTERFACTUAL.WON || st.status === CIRCUIT_STATES.COUNTERFACTUAL.LOST)) {
          groups[k].settled++;
          if (st.status === CIRCUIT_STATES.COUNTERFACTUAL.WON) groups[k].won++;
          else groups[k].lost++;
          groups[k].hitRatePct = Number(((groups[k].won / groups[k].settled) * 100).toFixed(2));
        }
      }
      return groups;
    };

    const oddsBucket = (e) => {
      if (typeof e.odds !== 'number') return 'Sin cuota';
      if (e.odds < 1.5) return '< 1.50';
      if (e.odds < 1.8) return '1.50 - 1.79';
      if (e.odds < 2.2) return '1.80 - 2.19';
      return '>= 2.20';
    };

    return {
      circuit: 'COUNTERFACTUAL_RESEARCH_ONLY',
      autoExecutionAllowed: false,
      totalEvaluated: latest.length,
      totalVersionsStored: this.store.getAllEvaluations().length,
      totalApproved: approved.length,
      totalRejected: rejected.length,
      totalInsufficientData: insufficientData.length,
      totalSettled: settlements.length,
      wonCount: won.length,
      lostCount: lost.length,
      voidCount: voided.length,
      hitRatePct,
      virtualRoiPct,
      virtualYieldPct,
      brierScore,
      logLoss,
      byMarket: groupBy(e => e.market),
      byLeague: groupBy(e => e.league),
      byOddsRange: groupBy(oddsBucket),
      sampleSizeConclusive: settledValid.length >= 30,
      statisticalWarning: settledValid.length < 30
        ? `Muestra liquidada insuficiente (N=${settledValid.length} < 30). No concluyente estadísticamente.`
        : null
    };
  }

  exportDashboardJson(outPath = null) {
    const target = outPath || this.exportPath;
    const latest = this.store.getLatestEvaluationsByPick();
    const settlements = this.store.getAllSettlements();
    const settleMap = new Map(settlements.map(s => [s.evaluationId, s]));
    const metrics = this.computeVirtualMetrics();
    const chain = this.store.verifyChain();

    const payload = {
      generatedAtUtc: new Date().toISOString(),
      circuit: 'COUNTERFACTUAL_RESEARCH_ONLY',
      autoExecutionAllowed: false,
      operationalIsolation: true,
      integrity: chain,
      metrics,
      evaluations: latest.map(e => ({
        ...e,
        settlement: settleMap.get(e.evaluationId) || null
      }))
    };

    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }
}

module.exports = {
  CounterfactualElenaEngine,
  CIRCUIT_STATES,
  ELENA_CF_VERSION
};
