/**
 * SHADOW FEATURE & CLV COLLECTOR (EXPERIMENTAL — SHADOW MODE ONLY)
 * Fase 2.2: Recolecta features pre-partido, cuotas (apertura, aprobación, cierre T-5 min),
 * mercado 1X2, hándicap, árbitro, minutos por partido, splits local/visitante y ventanas L5/L10/L20.
 *
 * Garantías de integridad:
 * - Almacenamiento 100% aislado en engine/storage_data/shadow_observations_v2.json.
 * - NUNCA modifica model_observation_registry.json, historial_picks.json, picks_hoy.json ni approved_picks.json.
 * - NUNCA fabrica datos faltantes como reales: todo campo ausente queda en null con flag en dataAvailability.
 * - Temporal Guard estricto: rechaza observaciones pre-partido con observedAt >= kickoffUtc.
 * - Deduplicación por pickId y clave de evento (matchId + playerOrTeam + market + line).
 */

const fs = require('fs');
const path = require('path');
const engineV2 = require('./predictionEngineV2');

const DEFAULT_LEDGER_PATH = path.resolve(__dirname, '..', 'storage_data', 'shadow_observations_v2.json');

function toFiniteOrNull(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function computeWindowSummary(values, parsedLine, windowSize) {
  if (!Array.isArray(values) || values.length < windowSize) return null;
  const slice = values.slice(0, windowSize).map(Number).filter(Number.isFinite);
  if (slice.length < windowSize) return null;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.length > 1
    ? slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (slice.length - 1)
    : null;
  const hits = slice.filter(v => (parsedLine.side === 'under' ? v <= parsedLine.kUnderMax : v >= parsedLine.kOverMin)).length;
  const nonPush = parsedLine.hasPush ? slice.filter(v => v !== parsedLine.pushK).length : slice.length;
  return {
    n: slice.length,
    hits,
    hitRate: nonPush > 0 ? Number((hits / nonPush).toFixed(4)) : null,
    mean: Number(mean.toFixed(4)),
    variance: variance !== null ? Number(variance.toFixed(4)) : null
  };
}

function compute1X2NoVig(homeOdds, drawOdds, awayOdds) {
  const h = toFiniteOrNull(homeOdds);
  const d = toFiniteOrNull(drawOdds);
  const a = toFiniteOrNull(awayOdds);
  if (!h || !d || !a || h <= 1 || d <= 1 || a <= 1) {
    return {
      homeOdds: h,
      drawOdds: d,
      awayOdds: a,
      noVigHome: null,
      noVigDraw: null,
      noVigAway: null,
      overround: null,
      available: false
    };
  }
  const sum = (1 / h) + (1 / d) + (1 / a);
  return {
    homeOdds: h,
    drawOdds: d,
    awayOdds: a,
    noVigHome: Number(((1 / h) / sum).toFixed(4)),
    noVigDraw: Number(((1 / d) / sum).toFixed(4)),
    noVigAway: Number(((1 / a) / sum).toFixed(4)),
    overround: Number(sum.toFixed(4)),
    available: true
  };
}

class ShadowFeatureCollector {
  constructor(ledgerPath = DEFAULT_LEDGER_PATH) {
    this.ledgerPath = ledgerPath;
  }

  _readAll() {
    if (!fs.existsSync(this.ledgerPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  _writeAll(records) {
    const dir = path.dirname(this.ledgerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.ledgerPath, JSON.stringify(records, null, 2), 'utf8');
  }

  buildEventKey(pick) {
    const m = String(pick.matchId || pick.match || '').trim().toLowerCase();
    const p = String(pick.playerId || pick.teamId || pick.playerOrTeam || pick.player || '').trim().toLowerCase();
    const mkt = String(pick.market || '').trim().toLowerCase();
    const ln = String(pick.line || '').trim().toLowerCase();
    return `${m}__${p}__${mkt}__${ln}`;
  }

  /**
   * Registra una observación pre-partido en Shadow Mode con todas las features y disponibilidad real.
   * Rechaza observaciones si observedAt >= kickoffUtc (protección estricta contra fuga temporal).
   */
  recordPreMatchObservation(payload) {
    const observedAt = payload.observedAt || new Date().toISOString();
    const kickoffUtc = payload.kickoffUtc || payload.eventDate || null;

    // Temporal Guard: impedir registros pre-partido con fecha/hora posterior al inicio del partido
    if (kickoffUtc) {
      const obsMs = Date.parse(observedAt);
      const koMs = Date.parse(kickoffUtc);
      if (Number.isFinite(obsMs) && Number.isFinite(koMs) && obsMs >= koMs) {
        return {
          recorded: false,
          reason: 'TEMPORAL_LEAKAGE_BLOCKED',
          message: `Observación (${observedAt}) no es anterior al inicio del partido (${kickoffUtc}).`
        };
      }
    }

    const records = this._readAll();
    const eventKey = this.buildEventKey(payload);
    const existing = records.find(r => r.pickId === payload.pickId || (payload.matchId && r.eventKey === eventKey));
    if (existing) {
      return { recorded: false, reason: 'DUPLICATE_PREVENTED', pickId: existing.pickId };
    }

    const parsedLine = engineV2.parseLine(payload.line, payload.rawLine, payload.side || payload.oddsType);

    // Cuotas y probabilidad sin vig
    const openingOdds = toFiniteOrNull(payload.openingOdds);
    const approvalOdds = toFiniteOrNull(payload.approvalOdds ?? payload.bookmakerOdds ?? payload.odds);
    const overOdds = toFiniteOrNull(payload.overOdds ?? (parsedLine.side === 'over' ? approvalOdds : null));
    const underOdds = toFiniteOrNull(payload.underOdds ?? (parsedLine.side === 'under' ? approvalOdds : null));
    const oppositeOdds = parsedLine.side === 'over' ? underOdds : overOdds;
    const noVig = engineV2.computeNoVigProb(approvalOdds, oppositeOdds);

    // Mercado 1X2 y Hándicap (null si no provistos — nunca inventados)
    const market1X2 = compute1X2NoVig(
      payload.market1X2?.homeOdds,
      payload.market1X2?.drawOdds,
      payload.market1X2?.awayOdds
    );
    const handicap = {
      line: toFiniteOrNull(payload.handicap?.line),
      homeOdds: toFiniteOrNull(payload.handicap?.homeOdds),
      awayOdds: toFiniteOrNull(payload.handicap?.awayOdds),
      source: payload.handicap?.source || null,
      available: payload.handicap?.line !== undefined && payload.handicap?.line !== null
    };

    // Árbitro
    const referee = {
      id: payload.referee?.id || null,
      name: payload.referee?.name || null,
      avgCardsPerGame: toFiniteOrNull(payload.referee?.avgCardsPerGame),
      avgFoulsPerGame: toFiniteOrNull(payload.referee?.avgFoulsPerGame),
      source: payload.referee?.source || null,
      available: Boolean(payload.referee?.name || payload.referee?.id)
    };

    // Minutos jugados por partido, titularidad y posición
    const minutesHistory = Array.isArray(payload.minutesPerMatch)
      ? payload.minutesPerMatch.map(toFiniteOrNull).filter(v => v !== null)
      : null;
    const avgMinutes = minutesHistory && minutesHistory.length > 0
      ? Number((minutesHistory.reduce((a, b) => a + b, 0) / minutesHistory.length).toFixed(1))
      : toFiniteOrNull(payload.avgMinutes);

    const playerContext = {
      isTeamProp: Boolean(payload.isTeamProp),
      minutesPerMatch: minutesHistory,
      avgMinutes,
      expectedMinutes: toFiniteOrNull(payload.expectedMinutes),
      lineupStatus: payload.lineupStatus || 'UNKNOWN',
      isStarter: typeof payload.isStarter === 'boolean' ? payload.isStarter : null,
      position: payload.position || null
    };

    // Ventanas estadísticas L5, L10, L20 y splits local/visitante
    const histVals = Array.isArray(payload.historicalValues) ? payload.historicalValues : [];
    const statWindows = {
      L5: computeWindowSummary(histVals, parsedLine, 5),
      L10: computeWindowSummary(histVals, parsedLine, 10),
      L20: computeWindowSummary(histVals, parsedLine, 20),
      splits: {
        home: payload.splits?.home ? {
          n: toFiniteOrNull(payload.splits.home.n),
          mean: toFiniteOrNull(payload.splits.home.mean),
          hitRate: toFiniteOrNull(payload.splits.home.hitRate)
        } : null,
        away: payload.splits?.away ? {
          n: toFiniteOrNull(payload.splits.away.n),
          mean: toFiniteOrNull(payload.splits.away.mean),
          hitRate: toFiniteOrNull(payload.splits.away.hitRate)
        } : null
      }
    };

    // Predicción experimental V2 (Shadow Only)
    const v2Pred = histVals.length > 0
      ? engineV2.predictCandidate({
          ...payload,
          id: payload.pickId,
          bookmakerOdds: approvalOdds,
          oppositeOdds,
          historicalValues: histVals,
          avgMinutesPlayed: avgMinutes,
          minutesExpected: playerContext.expectedMinutes
        })
      : null;

    const record = {
      schemaVersion: 'shadow-v2.2',
      shadowMode: true,
      isOperativeRecommendation: false,
      pickId: payload.pickId,
      eventKey,
      matchId: payload.matchId || null,
      competition: payload.competition || null,
      match: payload.match || null,
      kickoffUtc,
      observedAt,
      source: payload.source || 'StatsHub MCP',
      playerOrTeam: payload.playerOrTeam || payload.player || null,
      market: payload.market || null,
      line: payload.line || null,
      side: parsedLine.side,

      oddsSnapshot: {
        bookmaker: payload.bookmaker || null,
        openingOdds,
        openingCapturedAt: openingOdds ? (payload.openingCapturedAt || observedAt) : null,
        approvalOdds,
        approvalCapturedAt: approvalOdds ? observedAt : null,
        overOdds,
        underOdds,
        marketNoVigProb: noVig.prob,
        noVigMethod: noVig.method,
        overround: noVig.overround,
        closingOdds: null,
        closingOppositeOdds: null,
        closingNoVigProb: null,
        closingCapturedAt: null,
        closingMinutesBeforeKickoff: null,
        clvOddsPct: null,
        clvProbPp: null
      },

      matchContext: {
        market1X2,
        handicap,
        referee
      },

      playerContext,
      statWindows,

      predictions: {
        referenceEngineV1: payload.referenceEngineV1 || null,
        experimentalEngineV2: v2Pred
      },

      dataAvailability: {
        openingOdds: openingOdds !== null,
        approvalOdds: approvalOdds !== null,
        twoWayOddsForExactNoVig: overOdds !== null && underOdds !== null,
        closingOdds: false,
        market1X2: market1X2.available,
        handicap: handicap.available,
        referee: referee.available,
        minutesPerMatch: Boolean(minutesHistory && minutesHistory.length > 0),
        position: Boolean(playerContext.position),
        windowL5: statWindows.L5 !== null,
        windowL10: statWindows.L10 !== null,
        windowL20: statWindows.L20 !== null,
        homeAwaySplits: Boolean(statWindows.splits.home || statWindows.splits.away)
      }
    };

    records.push(record);
    this._writeAll(records);
    return { recorded: true, pickId: record.pickId, record };
  }

  /**
   * Captura cuota de cierre (idealmente a T-5 min) y calcula CLV real sin alterar los datos de apertura/aprobación.
   */
  recordClosingOdds(pickId, { closingOdds, closingOppositeOdds = null, capturedAt = null, source = 'StatsHub MCP' }) {
    const records = this._readAll();
    const rec = records.find(r => r.pickId === pickId);
    if (!rec) return { updated: false, reason: 'PICK_NOT_FOUND' };

    const ts = capturedAt || new Date().toISOString();
    if (rec.kickoffUtc) {
      const capMs = Date.parse(ts);
      const koMs = Date.parse(rec.kickoffUtc);
      if (Number.isFinite(capMs) && Number.isFinite(koMs) && capMs > koMs) {
        return { updated: false, reason: 'CLOSING_ODDS_AFTER_KICKOFF_BLOCKED' };
      }
      rec.oddsSnapshot.closingMinutesBeforeKickoff = Number(((koMs - capMs) / 60000).toFixed(1));
    }

    const cOdds = toFiniteOrNull(closingOdds);
    if (!cOdds || cOdds <= 1) return { updated: false, reason: 'INVALID_CLOSING_ODDS' };

    const cOpp = toFiniteOrNull(closingOppositeOdds);
    const closingNoVig = engineV2.computeNoVigProb(cOdds, cOpp);

    rec.oddsSnapshot.closingOdds = cOdds;
    rec.oddsSnapshot.closingOppositeOdds = cOpp;
    rec.oddsSnapshot.closingNoVigProb = closingNoVig.prob;
    rec.oddsSnapshot.closingCapturedAt = ts;
    rec.oddsSnapshot.closingSource = source;

    if (rec.oddsSnapshot.approvalOdds) {
      rec.oddsSnapshot.clvOddsPct = Number((((rec.oddsSnapshot.approvalOdds / cOdds) - 1) * 100).toFixed(2));
    }
    if (closingNoVig.prob !== null && rec.oddsSnapshot.marketNoVigProb !== null) {
      rec.oddsSnapshot.clvProbPp = Number(((closingNoVig.prob - rec.oddsSnapshot.marketNoVigProb) * 100).toFixed(2));
    }

    rec.dataAvailability.closingOdds = true;
    this._writeAll(records);
    return { updated: true, pickId, clvOddsPct: rec.oddsSnapshot.clvOddsPct, clvProbPp: rec.oddsSnapshot.clvProbPp };
  }
}

module.exports = new ShadowFeatureCollector();
module.exports.ShadowFeatureCollector = ShadowFeatureCollector;
