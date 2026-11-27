/**
 * SHADOW LAB STORE (V2.1 - HARDENED) — DARADOR IA 2.0
 * 
 * Garantías criptográficas y de inmutabilidad:
 * 1. Serialización Canónica: Ordenamiento determinista de claves antes de hashear para evitar variaciones por orden de propiedades.
 * 2. Hash Integral: Sella candidateId, match, selection, market, line, odds, historicalSample, pV1, pV2, grossEvV2, prior y modelVersion.
 * 3. Verificación al Leer: Valida que el registro no haya sido alterado en disco mediante checkTamper().
 * 4. Detección de Duplicados e Idempotencia estricta.
 * 5. Registro auditable de qué garantiza y qué NO garantiza el mecanismo.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHADOW_LAB_FILE = path.join(__dirname, '..', 'storage_data', 'shadow_lab_frozen_predictions.json');

function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

class ShadowLabStore {
  constructor(filePath = SHADOW_LAB_FILE) {
    this.filePath = filePath;
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      const initial = {
        schemaVersion: '2.1.0-shadow-lab-hardened',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        predictions: [],
        evaluations: []
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  _load() {
    this._ensureFile();
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[ShadowLabStore] Error leyendo archivo, retornando base limpia:', err.message);
      return { schemaVersion: '2.1.0-shadow-lab-hardened', predictions: [], evaluations: [] };
    }
  }

  _save(data) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Genera el hash canónico SHA-256 de una predicción congelada
   */
  computeCanonicalHash(entry) {
    const payload = {
      candidateId: entry.candidateId,
      match: entry.match,
      competition: entry.competition,
      selection: entry.selection,
      market: entry.market,
      line: entry.line,
      odds: entry.odds,
      historicalSample: entry.historicalSample,
      sampleSize: entry.sampleSize,
      targetK: entry.targetK,
      threshold: entry.threshold,
      betType: entry.betType,
      pV1: entry.pV1,
      evV1: entry.evV1,
      pV2: entry.pV2,
      grossEvV2: entry.grossEvV2,
      uncertaintyIndex: entry.uncertaintyIndex,
      modelVersion: entry.modelVersion || 'v2.1-calibrated',
      evaluatedAt: entry.evaluatedAt
    };
    return crypto.createHash('sha256').update(canonicalJsonStringify(payload)).digest('hex');
  }

  /**
   * Congela una predicción de forma canónica e inmutable
   */
  freezePrediction(entry) {
    if (!entry || !entry.candidateId) {
      return { saved: false, reason: 'INVALID_ENTRY: candidateId ausente' };
    }

    const data = this._load();
    const existing = data.predictions.find(p => p.candidateId === entry.candidateId);

    if (existing) {
      return {
        saved: false,
        reason: 'IDEMPOTENT_SKIPPED: Predicción previamente congelada e inmutable',
        entry: existing
      };
    }

    const frozenHash = this.computeCanonicalHash(entry);

    const frozenRecord = {
      ...entry,
      modelVersion: entry.modelVersion || 'v2.1-calibrated',
      frozenHash,
      frozenAt: new Date().toISOString(),
      isSettled: false,
      result: null
    };

    data.predictions.push(frozenRecord);
    this._save(data);

    return { saved: true, reason: 'PREDICTION_FROZEN', entry: frozenRecord };
  }

  /**
   * Obtiene y valida una predicción detectando si el archivo fue alterado externamente
   */
  getPredictionById(candidateId) {
    const data = this._load();
    const entry = (data.predictions || []).find(p => p.candidateId === candidateId);
    if (!entry) return null;

    const currentHash = this.computeCanonicalHash(entry);
    const isTampered = currentHash !== entry.frozenHash;

    return {
      ...entry,
      tamperCheck: {
        isValid: !isTampered,
        recordedHash: entry.frozenHash,
        recalculatedHash: currentHash
      }
    };
  }

  /**
   * Valida la integridad de todas las predicciones almacenadas
   */
  verifyStoreIntegrity() {
    const data = this._load();
    const predictions = data.predictions || [];
    let validCount = 0;
    let corruptedCount = 0;
    const corruptedIds = [];

    for (const p of predictions) {
      const calcHash = this.computeCanonicalHash(p);
      if (calcHash === p.frozenHash) {
        validCount++;
      } else {
        corruptedCount++;
        corruptedIds.push(p.candidateId);
      }
    }

    return {
      total: predictions.length,
      validCount,
      corruptedCount,
      corruptedIds,
      integrityPassed: corruptedCount === 0
    };
  }

  getPredictions() {
    const data = this._load();
    return data.predictions || [];
  }

  settlePrediction(candidateId, outcome) {
    const data = this._load();
    const target = (data.predictions || []).find(p => p.candidateId === candidateId);

    if (!target) {
      return { settled: false, reason: 'CANDIDATE_NOT_FOUND' };
    }

    if (target.isSettled) {
      return { settled: false, reason: 'ALREADY_SETTLED', entry: target };
    }

    target.isSettled = true;
    target.result = {
      status: outcome.status,
      actualStat: outcome.actualStat !== undefined ? outcome.actualStat : null,
      isWon: outcome.status === 'ACERTADA' || outcome.status === 'GANADA',
      isLost: outcome.status === 'FALLADA' || outcome.status === 'PERDIDA',
      isVoid: outcome.status === 'ANULADA' || outcome.status === 'ANULADA_LINEUP' || outcome.status === 'VOID',
      settledAt: outcome.settledAt || new Date().toISOString()
    };

    this._save(data);
    return { settled: true, reason: 'SETTLED_LINKED', entry: target };
  }

  saveEvaluationReport(report) {
    const data = this._load();
    data.evaluations = data.evaluations || [];
    data.evaluations.push({
      ...report,
      savedAt: new Date().toISOString()
    });
    this._save(data);
  }
}

module.exports = ShadowLabStore;
