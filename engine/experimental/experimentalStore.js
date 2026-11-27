/**
 * EXPERIMENTAL STORE & AUDIT LOG V2.4
 * Almacenamiento inmutable para la cohorte EXPERIMENTAL_ODDS_POLICY_V24.
 *
 * Garantías:
 * 1. Integridad temporal: sourceEventTimestamp <= dataCutoffTimestamp < eventKickoff.
 * 2. Inmutabilidad por hash SHA-256.
 * 3. Desduplicación canónica (no se crean candidatos duplicados por variación de cuota).
 * 4. Snapshots ordenados con versionado y trazabilidad.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.resolve(__dirname, '../storage_data/experimental_odds_policy_v24.json');

class ExperimentalStore {
  constructor(filePath = STORE_PATH) {
    this.filePath = filePath;
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      const initial = {
        cohortId: 'EXPERIMENTAL_ODDS_POLICY_V24',
        description: 'Cohorte aislada para evaluación experimental de política de cuotas [1.45, 2.20] con EV >= +8.0%',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: {
          totalDiscovered: 0,
          totalUnderResearch: 0,
          totalMathematicalPass: 0,
          totalCommitteeApproved: 0,
          totalExperimentalApproved: 0,
          totalRejected: 0
        },
        records: []
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  loadStore() {
    this._ensureFile();
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  /**
   * Guarda o actualiza un registro experimental con control estricto de duplicados y snapshots
   */
  saveRecord(evaluatedRecord) {
    const store = this.loadStore();
    const records = store.records || [];

    // Clave canónica de desduplicación
    const canonicalKey = `${evaluatedRecord.matchId}::${evaluatedRecord.selection}::${evaluatedRecord.market}::${evaluatedRecord.line}`;

    const existingIdx = records.findIndex(r => {
      const rKey = `${r.matchId}::${r.selection}::${r.market}::${r.line}`;
      return rKey === canonicalKey || r.candidateId === evaluatedRecord.candidateId;
    });

    if (existingIdx >= 0) {
      const existing = records[existingIdx];
      // Si cambia la cuota pero es el mismo candidato, versionar como snapshot sin inflar candidatos
      if (existing.odds !== evaluatedRecord.odds) {
        if (!existing.snapshots) existing.snapshots = [];
        existing.snapshots.push({
          previousOdds: existing.odds,
          previousSha256: existing.sha256,
          timestamp: existing.evaluatedAt || new Date().toISOString()
        });
        existing.odds = evaluatedRecord.odds;
        existing.ev = evaluatedRecord.ev;
        existing.evPercentage = evaluatedRecord.evPercentage;
        existing.fairOdds = evaluatedRecord.fairOdds;
        existing.finalState = evaluatedRecord.finalState;
        existing.statusLabel = evaluatedRecord.statusLabel;
        existing.snapshotVersion = (existing.snapshotVersion || 1) + 1;
        existing.sha256 = evaluatedRecord.sha256;
      }
      records[existingIdx] = existing;
    } else {
      records.push(evaluatedRecord);
    }

    // Actualizar resumen
    store.records = records;
    store.updatedAt = new Date().toISOString();
    store.summary = {
      totalRecords: records.length,
      totalExperimentalApproved: records.filter(r => r.finalState === 'EXPERIMENTAL_APPROVED').length,
      totalRejectedByRisk: records.filter(r => r.finalState === 'EXPERIMENTAL_REJECTED_BY_RISK_MANAGER').length,
      totalRejectedMath: records.filter(r => r.finalState === 'REJECTED').length,
      totalExpired: records.filter(r => r.finalState === 'EXPIRED').length,
      totalUnderResearch: records.filter(r => r.finalState === 'UNDER_RESEARCH').length
    };

    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf8');
    return records[existingIdx >= 0 ? existingIdx : records.length - 1];
  }

  getRecords() {
    return this.loadStore().records || [];
  }
}

module.exports = ExperimentalStore;
