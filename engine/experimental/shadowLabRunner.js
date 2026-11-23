/**
 * SHADOW LAB RUNNER (FASE 2.3 — SHADOW MODE PARALELO EN VIVO)
 * Evalúa exactamente el mismo evento, mercado, línea y momento de observación en 6 modelos:
 *   1. v1_production  (Motor productivo actual — solo lectura, sin efectos colaterales)
 *   2. v2_corrected   (Motor matemático corregido V2 — Lanczos, Over/Under, Shrinkage)
 *   3. model_b        (Empírico L10)
 *   4. model_c        (Empírico L15/L20)
 *   5. beta_binomial  (Shrinkage Beta-Binomial sobre Model C anclado a pNoVig)
 *   6. ensemble_v2    (Ensemble dinámico ponderado por muestra n + NB + pNoVig)
 *
 * Garantías de integridad:
 * - Almacenamiento aislado en engine/storage_data/shadow_lab_v2_3.json.
 * - Sello criptográfico SHA-256 inmutable sobre el bloque pre-partido (preMatchHash).
 * - Guarda temporal estricta: rechaza cualquier dato con timestamp >= kickoffUtc.
 * - Deduplicación estricta por pickId y eventKey.
 * - La liquidación (WON/LOST/VOID) nunca modifica las probabilidades pre-partido.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const v1Engine = require('../prediction/predictionEngine');
const v2Engine = require('./predictionEngineV2');

const DEFAULT_LAB_LEDGER = path.resolve(__dirname, '..', 'storage_data', 'shadow_lab_v2_3.json');
const MIN_ENSEMBLE_PROB = 0.03;
const MAX_ENSEMBLE_PROB = 0.94;

// Umbrales mínimos de muestra por modelo y por tipo de mercado (Fase 2.3.1)
const MIN_SAMPLE_BY_MODEL = {
  v1_production: 8,
  v2_corrected: 8,
  model_b: 5,
  model_c: 15,
  beta_binomial: 5,
  ensemble_v2: 8
};

const MIN_SAMPLE_BY_MARKET = {
  'remates totales': 8,
  'remates al arco': 8,
  'entradas (tackles)': 8,
  'faltas cometidas': 8,
  'faltas ganadas': 8,
  'faltas recibidas': 8,
  'remates de equipo': 10,
  'remates al arco de equipo': 10,
  'córners de equipo': 10,
  'goles de equipo': 10,
  'tarjetas de equipo': 10,
  'tarjetas': 10
};

function getMinSampleFor(modelKey, market) {
  const mBase = MIN_SAMPLE_BY_MODEL[modelKey] ?? 8;
  const mktMin = MIN_SAMPLE_BY_MARKET[String(market || '').toLowerCase()] ?? 8;
  // Para Model B y Beta-Binomial respetamos su mínimo de modelo si es menor; para los demás el mayor de ambos
  if (modelKey === 'model_b' || modelKey === 'beta_binomial') return mBase;
  return Math.max(mBase, mktMin);
}

function toFiniteOrNull(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function sha256Of(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

class ShadowLabRunner {
  constructor(ledgerPath = DEFAULT_LAB_LEDGER) {
    this.ledgerPath = ledgerPath;
    this.schemaVersion = 'shadow-lab-v2.3';
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

  buildEventKey(payload) {
    const m = String(payload.matchId || payload.match || '').trim().toLowerCase();
    const p = String(payload.playerId || payload.teamId || payload.playerOrTeam || payload.player || '').trim().toLowerCase();
    const mkt = String(payload.market || '').trim().toLowerCase();
    const ln = String(payload.line || '').trim().toLowerCase();
    return `${m}__${p}__${mkt}__${ln}`;
  }

  /**
   * Calcula el Ensemble v2 dinámico (solo Shadow):
   *   w_mkt(n) = max(0.30, 0.55 - 0.01 * min(n, 25))
   *   w_nb     = 0.25
   *   w_bb     = 1 - w_mkt - w_nb
   */
  computeEnsembleV2(pNB, pBB, pNoVig, sampleSize) {
    if (pNB === null || pBB === null || pNoVig === null) {
      return { available: false, prob: null, weights: null, reason: 'Faltan componentes (NB, Beta-Binomial o pNoVig)' };
    }
    const n = Math.max(0, Number(sampleSize) || 0);
    const wMkt = Number(Math.max(0.30, 0.55 - 0.01 * Math.min(n, 25)).toFixed(4));
    const wNB = 0.25;
    const wBB = Number((1 - wMkt - wNB).toFixed(4));
    const raw = wBB * pBB + wNB * pNB + wMkt * pNoVig;
    const prob = Number(Math.min(MAX_ENSEMBLE_PROB, Math.max(MIN_ENSEMBLE_PROB, raw)).toFixed(4));
    return {
      available: true,
      prob,
      weights: { wBB, wNB, wMkt },
      reason: null
    };
  }

  /**
   * Evalúa los 6 modelos en paralelo sobre exactamente el mismo payload pre-partido.
   * Nunca descarta un modelo porque otro haya rechazado; registra disponibilidad y motivo.
   */
  evaluateAllSixModels(payload, approvalOdds, oppositeOdds, noVig) {
    const isTeamProp = Boolean(payload.isTeamProp || String(payload.playerOrTeam || payload.player || '').toLowerCase().includes('(equipo)'));
    const histVals = Array.isArray(payload.historicalValues) ? payload.historicalValues.map(Number).filter(Number.isFinite) : [];

    // 1. Motor actual V1 (solo lectura, sin tocar storage productivo)
    let mV1;
    try {
      const candV1 = {
        id: payload.pickId,
        isTeamProp,
        playerOrTeam: payload.playerOrTeam || payload.player,
        match: payload.match,
        team: payload.team,
        market: payload.market,
        line: payload.line,
        rawLine: payload.rawLine,
        bookmakerOdds: approvalOdds,
        minutesExpected: payload.expectedMinutes,
        researchData: {
          qualityStatus: histVals.length > 0 ? 'COMPLETA' : 'INVESTIGACION_INCOMPLETA',
          playerData: !isTeamProp ? {
            observations: histVals,
            statPer90: payload.statPer90 ?? null,
            avgMinutes: payload.avgMinutes ?? null,
            projectedMinutes: payload.expectedMinutes ?? null,
            validMatches: histVals.length
          } : undefined,
          teamData: isTeamProp ? {
            observations: histVals,
            validMatches: histVals.length
          } : undefined,
          opponentData: payload.opponentConcessionRatio ? { isAvailable: true, concessionRatio: payload.opponentConcessionRatio } : undefined,
          lineupData: { status: payload.lineupStatus || 'PROBABLE' }
        }
      };
      const r1 = v1Engine.predictCandidate(candV1);
      if (typeof r1.pProjected === 'number' && Number.isFinite(r1.pProjected)) {
        mV1 = {
          available: true,
          prob: r1.pProjected,
          evPct: approvalOdds ? Number(((r1.pProjected * approvalOdds - 1) * 100).toFixed(2)) : null,
          decisionV1: r1.decision,
          modelApplied: r1.modelApplied,
          reason: null
        };
      } else {
        mV1 = { available: false, prob: null, evPct: null, decisionV1: r1.decision || 'RECHAZADO', reason: r1.decisionReason || 'Sin observaciones históricas en V1' };
      }
    } catch (err) {
      mV1 = { available: false, prob: null, evPct: null, reason: `Error V1: ${err.message}` };
    }

    // 2. Motor corregido V2 + 3. Model B + 4. Model C + 5. Beta-Binomial + 6. Ensemble v2
    let mV2, mB, mC, mBB, mEnsV2;
    if (histVals.length === 0) {
      const noHistReason = 'Ausencia de serie histórica de observaciones (historicalValues vacío)';
      mV2 = { available: false, prob: null, evPct: null, reason: noHistReason };
      mB = { available: false, prob: null, evPct: null, sampleSize: 0, reason: noHistReason };
      mC = { available: false, prob: null, evPct: null, sampleSize: 0, reason: noHistReason };
      mBB = { available: false, prob: null, evPct: null, reason: noHistReason };
      mEnsV2 = { available: false, prob: null, evPct: null, reason: noHistReason };
    } else {
      const r2 = v2Engine.predictCandidate({
        ...payload,
        id: payload.pickId,
        isTeamProp,
        bookmakerOdds: approvalOdds,
        oppositeOdds,
        historicalValues: histVals,
        avgMinutesPlayed: payload.avgMinutes ?? null,
        minutesExpected: payload.expectedMinutes ?? null
      });

      const calcEv = (p) => (p !== null && approvalOdds > 1 ? Number(((p * approvalOdds - 1) * 100).toFixed(2)) : null);
      const nHist = histVals.length;

      // Validar umbral mínimo de muestra por modelo y mercado
      const minV1 = getMinSampleFor('v1_production', payload.market);
      if (mV1.available && nHist < minV1) {
        mV1 = { available: false, prob: null, evPct: null, decisionV1: mV1.decisionV1, reason: `Muestra insuficiente para V1 en ${payload.market} (${nHist} < ${minV1})` };
      }

      const minV2 = getMinSampleFor('v2_corrected', payload.market);
      mV2 = nHist >= minV2 && r2.pShadowCombined !== null && r2.pShadowCombined !== undefined
        ? {
            available: true,
            prob: r2.pShadowCombined,
            evPct: calcEv(r2.pShadowCombined),
            parametricModel: r2.parametric?.modelUsed || null,
            pParametric: r2.parametric?.pSelected ?? null,
            dispersionPhi: r2.parametric?.dispersionPhi ?? null,
            reason: null
          }
        : {
            available: false,
            prob: null,
            evPct: null,
            reason: nHist < minV2 ? `Muestra insuficiente para V2 en ${payload.market} (${nHist} < ${minV2})` : (r2.error || 'V2 no disponible')
          };

      const minB = getMinSampleFor('model_b', payload.market);
      const bRaw = r2.models?.modelB?.pRaw ?? null;
      const bN = r2.models?.modelB?.sampleSize ?? 0;
      mB = bN >= minB && bRaw !== null
        ? { available: true, prob: bRaw, evPct: calcEv(bRaw), window: 'L10', sampleSize: bN, reason: null }
        : { available: false, prob: null, evPct: null, window: 'L10', sampleSize: bN, reason: `Muestra insuficiente para Model B (${bN} < ${minB})` };

      const minC = getMinSampleFor('model_c', payload.market);
      const cRaw = r2.models?.modelC?.pRaw ?? null;
      const cN = r2.models?.modelC?.sampleSize ?? 0;
      mC = cN >= minC && cRaw !== null
        ? { available: true, prob: cRaw, evPct: calcEv(cRaw), window: r2.models.modelC.window, sampleSize: cN, reason: null }
        : { available: false, prob: null, evPct: null, window: r2.models?.modelC?.window || null, sampleSize: cN, reason: `Muestra insuficiente para Model C (${cN} < ${minC})` };

      const minBB = getMinSampleFor('beta_binomial', payload.market);
      const bbProb = r2.models?.modelC?.pShrunk ?? null;
      mBB = nHist >= minBB && bbProb !== null
        ? { available: true, prob: bbProb, evPct: calcEv(bbProb), priorStrength: v2Engine.defaultPriorStrength, priorProb: noVig.prob, reason: null }
        : { available: false, prob: null, evPct: null, reason: nHist < minBB ? `Muestra insuficiente para Beta-Binomial (${nHist} < ${minBB})` : 'No fue posible calcular shrinkage Beta-Binomial' };

      const minEns = getMinSampleFor('ensemble_v2', payload.market);
      const ens = nHist >= minEns
        ? this.computeEnsembleV2(r2.parametric?.pSelected ?? null, bbProb, noVig.prob, nHist)
        : { available: false, prob: null, weights: null, reason: `Muestra insuficiente para Ensemble v2 en ${payload.market} (${nHist} < ${minEns})` };
      mEnsV2 = {
        available: ens.available,
        prob: ens.prob,
        evPct: calcEv(ens.prob),
        weights: ens.weights,
        reason: ens.reason
      };
    }

    return {
      v1_production: mV1,
      v2_corrected: mV2,
      model_b: mB,
      model_c: mC,
      beta_binomial: mBB,
      ensemble_v2: mEnsV2
    };
  }

  /**
   * Registra una observación paralela pre-partido con sello inmutable SHA-256.
   */
  recordParallelObservation(payload) {
    const observedAtUtc = payload.observedAtUtc || new Date().toISOString();
    const kickoffUtc = payload.kickoffUtc || payload.eventDate || null;

    if (!kickoffUtc) {
      return { recorded: false, reason: 'MISSING_KICKOFF_UTC' };
    }

    // Guarda temporal estricta: impedir datos posteriores al kickoff en predicciones pre-partido
    const obsMs = Date.parse(observedAtUtc);
    const koMs = Date.parse(kickoffUtc);
    if (!Number.isFinite(obsMs) || !Number.isFinite(koMs) || obsMs >= koMs) {
      return {
        recorded: false,
        reason: 'TEMPORAL_LEAKAGE_BLOCKED',
        message: `observedAtUtc (${observedAtUtc}) debe ser estrictamente anterior a kickoffUtc (${kickoffUtc}).`
      };
    }

    const records = this._readAll();
    const eventKey = this.buildEventKey(payload);
    const dup = records.find(r => r.pickId === payload.pickId || (payload.matchId && r.eventKey === eventKey));
    if (dup) {
      return { recorded: false, reason: 'DUPLICATE_PREVENTED', existingPredictionId: dup.predictionId };
    }

    const parsedLine = v2Engine.parseLine(payload.line, payload.rawLine, payload.side || payload.oddsType);
    const openingOdds = toFiniteOrNull(payload.openingOdds);
    const approvalOdds = toFiniteOrNull(payload.approvalOdds ?? payload.bookmakerOdds ?? payload.odds);
    const overOdds = toFiniteOrNull(payload.overOdds ?? (parsedLine.side === 'over' ? approvalOdds : null));
    const underOdds = toFiniteOrNull(payload.underOdds ?? (parsedLine.side === 'under' ? approvalOdds : null));
    const oppositeOdds = parsedLine.side === 'over' ? underOdds : overOdds;
    const noVig = v2Engine.computeNoVigProb(approvalOdds, oppositeOdds);

    const models = this.evaluateAllSixModels(payload, approvalOdds, oppositeOdds, noVig);

    const predictionId = `shpred_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const eventId = payload.matchId || `evt_${crypto.createHash('md5').update(`${payload.match || ''}_${kickoffUtc}`).digest('hex').slice(0, 10)}`;

    // Bloque inmutable pre-partido (sellado con SHA-256)
    const preMatchBlock = {
      predictionId,
      eventId,
      pickId: payload.pickId,
      eventKey,
      observedAtUtc,
      kickoffUtc,
      competition: payload.competition || null,
      match: payload.match || null,
      playerOrTeam: payload.playerOrTeam || payload.player || null,
      market: payload.market || null,
      line: payload.line || null,
      side: parsedLine.side,
      oddsAtPrediction: {
        bookmaker: payload.bookmaker || null,
        openingOdds,
        approvalOdds,
        overOdds,
        underOdds,
        marketNoVigProb: noVig.prob,
        noVigMethod: noVig.method,
        isExactNoVig: noVig.method === 'exact_2way_proportional',
        overround: noVig.overround
      },
      historyMetadata: {
        sampleCount: Array.isArray(payload.historicalValues) ? payload.historicalValues.length : 0,
        dates: Array.isArray(payload.matchDates) ? payload.matchDates : [],
        minutesPerMatch: Array.isArray(payload.minutesPerMatch) ? payload.minutesPerMatch : [],
        avgMinutes: toFiniteOrNull(payload.avgMinutes),
        sourceEndpoint: payload.historySourceEndpoint || null,
        filteredPostKickoffCount: Number(payload.filteredPostKickoffCount || 0),
        unavailableReason: payload.historyUnavailableReason || null
      },
      models
    };

    const preMatchHash = sha256Of(preMatchBlock);

    const record = {
      schemaVersion: this.schemaVersion,
      shadowMode: true,
      isOperativeRecommendation: false,
      predictionId,
      eventId,
      pickId: payload.pickId,
      eventKey,
      observedAtUtc,
      kickoffUtc,
      preMatchBlock,
      preMatchHash,
      closingOddsSnapshot: {
        closingOdds: null,
        closingOppositeOdds: null,
        closingNoVigProb: null,
        closingNoVigMethod: null,
        closingOverround: null,
        capturedAtUtc: null,
        minutesBeforeKickoff: null,
        source: null,
        clvOddsPct: null,
        clvProbPp: null
      },
      settlement: {
        status: 'PENDING',
        outcome: null, // 'WON' | 'LOST' | 'VOID'
        actualStat: null,
        settledAtUtc: null,
        verificationSource: null
      }
    };

    records.push(record);
    this._writeAll(records);
    return { recorded: true, predictionId, eventId, preMatchHash, record };
  }

  /**
   * Captura cuota de cierre T-5 min sin alterar preMatchBlock ni preMatchHash.
   */
  recordClosingOdds(pickIdOrPredictionId, { closingOdds, closingOppositeOdds = null, capturedAtUtc = null, source = 'StatsHub MCP' }) {
    const records = this._readAll();
    const rec = records.find(r => r.predictionId === pickIdOrPredictionId || r.pickId === pickIdOrPredictionId);
    if (!rec) return { updated: false, reason: 'OBSERVATION_NOT_FOUND' };

    const ts = capturedAtUtc || new Date().toISOString();
    const capMs = Date.parse(ts);
    const koMs = Date.parse(rec.kickoffUtc);
    if (!Number.isFinite(capMs) || !Number.isFinite(koMs) || capMs > koMs) {
      return { updated: false, reason: 'CLOSING_ODDS_AFTER_KICKOFF_BLOCKED' };
    }

    const cOdds = toFiniteOrNull(closingOdds);
    if (!cOdds || cOdds <= 1) return { updated: false, reason: 'INVALID_CLOSING_ODDS' };

    const cOpp = toFiniteOrNull(closingOppositeOdds);
    const closingNoVig = v2Engine.computeNoVigProb(cOdds, cOpp);
    const appOdds = rec.preMatchBlock.oddsAtPrediction.approvalOdds;
    const appNoVig = rec.preMatchBlock.oddsAtPrediction.marketNoVigProb;

    rec.closingOddsSnapshot = {
      closingOdds: cOdds,
      closingOppositeOdds: cOpp,
      closingNoVigProb: closingNoVig.prob,
      closingNoVigMethod: closingNoVig.method,
      isExactClosingNoVig: closingNoVig.method === 'exact_2way_proportional',
      closingOverround: closingNoVig.overround,
      capturedAtUtc: ts,
      minutesBeforeKickoff: Number(((koMs - capMs) / 60000).toFixed(1)),
      source,
      clvOddsPct: appOdds ? Number((((appOdds / cOdds) - 1) * 100).toFixed(2)) : null,
      clvProbPp: (closingNoVig.prob !== null && appNoVig !== null)
        ? Number(((closingNoVig.prob - appNoVig) * 100).toFixed(2))
        : null
    };

    this._writeAll(records);
    return {
      updated: true,
      predictionId: rec.predictionId,
      clvOddsPct: rec.closingOddsSnapshot.clvOddsPct,
      clvProbPp: rec.closingOddsSnapshot.clvProbPp
    };
  }

  /**
   * Registra liquidación oficial (WON, LOST o VOID) preservando intacto preMatchBlock y verificando preMatchHash.
   */
  recordSettlement(pickIdOrPredictionId, { outcome, actualStat = null, settledAtUtc = null, verificationSource = 'StatsHub Oficial' }) {
    const normOut = String(outcome || '').toUpperCase();
    if (!['WON', 'LOST', 'VOID'].includes(normOut)) {
      return { settled: false, reason: `Outcome inválido: ${outcome} (debe ser WON, LOST o VOID)` };
    }

    const records = this._readAll();
    const rec = records.find(r => r.predictionId === pickIdOrPredictionId || r.pickId === pickIdOrPredictionId);
    if (!rec) return { settled: false, reason: 'OBSERVATION_NOT_FOUND' };

    // Verificar inmutabilidad del bloque pre-partido antes de liquidar
    const currentHash = sha256Of(rec.preMatchBlock);
    if (currentHash !== rec.preMatchHash) {
      return { settled: false, reason: 'PREMATCH_INTEGRITY_VIOLATION' };
    }

    if (rec.settlement && rec.settlement.status === 'SETTLED') {
      return { settled: false, reason: 'ALREADY_SETTLED_IDEMPOTENT', outcome: rec.settlement.outcome };
    }

    rec.settlement = {
      status: 'SETTLED',
      outcome: normOut,
      actualStat: actualStat !== undefined ? actualStat : null,
      settledAtUtc: settledAtUtc || new Date().toISOString(),
      eventId: rec.eventId,
      predictionId: rec.predictionId,
      verificationSource
    };

    this._writeAll(records);
    return { settled: true, predictionId: rec.predictionId, eventId: rec.eventId, outcome: normOut, hashIntact: true };
  }

  /**
   * Verifica integridad criptográfica de todas las observaciones del laboratorio.
   */
  verifyAllHashes() {
    const records = this._readAll();
    let intact = 0;
    const tampered = [];
    for (const r of records) {
      const computed = sha256Of(r.preMatchBlock);
      if (computed === r.preMatchHash) intact++;
      else tampered.push(r.predictionId);
    }
    return { total: records.length, intact, tamperedCount: tampered.length, tampered };
  }
}

module.exports = new ShadowLabRunner();
module.exports.ShadowLabRunner = ShadowLabRunner;
