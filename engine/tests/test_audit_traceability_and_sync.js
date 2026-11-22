/**
 * TEST AUDIT: TRAZABILIDAD, PERSISTENCIA Y SINCRONIZACIÓN DE DATOS (FASE 11.1)
 * DARADORIA / DARADORBET
 */

const fs = require('fs');
const assert = require('assert');
const path = require('path');
const http = require('http');

const { ProvenanceGuard, PROVENANCE_TYPES } = require('../audit/provenanceGuard');
const tracker = require('../prediction/observationTracker');
const Evaluator = require('../evaluation/evaluator');

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     ${err.message}`);
    process.exit(1);
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  console.log('🧪 Iniciando Test Suite: Fase 11.1 — Trazabilidad, Persistencia y Sincronización...\n');

  console.log('--- 1. Reconciliación de Almacenamiento y Provenance ---');
  const picksData = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
  const topPicks = picksData.top_picks;

  runTest('picks_hoy.json contiene exactamente 27 selecciones verificadas', () => {
    assert.strictEqual(topPicks.length, 27);
  });

  runTest('Ninguna selección en picks_hoy.json tiene procedencia MOCK o TEST', () => {
    const guard = new ProvenanceGuard();
    topPicks.forEach(p => {
      const cls = guard.classifyCandidate(p);
      assert.strictEqual(cls, PROVENANCE_TYPES.REAL_VERIFIED, `Pick ${p.id} debe ser REAL_VERIFIED`);
    });
  });

  runTest('El archivo de cuarentena contiene exactamente los 30 candidatos sintéticos aislados', () => {
    const quar = JSON.parse(fs.readFileSync('engine/storage_data/quarantine_candidates.json', 'utf8'));
    assert.strictEqual(quar.quarantinedCount, 30);
    assert.strictEqual(quar.quarantinedCandidates.length, 30);
  });

  console.log('\n--- 2. Integridad del Ledger Criptográfico y 18 Observaciones Congeladas ---');
  runTest('Las 18 observaciones oficiales congeladas del 19-Nov están intactas', () => {
    const reg = tracker.getRegistry();
    const settledOfficial = reg.filter(r => r.settledAt && !r.isTestPick && !r.pickId.startsWith('cand_test_'));
    assert.strictEqual(settledOfficial.length, 18);
  });

  runTest('0 alteraciones históricas en el ledger SHA-256', () => {
    const audit = tracker.verifyIntegrity();
    assert.strictEqual(audit.alteredCount, 0);
  });

  console.log('\n--- 3. Prueba Funcional D: Sincronización API vs Almacenamiento ---');
  await runAsyncTest('La API local (/picks_hoy.json) entrega exactamente el contenido de disco', async () => {
    const fetched = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3333/picks_hoy.json', res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });
    assert.strictEqual(fetched.top_picks.length, 27);
    assert.strictEqual(fetched.top_picks[0].id, topPicks[0].id);
  });

  console.log('\n--- 4. Prueba Funcional E: Cálculo de Métricas en Evaluator ---');
  runTest('Evaluator computa métricas probabilísticas sobre el conjunto congelado', () => {
    const ev = Evaluator;
    const res = ev.evaluatePerformance();
    assert.strictEqual(res.sampleSize, 18);
    assert.strictEqual(res.financialMetrics.wonBets, 10);
    assert.strictEqual(res.financialMetrics.lostBets, 8);
    assert.strictEqual(res.financialMetrics.winRatePct, 55.6);
    assert(typeof res.probabilisticMetrics.brierScore === 'number');
    assert(typeof res.probabilisticMetrics.logLoss === 'number');
  });

  console.log('\n====================================================');
  console.log('🏁 RESULTADO FASE 11.1: TODAS LAS PRUEBAS PASADAS CON ÉXITO');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
