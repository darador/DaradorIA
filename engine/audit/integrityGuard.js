/**
 * AUDIT INTEGRITY GUARD - SELLO CRIPTOGRÁFICO SHA-256 Y DETECCIÓN DE ALTERACIONES
 * DaradorIA / DaradorBET - Fase 10.1.2
 * 
 * Protege la inmutabilidad de los registros históricos mediante:
 * 1. Generación de hash SHA-256 canónico por observación (datos pre-match congelados).
 * 2. Hash compuesto de liquidación oficial (pre-match + settlement oficial).
 * 3. Libro de firmas inmutable (ledger) independiente para verificar integridad.
 * 4. Detección automática de alteraciones posteriores en los datos o en los tests.
 * 5. Registro automático de incidentes y tentativas de modificación.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEDGER_FILE = path.resolve(__dirname, '..', 'storage_data', 'audit_integrity_ledger.json');
const TAMPERING_LOG_FILE = path.resolve(__dirname, '..', 'storage_data', 'tampering_log.json');

class IntegrityGuard {
  constructor() {
    this.ledgerPath = LEDGER_FILE;
    this.tamperLogPath = TAMPERING_LOG_FILE;
    this._ensureFilesExist();
  }

  _ensureFilesExist() {
    if (!fs.existsSync(this.ledgerPath)) {
      fs.writeFileSync(this.ledgerPath, JSON.stringify({}, null, 2), 'utf-8');
    }
    if (!fs.existsSync(this.tamperLogPath)) {
      fs.writeFileSync(this.tamperLogPath, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  /**
   * Genera el hash canónico SHA-256 de los atributos pre-partido congelados.
   * La canonicalización normaliza números, strings y nulls para garantizar reproducibilidad exacta.
   * @param {Object} record
   * @returns {string} SHA-256 hexadecimal
   */
  computePreMatchHash(record) {
    if (!record || typeof record !== 'object') return null;

    const canonicalFields = [
      record.pickId || '',
      record.eventId || '',
      record.playerOrTeam || '',
      record.market || '',
      record.line || '',
      Number(record.odds || 0).toFixed(2),
      typeof record.probModelB === 'number' ? Number(record.probModelB).toFixed(4) : 'NULL',
      typeof record.probModelC === 'number' ? Number(record.probModelC).toFixed(4) : 'NULL',
      typeof record.originalProb === 'number' ? Number(record.originalProb).toFixed(4) : 'NULL',
      record.modelVersionB || 'Model-B-L10',
      record.modelVersionC || 'Model-C-L15-L20',
      record.investigatedAt || ''
    ];

    const payload = canonicalFields.join('|');
    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /**
   * Genera el hash compuesto de liquidación oficial (Pre-Match + Settlement oficial)
   * @param {Object} record
   * @returns {string} SHA-256 hexadecimal
   */
  computeSettlementHash(record) {
    const preMatchHash = this.computePreMatchHash(record);
    if (!preMatchHash) return null;

    const payload = [
      preMatchHash,
      record.verificationStatus || 'PENDIENTE',
      record.finalResultConfirmed || 'NULL',
      record.actualStat !== null && record.actualStat !== undefined ? String(record.actualStat) : 'NULL',
      record.settledAt || '',
      record.verificationSource || ''
    ].join('::');

    return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /**
   * Sella el registro en el ledger criptográfico oficial si no existe.
   * Si ya existe, NO lo sobrescribe para preservar el timestamp de sellado inicial.
   * @param {Array<Object>} records
   * @returns {Object} Resumen de sellado
   */
  sealRecords(records = []) {
    let ledger = {};
    try {
      ledger = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf-8'));
    } catch (e) {
      ledger = {};
    }

    let newlySealed = 0;
    const timestamp = new Date().toISOString();

    for (const record of records) {
      if (!record.pickId) continue;
      // Excluir selecciones de prueba para que los tests no contaminen el libro sellado oficial
      if (record.isTestPick || record.pickId.startsWith('cand_test_') || record.pickId.startsWith('pick_test_')) {
        continue;
      }

      const preHash = this.computePreMatchHash(record);
      const postHash = this.computeSettlementHash(record);

      if (!ledger[record.pickId]) {
        ledger[record.pickId] = {
          pickId: record.pickId,
          sealedAt: timestamp,
          preMatchHash: preHash,
          settlementHash: postHash,
          modelVersionB: record.modelVersionB,
          modelVersionC: record.modelVersionC,
          odds: record.odds,
          probModelB: record.probModelB,
          probModelC: record.probModelC,
          finalResultConfirmed: record.finalResultConfirmed
        };
        newlySealed++;
      }
    }

    fs.writeFileSync(this.ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
    return { totalInLedger: Object.keys(ledger).length, newlySealed };
  }

  /**
   * Sella formalmente la liquidación oficial de una observación pre-sellada en el ledger.
   * Valida estrictamente que los datos pre-match no hayan sufrido ninguna alteración.
   * @param {Object} record Observación con liquidación confirmada
   * @returns {boolean}
   */
  sealSettlement(record) {
    if (!record || !record.pickId) return false;
    let ledger = {};
    try {
      ledger = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf-8'));
    } catch (e) {
      ledger = {};
    }

    const seal = ledger[record.pickId];
    if (seal) {
      const currentPreHash = this.computePreMatchHash(record);
      if (currentPreHash !== seal.preMatchHash) {
        throw new Error(`TAMPERING_DETECTED: Pre-match data altered for ${record.pickId}`);
      }
      seal.finalResultConfirmed = record.finalResultConfirmed;
      seal.settlementHash = this.computeSettlementHash(record);
      seal.settledAt = record.settledAt || new Date().toISOString();
      seal.actualStat = record.actualStat;
      fs.writeFileSync(this.ledgerPath, JSON.stringify(ledger, null, 2), 'utf-8');
      return true;
    }
    return false;
  }

  /**
   * Audita exhaustivamente la integridad del registro frente al ledger sellado.
   * Detecta cualquier modificación retrospectiva de probabilidades, cuotas o resultados.
   * @param {Array<Object>} records
   * @returns {Object} Informe de auditoría criptográfica
   */
  verifyIntegrity(records = []) {
    let ledger = {};
    try {
      ledger = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf-8'));
    } catch (e) {
      ledger = {};
    }

    const officialRecords = records.filter(r => !r.isTestPick && !r.pickId.startsWith('cand_test_') && !r.pickId.startsWith('pick_test_'));

    const report = {
      verifiedAt: new Date().toISOString(),
      totalChecked: officialRecords.length,
      intactCount: 0,
      alteredCount: 0,
      unsealedCount: 0,
      violations: [],
      ledgerEntries: Object.keys(ledger).length
    };

    for (const record of officialRecords) {
      const seal = ledger[record.pickId];
      if (!seal) {
        report.unsealedCount++;
        continue;
      }

      const currentPreHash = this.computePreMatchHash(record);
      const currentPostHash = this.computeSettlementHash(record);

      const isPreMatchIntact = currentPreHash === seal.preMatchHash;
      const isSettlementIntact = currentPostHash === seal.settlementHash;

      if (isPreMatchIntact && isSettlementIntact) {
        report.intactCount++;
      } else {
        report.alteredCount++;
        const violation = {
          pickId: record.pickId,
          playerOrTeam: record.playerOrTeam,
          market: record.market,
          detectedAt: new Date().toISOString(),
          preMatchAltered: !isPreMatchIntact,
          settlementAltered: !isSettlementIntact,
          expectedPreHash: seal.preMatchHash,
          actualPreHash: currentPreHash,
          originalProbModelB: seal.probModelB,
          currentProbModelB: record.probModelB,
          originalProbModelC: seal.probModelC,
          currentProbModelC: record.probModelC
        };
        report.violations.push(violation);
        this._logTamperingIncident(violation);
      }
    }

    return report;
  }

  _logTamperingIncident(incident) {
    try {
      let logs = [];
      if (fs.existsSync(this.tamperLogPath)) {
        logs = JSON.parse(fs.readFileSync(this.tamperLogPath, 'utf-8'));
      }
      logs.push(incident);
      fs.writeFileSync(this.tamperLogPath, JSON.stringify(logs, null, 2), 'utf-8');
      console.error(`🚨 [IntegrityGuard] ALERTA DE INTEGRIDAD: Alteración detectada en pick ${incident.pickId}`);
    } catch (e) {
      console.error('[IntegrityGuard] Error registrando incidente de alteración:', e.message);
    }
  }
}

module.exports = new IntegrityGuard();
