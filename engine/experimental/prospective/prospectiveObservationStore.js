/**
 * DARADORBET — FASE 11: STORE DE OBSERVACIÓN PROSPECTIVA (APPEND-ONLY, SHA-256, VERSIONADO)
 *
 * Mantiene 4 circuitos estrictamente separados:
 *   - OPERATIVO
 *   - CONTRAFACTUAL
 *   - RETO_ESCALERA
 *   - SHADOW_OBSERVACION
 *
 * Control de sesgo temporal:
 *   - Rechaza cualquier snapshot prospectivo prepartido con detectedAtUtc >= kickoffUtc
 *     o evaluatedAtUtc >= kickoffUtc o estado LIVE/FINISHED.
 *   - Nunca sobrescribe snapshots originales: cambios de cuota/línea/alineación crean
 *     una nueva versión vinculada (previousVersionId).
 *   - Nunca permite convertir una aprobación contrafactual en circuito OPERATIVO.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SD = path.join(__dirname, '..', '..', 'storage_data');
const DEFAULT_SNAPSHOT_PATH = path.join(SD, 'fase11_prospective_snapshots.json');
const DEFAULT_SETTLEMENT_PATH = path.join(SD, 'fase11_prospective_settlements.json');
const GENESIS_HASH = '0'.repeat(64);

const VALID_CIRCUITS = new Set(['OPERATIVO', 'CONTRAFACTUAL', 'RETO_ESCALERA', 'SHADOW_OBSERVACION']);
const VALID_SETTLEMENTS = new Set(['WON', 'LOST', 'VOID', 'HALF_WON', 'HALF_LOST', 'UNAVAILABLE']);

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
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

class ProspectiveObservationStore {
  constructor(options = {}) {
    this.snapshotPath = options.snapshotPath || DEFAULT_SNAPSHOT_PATH;
    this.settlementPath = options.settlementPath || DEFAULT_SETTLEMENT_PATH;
  }

  _readSnapshots() {
    if (!fs.existsSync(this.snapshotPath)) {
      return {
        schemaVersion: '1.0.0',
        phase: 'FASE_11_PROSPECTIVE_OBSERVATION',
        autoExecutionAllowed: false,
        genesisHash: GENESIS_HASH,
        records: []
      };
    }
    return JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
  }

  _readSettlements() {
    if (!fs.existsSync(this.settlementPath)) {
      return {
        schemaVersion: '1.0.0',
        phase: 'FASE_11_PROSPECTIVE_SETTLEMENTS',
        autoExecutionAllowed: false,
        genesisHash: GENESIS_HASH,
        records: []
      };
    }
    return JSON.parse(fs.readFileSync(this.settlementPath, 'utf8'));
  }

  getAllSnapshots() {
    return this._readSnapshots().records;
  }

  getLatestSnapshotsByKey() {
    const map = new Map();
    for (const r of this.getAllSnapshots()) {
      map.set(r.opportunityKey, r);
    }
    return Array.from(map.values());
  }

  getVersionsForKey(opportunityKey) {
    return this.getAllSnapshots().filter(r => r.opportunityKey === opportunityKey);
  }

  getAllSettlements() {
    return this._readSettlements().records;
  }

  getSettlementByKey(opportunityKey) {
    return this.getAllSettlements().find(s => s.opportunityKey === opportunityKey) || null;
  }

  /**
   * Registra un snapshot prospectivo inmutable.
   * Si ya existe un snapshot para opportunityKey, crea una nueva versión vinculada.
   */
  recordSnapshot(input) {
    const circuit = String(input.circuit || 'SHADOW_OBSERVACION').toUpperCase();
    if (!VALID_CIRCUITS.has(circuit)) {
      throw new Error(`INVALID_CIRCUIT: Circuito no reconocido (${circuit}).`);
    }

    // Bloqueo de conversión contrafactual -> operativo
    if (circuit === 'OPERATIVO' && (input.originCircuit === 'CONTRAFACTUAL' || String(input.elenaDecision || '').startsWith('COUNTERFACTUAL_'))) {
      throw new Error('CIRCUIT_ISOLATION_VIOLATION: Una aprobación contrafactual nunca puede ingresar al circuito OPERATIVO.');
    }

    if (!input.detectedAtUtc || isNaN(new Date(input.detectedAtUtc).getTime())) {
      throw new Error('MISSING_DETECTION_TIMESTAMP: Todo snapshot prospectivo requiere detectedAtUtc verificable.');
    }
    const detectedTs = new Date(input.detectedAtUtc).getTime();
    const evaluatedAtUtc = input.evaluatedAtUtc || input.detectedAtUtc;
    const evaluatedTs = new Date(evaluatedAtUtc).getTime();

    const kickoffUtc = input.kickoffUtc || null;
    const kickoffTs = kickoffUtc ? new Date(kickoffUtc).getTime() : null;
    const matchState = String(input.matchStateAtEvaluation || 'PREMATCH').toUpperCase();

    // Control estricto de sesgo temporal para circuitos prospectivos prepartido
    if (circuit !== 'CONTRAFACTUAL') {
      if (matchState === 'LIVE' || matchState === 'IN_PLAY' || matchState === 'FINISHED' || matchState === 'FINALIZADO') {
        throw new Error(`PROSPECTIVE_TEMPORAL_VIOLATION: No se permite registrar evento ${matchState} como oportunidad prospectiva prepartido.`);
      }
      if (kickoffTs !== null && (detectedTs >= kickoffTs || evaluatedTs >= kickoffTs)) {
        throw new Error(`PROSPECTIVE_TEMPORAL_VIOLATION: detectedAtUtc/evaluatedAtUtc >= kickoffUtc (${kickoffUtc}).`);
      }
      if (input.isRetrospective === true) {
        throw new Error('PROSPECTIVE_TEMPORAL_VIOLATION: No se permite registrar un pick retrospectivo como prospectivo.');
      }
    }

    const store = this._readSnapshots();
    const records = store.records;
    const prevRec = records.length > 0 ? records[records.length - 1] : null;
    const prevHash = prevRec ? prevRec.recordHash : GENESIS_HASH;

    const opportunityKey = input.opportunityKey || `${input.matchId || input.match}|${input.market}|${input.selection}|${input.line}`;
    const priorVersions = records.filter(r => r.opportunityKey === opportunityKey);
    const lastVer = priorVersions.length > 0 ? priorVersions[priorVersions.length - 1] : null;
    const versionNumber = lastVer ? lastVer.versionNumber + 1 : 1;
    const previousVersionId = lastVer ? lastVer.snapshotId : null;

    const snapshotId = input.snapshotId || `prosp_${Date.now()}_${records.length + 1}_v${versionNumber}`;
    const body = {
      snapshotId,
      opportunityKey,
      versionNumber,
      previousVersionId,
      circuit,
      autoExecutionAllowed: false,
      sequenceIndex: records.length + 1,
      matchId: input.matchId || null,
      match: input.match || null,
      competition: input.competition || input.league || null,
      market: input.market || null,
      selection: input.selection || null,
      line: input.line || null,
      odds: input.odds ?? null,
      bookmaker: input.bookmaker || 'UNKNOWN',
      source: input.source || 'StatsHub',
      modelProbability: input.modelProbability ?? null,
      expectedValuePct: input.expectedValuePct ?? null,
      elenaDecision: input.elenaDecision || 'PENDIENTE_EVALUACION',
      riskManagerDecision: input.riskManagerDecision || 'PENDIENTE',
      detectedAtUtc: input.detectedAtUtc,
      evaluatedAtUtc,
      kickoffUtc,
      matchStateAtEvaluation: matchState,
      lineupStatus: input.lineupStatus || 'PENDIENTE_T60',
      playerAvailability: input.playerAvailability || null,
      modelVersion: input.modelVersion || 'Beta-Binomial-v2.3',
      criteriaVersion: input.criteriaVersion || 'Elena-v2.0',
      availableDataSnapshot: input.availableDataSnapshot || {},
      prevHash
    };

    const recordHash = sha256(body);
    const sealed = { ...body, recordHash };
    store.records.push(sealed);
    store.updatedAtUtc = new Date().toISOString();
    atomicWriteJson(this.snapshotPath, store);
    return sealed;
  }

  /**
   * Liquidación prospectiva idempotente (append-only, SHA-256).
   */
  settleOpportunity(opportunityKey, settlementInput) {
    const outcome = String(settlementInput.outcome || '').toUpperCase();
    if (!VALID_SETTLEMENTS.has(outcome)) {
      throw new Error(`INVALID_SETTLEMENT_OUTCOME: ${outcome}`);
    }
    if (settlementInput.confirmed !== true && outcome !== 'UNAVAILABLE') {
      return { settled: false, reason: 'RESULT_NOT_CONFIRMED: No se liquida sin confirmación oficial.' };
    }

    const store = this._readSettlements();
    const existing = store.records.find(s => s.opportunityKey === opportunityKey);
    if (existing) {
      return { settled: true, duplicate: true, record: existing };
    }

    const snap = this.getVersionsForKey(opportunityKey).slice(-1)[0];
    if (!snap) {
      throw new Error(`SNAPSHOT_NOT_FOUND: No existe snapshot para ${opportunityKey}`);
    }

    const prevRec = store.records.length > 0 ? store.records[store.records.length - 1] : null;
    const prevHash = prevRec ? prevRec.recordHash : GENESIS_HASH;
    const odds = snap.odds;
    let profitUnits = 0;
    if (odds && outcome === 'WON') profitUnits = Number((odds - 1).toFixed(4));
    else if (odds && outcome === 'LOST') profitUnits = -1.0;
    else if (odds && outcome === 'HALF_WON') profitUnits = Number(((odds - 1) / 2).toFixed(4));
    else if (odds && outcome === 'HALF_LOST') profitUnits = -0.5;

    const body = {
      settlementId: `prosp_settle_${Date.now()}_${store.records.length + 1}`,
      sequenceIndex: store.records.length + 1,
      opportunityKey,
      snapshotId: snap.snapshotId,
      circuit: snap.circuit,
      outcome,
      actualStat: settlementInput.actualStat ?? null,
      odds,
      profitUnits,
      settledAtUtc: settlementInput.settledAtUtc || new Date().toISOString(),
      source: settlementInput.source || 'StatsHub Oficial',
      reason: settlementInput.reason || '',
      prevHash
    };

    const recordHash = sha256(body);
    const sealed = { ...body, recordHash };
    store.records.push(sealed);
    store.updatedAtUtc = new Date().toISOString();
    atomicWriteJson(this.settlementPath, store);
    return { settled: true, duplicate: false, record: sealed };
  }

  verifyChain() {
    const store = this._readSnapshots();
    let expectedPrev = GENESIS_HASH;
    const violations = [];
    for (let i = 0; i < store.records.length; i++) {
      const r = store.records[i];
      if (r.prevHash !== expectedPrev) violations.push({ index: i, snapshotId: r.snapshotId, reason: 'PREV_HASH_MISMATCH' });
      const { recordHash, ...body } = r;
      if (sha256(body) !== recordHash) violations.push({ index: i, snapshotId: r.snapshotId, reason: 'RECORD_HASH_MISMATCH' });
      expectedPrev = recordHash;
    }
    return { ok: violations.length === 0, totalSnapshots: store.records.length, violations };
  }
}

module.exports = {
  ProspectiveObservationStore,
  VALID_CIRCUITS,
  VALID_SETTLEMENTS,
  DEFAULT_SNAPSHOT_PATH,
  DEFAULT_SETTLEMENT_PATH
};
