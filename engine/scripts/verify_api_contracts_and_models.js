const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const rootDir = path.resolve(__dirname, '../..');
const resultsPath = path.join(rootDir, 'engine/storage_data/pick_results.json');
const registryPath = path.join(rootDir, 'engine/storage_data/model_observation_registry.json');
const ledgerPath = path.join(rootDir, 'engine/storage_data/audit_integrity_ledger.json');
const metricsJsonPath = path.join(rootDir, 'api/metrics.json');
const tracker = require('../prediction/observationTracker');

console.log('================================================================');
console.log('🔬 AUDITORÍA FASE 11.2.2: CAPACIDAD PREDICTIVA Y API VERCEL');
console.log('================================================================\n');

// 1. Integridad SHA-256
console.log('--- 1. Verificación de Integridad SHA-256 ---');
const audit = tracker.verifyIntegrity();
assert.strictEqual(audit.alteredCount, 0, 'No debe haber alteraciones');
assert.strictEqual(audit.intactCount, 57, 'Deben verificarse 57 sellos');
console.log(`  ✅ 57/57 sellos intactos, 0 alteraciones.\n`);

// 2. Auditoría Brier y LogLoss
console.log('--- 2. Verificación Matemática de Brier y Log Loss ---');
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

const decided = results.filter(r => r.status === 'GANADA' || r.status === 'PERDIDA' || r.status === 'ACERTADA' || r.status === 'FALLADA');
assert.strictEqual(decided.length, 19, 'Deben ser 19 observaciones decididas');

let sumBrierBench = 0, sumLogLossBench = 0;
let sumBrierMarket = 0, sumLogLossMarket = 0;
let sumBrierB = 0, sumLogLossB = 0;
let sumBrierC = 0, sumLogLossC = 0;
let sumBrierEns = 0, sumLogLossEns = 0;

decided.forEach(d => {
  const reg = registry.find(r => r.pickId === d.pickId);
  const seal = ledger[d.pickId] || {};
  const y = (d.status === 'GANADA' || d.status === 'ACERTADA') ? 1 : 0;

  const pBench = 0.625;
  const pMkt = Number((1 / d.odds).toFixed(4));
  const pB = seal.probModelB !== undefined ? seal.probModelB : (reg ? reg.probModelB : 0.8);
  const pC = seal.probModelC !== undefined ? seal.probModelC : (reg ? reg.probModelC : 0.8);
  const pEns = Number(((pB + pC) / 2).toFixed(4));

  sumBrierBench += Math.pow(pBench - y, 2);
  sumLogLossBench += -(y * Math.log(pBench) + (1 - y) * Math.log(1 - pBench));

  sumBrierMarket += Math.pow(pMkt - y, 2);
  const clampMkt = Math.max(0.0001, Math.min(0.9999, pMkt));
  sumLogLossMarket += -(y * Math.log(clampMkt) + (1 - y) * Math.log(1 - clampMkt));

  sumBrierB += Math.pow(pB - y, 2);
  const clampB = Math.max(0.0001, Math.min(0.9999, pB));
  sumLogLossB += -(y * Math.log(clampB) + (1 - y) * Math.log(1 - clampB));

  sumBrierC += Math.pow(pC - y, 2);
  const clampC = Math.max(0.0001, Math.min(0.9999, pC));
  sumLogLossC += -(y * Math.log(clampC) + (1 - y) * Math.log(1 - clampC));

  sumBrierEns += Math.pow(pEns - y, 2);
  const clampEns = Math.max(0.0001, Math.min(0.9999, pEns));
  sumLogLossEns += -(y * Math.log(clampEns) + (1 - y) * Math.log(1 - clampEns));
});

const brierBench = Number((sumBrierBench / 19).toFixed(4));
const logLossBench = Number((sumLogLossBench / 19).toFixed(4));
const brierMarket = Number((sumBrierMarket / 19).toFixed(4));
const logLossMarket = Number((sumLogLossMarket / 19).toFixed(4));
const brierB = Number((sumBrierB / 19).toFixed(4));
const logLossB = Number((sumLogLossB / 19).toFixed(4));
const brierC = Number((sumBrierC / 19).toFixed(4));
const logLossC = Number((sumLogLossC / 19).toFixed(4));
const brierEns = Number((sumBrierEns / 19).toFixed(4));
const logLossEns = Number((sumLogLossEns / 19).toFixed(4));

assert.strictEqual(brierBench, 0.2459, `Benchmark Brier debe ser 0.2459, obtenido ${brierBench}`);
assert.strictEqual(brierB, 0.3121, `Model B Brier debe ser 0.3121, obtenido ${brierB}`);
assert.strictEqual(brierEns, 0.3060, `Ensemble Brier debe ser 0.3060, obtenido ${brierEns}`);

console.log(`  ✅ Benchmark Fijo (0.625): Brier = ${brierBench} | Log Loss = ${logLossBench}`);
console.log(`  ✅ Mercado Implícito:      Brier = ${brierMarket} | Log Loss = ${logLossMarket}`);
console.log(`  ✅ Modelo B (L10):         Brier = ${brierB} | Log Loss = ${logLossB}`);
console.log(`  ✅ Modelo C (L15-L20):     Brier = ${brierC} | Log Loss = ${logLossC}`);
console.log(`  ✅ Ensemble (B + C):       Brier = ${brierEns} | Log Loss = ${logLossEns}\n`);

// 3. Verificación de api/metrics.json en disco
console.log('--- 3. Verificación de api/metrics.json en Disco ---');
assert(fs.existsSync(metricsJsonPath), 'api/metrics.json debe existir');
const staticMetrics = JSON.parse(fs.readFileSync(metricsJsonPath, 'utf8'));
assert.strictEqual(staticMetrics.status, 'ok');
assert.strictEqual(staticMetrics.totalTrackedPicks, 20);
assert.strictEqual(staticMetrics.summary.win_rate_pct, 57.9);
assert.strictEqual(staticMetrics.summary.net_profit_units, 0.67);
console.log(`  ✅ api/metrics.json válido y alineado con 20 picks y +0.67 U PnL.\n`);

// 4. Test del endpoint HTTP /api/metrics en el servidor local
console.log('--- 4. Verificación de Servidor HTTP (/api/metrics) ---');
http.get('http://127.0.0.1:3333/api/metrics', res => {
  assert.strictEqual(res.statusCode, 200);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    assert.strictEqual(json.status, 'ok');
    assert.strictEqual(json.totalTrackedPicks, 20);
    assert.strictEqual(json.summary.win_rate_pct, 57.9);
    console.log(`  ✅ Servidor HTTP responde 200 OK con payload sincronizado de 20 apuestas.\n`);
    console.log('================================================================');
    console.log('🎉 AUDITORÍA 11.2.2 VERIFICADA EXITOSAMENTE');
    console.log('================================================================\n');
  });
}).on('error', err => {
  console.error('Error conectando a servidor local:', err.message);
  process.exit(1);
});
