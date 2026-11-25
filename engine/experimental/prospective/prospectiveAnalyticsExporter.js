/**
 * DARADORBET — FASE 11: EXPORTADOR DE MÉTRICAS PROSPECTIVAS Y PANEL RETO ESCALERA
 *
 * Calcula métricas estrictamente prospectivas (nunca mezcla resultados contrafactuales
 * ni suma el replay histórico al balance prospectivo de RETO ESCALERA).
 * Exporta api/fase11_prospective_dashboard.json.
 */

const fs = require('fs');
const path = require('path');
const { ProspectiveObservationStore } = require('./prospectiveObservationStore');
const { ProspectiveLadderEngine } = require('./prospectiveLadderEngine');

const ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_EXPORT_PATH = path.join(ROOT, 'api', 'fase11_prospective_dashboard.json');
const REPLAY_PATH = path.join(ROOT, 'api', 'reto_escalera_simulation.json');

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function clamp(p) {
  return Math.min(Math.max(p, 1e-6), 1 - 1e-6);
}

function computeStats(items, settleMap) {
  let won = 0, lost = 0, voided = 0, pending = 0, profitU = 0, oddsSum = 0, oddsN = 0;
  let brier = 0, brierB = 0, ll = 0, llB = 0, calN = 0;

  for (const snap of items) {
    const st = settleMap.get(snap.opportunityKey);
    if (!st) {
      pending++;
      continue;
    }
    if (st.outcome === 'WON') won++;
    else if (st.outcome === 'LOST') lost++;
    else if (st.outcome === 'VOID') voided++;
    else if (st.outcome === 'HALF_WON') won += 0.5;
    else if (st.outcome === 'HALF_LOST') lost += 0.5;

    if (['WON', 'LOST', 'HALF_WON', 'HALF_LOST'].includes(st.outcome) && snap.odds) {
      profitU += st.profitUnits;
      oddsSum += snap.odds;
      oddsN++;
    }
    if ((st.outcome === 'WON' || st.outcome === 'LOST') && snap.modelProbability && snap.odds) {
      const y = st.outcome === 'WON' ? 1 : 0;
      const p = clamp(snap.modelProbability);
      const pb = clamp(1 / snap.odds);
      brier += (p - y) ** 2;
      brierB += (pb - y) ** 2;
      ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      llB += -(y * Math.log(pb) + (1 - y) * Math.log(1 - pb));
      calN++;
    }
  }

  const settled = won + lost;
  return {
    n: items.length,
    settled,
    won,
    lost,
    void: voided,
    pending,
    hitRatePct: settled > 0 ? Number(((won / settled) * 100).toFixed(1)) : null,
    avgOdds: oddsN > 0 ? Number((oddsSum / oddsN).toFixed(2)) : null,
    profitUnits: Number(profitU.toFixed(2)),
    roiPct: oddsN > 0 ? Number(((profitU / oddsN) * 100).toFixed(1)) : null,
    yieldPct: oddsN > 0 ? Number(((profitU / oddsN) * 100).toFixed(1)) : null,
    brierScore: calN > 0 ? Number((brier / calN).toFixed(4)) : null,
    brierBaseline: calN > 0 ? Number((brierB / calN).toFixed(4)) : null,
    logLoss: calN > 0 ? Number((ll / calN).toFixed(4)) : null,
    logLossBaseline: calN > 0 ? Number((llB / calN).toFixed(4)) : null,
    sampleConclusive: settled >= 30
  };
}

function groupBy(items, keyFn, settleMap) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it) || 'Sin especificar';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  const out = {};
  for (const [k, arr] of map.entries()) out[k] = computeStats(arr, settleMap);
  return out;
}

class ProspectiveAnalyticsExporter {
  constructor(options = {}) {
    this.store = options.store || new ProspectiveObservationStore(options);
    this.ladder = options.ladder || new ProspectiveLadderEngine(options);
    this.exportPath = options.exportPath || DEFAULT_EXPORT_PATH;
  }

  export() {
    const latest = this.store.getLatestSnapshotsByKey();
    // Excluir explícitamente cualquier registro CONTRAFACTUAL de las métricas prospectivas
    const prospectiveOnly = latest.filter(s => s.circuit !== 'CONTRAFACTUAL');
    const settlements = this.store.getAllSettlements();
    const settleMap = new Map(settlements.map(s => [s.opportunityKey, s]));
    const chain = this.store.verifyChain();
    const ladderState = this.ladder.getState();
    ladderState.eligibleOpportunities = this.ladder.getEligibleRankedOpportunities(prospectiveOnly);
    const historicalReplay = readJson(REPLAY_PATH, null);

    const overall = computeStats(prospectiveOnly, settleMap);
    const approvedCount = prospectiveOnly.filter(s => s.elenaDecision === 'APROBADO').length;
    const rejectedCount = prospectiveOnly.filter(s => s.elenaDecision === 'RECHAZADO').length;
    const pendingEvalCount = prospectiveOnly.filter(s => !['APROBADO', 'RECHAZADO'].includes(s.elenaDecision)).length;

    const probBand = (s) => {
      if (s.modelProbability == null) return 'Sin prob.';
      const p = s.modelProbability * 100;
      if (p < 60) return '<60%';
      if (p < 70) return '60-69%';
      if (p < 80) return '70-79%';
      return '>=80%';
    };

    const payload = {
      generatedAtUtc: new Date().toISOString(),
      phase: 'FASE_11_PROSPECTIVE_OBSERVATION',
      mode: 'SIMULACIÓN — DINERO VIRTUAL',
      autoExecutionAllowed: false,
      integrity: chain,
      summary: {
        ...overall,
        detectedCount: prospectiveOnly.length,
        approvedCount,
        rejectedCount,
        pendingEvalCount,
        statisticalWarning: overall.settled < 30
          ? `Muestra prospectiva liquidada insuficiente (N=${overall.settled} < 30). No concluyente estadísticamente.`
          : null
      },
      breakdowns: {
        byMarket: groupBy(prospectiveOnly, s => s.market, settleMap),
        byLeague: groupBy(prospectiveOnly, s => s.competition, settleMap),
        byCircuit: groupBy(prospectiveOnly, s => s.circuit, settleMap),
        byElenaDecision: groupBy(prospectiveOnly, s => s.elenaDecision, settleMap),
        byLineupStatus: groupBy(prospectiveOnly, s => s.lineupStatus, settleMap),
        byProbBand: groupBy(prospectiveOnly, probBand, settleMap)
      },
      prospectiveLadder: ladderState,
      historicalReplayReference: historicalReplay ? {
        label: 'REPLAY HISTÓRICO SIMULADO (SEPARADO — NO SUMADO AL BALANCE PROSPECTIVO)',
        eligiblePicksReplayed: historicalReplay.summary?.eligiblePicksReplayed ?? 0,
        netSimulatedProfit: historicalReplay.summary?.netSimulatedProfit ?? 0,
        cyclesCompleted: historicalReplay.summary?.cyclesCompleted ?? 0
      } : null,
      opportunities: prospectiveOnly.map(s => ({
        ...s,
        settlement: settleMap.get(s.opportunityKey) || null
      }))
    };

    const dir = path.dirname(this.exportPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.exportPath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }
}

module.exports = { ProspectiveAnalyticsExporter, computeStats };
