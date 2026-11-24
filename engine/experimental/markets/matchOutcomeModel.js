/**
 * MATCH OUTCOME & DOUBLE CHANCE MODEL (FASE 2 — EXPERIMENTAL / SHADOW MODE ONLY)
 *
 * Calcula distribuciones probabilísticas coherentes para mercados de resultado y goles:
 *   - Ganador del partido (1X2): P(1) + P(X) + P(2) = 1.0000
 *   - Doble Oportunidad (1X, X2, 12): derivadas exactamente de la misma matriz:
 *       P(1X) = P(1) + P(X), P(X2) = P(X) + P(2), P(12) = P(1) + P(2)
 *   - Derivados consistentes: BTTS (Sí/No), Total Goles (O/U con push en enteras),
 *     Goles por Equipo y Hándicap Asiático (AH).
 *
 * Motor matemático:
 *   - Fuerza ofensiva/defensiva con decaimiento temporal exponencial
 *   - Integración de xG cuando está disponible (sin inventar xG si falta)
 *   - Split local/visitante + ventaja de localía calibrada
 *   - Factor de descanso/calendario y ausencias confirmadas (getTeamNews coverage === 'ok')
 *   - Matriz de marcadores Poisson Bivariado con corrección Dixon-Coles (rho) en marcadores bajos
 *   - Devig exacto 3-way (1X2) y 2-way (O/U, BTTS, AH) + filtro estricto de movement warnings
 *
 * NO modifica PredictionEngine V1 productivo ni habilita apuestas reales.
 */

'use strict';

const v2Math = require('../predictionEngineV2');

const MODEL_VERSION = 'match-outcome-dc-v1.0-experimental';
const MAX_GOALS_GRID = 10;
const DEFAULT_LEAGUE_AVG_GOALS_HOME = 1.48;
const DEFAULT_LEAGUE_AVG_GOALS_AWAY = 1.15;
const DEFAULT_DIXON_COLES_RHO = -0.06;
const DEFAULT_DECAY_ALPHA = 0.045;
const MIN_LAMBDA = 0.20;
const MAX_LAMBDA = 4.20;

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function round(val, digits = 6) {
  if (!Number.isFinite(val)) return null;
  const f = Math.pow(10, digits);
  return Math.round(val * f) / f;
}

/**
 * Calcula promedio ponderado exponencialmente sobre una serie ordenada de más reciente (i=0) a más antigua.
 */
function weightedMean(values, alpha = DEFAULT_DECAY_ALPHA) {
  const clean = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  if (clean.length === 0) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < clean.length; i++) {
    const w = Math.exp(-alpha * i);
    num += clean[i] * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * Extrae series partido a partido de goles a favor y en contra desde getTeamPerformance.
 * Nunca inventa datos: si matches[] no trae goalsFor/goalsAgainst, devuelve vacío.
 */
function extractTeamGoalSeries(teamPerf, targetVenue = null) {
  const matches = Array.isArray(teamPerf?.matches) ? teamPerf.matches : [];
  const allFor = [];
  const allAgainst = [];
  const venueFor = [];
  const venueAgainst = [];

  for (const m of matches) {
    const gf = Number(m?.goalsFor);
    const ga = Number(m?.goalsAgainst);
    if (!Number.isFinite(gf) || !Number.isFinite(ga)) continue;
    allFor.push(gf);
    allAgainst.push(ga);
    if (targetVenue && String(m.venue || '').toLowerCase() === targetVenue) {
      venueFor.push(gf);
      venueAgainst.push(ga);
    }
  }

  const xGForAvg = Number.isFinite(Number(teamPerf?.totals?.stats?.xG?.avg))
    ? Number(teamPerf.totals.stats.xG.avg)
    : null;
  const xGAgainstAvg = Number.isFinite(Number(teamPerf?.totals?.opponentStats?.xG?.avg))
    ? Number(teamPerf.totals.opponentStats.xG.avg)
    : null;
  const xGGames = Number(teamPerf?.totals?.stats?.xG?.games ?? allFor.length);

  return {
    totalGames: allFor.length,
    venueGames: venueFor.length,
    allFor,
    allAgainst,
    venueFor,
    venueAgainst,
    xGForAvg,
    xGAgainstAvg,
    hasXG: xGForAvg !== null && xGAgainstAvg !== null && xGGames >= 5
  };
}

/**
 * Factor de ajuste acotado por días de descanso y densidad de calendario.
 * Rango seguro [0.94, 1.03] para evitar sobre-ajuste.
 */
function computeRestFactor(daysSinceLastMatch) {
  const d = Number(daysSinceLastMatch);
  if (!Number.isFinite(d) || d <= 0) return 1.0;
  if (d <= 2) return 0.94;
  if (d === 3) return 0.97;
  if (d >= 4 && d <= 8) return 1.0;
  if (d > 14) return 0.99; // ligera pérdida de ritmo tras parón largo
  return 1.01;
}

/**
 * Factor de ajuste conservador por ausencias confirmadas (getTeamNews con coverage === 'ok').
 * Solo penaliza si hay bajas confirmadas (out); nunca asume "0 bajas" si coverage !== 'ok'.
 */
function computeAbsencesFactor(teamNewsSide) {
  if (!teamNewsSide || teamNewsSide.coverage !== 'ok') {
    return { attackFactor: 1.0, defenseFactor: 1.0, coverage: teamNewsSide?.coverage || 'noData', outCount: null };
  }
  const players = Array.isArray(teamNewsSide.players) ? teamNewsSide.players : [];
  const outPlayers = players.filter(p => String(p.status || '').toLowerCase() === 'out');
  const outForwardsMid = outPlayers.filter(p => ['F', 'M'].includes(String(p.position || '').toUpperCase())).length;
  const outDefGk = outPlayers.filter(p => ['D', 'G'].includes(String(p.position || '').toUpperCase())).length;

  const attackFactor = clamp(1 - outForwardsMid * 0.025, 0.88, 1.0);
  const defenseFactor = clamp(1 + outDefGk * 0.025, 1.0, 1.12); // >1 concede más goles esperados

  return {
    attackFactor: round(attackFactor, 4),
    defenseFactor: round(defenseFactor, 4),
    coverage: 'ok',
    outCount: outPlayers.length
  };
}

/**
 * Factor tau(x, y, lambda, mu, rho) de Dixon-Coles (1997) para corregir la subestimación de empates 0-0 / 1-1.
 */
function dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho = DEFAULT_DIXON_COLES_RHO) {
  if (homeGoals === 0 && awayGoals === 0) return Math.max(0.01, 1 - lambdaHome * lambdaAway * rho);
  if (homeGoals === 0 && awayGoals === 1) return Math.max(0.01, 1 + lambdaHome * rho);
  if (homeGoals === 1 && awayGoals === 0) return Math.max(0.01, 1 + lambdaAway * rho);
  if (homeGoals === 1 && awayGoals === 1) return Math.max(0.01, 1 - rho);
  return 1.0;
}

/**
 * Construye la matriz de probabilidad de marcadores P(G_home = i, G_away = j) normalizada a suma exacta 1.0.
 */
function buildScoreMatrix(lambdaHome, lambdaAway, rho = DEFAULT_DIXON_COLES_RHO, maxGoals = MAX_GOALS_GRID) {
  const matrix = [];
  let totalMass = 0;

  for (let i = 0; i <= maxGoals; i++) {
    const pHome = v2Math.poissonPmf(lambdaHome, i);
    const row = [];
    for (let j = 0; j <= maxGoals; j++) {
      const pAway = v2Math.poissonPmf(lambdaAway, j);
      const tau = dixonColesTau(i, j, lambdaHome, lambdaAway, rho);
      const val = Math.max(0, pHome * pAway * tau);
      row.push(val);
      totalMass += val;
    }
    matrix.push(row);
  }

  // Normalización exacta para que la suma sobre la grilla sea 1.000000
  if (totalMass > 0) {
    for (let i = 0; i <= maxGoals; i++) {
      for (let j = 0; j <= maxGoals; j++) {
        matrix[i][j] = matrix[i][j] / totalMass;
      }
    }
  }

  return matrix;
}

/**
 * Deriva TODOS los mercados de resultado y goles de forma 100% coherente desde la misma matriz de marcadores.
 */
function deriveMarketsFromScoreMatrix(matrix) {
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pBttsYes = 0;
  const totalGoalProbs = new Map();
  const homeGoalProbs = new Map();
  const awayGoalProbs = new Map();

  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      const p = matrix[i][j];
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;

      if (i > 0 && j > 0) pBttsYes += p;

      const tot = i + j;
      totalGoalProbs.set(tot, (totalGoalProbs.get(tot) || 0) + p);
      homeGoalProbs.set(i, (homeGoalProbs.get(i) || 0) + p);
      awayGoalProbs.set(j, (awayGoalProbs.get(j) || 0) + p);
    }
  }

  // Normalización final estricta 1X2 (garantiza suma exacta = 1)
  const sum1x2 = pHome + pDraw + pAway;
  pHome = pHome / sum1x2;
  pDraw = pDraw / sum1x2;
  pAway = pAway / sum1x2;

  // Doble Oportunidad derivada directamente (nunca independiente)
  const p1X = pHome + pDraw;
  const pX2 = pDraw + pAway;
  const p12 = pHome + pAway;

  // Helper Over/Under exacto sobre distribución discreta (soporta X.5 y enteras X.0 con push)
  const evalOverUnder = (distMap, line) => {
    const parsed = v2Math.parseLine(`Over ${line}`, line, 'over');
    let pUnder = 0;
    let pPush = 0;
    let pOver = 0;
    for (const [k, prob] of distMap.entries()) {
      if (parsed.hasPush && k === parsed.pushK) pPush += prob;
      else if (k >= parsed.kOverMin) pOver += prob;
      else pUnder += prob;
    }
    const nonPush = Math.max(1e-12, 1 - pPush);
    return {
      line: parsed.numericLine,
      pOver: round(pOver, 6),
      pUnder: round(pUnder, 6),
      pPush: round(pPush, 6),
      pOverNoPush: round(pOver / nonPush, 6),
      pUnderNoPush: round(pUnder / nonPush, 6)
    };
  };

  // Helper Hándicap Asiático para el local (ej. -0.5, -1.0, +0.5, 0.0)
  const evalAsianHandicapHome = (handicap) => {
    const h = Number(handicap);
    let pWin = 0;
    let pPush = 0;
    let pLoss = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        const diff = (i - j) + h;
        if (Math.abs(diff) < 1e-9) pPush += matrix[i][j];
        else if (diff > 0) pWin += matrix[i][j];
        else pLoss += matrix[i][j];
      }
    }
    const nonPush = Math.max(1e-12, 1 - pPush);
    return {
      handicap: h,
      pWin: round(pWin, 6),
      pPush: round(pPush, 6),
      pLoss: round(pLoss, 6),
      pWinNoPush: round(pWin / nonPush, 6),
      pLossNoPush: round(pLoss / nonPush, 6)
    };
  };

  return {
    matchResult1X2: {
      home: round(pHome, 6),
      draw: round(pDraw, 6),
      away: round(pAway, 6),
      sumCheck: round(pHome + pDraw + pAway, 6)
    },
    doubleChance: {
      '1X': round(p1X, 6),
      'X2': round(pX2, 6),
      '12': round(p12, 6)
    },
    btts: {
      yes: round(pBttsYes, 6),
      no: round(1 - pBttsYes, 6)
    },
    totalGoals: {
      '1.5': evalOverUnder(totalGoalProbs, 1.5),
      '2.0': evalOverUnder(totalGoalProbs, 2.0),
      '2.5': evalOverUnder(totalGoalProbs, 2.5),
      '3.5': evalOverUnder(totalGoalProbs, 3.5)
    },
    teamGoals: {
      homeOver0_5: evalOverUnder(homeGoalProbs, 0.5),
      homeOver1_5: evalOverUnder(homeGoalProbs, 1.5),
      awayOver0_5: evalOverUnder(awayGoalProbs, 0.5),
      awayOver1_5: evalOverUnder(awayGoalProbs, 1.5)
    },
    asianHandicapHome: {
      '-1.5': evalAsianHandicapHome(-1.5),
      '-1.0': evalAsianHandicapHome(-1.0),
      '-0.5': evalAsianHandicapHome(-0.5),
      '0.0': evalAsianHandicapHome(0.0),
      '+0.5': evalAsianHandicapHome(0.5)
    }
  };
}

/**
 * Devig exacto 3-way (1X2) por normalización proporcional.
 * Requiere las 3 cuotas > 1.0 para remover el margen (overround) de la casa.
 */
function devig3Way(homeOdds, drawOdds, awayOdds) {
  const h = Number(homeOdds);
  const d = Number(drawOdds);
  const a = Number(awayOdds);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a) || h <= 1 || d <= 1 || a <= 1) {
    return { available: false, reason: 'CUOTAS_3WAY_INCOMPLETAS', overround: null, probs: null };
  }
  const impH = 1 / h;
  const impD = 1 / d;
  const impA = 1 / a;
  const overround = impH + impD + impA;
  const pH = impH / overround;
  const pD = impD / overround;
  const pA = impA / overround;

  return {
    available: true,
    method: 'exact_3way_proportional',
    overround: round(overround, 4),
    marginPct: round((overround - 1) * 100, 2),
    impliedRaw: { home: round(impH, 6), draw: round(impD, 6), away: round(impA, 6) },
    probs: { home: round(pH, 6), draw: round(pD, 6), away: round(pA, 6) },
    doubleChanceNoVig: {
      '1X': round(pH + pD, 6),
      'X2': round(pD + pA, 6),
      '12': round(pH + pA, 6)
    }
  };
}

/**
 * Filtra filas contaminadas en getMatchOdds(movement: true).
 * StatsHub advierte explícitamente warning: "first-half prices mixed in".
 */
function parseCleanPriceMovement(movementPayload, selection = null) {
  const rows = Array.isArray(movementPayload?.rows) ? movementPayload.rows : [];
  const cleanRows = [];
  let discardedCount = 0;

  for (const r of rows) {
    if (selection && String(r.selection || '').toLowerCase() !== String(selection).toLowerCase()) {
      continue;
    }
    const warn = String(r.warning || '').toLowerCase();
    if (warn.includes('first-half prices mixed in')) {
      discardedCount++;
      continue;
    }
    const opening = Number(r.opening ?? r.firstSeen);
    const current = Number(r.nowOnScreen ?? r.current);
    if (!Number.isFinite(opening) || !Number.isFinite(current) || opening <= 1 || current <= 1) {
      discardedCount++;
      continue;
    }
    const pct = round(((current - opening) / opening) * 100, 2);
    cleanRows.push({
      bookmaker: r.bookmaker,
      selection: r.selection,
      opening,
      current,
      changePct: pct,
      direction: current < opening ? 'shortened' : (current > opening ? 'drifted' : 'unchanged'),
      lastMove: r.lastMove || null
    });
  }

  const avgChangePct = cleanRows.length > 0
    ? round(cleanRows.reduce((acc, x) => acc + x.changePct, 0) / cleanRows.length, 2)
    : null;

  return {
    available: cleanRows.length > 0,
    cleanCount: cleanRows.length,
    discardedCorruptCount: discardedCount,
    avgChangePct,
    rows: cleanRows
  };
}

/**
 * Calcula EV y comparación contra cuota implícita bruta y no-vig para una selección dada.
 * Nunca confunde probabilidad alta con EV positivo.
 */
function evaluateSelectionPricing({ selection, marketFamily, modelProb, bookmakerOdds, noVigProb = null, pPush = 0 }) {
  const p = Number(modelProb);
  const odds = Number(bookmakerOdds);
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !Number.isFinite(odds) || odds <= 1) {
    return {
      selection,
      marketFamily,
      available: false,
      reason: 'DATOS_PRECIO_O_PROBABILIDAD_INVALIDOS'
    };
  }
  const impliedProb = 1 / odds;
  // Con soporte de push: EV = p_win * (odds - 1) - p_loss
  const pLoss = Math.max(0, 1 - p - (Number(pPush) || 0));
  const ev = p * (odds - 1) - pLoss;
  const edgeVsImplied = p - impliedProb;
  const edgeVsNoVig = Number.isFinite(Number(noVigProb)) ? p - Number(noVigProb) : null;

  return {
    selection,
    marketFamily,
    available: true,
    bookmakerOdds: round(odds, 3),
    modelProb: round(p, 6),
    impliedProb: round(impliedProb, 6),
    noVigProb: Number.isFinite(Number(noVigProb)) ? round(Number(noVigProb), 6) : null,
    fairOdds: round(1 / p, 3),
    ev: round(ev, 6),
    evPct: round(ev * 100, 2),
    edgeVsImpliedPct: round(edgeVsImplied * 100, 2),
    edgeVsNoVigPct: edgeVsNoVig !== null ? round(edgeVsNoVig * 100, 2) : null,
    hasPositiveEV: ev > 0
  };
}

/**
 * Evalúa un partido completo a partir de los datos reales de StatsHub (getTeamPerformance + getTeamNews + getMatchOdds).
 * Devuelve lambdas, matriz de marcadores, probabilidades 1X2, Doble Oportunidad, BTTS, Goles, AH y pricing EV.
 */
function predictMatchOutcomes({
  matchId = null,
  match = '',
  league = '',
  homeTeamPerf,
  awayTeamPerf,
  homeTeamNews = null,
  awayTeamNews = null,
  homeDaysRest = null,
  awayDaysRest = null,
  leagueAvgHome = DEFAULT_LEAGUE_AVG_GOALS_HOME,
  leagueAvgAway = DEFAULT_LEAGUE_AVG_GOALS_AWAY,
  odds1X2 = null,       // { home, draw, away }
  oddsDoubleChance = null, // { '1X', 'X2', '12' }
  minSampleGames = 8,
  rho = DEFAULT_DIXON_COLES_RHO
}) {
  const homeSeries = extractTeamGoalSeries(homeTeamPerf, 'home');
  const awaySeries = extractTeamGoalSeries(awayTeamPerf, 'away');

  if (homeSeries.totalGames < minSampleGames || awaySeries.totalGames < minSampleGames) {
    return {
      ok: false,
      status: 'DATOS_INSUFICIENTES',
      modelVersion: MODEL_VERSION,
      matchId,
      match,
      league,
      reason: `Muestra histórica insuficiente de goles (Local=${homeSeries.totalGames}, Visitante=${awaySeries.totalGames}, mínimo=${minSampleGames}).`
    };
  }

  // 1. Tasas ponderadas temporalmente (mezcla global + split de localía si hay >= 4 partidos en condición)
  const blendVenue = (allArr, venueArr) => {
    const mAll = weightedMean(allArr);
    const mVenue = venueArr.length >= 4 ? weightedMean(venueArr) : null;
    if (mVenue !== null && mAll !== null) {
      const wVenue = Math.min(0.60, venueArr.length / 10);
      return mVenue * wVenue + mAll * (1 - wVenue);
    }
    return mAll;
  };

  let homeAttackRate = blendVenue(homeSeries.allFor, homeSeries.venueFor);
  let homeDefenseRate = blendVenue(homeSeries.allAgainst, homeSeries.venueAgainst);
  let awayAttackRate = blendVenue(awaySeries.allFor, awaySeries.venueFor);
  let awayDefenseRate = blendVenue(awaySeries.allAgainst, awaySeries.venueAgainst);

  // 2. Integración con xG cuando está disponible (55% xG + 45% goles reales ponderados)
  if (homeSeries.hasXG) {
    homeAttackRate = 0.55 * homeSeries.xGForAvg + 0.45 * homeAttackRate;
    homeDefenseRate = 0.55 * homeSeries.xGAgainstAvg + 0.45 * homeDefenseRate;
  }
  if (awaySeries.hasXG) {
    awayAttackRate = 0.55 * awaySeries.xGForAvg + 0.45 * awayAttackRate;
    awayDefenseRate = 0.55 * awaySeries.xGAgainstAvg + 0.45 * awayDefenseRate;
  }

  // 3. Fuerza relativa respecto a promedios de liga
  const leagueAvgTotal = (leagueAvgHome + leagueAvgAway) / 2;
  const homeAttackStrength = homeAttackRate / leagueAvgTotal;
  const homeDefenseWeakness = homeDefenseRate / leagueAvgTotal;
  const awayAttackStrength = awayAttackRate / leagueAvgTotal;
  const awayDefenseWeakness = awayDefenseRate / leagueAvgTotal;

  // 4. Descanso y ausencias confirmadas
  const homeRest = computeRestFactor(homeDaysRest);
  const awayRest = computeRestFactor(awayDaysRest);
  const homeAbs = computeAbsencesFactor(homeTeamNews);
  const awayAbs = computeAbsencesFactor(awayTeamNews);

  const lambdaHome = clamp(
    leagueAvgHome * homeAttackStrength * awayDefenseWeakness * homeRest * homeAbs.attackFactor * awayAbs.defenseFactor,
    MIN_LAMBDA,
    MAX_LAMBDA
  );
  const lambdaAway = clamp(
    leagueAvgAway * awayAttackStrength * homeDefenseWeakness * awayRest * awayAbs.attackFactor * homeAbs.defenseFactor,
    MIN_LAMBDA,
    MAX_LAMBDA
  );

  // 5. Matriz Dixon-Coles y derivación coherente de todos los mercados
  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, rho);
  const derived = deriveMarketsFromScoreMatrix(matrix);

  // 6. Devig 3-way y evaluación de EV para 1X2 y Doble Oportunidad
  const devig1X2 = odds1X2 ? devig3Way(odds1X2.home, odds1X2.draw, odds1X2.away) : { available: false };

  const pricing1X2 = odds1X2 ? {
    '1': evaluateSelectionPricing({
      selection: '1',
      marketFamily: 'match_1x2',
      modelProb: derived.matchResult1X2.home,
      bookmakerOdds: odds1X2.home,
      noVigProb: devig1X2.probs?.home ?? null
    }),
    'X': evaluateSelectionPricing({
      selection: 'X',
      marketFamily: 'match_1x2',
      modelProb: derived.matchResult1X2.draw,
      bookmakerOdds: odds1X2.draw,
      noVigProb: devig1X2.probs?.draw ?? null
    }),
    '2': evaluateSelectionPricing({
      selection: '2',
      marketFamily: 'match_1x2',
      modelProb: derived.matchResult1X2.away,
      bookmakerOdds: odds1X2.away,
      noVigProb: devig1X2.probs?.away ?? null
    })
  } : null;

  const pricingDoubleChance = oddsDoubleChance ? {
    '1X': evaluateSelectionPricing({
      selection: '1X',
      marketFamily: 'double_chance',
      modelProb: derived.doubleChance['1X'],
      bookmakerOdds: oddsDoubleChance['1X'],
      noVigProb: devig1X2.doubleChanceNoVig?.['1X'] ?? null
    }),
    'X2': evaluateSelectionPricing({
      selection: 'X2',
      marketFamily: 'double_chance',
      modelProb: derived.doubleChance['X2'],
      bookmakerOdds: oddsDoubleChance['X2'],
      noVigProb: devig1X2.doubleChanceNoVig?.['X2'] ?? null
    }),
    '12': evaluateSelectionPricing({
      selection: '12',
      marketFamily: 'double_chance',
      modelProb: derived.doubleChance['12'],
      bookmakerOdds: oddsDoubleChance['12'],
      noVigProb: devig1X2.doubleChanceNoVig?.['12'] ?? null
    })
  } : null;

  // 7. Índice de calidad de datos (0..1)
  const sampleScore = clamp(Math.min(homeSeries.totalGames, awaySeries.totalGames) / 20, 0.3, 1.0);
  const xgBonus = (homeSeries.hasXG && awaySeries.hasXG) ? 0.15 : 0;
  const venueBonus = (homeSeries.venueGames >= 5 && awaySeries.venueGames >= 5) ? 0.10 : 0;
  const newsBonus = (homeAbs.coverage === 'ok' && awayAbs.coverage === 'ok') ? 0.05 : 0;
  const dataQualityScore = round(clamp(sampleScore * 0.70 + xgBonus + venueBonus + newsBonus, 0, 1), 3);

  return {
    ok: true,
    status: 'EVALUADO',
    modelVersion: MODEL_VERSION,
    matchId,
    match,
    league,
    parameters: {
      lambdaHome: round(lambdaHome, 4),
      lambdaAway: round(lambdaAway, 4),
      rho,
      homeSampleGames: homeSeries.totalGames,
      awaySampleGames: awaySeries.totalGames,
      homeVenueGames: homeSeries.venueGames,
      awayVenueGames: awaySeries.venueGames,
      usedXG: homeSeries.hasXG && awaySeries.hasXG,
      restFactors: { home: homeRest, away: awayRest },
      absences: { home: homeAbs, away: awayAbs }
    },
    dataQuality: {
      score: dataQualityScore,
      tier: dataQualityScore >= 0.85 ? 'ALTA' : (dataQualityScore >= 0.65 ? 'MEDIA' : 'BAJA'),
      hasXG: homeSeries.hasXG && awaySeries.hasXG,
      hasVenueSplit: homeSeries.venueGames >= 4 && awaySeries.venueGames >= 4,
      hasTeamNews: homeAbs.coverage === 'ok' && awayAbs.coverage === 'ok'
    },
    probabilities: derived,
    marketDevig1X2: devig1X2,
    pricing: {
      match_1x2: pricing1X2,
      double_chance: pricingDoubleChance
    },
    evaluatedAt: new Date().toISOString()
  };
}

module.exports = {
  MODEL_VERSION,
  weightedMean,
  extractTeamGoalSeries,
  computeRestFactor,
  computeAbsencesFactor,
  dixonColesTau,
  buildScoreMatrix,
  deriveMarketsFromScoreMatrix,
  devig3Way,
  parseCleanPriceMovement,
  evaluateSelectionPricing,
  predictMatchOutcomes
};
