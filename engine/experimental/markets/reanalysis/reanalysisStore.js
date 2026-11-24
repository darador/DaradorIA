/**
 * FASE 10.2 — REANALYSIS VERSION STORE (VERSIONADO INMUTABLE + CADENA SHA-256)
 *
 * Persiste cada evaluación/reanálisis como una versión nueva e inmutable,
 * vinculada mediante previousAnalysisId, sin sobrescribir nunca análisis previos.
 *
 * Garantías:
 *  - Lock inter-proceso O_EXCL + escritura atómica (tmp -> fsync -> rename).
 *  - Cadena SHA-256 canónica (sequenceIndex, prevAnalysisHash, analysisHash).
 *  - Guardia temporal estricta: analyzedAtUtc < kickoffUtc.
 *  - autoExecutionAllowed = false siempre.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { GENESIS_HASH, canonicalStringify, sha256Canonical } = require('../observation/observationStore');

const STORAGE_DIR = path.resolve(__dirname, '..', '..', '..', 'storage_data');
const DEFAULT_VERSIONS_PATH = path.join(STORAGE_DIR, 'fase10_2_reanalysis_versions.json');

function round(v, d = 6) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

class ReanalysisStore {
  constructor(options = {}) {
    this.versionsPath = options.versionsPath || DEFAULT_VERSIONS_PATH;
    this.lockPath = options.lockPath || `${this.versionsPath}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.staleLockMs = options.staleLockMs ?? 15000;
    this.autoExecutionAllowed = false;
  }

  _withLock(fn) {
    const dir = path.dirname(this.lockPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    let acquired = false;

    while (Date.now() <= deadline) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAtMs: Date.now() }), 0, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        acquired = true;
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          const info = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
          if (Date.now() - Number(info.createdAtMs || 0) > this.staleLockMs && !isProcessAlive(Number(info.pid))) {
            try { fs.unlinkSync(this.lockPath); } catch (_) {}
            continue;
          }
        } catch (_) {}
        sleepSync(20);
      }
    }

    if (!acquired) {
      const e = new Error(`REANALYSIS_LOCK_TIMEOUT: ${this.lockPath}`);
      e.code = 'LOCK_TIMEOUT';
      throw e;
    }

    try { return fn(); } finally {
      try { fs.unlinkSync(this.lockPath); } catch (_) {}
    }
  }

  _readStrict() {
    if (!fs.existsSync(this.versionsPath)) return [];
    const raw = fs.readFileSync(this.versionsPath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const bak = `${this.versionsPath}.${Date.now()}.corrupt.bak`;
      try { fs.copyFileSync(this.versionsPath, bak); } catch (_) {}
      const e = new Error(`REANALYSIS_STORE_CORRUPT: ${err.message} (backup: ${bak})`);
      e.code = 'LEDGER_CORRUPTION_ERROR';
      throw e;
    }
    if (!Array.isArray(parsed)) {
      const e = new Error('REANALYSIS_STORE_CORRUPT: root is not an array');
      e.code = 'LEDGER_CORRUPTION_ERROR';
      throw e;
    }
    return parsed;
  }

  _atomicWrite(arr) {
    const dir = path.dirname(this.versionsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.versionsPath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(arr, null, 2), 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.versionsPath);
  }

  _verifyChain(list) {
    let expectedPrev = GENESIS_HASH;
    const errors = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.sequenceIndex !== i) errors.push(`SEQ_MISMATCH@${i}`);
      if (item.prevAnalysisHash !== expectedPrev) errors.push(`CHAIN_BREAK@${i}`);
      const { analysisHash, ...core } = item;
      if (sha256Canonical(core) !== analysisHash) errors.push(`HASH_MISMATCH@${i}`);
      expectedPrev = analysisHash;
    }
    return { ok: errors.length === 0, total: list.length, errors };
  }

  verifyIntegrity() {
    return this._verifyChain(this._readStrict());
  }

  getAllVersions() {
    const list = this._readStrict();
    const check = this._verifyChain(list);
    if (!check.ok) {
      const e = new Error(`REANALYSIS_INTEGRITY_ERROR: ${check.errors.join(', ')}`);
      e.code = 'LEDGER_INTEGRITY_ERROR';
      throw e;
    }
    return list;
  }

  getLatestByOpportunityId() {
    const list = this.getAllVersions();
    const map = new Map();
    for (const v of list) {
      map.set(v.opportunityId, v);
    }
    return map;
  }

  getHistoryForOpportunity(opportunityId) {
    return this.getAllVersions().filter(v => v.opportunityId === opportunityId);
  }

  /**
   * Registra una nueva versión inmutable de análisis prepartido.
   * Bloquea estrictamente si analyzedAtUtc >= kickoffUtc (a menos que sea estado EXPIRED explícito).
   */
  appendVersion(payload) {
    return this._withLock(() => {
      const list = this._readStrict();
      const check = this._verifyChain(list);
      if (!check.ok) {
        const e = new Error(`REANALYSIS_INTEGRITY_ERROR: ${check.errors.join(', ')}`);
        e.code = 'LEDGER_INTEGRITY_ERROR';
        throw e;
      }

      const analyzedAtUtc = payload.analyzedAtUtc || new Date().toISOString();
      const kickoffUtc = payload.kickoffUtc || null;
      const aMs = Date.parse(analyzedAtUtc);
      const koMs = Date.parse(kickoffUtc);

      if (!Number.isFinite(aMs) || !Number.isFinite(koMs)) {
        return { recorded: false, reason: 'INVALID_TIMESTAMPS' };
      }

      // Regla anti-leakage: nunca registrar análisis prepartido posterior al kickoff
      if (aMs >= koMs && payload.status !== 'EXPIRED') {
        return { recorded: false, reason: 'POST_KICKOFF_REANALYSIS_BLOCKED' };
      }

      // Idempotencia: si existe versión idéntica en contenido clave para la misma oportunidad en mismo timestamp/estado
      const prevList = list.filter(v => v.opportunityId === payload.opportunityId);
      const prev = prevList.length > 0 ? prevList[prevList.length - 1] : null;
      if (
        prev &&
        prev.odds === round(Number(payload.odds), 4) &&
        prev.bookmaker === payload.bookmaker &&
        prev.probability === round(Number(payload.probability), 6) &&
        prev.status === payload.status &&
        prev.line === (payload.line ?? null) &&
        prev.modelVersion === payload.modelVersion
      ) {
        return { recorded: false, idempotent: true, reason: 'UNCHANGED_VERSION_SKIPPED', analysisId: prev.analysisId };
      }

      const sequenceIndex = list.length;
      const prevAnalysisHash = list.length > 0 ? list[list.length - 1].analysisHash : GENESIS_HASH;
      const analysisId = `anl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      const core = {
        sequenceIndex,
        prevAnalysisHash,
        analysisId,
        opportunityId: String(payload.opportunityId),
        matchId: String(payload.matchId),
        match: String(payload.match || ''),
        league: String(payload.league || ''),
        marketFamily: String(payload.marketFamily || ''),
        market: String(payload.market || ''),
        selection: String(payload.selection || '').toUpperCase(),
        line: payload.line !== undefined ? payload.line : null,
        odds: Number.isFinite(Number(payload.odds)) ? round(Number(payload.odds), 4) : null,
        bookmaker: String(payload.bookmaker || 'BOOKMAKER_UNAVAILABLE'),
        probability: Number.isFinite(Number(payload.probability)) ? round(Number(payload.probability), 6) : null,
        fairOdds: Number.isFinite(Number(payload.fairOdds)) ? round(Number(payload.fairOdds), 4) : null,
        impliedProbability: Number.isFinite(Number(payload.impliedProbability)) ? round(Number(payload.impliedProbability), 6) : null,
        noVigProbability: Number.isFinite(Number(payload.noVigProbability)) ? round(Number(payload.noVigProbability), 6) : null,
        expectedValue: Number.isFinite(Number(payload.expectedValue)) ? round(Number(payload.expectedValue), 6) : null,
        expectedValuePct: Number.isFinite(Number(payload.expectedValuePct)) ? round(Number(payload.expectedValuePct), 2) : null,
        modelId: String(payload.modelId || 'MatchOutcomeDC'),
        modelVersion: String(payload.modelVersion || 'match-outcome-dc-v1.0-experimental'),
        dataCoverage: payload.dataCoverage || 'UNKNOWN',
        dataQualityScore: Number.isFinite(Number(payload.dataQualityScore)) ? round(Number(payload.dataQualityScore), 3) : null,
        evidenceTier: String(payload.evidenceTier || 'INSUFFICIENT_SAMPLE'),
        analyzedAtUtc,
        kickoffUtc,
        previousAnalysisId: prev ? prev.analysisId : null,
        changeReason: Array.isArray(payload.changeReason) ? payload.changeReason : [String(payload.changeReason || 'INITIAL_ANALYSIS')],
        status: String(payload.status),
        elenaSummary: payload.elenaSummary || null,
        riskManagerSummary: payload.riskManagerSummary || null,
        autoExecutionAllowed: false
      };

      const analysisHash = sha256Canonical(core);
      const record = { ...core, analysisHash };
      list.push(record);
      this._atomicWrite(list);

      return { recorded: true, analysisId, sequenceIndex, analysisHash, previousAnalysisId: core.previousAnalysisId };
    });
  }
}

module.exports = {
  ReanalysisStore
};
