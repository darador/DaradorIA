/**
 * FASE 9 — OBSERVATION STORE (REGISTRO INMUTABLE, SNAPSHOTS DE CUOTAS, CLV Y ALERTAS)
 * Shadow Mode exclusivo: autoExecutionAllowed = false.
 *
 * Garantías:
 *  - Registro append-only inmutable con inputSnapshotHash y predictionHash (SHA-256).
 *  - Nunca sobrescribe observaciones previas; nuevas evaluaciones generan observaciones independientes.
 *  - Anti-leakage temporal estricto: observedAtUtc < kickoffUtc y todos los inputs < kickoffUtc.
 *  - Snapshots de cuotas (FIRST_VALID, T_MINUS_60, T_MINUS_30, T_MINUS_5, CLOSING).
 *  - Cálculo de CLV solo con cuotas comparables (mismo bookmaker, mercado, selección y línea),
 *    excluyendo movimientos contaminados ("first-half prices mixed in").
 *  - Registro local de alertas de calidad (sin Telegram).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_OBS_PATH = path.join(STORAGE_DIR, 'fase9_observations.json');
const DEFAULT_REJECTED_PATH = path.join(STORAGE_DIR, 'fase9_rejected_observations.json');
const DEFAULT_ALERTS_PATH = path.join(STORAGE_DIR, 'fase9_quality_alerts.json');

const SNAPSHOT_CHECKPOINTS = Object.freeze([
  'FIRST_VALID',
  'T_MINUS_60',
  'T_MINUS_30',
  'T_MINUS_5',
  'CLOSING'
]);

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function round(v, d = 6) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

class ObservationStore {
  constructor(options = {}) {
    this.obsPath = options.obsPath || DEFAULT_OBS_PATH;
    this.rejectedPath = options.rejectedPath || DEFAULT_REJECTED_PATH;
    this.alertsPath = options.alertsPath || DEFAULT_ALERTS_PATH;
    this.autoExecutionAllowed = false;
  }

  _readJsonArray(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  _writeJsonArray(filePath, arr) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), 'utf8');
  }

  logQualityAlert({ code, severity = 'WARNING', matchId = null, observationId = null, message, details = null }) {
    const alerts = this._readJsonArray(this.alertsPath);
    const alert = {
      alertId: `qa_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      timestampUtc: new Date().toISOString(),
      code,
      severity,
      matchId,
      observationId,
      message,
      details,
      telegramSent: false
    };
    alerts.push(alert);
    this._writeJsonArray(this.alertsPath, alerts);
    return alert;
  }

  getQualityAlerts() {
    return this._readJsonArray(this.alertsPath);
  }

  getObservations() {
    return this._readJsonArray(this.obsPath);
  }

  getRejectedObservations() {
    return this._readJsonArray(this.rejectedPath);
  }

  /**
   * Registra una nueva observación inmutable pre-partido.
   * Nunca sobrescribe predicciones anteriores.
   */
  recordObservation(payload) {
    const observedAtUtc = payload.observedAtUtc || new Date().toISOString();
    const kickoffUtc = payload.kickoffUtc || null;

    const reject = (reason, alertCode, extra = {}) => {
      const rejected = this._readJsonArray(this.rejectedPath);
      const entry = {
        rejectedId: `rej_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        rejectedAtUtc: new Date().toISOString(),
        reason,
        matchId: payload.matchId || null,
        marketFamily: payload.marketFamily || null,
        selection: payload.selection || null,
        observedAtUtc,
        kickoffUtc,
        ...extra
      };
      rejected.push(entry);
      this._writeJsonArray(this.rejectedPath, rejected);
      this.logQualityAlert({
        code: alertCode,
        severity: 'ERROR',
        matchId: payload.matchId || null,
        message: reason,
        details: extra
      });
      return { recorded: false, reason, rejectedId: entry.rejectedId };
    };

    // 1. Validación de campos esenciales
    if (!payload.matchId || !payload.marketFamily || !payload.selection || !kickoffUtc) {
      return reject(
        'Faltan campos esenciales (matchId, marketFamily, selection o kickoffUtc).',
        'MISSING_ESSENTIAL_DATA'
      );
    }
    if (!Number.isFinite(Number(payload.modelProbability)) || Number(payload.modelProbability) <= 0 || Number(payload.modelProbability) >= 1) {
      return reject('modelProbability inválida o ausente.', 'MISSING_ESSENTIAL_DATA');
    }
    if (!Number.isFinite(Number(payload.odds)) || Number(payload.odds) <= 1.0) {
      return reject('Cuota (odds) inválida o ausente.', 'MISSING_ESSENTIAL_DATA');
    }

    // 2. Anti-leakage temporal estricto
    const obsMs = Date.parse(observedAtUtc);
    const koMs = Date.parse(kickoffUtc);
    if (!Number.isFinite(obsMs) || !Number.isFinite(koMs) || obsMs >= koMs) {
      return reject(
        `Violación anti-leakage: observedAtUtc (${observedAtUtc}) >= kickoffUtc (${kickoffUtc}).`,
        'POST_KICKOFF_OBSERVATION_BLOCKED'
      );
    }

    // Validar que ningún timestamp en inputSnapshot sea posterior al kickoff
    const inputTsList = Array.isArray(payload.inputTimestampsUtc) ? payload.inputTimestampsUtc : [];
    for (const ts of inputTsList) {
      const tMs = Date.parse(ts);
      if (Number.isFinite(tMs) && tMs >= koMs) {
        return reject(
          `Violación anti-leakage en datos de entrada: timestamp ${ts} >= kickoffUtc (${kickoffUtc}).`,
          'FUTURE_INPUT_DATA_BLOCKED',
          { offendingTimestamp: ts }
        );
      }
    }

    const inputSnapshot = payload.inputSnapshot || {
      dataQualityTier: payload.dataQualityTier || 'DESCONOCIDA',
      dataSources: payload.dataSources || [],
      features: payload.features || null
    };
    const inputSnapshotHash = sha256(inputSnapshot);

    const impliedProbability = Number.isFinite(Number(payload.impliedProbability))
      ? round(Number(payload.impliedProbability), 6)
      : round(1 / Number(payload.odds), 6);

    const noVigProbability = Number.isFinite(Number(payload.noVigProbability))
      ? round(Number(payload.noVigProbability), 6)
      : null;

    const immutableCore = {
      matchId: String(payload.matchId),
      league: String(payload.league || 'Desconocida'),
      season: String(payload.season || '2026-2027'),
      homeTeam: String(payload.homeTeam || ''),
      awayTeam: String(payload.awayTeam || ''),
      kickoffUtc,
      observedAtUtc,
      marketFamily: String(payload.marketFamily),
      market: String(payload.market || payload.marketFamily),
      selection: String(payload.selection).toUpperCase(),
      line: payload.line !== undefined ? payload.line : null,
      modelName: String(payload.modelName || 'MatchOutcomeDC'),
      modelVersion: String(payload.modelVersion || 'match-outcome-dc-v1.0-experimental'),
      parameterVersion: String(payload.parameterVersion || 'params-default-v1'),
      modelProbability: round(Number(payload.modelProbability), 6),
      probabilities1X2: payload.probabilities1X2 || null,
      odds: round(Number(payload.odds), 4),
      bookmaker: String(payload.bookmaker || 'Unknown'),
      impliedProbability,
      noVigProbability,
      dataQualityTier: String(payload.dataQualityTier || 'MEDIA'),
      dataSources: Array.isArray(payload.dataSources) ? payload.dataSources : [],
      inputSnapshotHash
    };

    const predictionHash = sha256(immutableCore);

    // 3. Deduplicación estricta (mismo predictionHash o mismo match+market+selection+modelVersion+odds+inputSnapshotHash)
    const existing = this._readJsonArray(this.obsPath);
    const dup = existing.find(o =>
      o.predictionHash === predictionHash ||
      (
        o.matchId === immutableCore.matchId &&
        o.marketFamily === immutableCore.marketFamily &&
        o.selection === immutableCore.selection &&
        o.line === immutableCore.line &&
        o.modelVersion === immutableCore.modelVersion &&
        o.odds === immutableCore.odds &&
        o.inputSnapshotHash === immutableCore.inputSnapshotHash
      )
    );
    if (dup) {
      this.logQualityAlert({
        code: 'DUPLICATE_OBSERVATION_DETECTED',
        severity: 'WARNING',
        matchId: immutableCore.matchId,
        observationId: dup.observationId,
        message: `Observación duplicada evitada para ${immutableCore.matchId} (${immutableCore.marketFamily}/${immutableCore.selection}).`
      });
      return { recorded: false, reason: 'DUPLICATE_PREVENTED', observationId: dup.observationId };
    }

    const observationId = `obs9_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const record = {
      observationId,
      ...immutableCore,
      predictionHash,
      status: 'PENDING',
      autoExecutionAllowed: false,
      oddsSnapshots: [
        {
          checkpoint: 'FIRST_VALID',
          capturedAtUtc: observedAtUtc,
          odds: immutableCore.odds,
          bookmaker: immutableCore.bookmaker,
          marketFamily: immutableCore.marketFamily,
          selection: immutableCore.selection,
          line: immutableCore.line,
          source: payload.oddsSource || 'observation_time',
          contaminated: false
        }
      ],
      clv: {
        status: 'CLV_UNAVAILABLE',
        clvPct: null,
        closingOdds: null,
        closingBookmaker: null,
        closingCapturedAtUtc: null,
        reason: 'Sin cuota de cierre comparable registrada aún.'
      },
      settlement: {
        status: 'PENDING',
        homeGoals: null,
        awayGoals: null,
        actual1X2: null,
        profitUnits: null,
        resultSource: null,
        settledAtUtc: null,
        corrections: []
      }
    };

    existing.push(record);
    this._writeJsonArray(this.obsPath, existing);

    return {
      recorded: true,
      observationId,
      inputSnapshotHash,
      predictionHash
    };
  }

  /**
   * Agrega un snapshot de cuota (T-60, T-30, T-5, CLOSING) sin modificar el bloque inmutable.
   * Excluye automáticamente filas contaminadas con precios de primer tiempo mezclados.
   */
  recordOddsSnapshot(observationId, snapshot) {
    const list = this._readJsonArray(this.obsPath);
    const obs = list.find(o => o.observationId === observationId);
    if (!obs) return { updated: false, reason: 'OBSERVATION_NOT_FOUND' };

    const warn = String(snapshot.warning || '').toLowerCase();
    if (warn.includes('first-half prices mixed in') || snapshot.contaminated === true) {
      this.logQualityAlert({
        code: 'CONTAMINATED_ODDS_MOVEMENT_EXCLUDED',
        severity: 'WARNING',
        matchId: obs.matchId,
        observationId,
        message: 'Movimiento de cuota descartado por contaminación con precios de primer tiempo.',
        details: { bookmaker: snapshot.bookmaker, warning: snapshot.warning }
      });
      return { updated: false, reason: 'CONTAMINATED_MOVEMENT_EXCLUDED' };
    }

    const checkpoint = SNAPSHOT_CHECKPOINTS.includes(snapshot.checkpoint) ? snapshot.checkpoint : 'T_MINUS_5';
    const oddsVal = Number(snapshot.odds);
    if (!Number.isFinite(oddsVal) || oddsVal <= 1.0) {
      return { updated: false, reason: 'INVALID_ODDS' };
    }

    const entry = {
      checkpoint,
      capturedAtUtc: snapshot.capturedAtUtc || new Date().toISOString(),
      odds: round(oddsVal, 4),
      bookmaker: String(snapshot.bookmaker || 'Unknown'),
      marketFamily: String(snapshot.marketFamily || obs.marketFamily),
      selection: String(snapshot.selection || obs.selection).toUpperCase(),
      line: snapshot.line !== undefined ? snapshot.line : obs.line,
      source: snapshot.source || 'statshub_snapshot',
      contaminated: false
    };

    obs.oddsSnapshots.push(entry);

    // Solo calcula CLV si el checkpoint es explícitamente CLOSING (nunca asume que el último snapshot es cierre)
    if (checkpoint === 'CLOSING') {
      const clvResult = this.computeComparableCLV(obs, entry);
      obs.clv = clvResult;
      if (clvResult.status === 'CLV_UNAVAILABLE') {
        this.logQualityAlert({
          code: 'NON_COMPARABLE_CLOSING_ODDS',
          severity: 'WARNING',
          matchId: obs.matchId,
          observationId,
          message: clvResult.reason,
          details: { obsLine: obs.line, closingLine: entry.line, obsBook: obs.bookmaker, closingBook: entry.bookmaker }
        });
      }
    }

    this._writeJsonArray(this.obsPath, list);
    return { updated: true, checkpoint, clv: obs.clv };
  }

  /**
   * Calcula CLV únicamente si bookmaker, mercado, selección y línea coinciden exactamente.
   */
  computeComparableCLV(obs, closingSnap) {
    if (!closingSnap || closingSnap.checkpoint !== 'CLOSING' || closingSnap.contaminated) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'No existe cuota de cierre válida.' };
    }
    if (String(closingSnap.marketFamily) !== String(obs.marketFamily)) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'Mercado no comparable para CLV.' };
    }
    if (String(closingSnap.selection).toUpperCase() !== String(obs.selection).toUpperCase()) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'Selección no comparable para CLV.' };
    }
    if (String(closingSnap.bookmaker).toLowerCase() !== String(obs.bookmaker).toLowerCase()) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: `Bookmaker distinto (${obs.bookmaker} vs ${closingSnap.bookmaker}).` };
    }
    if ((obs.line ?? null) !== (closingSnap.line ?? null)) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: `Línea distinta (${obs.line} vs ${closingSnap.line}): no comparable.` };
    }

    const clvPct = round(((obs.odds / closingSnap.odds) - 1) * 100, 3);
    return {
      status: 'CLV_AVAILABLE',
      clvPct,
      closingOdds: closingSnap.odds,
      closingBookmaker: closingSnap.bookmaker,
      closingCapturedAtUtc: closingSnap.capturedAtUtc,
      reason: null
    };
  }

  /**
   * Verifica la integridad SHA-256 de todas las observaciones registradas.
   */
  verifyIntegrity() {
    const list = this._readJsonArray(this.obsPath);
    let intact = 0;
    const corruptedIds = [];

    for (const o of list) {
      const core = {
        matchId: o.matchId,
        league: o.league,
        season: o.season,
        homeTeam: o.homeTeam,
        awayTeam: o.awayTeam,
        kickoffUtc: o.kickoffUtc,
        observedAtUtc: o.observedAtUtc,
        marketFamily: o.marketFamily,
        market: o.market,
        selection: o.selection,
        line: o.line,
        modelName: o.modelName,
        modelVersion: o.modelVersion,
        parameterVersion: o.parameterVersion,
        modelProbability: o.modelProbability,
        probabilities1X2: o.probabilities1X2,
        odds: o.odds,
        bookmaker: o.bookmaker,
        impliedProbability: o.impliedProbability,
        noVigProbability: o.noVigProbability,
        dataQualityTier: o.dataQualityTier,
        dataSources: o.dataSources,
        inputSnapshotHash: o.inputSnapshotHash
      };
      if (sha256(core) === o.predictionHash) intact++;
      else corruptedIds.push(o.observationId);
    }

    return {
      total: list.length,
      intact,
      corruptedCount: corruptedIds.length,
      corruptedIds,
      ok: corruptedIds.length === 0
    };
  }
}

module.exports = {
  ObservationStore,
  SNAPSHOT_CHECKPOINTS
};
