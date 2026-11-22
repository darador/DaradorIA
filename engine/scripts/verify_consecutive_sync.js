/**
 * DARADORIA / DARADORBET - PHASE 11.2.1 DOUBLE SYNC VERIFICATION
 * Executes synchronization twice consecutively and asserts:
 * 1. Exactly 20 total records.
 * 2. Exactly 19 decided results.
 * 3. Exactly 1 void bet (Javi Puado).
 * 4. Exact PnL of +0.67 U.
 * 5. Exactly 0 duplicates.
 * 6. Exactly 0 modifications to original pre-match hashes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const syncRadar = require('../data/syncRadar');
const tracker = require('../prediction/observationTracker');

console.log('================================================================');
console.log('🔄 EJECUTANDO VERIFICACIÓN DE SINCRONIZACIÓN DOBLE CONSECUTIVA');
console.log('================================================================\n');

// Snapshot pre-ejecución
const preAudit = tracker.verifyIntegrity();
assert.strictEqual(preAudit.alteredCount, 0, 'No debe haber alteraciones antes del test');
const baselineIntact = preAudit.intactCount;
console.log(`[Snapshot Inicial] Sellos íntegros verificados: ${baselineIntact}/57`);

// EJECUCIÓN 1
console.log('\n--- Ejecución 1 de Sincronización ---');
syncRadar.exportToHistorial();
const hist1 = JSON.parse(fs.readFileSync(path.join(rootDir, 'historial_picks.json'), 'utf8'));
const results1 = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));

// Comprobaciones Ejecución 1
assert.strictEqual(hist1.picks.length, 20, `Ejecución 1: Esperados 20 registros, obtenidos ${hist1.picks.length}`);
assert.strictEqual(hist1.summary.total_bets, 20);
assert.strictEqual(hist1.summary.settled_bets, 19);
assert.strictEqual(hist1.summary.won_bets, 11);
assert.strictEqual(hist1.summary.lost_bets, 8);
assert.strictEqual(hist1.summary.void_bets, 1);
assert.strictEqual(hist1.summary.win_rate_pct, 57.9);
assert.strictEqual(hist1.summary.net_profit_units, 0.67);
assert.strictEqual(hist1.summary.roi_pct, 3.5);
console.log('  ✅ Ejecución 1 completada con métricas esperadas (20 total, 19 resueltas, 1 anulada, +0.67 U PnL).');

// EJECUCIÓN 2 (Idempotencia inmediata)
console.log('\n--- Ejecución 2 de Sincronización (Reiteración) ---');
syncRadar.exportToHistorial();
const hist2 = JSON.parse(fs.readFileSync(path.join(rootDir, 'historial_picks.json'), 'utf8'));
const results2 = JSON.parse(fs.readFileSync(path.join(rootDir, 'engine/storage_data/pick_results.json'), 'utf8'));

// Comprobaciones Ejecución 2
assert.strictEqual(hist2.picks.length, 20, `Ejecución 2: El conteo cambió a ${hist2.picks.length}`);
assert.strictEqual(hist2.summary.total_bets, 20);
assert.strictEqual(hist2.summary.settled_bets, 19);
assert.strictEqual(hist2.summary.won_bets, 11);
assert.strictEqual(hist2.summary.lost_bets, 8);
assert.strictEqual(hist2.summary.void_bets, 1);
assert.strictEqual(hist2.summary.win_rate_pct, 57.9);
assert.strictEqual(hist2.summary.net_profit_units, 0.67);
assert.strictEqual(hist2.summary.roi_pct, 3.5);

// Verificar ausencia de duplicados por ID
const ids = hist2.picks.map(p => p.id);
const uniqueIds = new Set(ids);
assert.strictEqual(uniqueIds.size, 20, `Se encontraron duplicados: ${uniqueIds.size} únicos de 20`);
console.log('  ✅ Ejecución 2 superada: 0 duplicados, balance inalterado (+0.67 U).');

// Verificación estricta de inmutabilidad de hashes
console.log('\n--- Verificación Criptográfica Post-Doble Sincronización ---');
const postAudit = tracker.verifyIntegrity();
assert.strictEqual(postAudit.alteredCount, 0, `Violaciones detectadas: ${postAudit.alteredCount}`);
assert.strictEqual(postAudit.intactCount, baselineIntact, `Se rompió algún sello: ${postAudit.intactCount} vs ${baselineIntact}`);
console.log(`  ✅ Integridad SHA-256 Confirmada: ${postAudit.intactCount}/57 sellos intactos, 0 alteraciones.`);

console.log('\n================================================================');
console.log('🎉 VERIFICACIÓN DE DOBLE SINCRONIZACIÓN EXITOSA AL 100%');
console.log('================================================================\n');
