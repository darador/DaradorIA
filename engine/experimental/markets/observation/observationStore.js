/**
 * FASE 9.1 — OBSERVATION STORE HARDENED (APPEND-ONLY, LOCK INTER-PROCESO, ESCRITURA ATÓMICA,
 * CADENA CRIPTOGRÁFICA SHA-256, EVENTOS SEPARADOS Y GUARDIA ANTI-LEAKAGE EN SNAPSHOTS)
 *
 * Shadow Mode exclusivo: autoExecutionAllowed = false.
 *
 * Garantías implementadas:
 *  1. Lock inter-proceso mediante creación atómica de lockfile (O_CREAT | O_EXCL),
 *     reintentos acotados y detección de locks obsoletos validando PID vivo antes de remover.
 *     Nota de filesystem: la atomicidad de O_EXCL + rename requiere un filesystem POSIX/NTFS local
 *     (no se garantiza en montajes NFSv2 o sincronizaciones de nube con conflictos concurrentes).
 *  2. Escritura atómica: write(.tmp) -> fsync(fd) -> close -> renameSync(.tmp, target).
 *  3. Protección contra corrupción: nunca convierte JSON corrupto en []; preserva backup único
 *     `.corrupt.<ts>.bak` y bloquea lecturas/escrituras hasta recuperación explícita auditada.
 *  4. Cadena criptográfica global: sequenceIndex + prevPredictionHash (génesis '0'.repeat(64))
 *     + predictionHash sobre JSON canónico determinista. Verificación automática al leer.
 *  5. Separación estricta de eventos mutables en logs append-only independientes encadenados:
 *     - fase9_observations.json       (predicciones inmutables — nunca se modifica una fila)
 *     - fase9_odds_snapshots.json     (eventos append-only de snapshots de cuotas y CLV)
 *     - fase9_settlement_events.json  (eventos append-only de liquidaciones y correcciones)
 *  6. Guardia temporal estricta en TODOS los snapshots (incl. CLOSING): capturedAtUtc < kickoffUtc.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_OBS_PATH = path.join(STORAGE_DIR, 'fase9_observations.json');
const DEFAULT_SNAPSHOTS_PATH = path.join(STORAGE_DIR, 'fase9_odds_snapshots.json');
const DEFAULT_SETTLEMENTS_PATH = path.join(STORAGE_DIR, 'fase9_settlement_events.json');
const DEFAULT_REJECTED_PATH = path.join(STORAGE_DIR, 'fase9_rejected_observations.json');
const DEFAULT_ALERTS_PATH = path.join(STORAGE_DIR, 'fase9_quality_alerts.json');

const GENESIS_HASH = '0'.repeat(64);

const SNAPSHOT_CHECKPOINTS = Object.freeze([
  'FIRST_VALID',
  'T_MINUS_60',
  'T_MINUS_30',
  'T_MINUS_5',
  'CLOSING'
]);

/**
 * Serialización JSON canónica y determinista (claves ordenadas recursivamente).
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

function sha256Canonical(obj) {
  return crypto.createHash('sha256').update(canonicalStringify(obj)).digest('hex');
}

function round(v, d = 6) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

/**
 * Valida vector noVig1X2 (3 probabilidades que sumen 1.0 dentro de tolerancia 1e-3).
 */
function validateNoVig1X2(vec) {
  if (!vec || typeof vec !== 'object') return null;
  const h = Number(vec.home);
  const d = Number(vec.draw);
  const a = Number(vec.away);
  if (!Number.isFinite(h) || !Number.isFinite(d) || !Number.isFinite(a)) return null;
  if (h <= 0 || d <= 0 || a <= 0 || h >= 1 || d >= 1 || a >= 1) return null;
  if (Math.abs((h + d + a) - 1.0) > 1e-3) return null;
  return { home: round(h, 6), draw: round(d, 6), away: round(a, 6) };
}

class ObservationStore {
  constructor(options = {}) {
    this.obsPath = options.obsPath || DEFAULT_OBS_PATH;
    this.snapshotsPath = options.snapshotsPath || path.join(path.dirname(this.obsPath), path.basename(this.obsPath, '.json') + '_snapshots.json');
    this.settlementsPath = options.settlementsPath || path.join(path.dirname(this.obsPath), path.basename(this.obsPath, '.json') + '_settlements.json');
    this.rejectedPath = options.rejectedPath || DEFAULT_REJECTED_PATH;
    this.alertsPath = options.alertsPath || DEFAULT_ALERTS_PATH;
    this.lockPath = options.lockPath || `${this.obsPath}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.staleLockMs = options.staleLockMs ?? 15000;
    this.autoExecutionAllowed = false;
  }

  // --- LOCK INTER-PROCESO (O_CREAT | O_EXCL) ---

  _withFileLock(fn) {
    const dir = path.dirname(this.lockPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const deadline = Date.now() + this.lockTimeoutMs;
    let acquired = false;

    while (Date.now() <= deadline) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        const meta = JSON.stringify({ pid: process.pid, createdAtMs: Date.now() });
        fs.writeSync(fd, meta, 0, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        acquired = true;
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;

        // Verificar si el lock existente es obsoleto Y pertenece a un proceso muerto
        try {
          const raw = fs.readFileSync(this.lockPath, 'utf8');
          const info = JSON.parse(raw);
          const ageMs = Date.now() - Number(info.createdAtMs || 0);
          if (ageMs > this.staleLockMs && !isProcessAlive(Number(info.pid))) {
            try { fs.unlinkSync(this.lockPath); } catch (_) {}
            continue;
          }
        } catch (_) {
          // Lock siendo escrito por otro proceso; esperar y reintentar
        }

        sleepSync(25 + Math.floor(Math.random() * 25));
      }
    }

    if (!acquired) {
      const e = new Error(`LOCK_ACQUISITION_TIMEOUT: No se pudo adquirir el lock inter-proceso ${this.lockPath} en ${this.lockTimeoutMs}ms.`);
      e.code = 'LOCK_TIMEOUT';
      throw e;
    }

    try {
      return fn();
    } finally {
      try { fs.unlinkSync(this.lockPath); } catch (_) {}
    }
  }

  // --- LECTURA ESTRICTA CON CUARENTENA DE CORRUPCIÓN Y ESCRITURA ATÓMICA ---

  _quarantineCorruptFile(filePath, parseError) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    let backupPath = `${filePath}.${ts}.corrupt.bak`;
    let suffix = 1;
    while (fs.existsSync(backupPath)) {
      backupPath = `${filePath}.${ts}.${suffix++}.corrupt.bak`;
    }
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (_) {
      backupPath = null;
    }
    const err = new Error(
      `LEDGER_CORRUPTION_ERROR: Archivo JSON corrupto detectado en ${filePath} (${parseError.message}). ` +
      `Backup preservado en ${backupPath || 'N/A'}. Operaciones bloqueadas hasta recuperación explícita.`
    );
    err.code = 'LEDGER_CORRUPTION_ERROR';
    err.backupPath = backupPath;
    err.corruptFile = filePath;
    throw err;
  }

  _readJsonArrayStrict(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim() === '') {
      this._quarantineCorruptFile(filePath, new Error('Archivo vacío/truncado inesperadamente'));
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this._quarantineCorruptFile(filePath, err);
    }
    if (!Array.isArray(parsed)) {
      this._quarantineCorruptFile(filePath, new Error('La raíz del ledger no es un array JSON'));
    }
    return parsed;
  }

  _atomicWriteJsonArray(filePath, arr) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    const payload = JSON.stringify(arr, null, 2);
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, payload, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);

    // Sincronización best-effort del directorio (soportada en POSIX; Windows puede retornar EINVAL/EPERM)
    try {
      const dirFd = fs.openSync(dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_) {}
  }

  // --- VERIFICACIÓN CRIPTOGRÁFICA DE CADENAS ---

  _extractImmutableCore(o) {
    return {
      sequenceIndex: o.sequenceIndex,
      prevPredictionHash: o.prevPredictionHash,
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
      noVig1X2: o.noVig1X2 ?? null,
      dataQualityTier: o.dataQualityTier,
      dataSources: o.dataSources,
      inputSnapshotHash: o.inputSnapshotHash
    };
  }

  _verifyObservationChain(list) {
    let expectedPrev = GENESIS_HASH;
    const seenIds = new Set();
    const seenHashes = new Set();
    const errors = [];

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.sequenceIndex !== i) {
        errors.push(`SEQUENCE_MISMATCH at index ${i}: expected ${i}, got ${o.sequenceIndex}`);
      }
      if (o.prevPredictionHash !== expectedPrev) {
        errors.push(`CHAIN_BREAK at index ${i} (${o.observationId}): expected prevHash ${expectedPrev}, got ${o.prevPredictionHash}`);
      }
      if (seenIds.has(o.observationId)) {
        errors.push(`DUPLICATE_ID at index ${i}: ${o.observationId}`);
      }
      seenIds.add(o.observationId);

      const recomputed = sha256Canonical(this._extractImmutableCore(o));
      if (recomputed !== o.predictionHash) {
        errors.push(`HASH_MISMATCH at index ${i} (${o.observationId})`);
      }
      if (seenHashes.has(o.predictionHash)) {
        errors.push(`DUPLICATE_HASH at index ${i}: ${o.predictionHash}`);
      }
      seenHashes.add(o.predictionHash);
      expectedPrev = o.predictionHash;
    }

    return {
      ok: errors.length === 0,
      total: list.length,
      intact: errors.length === 0 ? list.length : Math.max(0, list.length - errors.length),
      corruptedCount: errors.length,
      errors
    };
  }

  _verifyEventChain(events, label) {
    let expectedPrev = GENESIS_HASH;
    const errors = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.sequenceIndex !== i) {
        errors.push(`${label}_SEQUENCE_MISMATCH at ${i}`);
      }
      if (ev.prevEventHash !== expectedPrev) {
        errors.push(`${label}_CHAIN_BREAK at ${i}`);
      }
      const { eventHash, ...core } = ev;
      if (sha256Canonical(core) !== eventHash) {
        errors.push(`${label}_HASH_MISMATCH at ${i}`);
      }
      expectedPrev = eventHash;
    }
    return { ok: errors.length === 0, total: events.length, errors };
  }

  verifyIntegrity() {
    const obsList = this._readJsonArrayStrict(this.obsPath);
    const snapList = this._readJsonArrayStrict(this.snapshotsPath);
    const settList = this._readJsonArrayStrict(this.settlementsPath);

    const obsCheck = this._verifyObservationChain(obsList);
    const snapCheck = this._verifyEventChain(snapList, 'SNAPSHOT');
    const settCheck = this._verifyEventChain(settList, 'SETTLEMENT');

    const allErrors = [...obsCheck.errors, ...snapCheck.errors, ...settCheck.errors];
    return {
      ok: allErrors.length === 0,
      total: obsCheck.total,
      intact: obsCheck.ok ? obsCheck.total : 0,
      corruptedCount: allErrors.length,
      observationsChain: obsCheck,
      snapshotsChain: snapCheck,
      settlementsChain: settCheck,
      errors: allErrors
    };
  }

  _assertChainIntact(obsList, snapList = null, settList = null) {
    const obsCheck = this._verifyObservationChain(obsList);
    const errors = [...obsCheck.errors];
    if (snapList) errors.push(...this._verifyEventChain(snapList, 'SNAPSHOT').errors);
    if (settList) errors.push(...this._verifyEventChain(settList, 'SETTLEMENT').errors);
    if (errors.length > 0) {
      const err = new Error(`LEDGER_INTEGRITY_ERROR: Integridad de cadena SHA-256 comprometida (${errors.join(' | ')}).`);
      err.code = 'LEDGER_INTEGRITY_ERROR';
      err.errors = errors;
      throw err;
    }
  }

  // --- ALERTAS LOCALES (SIN TELEGRAM) ---

  logQualityAlert({ code, severity = 'WARNING', matchId = null, observationId = null, message, details = null }) {
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
    const alerts = this._readJsonArrayStrict(this.alertsPath);
    alerts.push(alert);
    this._atomicWriteJsonArray(this.alertsPath, alerts);
    return alert;
  }

  getQualityAlerts() {
    return this._readJsonArrayStrict(this.alertsPath);
  }

  getRejectedObservations() {
    return this._readJsonArrayStrict(this.rejectedPath);
  }

  /**
   * Recupera todas las observaciones hidratadas con sus snapshots, CLV y liquidación.
   * Valida automáticamente la cadena criptográfica completa en cada lectura.
   */
  getObservations() {
    const obsList = this._readJsonArrayStrict(this.obsPath);
    const snapList = this._readJsonArrayStrict(this.snapshotsPath);
    const settList = this._readJsonArrayStrict(this.settlementsPath);

    // Verificación automática obligatoria en lectura
    this._assertChainIntact(obsList, snapList, settList);

    const snapsByObs = new Map();
    for (const ev of snapList) {
      if (!snapsByObs.has(ev.observationId)) snapsByObs.set(ev.observationId, []);
      snapsByObs.get(ev.observationId).push(ev);
    }

    const settsByObs = new Map();
    for (const ev of settList) {
      if (!settsByObs.has(ev.observationId)) settsByObs.set(ev.observationId, []);
      settsByObs.get(ev.observationId).push(ev);
    }

    return obsList.map(obs => {
      const evSnaps = snapsByObs.get(obs.observationId) || [];
      const evSetts = settsByObs.get(obs.observationId) || [];

      // Construir vista hidratada sin mutar el registro inmutable
      const oddsSnapshots = [
        {
          checkpoint: 'FIRST_VALID',
          capturedAtUtc: obs.observedAtUtc,
          odds: obs.odds,
          bookmaker: obs.bookmaker,
          marketFamily: obs.marketFamily,
          selection: obs.selection,
          line: obs.line,
          source: 'observation_time',
          contaminated: false
        },
        ...evSnaps.map(s => ({
          eventId: s.eventId,
          checkpoint: s.checkpoint,
          capturedAtUtc: s.capturedAtUtc,
          odds: s.odds,
          bookmaker: s.bookmaker,
          marketFamily: s.marketFamily,
          selection: s.selection,
          line: s.line,
          source: s.source,
          contaminated: false
        }))
      ];

      // Último evento CLOSING determina CLV
      const closingEvents = evSnaps.filter(s => s.checkpoint === 'CLOSING');
      const clv = closingEvents.length > 0
        ? closingEvents[closingEvents.length - 1].clvResult
        : {
            status: 'CLV_UNAVAILABLE',
            clvPct: null,
            closingOdds: null,
            closingBookmaker: null,
            closingCapturedAtUtc: null,
            reason: 'Sin cuota de cierre comparable registrada aún.'
          };

      // Reconstruir estado de liquidación y trazabilidad de correcciones desde eventos append-only
      let status = 'PENDING';
      const settlement = {
        status: 'PENDING',
        homeGoals: null,
        awayGoals: null,
        actual1X2: null,
        profitUnits: null,
        resultSource: null,
        settledAtUtc: null,
        corrections: []
      };

      for (const se of evSetts) {
        if (se.eventType === 'SETTLEMENT') {
          status = se.status;
          settlement.status = se.status;
          settlement.homeGoals = se.homeGoals;
          settlement.awayGoals = se.awayGoals;
          settlement.actual1X2 = se.actual1X2;
          settlement.profitUnits = se.profitUnits;
          settlement.resultSource = se.resultSource;
          settlement.settledAtUtc = se.settledAtUtc;
        } else if (se.eventType === 'CORRECTION') {
          settlement.corrections.push({
            correctedAtUtc: se.correctedAtUtc,
            reason: se.reason,
            source: se.resultSource,
            previous: se.previous,
            updated: { status: se.status, homeGoals: se.homeGoals, awayGoals: se.awayGoals, profitUnits: se.profitUnits }
          });
          status = se.status;
          settlement.status = se.status;
          settlement.homeGoals = se.homeGoals;
          settlement.awayGoals = se.awayGoals;
          settlement.actual1X2 = se.actual1X2;
          settlement.profitUnits = se.profitUnits;
        }
      }

      return {
        ...obs,
        status,
        oddsSnapshots,
        clv,
        settlement
      };
    });
  }

  // --- REGISTRO APPEND-ONLY DE OBSERVACIÓN INMUTABLE ---

  recordObservation(payload) {
    return this._withFileLock(() => {
      const observedAtUtc = payload.observedAtUtc || new Date().toISOString();
      const kickoffUtc = payload.kickoffUtc || null;

      // Verificar cadena intacta ANTES de aceptar cualquier escritura
      const existing = this._readJsonArrayStrict(this.obsPath);
      this._assertChainIntact(existing);

      const reject = (reason, alertCode, extra = {}) => {
        const rejected = this._readJsonArrayStrict(this.rejectedPath);
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
        this._atomicWriteJsonArray(this.rejectedPath, rejected);
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
      const inputSnapshotHash = sha256Canonical(inputSnapshot);

      const impliedProbability = Number.isFinite(Number(payload.impliedProbability))
        ? round(Number(payload.impliedProbability), 6)
        : round(1 / Number(payload.odds), 6);

      const noVigProbability = Number.isFinite(Number(payload.noVigProbability))
        ? round(Number(payload.noVigProbability), 6)
        : null;

      const noVig1X2 = validateNoVig1X2(payload.noVig1X2);

      const sequenceIndex = existing.length;
      const prevPredictionHash = existing.length > 0 ? existing[existing.length - 1].predictionHash : GENESIS_HASH;

      const immutableCore = {
        sequenceIndex,
        prevPredictionHash,
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
        noVig1X2,
        dataQualityTier: String(payload.dataQualityTier || 'MEDIA'),
        dataSources: Array.isArray(payload.dataSources) ? payload.dataSources : [],
        inputSnapshotHash
      };

      // 3. Deduplicación estricta (mismo match+market+selection+line+modelVersion+odds+inputSnapshotHash)
      const dup = existing.find(o =>
        o.matchId === immutableCore.matchId &&
        o.marketFamily === immutableCore.marketFamily &&
        o.selection === immutableCore.selection &&
        o.line === immutableCore.line &&
        o.modelVersion === immutableCore.modelVersion &&
        o.odds === immutableCore.odds &&
        o.inputSnapshotHash === immutableCore.inputSnapshotHash
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

      const predictionHash = sha256Canonical(immutableCore);
      const observationId = `obs9_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      const record = {
        observationId,
        ...immutableCore,
        predictionHash,
        autoExecutionAllowed: false
      };

      existing.push(record);
      this._atomicWriteJsonArray(this.obsPath, existing);

      return {
        recorded: true,
        observationId,
        sequenceIndex,
        prevPredictionHash,
        inputSnapshotHash,
        predictionHash
      };
    });
  }

  // --- SNAPSHOTS DE CUOTAS APPEND-ONLY CON GUARDIA TEMPORAL ESTRICTA ---

  recordOddsSnapshot(observationId, snapshot) {
    return this._withFileLock(() => {
      const obsList = this._readJsonArrayStrict(this.obsPath);
      const snapList = this._readJsonArrayStrict(this.snapshotsPath);
      this._assertChainIntact(obsList, snapList);

      const obs = obsList.find(o => o.observationId === observationId);
      if (!obs) return { updated: false, reason: 'OBSERVATION_NOT_FOUND' };

      // 1. Excluir movimientos contaminados con precios de primer tiempo
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

      // 2. Validación temporal estricta: capturedAtUtc debe existir, ser válido y < kickoffUtc
      const capturedAtUtc = snapshot.capturedAtUtc || null;
      const capMs = capturedAtUtc ? Date.parse(capturedAtUtc) : NaN;
      const koMs = Date.parse(obs.kickoffUtc);

      if (!capturedAtUtc || !Number.isFinite(capMs)) {
        this.logQualityAlert({
          code: 'INVALID_SNAPSHOT_TIMESTAMP',
          severity: 'ERROR',
          matchId: obs.matchId,
          observationId,
          message: `Snapshot rechazado: timestamp ausente o inválido (${capturedAtUtc}).`
        });
        return { updated: false, reason: 'INVALID_SNAPSHOT_TIMESTAMP' };
      }

      if (!Number.isFinite(koMs) || capMs >= koMs) {
        this.logQualityAlert({
          code: 'POST_KICKOFF_SNAPSHOT_REJECTED',
          severity: 'ERROR',
          matchId: obs.matchId,
          observationId,
          message: `Snapshot ${snapshot.checkpoint || 'UNKNOWN'} rechazado por anti-leakage: capturedAtUtc (${capturedAtUtc}) >= kickoffUtc (${obs.kickoffUtc}).`
        });
        return { updated: false, reason: 'POST_KICKOFF_SNAPSHOT_REJECTED' };
      }

      const checkpoint = SNAPSHOT_CHECKPOINTS.includes(snapshot.checkpoint) ? snapshot.checkpoint : 'T_MINUS_5';
      const oddsVal = Number(snapshot.odds);
      if (!Number.isFinite(oddsVal) || oddsVal <= 1.0) {
        return { updated: false, reason: 'INVALID_ODDS' };
      }

      const entryCore = {
        sequenceIndex: snapList.length,
        prevEventHash: snapList.length > 0 ? snapList[snapList.length - 1].eventHash : GENESIS_HASH,
        eventId: `snp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        observationId,
        checkpoint,
        capturedAtUtc,
        odds: round(oddsVal, 4),
        bookmaker: String(snapshot.bookmaker || 'Unknown'),
        marketFamily: String(snapshot.marketFamily || obs.marketFamily),
        selection: String(snapshot.selection || obs.selection).toUpperCase(),
        line: snapshot.line !== undefined ? snapshot.line : obs.line,
        source: snapshot.source || 'statshub_snapshot',
        contaminated: false
      };

      const clvResult = checkpoint === 'CLOSING'
        ? this.computeComparableCLV(obs, entryCore)
        : {
            status: 'CLV_UNAVAILABLE',
            clvPct: null,
            closingOdds: null,
            closingBookmaker: null,
            closingCapturedAtUtc: null,
            reason: 'Checkpoint no es CLOSING; no se asume como cuota de cierre.'
          };

      if (checkpoint === 'CLOSING' && clvResult.status === 'CLV_UNAVAILABLE') {
        this.logQualityAlert({
          code: 'NON_COMPARABLE_CLOSING_ODDS',
          severity: 'WARNING',
          matchId: obs.matchId,
          observationId,
          message: clvResult.reason,
          details: { obsLine: obs.line, closingLine: entryCore.line, obsBook: obs.bookmaker, closingBook: entryCore.bookmaker }
        });
      }

      const eventPayload = { ...entryCore, clvResult };
      const eventHash = sha256Canonical(eventPayload);
      snapList.push({ ...eventPayload, eventHash });
      this._atomicWriteJsonArray(this.snapshotsPath, snapList);

      return { updated: true, checkpoint, clv: clvResult, eventId: entryCore.eventId };
    });
  }

  computeComparableCLV(obs, closingSnap) {
    if (!closingSnap || closingSnap.checkpoint !== 'CLOSING' || closingSnap.contaminated) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'No existe cuota de cierre válida.' };
    }
    const capMs = Date.parse(closingSnap.capturedAtUtc);
    const koMs = Date.parse(obs.kickoffUtc);
    if (!Number.isFinite(capMs) || !Number.isFinite(koMs) || capMs >= koMs) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'Cuota de cierre posterior o igual al kickoff.' };
    }
    if (String(closingSnap.marketFamily) !== String(obs.marketFamily)) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'Mercado no comparable para CLV.' };
    }
    if (String(closingSnap.selection).toUpperCase() !== String(obs.selection).toUpperCase()) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: 'Selección no comparable para CLV.' };
    }
    const obsBk = String(obs.bookmaker || '').trim();
    const closeBk = String(closingSnap.bookmaker || '').trim();
    if (!obsBk || !closeBk || obsBk === 'BOOKMAKER_UNAVAILABLE' || closeBk === 'BOOKMAKER_UNAVAILABLE' || obsBk === 'StatsHubBest' || closeBk === 'StatsHubBest') {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: `Bookmaker no identificado (${obsBk} / ${closeBk}): no comparable.` };
    }
    if (closeBk.toLowerCase() !== obsBk.toLowerCase()) {
      return { status: 'CLV_UNAVAILABLE', clvPct: null, reason: `Bookmaker distinto (${obsBk} vs ${closeBk}).` };
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

  // --- EVENTOS APPEND-ONLY DE LIQUIDACIÓN Y CORRECCIONES ---

  appendSettlementEvent(eventData) {
    return this._withFileLock(() => {
      const obsList = this._readJsonArrayStrict(this.obsPath);
      const settList = this._readJsonArrayStrict(this.settlementsPath);
      this._assertChainIntact(obsList, null, settList);

      const obs = obsList.find(o => o.observationId === eventData.observationId);
      if (!obs) return { appended: false, reason: 'OBSERVATION_NOT_FOUND' };

      // Idempotencia atómica bajo lock inter-proceso para SETTLEMENT inicial
      const priorForObs = settList.filter(e => e.observationId === eventData.observationId);
      if (eventData.eventType === 'SETTLEMENT' && priorForObs.some(e => e.eventType === 'SETTLEMENT')) {
        const last = priorForObs[priorForObs.length - 1];
        return { appended: false, idempotent: true, reason: 'ALREADY_SETTLED', status: last.status };
      }

      const core = {
        sequenceIndex: settList.length,
        prevEventHash: settList.length > 0 ? settList[settList.length - 1].eventHash : GENESIS_HASH,
        eventId: `set_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        ...eventData
      };
      const eventHash = sha256Canonical(core);
      settList.push({ ...core, eventHash });
      this._atomicWriteJsonArray(this.settlementsPath, settList);

      return { appended: true, eventId: core.eventId, eventHash };
    });
  }
}

module.exports = {
  ObservationStore,
  SNAPSHOT_CHECKPOINTS,
  GENESIS_HASH,
  canonicalStringify,
  sha256Canonical,
  validateNoVig1X2
};
