/**
 * DARADORBET — COUNTERFACTUAL ELENA STORE (APPEND-ONLY, SHA-256 CHAINED, VERSIONED)
 *
 * Circuito 100% independiente del circuito operativo (approved_picks / historial_picks / bankroll).
 * - Append-only con encadenamiento criptográfico SHA-256 (prevHash -> recordHash).
 * - Versionado inmutable: reevaluar un mismo pick crea una nueva versión vinculada (previousVersionId).
 * - Liquidación virtual idempotente en archivo separado sin tocar liquidaciones reales.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LEDGER_PATH = path.join(__dirname, '..', '..', 'storage_data', 'counterfactual_elena_ledger.json');
const DEFAULT_SETTLEMENT_PATH = path.join(__dirname, '..', '..', 'storage_data', 'counterfactual_elena_settlements.json');
const GENESIS_HASH = '0'.repeat(64);

function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

function sha256(payload) {
  return crypto.createHash('sha256').update(typeof payload === 'string' ? payload : canonicalize(payload)).digest('hex');
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

class CounterfactualStore {
  constructor(options = {}) {
    this.ledgerPath = options.ledgerPath || DEFAULT_LEDGER_PATH;
    this.settlementPath = options.settlementPath || DEFAULT_SETTLEMENT_PATH;
  }

  _readLedger() {
    if (!fs.existsSync(this.ledgerPath)) {
      return {
        schemaVersion: '1.0.0',
        circuit: 'COUNTERFACTUAL_RESEARCH_ONLY',
        autoExecutionAllowed: false,
        operationalIsolation: true,
        genesisHash: GENESIS_HASH,
        records: []
      };
    }
    return JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
  }

  _readSettlements() {
    if (!fs.existsSync(this.settlementPath)) {
      return {
        schemaVersion: '1.0.0',
        circuit: 'COUNTERFACTUAL_VIRTUAL_SETTLEMENT',
        autoExecutionAllowed: false,
        genesisHash: GENESIS_HASH,
        records: []
      };
    }
    return JSON.parse(fs.readFileSync(this.settlementPath, 'utf8'));
  }

  getAllEvaluations() {
    return this._readLedger().records;
  }

  getLatestEvaluationsByPick() {
    const all = this.getAllEvaluations();
    const map = new Map();
    for (const rec of all) {
      map.set(rec.originalPickId, rec);
    }
    return Array.from(map.values());
  }

  getVersionsForPick(originalPickId) {
    return this.getAllEvaluations().filter(r => r.originalPickId === originalPickId);
  }

  getAllSettlements() {
    return this._readSettlements().records;
  }

  getSettlementByEvaluationId(evaluationId) {
    return this.getAllSettlements().find(s => s.evaluationId === evaluationId) || null;
  }

  /**
   * Append-only: agrega una nueva evaluación contrafactual encadenada criptográficamente.
   * Si ya existía una evaluación previa para originalPickId, crea una nueva versión vinculada.
   */
  appendEvaluation(recordInput) {
    const ledger = this._readLedger();
    const records = ledger.records;
    const prevRecord = records.length > 0 ? records[records.length - 1] : null;
    const prevHash = prevRecord ? prevRecord.recordHash : GENESIS_HASH;

    const priorVersions = records.filter(r => r.originalPickId === recordInput.originalPickId);
    const lastVersionForPick = priorVersions.length > 0 ? priorVersions[priorVersions.length - 1] : null;
    const versionNumber = lastVersionForPick ? lastVersionForPick.versionNumber + 1 : 1;
    const previousVersionId = lastVersionForPick ? lastVersionForPick.evaluationId : null;

    const evaluationId = recordInput.evaluationId || `cf_eval_${Date.now()}_${records.length + 1}_v${versionNumber}`;
    const body = {
      evaluationId,
      circuit: 'COUNTERFACTUAL',
      autoExecutionAllowed: false,
      sequenceIndex: records.length + 1,
      versionNumber,
      previousVersionId,
      originalPickId: recordInput.originalPickId,
      matchId: recordInput.matchId || null,
      match: recordInput.match || null,
      league: recordInput.league || null,
      market: recordInput.market || null,
      selection: recordInput.selection || null,
      line: recordInput.line || null,
      evaluatedAtUtc: recordInput.evaluatedAtUtc,
      kickoffUtc: recordInput.kickoffUtc || null,
      matchStateAtEvaluation: recordInput.matchStateAtEvaluation,
      availableDataSnapshot: recordInput.availableDataSnapshot || {},
      odds: recordInput.odds ?? null,
      oddsTimestampUtc: recordInput.oddsTimestampUtc || null,
      elenaProbability: recordInput.elenaProbability ?? null,
      expectedValuePct: recordInput.expectedValuePct ?? null,
      decision: recordInput.decision,
      dataSufficiency: recordInput.dataSufficiency || 'SUFFICIENT',
      decisionReasons: Array.isArray(recordInput.decisionReasons) ? recordInput.decisionReasons : [],
      settlementResult: recordInput.settlementResult || null,
      modelVersion: recordInput.modelVersion || 'unknown',
      elenaVersion: recordInput.elenaVersion || '2.0.0-cf',
      prevHash
    };

    const recordHash = sha256(body);
    const sealed = { ...body, recordHash };
    ledger.records.push(sealed);
    ledger.updatedAtUtc = new Date().toISOString();
    atomicWriteJson(this.ledgerPath, ledger);
    return sealed;
  }

  /**
   * Append-only e idempotente: registra una liquidación virtual para una evaluación aprobada.
   */
  appendSettlement(settlementInput) {
    const store = this._readSettlements();
    const existing = store.records.find(s => s.evaluationId === settlementInput.evaluationId);
    if (existing) {
      return { record: existing, duplicate: true };
    }

    const prevRecord = store.records.length > 0 ? store.records[store.records.length - 1] : null;
    const prevHash = prevRecord ? prevRecord.recordHash : GENESIS_HASH;

    const body = {
      settlementId: settlementInput.settlementId || `cf_settle_${Date.now()}_${store.records.length + 1}`,
      circuit: 'COUNTERFACTUAL_VIRTUAL_SETTLEMENT',
      autoExecutionAllowed: false,
      sequenceIndex: store.records.length + 1,
      evaluationId: settlementInput.evaluationId,
      originalPickId: settlementInput.originalPickId,
      matchId: settlementInput.matchId || null,
      match: settlementInput.match || null,
      market: settlementInput.market || null,
      league: settlementInput.league || null,
      odds: settlementInput.odds ?? null,
      elenaProbability: settlementInput.elenaProbability ?? null,
      stakeVirtual: settlementInput.stakeVirtual ?? 1.0,
      status: settlementInput.status, // COUNTERFACTUAL_WON | COUNTERFACTUAL_LOST | COUNTERFACTUAL_VOID | COUNTERFACTUAL_UNAVAILABLE
      actualStat: settlementInput.actualStat ?? null,
      profitVirtual: settlementInput.profitVirtual ?? 0,
      settledAtUtc: settlementInput.settledAtUtc || new Date().toISOString(),
      source: settlementInput.source || 'official_result',
      reason: settlementInput.reason || '',
      prevHash
    };

    const recordHash = sha256(body);
    const sealed = { ...body, recordHash };
    store.records.push(sealed);
    store.updatedAtUtc = new Date().toISOString();
    atomicWriteJson(this.settlementPath, store);
    return { record: sealed, duplicate: false };
  }

  verifyChain() {
    const ledger = this._readLedger();
    let expectedPrev = GENESIS_HASH;
    const violations = [];

    for (let i = 0; i < ledger.records.length; i++) {
      const rec = ledger.records[i];
      if (rec.prevHash !== expectedPrev) {
        violations.push({ index: i, evaluationId: rec.evaluationId, reason: 'PREV_HASH_MISMATCH' });
      }
      const { recordHash, ...body } = rec;
      const recomputed = sha256(body);
      if (recomputed !== recordHash) {
        violations.push({ index: i, evaluationId: rec.evaluationId, reason: 'RECORD_HASH_MISMATCH' });
      }
      expectedPrev = recordHash;
    }

    return {
      ok: violations.length === 0,
      totalRecords: ledger.records.length,
      violations
    };
  }
}

module.exports = {
  CounterfactualStore,
  canonicalize,
  sha256,
  DEFAULT_LEDGER_PATH,
  DEFAULT_SETTLEMENT_PATH
};
