/**
 * DARADORBET — AMPLIACIÓN DE MERCADOS: GANADOR DEL PARTIDO (1X2) Y DOBLE OPORTUNIDAD
 *
 * Puente aditivo que reutiliza matchOutcomeModel.js para:
 * - Identificar las 6 selecciones canónicas: 1, X, 2, 1X, X2, 12.
 * - Calcular probabilidades coherentes (sum = 100%) y probabilidades implícitas sin margen (de-vig).
 * - Calcular EV sin inventar cuotas ni probabilidades.
 * - Liquidar exactamente las 6 selecciones según marcador oficial (homeGoals, awayGoals).
 * - Formatear entradas compatibles con el Daily Board (picks_hoy.json) sin duplicados.
 * - Calcular métricas de calibración y rendimiento SEPARADAS para 1X2 y Doble oportunidad.
 */

const matchOutcomeModel = require('./matchOutcomeModel');

const MARKET_1X2 = 'Ganador del partido (1X2)';
const MARKET_DC = 'Doble oportunidad';

const CANONICAL_SELECTIONS = {
  '1': { market: MARKET_1X2, code: '1', label: 'Local (1)' },
  'X': { market: MARKET_1X2, code: 'X', label: 'Empate (X)' },
  '2': { market: MARKET_1X2, code: '2', label: 'Visitante (2)' },
  '1X': { market: MARKET_DC, code: '1X', label: 'Local o empate (1X)' },
  'X2': { market: MARKET_DC, code: 'X2', label: 'Empate o visitante (X2)' },
  '12': { market: MARKET_DC, code: '12', label: 'Local o visitante (12)' }
};

function clampProb(p) {
  return Math.min(Math.max(p, 1e-6), 1 - 1e-6);
}

/**
 * Elimina el margen de la casa (overround) de un conjunto de cuotas 1X2 [odds1, oddsX, odds2].
 */
function deVig1X2(odds1, oddsX, odds2) {
  const o1 = Number(odds1), oX = Number(oddsX), o2 = Number(odds2);
  if (!Number.isFinite(o1) || !Number.isFinite(oX) || !Number.isFinite(o2) || o1 <= 1.01 || oX <= 1.01 || o2 <= 1.01) {
    return null;
  }
  const r1 = 1 / o1, rX = 1 / oX, r2 = 1 / o2;
  const sum = r1 + rX + r2;
  return {
    overroundPct: Number(((sum - 1) * 100).toFixed(2)),
    p1: Number((r1 / sum).toFixed(4)),
    pX: Number((rX / sum).toFixed(4)),
    p2: Number((r2 / sum).toFixed(4))
  };
}

/**
 * Calcula probabilidades coherentes 1X2 y Doble Oportunidad reutilizando matchOutcomeModel.
 * Verifica explícitamente que P(1) + P(X) + P(2) === 1.
 */
function computeCoherentProbabilities(matchInput) {
  let p1, pX, p2;

  if (matchInput.probabilities1X2) {
    p1 = Number(matchInput.probabilities1X2.home);
    pX = Number(matchInput.probabilities1X2.draw);
    p2 = Number(matchInput.probabilities1X2.away);
  } else if (typeof matchOutcomeModel.predictMatch === 'function') {
    const pred = matchOutcomeModel.predictMatch(matchInput);
    p1 = Number(pred.probs?.home ?? pred.pHome ?? pred.homeWin);
    pX = Number(pred.probs?.draw ?? pred.pDraw ?? pred.draw);
    p2 = Number(pred.probs?.away ?? pred.pAway ?? pred.awayWin);
  } else {
    throw new Error('MODEL_UNAVAILABLE: No se pudieron calcular probabilidades 1X2.');
  }

  const total = p1 + pX + p2;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('INVALID_PROBABILITIES: Probabilidades 1X2 inválidas.');
  }

  // Normalización exacta para garantizar coherencia suma = 1.0
  p1 = Number((p1 / total).toFixed(4));
  pX = Number((pX / total).toFixed(4));
  p2 = Number((1 - p1 - pX).toFixed(4));

  return {
    '1': p1,
    'X': pX,
    '2': p2,
    '1X': Number((p1 + pX).toFixed(4)),
    'X2': Number((pX + p2).toFixed(4)),
    '12': Number((p1 + p2).toFixed(4)),
    coherentSum: Number((p1 + pX + p2).toFixed(4))
  };
}

/**
 * Evalúa las 6 selecciones de un partido contra sus cuotas reales disponibles.
 * Nunca inventa cuotas: si falta la cuota de una selección, la omite y registra en missingOdds.
 */
function evaluateMatch1X2AndDC(matchInput, oddsInput = {}, options = {}) {
  const minEvPct = options.minEvPct ?? 7.0; // Mismo umbral productivo de Elena (+7.0%)
  const probs = computeCoherentProbabilities(matchInput);
  const noVig = deVig1X2(oddsInput['1'], oddsInput['X'], oddsInput['2']);
  const evaluated = [];
  const missingOdds = [];

  for (const code of ['1', 'X', '2', '1X', 'X2', '12']) {
    const meta = CANONICAL_SELECTIONS[code];
    const odds = Number(oddsInput[code]);
    if (!Number.isFinite(odds) || odds <= 1.01) {
      missingOdds.push({ code, market: meta.market, reason: 'ODDS_UNAVAILABLE' });
      continue;
    }

    const pModel = probs[code];
    const pImpliedRaw = Number((1 / odds).toFixed(4));
    let pImpliedNoVig = pImpliedRaw;
    if (noVig) {
      if (code === '1') pImpliedNoVig = noVig.p1;
      else if (code === 'X') pImpliedNoVig = noVig.pX;
      else if (code === '2') pImpliedNoVig = noVig.p2;
      else if (code === '1X') pImpliedNoVig = Number((noVig.p1 + noVig.pX).toFixed(4));
      else if (code === 'X2') pImpliedNoVig = Number((noVig.pX + noVig.p2).toFixed(4));
      else if (code === '12') pImpliedNoVig = Number((noVig.p1 + noVig.p2).toFixed(4));
    }

    const evPct = Number(((pModel * odds - 1) * 100).toFixed(2));
    const fairOdds = Number((1 / clampProb(pModel)).toFixed(2));
    const elenaApproved = evPct >= minEvPct && !(pModel > 0.85 && odds > 1.60);
    const elenaDecision = elenaApproved ? 'APROBADO' : 'RECHAZADO';
    const reason = elenaApproved
      ? `EV +${evPct}% (Modelo ${(pModel * 100).toFixed(1)}% vs Mercado sin vig ${(pImpliedNoVig * 100).toFixed(1)}%) @${odds}.`
      : (evPct < minEvPct
        ? `VETO MATEMÁTICO: EV (${evPct >= 0 ? '+' : ''}${evPct}%) inferior al umbral (+${minEvPct.toFixed(1)}%).`
        : 'VETO POR PROBABILIDAD INFLADA.');

    const matchName = matchInput.match || `${matchInput.homeTeam} vs ${matchInput.awayTeam}`;
    const selectionDisplay = code === '1' ? matchInput.homeTeam
      : (code === '2' ? matchInput.awayTeam
      : (code === 'X' ? 'Empate' : meta.label));

    const id = `cand_1x2dc_${matchInput.matchId || matchName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${code}`;
    evaluated.push({
      id,
      matchId: matchInput.matchId || null,
      league: matchInput.league || matchInput.competition || '',
      match: matchName,
      date: matchInput.eventDateLocal || null,
      eventDateLocal: matchInput.eventDateLocal || null,
      eventDateUtc: matchInput.eventDateUtc || null,
      kickoffTimeLocal: matchInput.kickoffTimeLocal || null,
      player: `${selectionDisplay} (${code})`,
      selectionCode: code,
      market: meta.market,
      line: meta.label,
      odds,
      bookmaker: oddsInput.bookmaker || 'StatsHub',
      implied_prob: Number((pImpliedRaw * 100).toFixed(1)),
      implied_prob_novig: Number((pImpliedNoVig * 100).toFixed(1)),
      real_prob: Number((pModel * 100).toFixed(1)),
      edge_pct: evPct,
      ev_pct: `${evPct >= 0 ? '+' : ''}${evPct}%`,
      fair_odds: fairOdds,
      elena_decision: elenaDecision,
      risk_manager_decision: elenaDecision,
      status: elenaDecision,
      sports_result: 'PENDIENTE',
      is_settled: false,
      is_finished: false,
      shadow_mode: true,
      is_operative_recommendation: false,
      rationale: reason
    });
  }

  return { probs, noVig, evaluated, missingOdds };
}

/**
 * Liquidación exacta para las 6 selecciones de 1X2 y Doble oportunidad.
 */
function settleMatchResultSelection(selectionCode, homeGoals, awayGoals) {
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) {
    return 'UNAVAILABLE';
  }
  const code = String(selectionCode || '').toUpperCase();
  if (code === '1') return homeGoals > awayGoals ? 'WON' : 'LOST';
  if (code === 'X') return homeGoals === awayGoals ? 'WON' : 'LOST';
  if (code === '2') return awayGoals > homeGoals ? 'WON' : 'LOST';
  if (code === '1X') return homeGoals >= awayGoals ? 'WON' : 'LOST';
  if (code === 'X2') return awayGoals >= homeGoals ? 'WON' : 'LOST';
  if (code === '12') return homeGoals !== awayGoals ? 'WON' : 'LOST';
  return 'UNAVAILABLE';
}

/**
 * Deduplica por ID estable sin alterar registros previos.
 */
function deduplicateBoardEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.id)) map.set(e.id, e);
  }
  return Array.from(map.values());
}

/**
 * Métricas SEPARADAS para 1X2 y Doble oportunidad (nunca combinadas).
 */
function computeSeparateMarketMetrics(records) {
  const calc = (list) => {
    const settled = list.filter(r => r.outcome === 'WON' || r.outcome === 'LOST');
    const won = settled.filter(r => r.outcome === 'WON').length;
    const lost = settled.filter(r => r.outcome === 'LOST').length;
    let profit = 0, brier = 0, brierBase = 0, ll = 0, llBase = 0, calN = 0;

    for (const r of settled) {
      const y = r.outcome === 'WON' ? 1 : 0;
      if (r.odds) profit += y === 1 ? (r.odds - 1) : -1;
      if (r.real_prob && r.odds) {
        const p = clampProb(r.real_prob / 100);
        const pb = clampProb(r.implied_prob_novig ? r.implied_prob_novig / 100 : (1 / r.odds));
        brier += (p - y) ** 2;
        brierBase += (pb - y) ** 2;
        ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        llBase += -(y * Math.log(pb) + (1 - y) * Math.log(1 - pb));
        calN++;
      }
    }

    return {
      nEvaluated: list.length,
      nSettled: settled.length,
      won,
      lost,
      hitRatePct: settled.length > 0 ? Number(((won / settled.length) * 100).toFixed(1)) : null,
      roiPct: settled.length > 0 ? Number(((profit / settled.length) * 100).toFixed(1)) : null,
      yieldPct: settled.length > 0 ? Number(((profit / settled.length) * 100).toFixed(1)) : null,
      brierScore: calN > 0 ? Number((brier / calN).toFixed(4)) : null,
      brierBaseline: calN > 0 ? Number((brierBase / calN).toFixed(4)) : null,
      logLoss: calN > 0 ? Number((ll / calN).toFixed(4)) : null,
      logLossBaseline: calN > 0 ? Number((llBase / calN).toFixed(4)) : null,
      sampleConclusive: settled.length >= 30,
      statisticalWarning: settled.length < 30 ? `Muestra insuficiente (N=${settled.length} < 30). No concluyente.` : null
    };
  };

  return {
    [MARKET_1X2]: calc(records.filter(r => r.market === MARKET_1X2)),
    [MARKET_DC]: calc(records.filter(r => r.market === MARKET_DC))
  };
}

module.exports = {
  MARKET_1X2,
  MARKET_DC,
  CANONICAL_SELECTIONS,
  deVig1X2,
  computeCoherentProbabilities,
  evaluateMatch1X2AndDC,
  settleMatchResultSelection,
  deduplicateBoardEntries,
  computeSeparateMarketMetrics
};
