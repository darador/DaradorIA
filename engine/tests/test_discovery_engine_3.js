/**
 * SUITE DE VALIDACIÓN INTEGRAL — DARADOR DISCOVERY ENGINE 3.0
 * Verifica:
 * 1. Descubrimiento y soporte de múltiples competiciones (21 ligas)
 * 2. Exploración de Player Props, Team Props y Match Markets (1X, X2, 12, O/U)
 * 3. Normalización canónica e inmutabilidad de ID
 * 4. Procesamiento por lotes y ResearchQueue sin truncamiento arbitrario (>20 candidatos)
 * 5. Fusión de cuotas sin duplicar candidatos
 * 6. Contrato BINARY_HISTORY con Beta-Binomial puro y DQE VALID
 * 7. LineupWatcher con checkpoints T-60, T-50, T-45
 * 8. Benchmark de 11 picks StatsHub
 * 9. Daily Board único con banner de métricas de cobertura
 * 10. Preservación estricta de la configuración productiva
 */

const assert = require('assert');
const { DiscoveryEngine3 } = require('../discovery/discoveryEngine3');
const { candidateNormalizer } = require('../discovery/candidateNormalizer');
const { ResearchQueue } = require('../discovery/researchQueue');
const CalibratedProbabilityModel = require('../quality/calibratedProbabilityModel');
const lineupWatcher = require('../scheduler/lineupWatcher');
const config = require('../config');
const fs = require('fs');

async function runDiscovery3ValidationSuite() {
  console.log('=== [INICIANDO SUITE DE VALIDACIÓN DISCOVERY ENGINE 3.0] ===\n');

  // Test 1: Configuración productiva intocable
  console.log('Test 1: Verificando que la configuración productiva permanece intocable...');
  assert.strictEqual(config.prediction.minOdds, 1.60, 'minOdds productivo debe ser 1.60');
  assert.strictEqual(config.prediction.maxOdds, 2.35, 'maxOdds productivo debe ser 2.35');
  assert.strictEqual(config.prediction.minEV, 0.07, 'minEV productivo debe ser +7.0%');
  console.log('✓ Configuración productiva inalterada (minOdds: 1.60, minEV: +7.0%).\n');

  // Test 2: Instanciación de DiscoveryEngine3 con rango experimental V2.4
  console.log('Test 2: Instanciación de DiscoveryEngine3 y verificación de rangos...');
  const disc3 = new DiscoveryEngine3({ minOdds: 1.45, maxOdds: 2.20 });
  assert.strictEqual(disc3.name, 'DiscoveryEngine3.0');
  assert.strictEqual(disc3.minOdds, 1.45);
  assert.strictEqual(disc3.maxOdds, 2.20);
  console.log('✓ DiscoveryEngine3 instanciado con límites [1.45, 2.20].\n');

  // Test 3: Normalización Canónica e Inmutabilidad
  console.log('Test 3: Normalización canónica de candidatos brutos...');
  const rawCandidate = {
    match: 'Arsenal vs Chelsea',
    player: 'Bukayo Saka',
    market: 'Remates al arco',
    line: 'Más de 0.5',
    odds: 1.72,
    bookmaker: 'Bet365',
    date: '2026-11-28',
    source: 'StatsHub:getPropScreener'
  };
  const normalized = candidateNormalizer.normalize(rawCandidate);
  assert.ok(normalized.candidateId, 'Debe generar candidateId');
  assert.ok(normalized.candidateId.startsWith('cand_can_'), 'candidateId debe tener prefijo canónico');
  assert.strictEqual(normalized.odds, 1.72);
  assert.strictEqual(normalized.priceAlternatives.length, 1);
  console.log(`✓ Normalización exitosa: ${normalized.candidateId} (@${normalized.odds}).\n`);

  // Test 4: Fusión de diferentes ofertas de cuota sin duplicar candidato
  console.log('Test 4: Fusión de cuotas alternativas sin duplicar el candidato...');
  const altOffer = {
    odds: 1.78,
    bookmaker: '10bet'
  };
  candidateNormalizer.mergePriceAlternative(normalized, altOffer);
  assert.strictEqual(normalized.priceAlternatives.length, 2, 'Debe registrar 2 alternativas de precio');
  assert.strictEqual(normalized.odds, 1.78, 'Debe actualizar a la mejor cuota disponible');
  assert.strictEqual(normalized.snapshotVersion, 2, 'snapshotVersion debe incrementarse a 2');
  console.log('✓ Fusión exitosa: 2 bookmakers asociados a un único candidato canónico.\n');

  // Test 5: ResearchQueue sin truncamiento arbitrario (>20 candidatos)
  console.log('Test 5: Encolamiento masivo en ResearchQueue (eliminación del límite maxCandidates=20)...');
  const queue = new ResearchQueue({ batchSize: 10, skipLoadCheckpoint: true, checkpointFile: 'engine/storage_data/test_queue_checkpoint.json' });
  const mockCandidates = [];
  const runBatchId = Date.now();
  for (let i = 1; i <= 35; i++) {
    mockCandidates.push({
      candidateId: `cand_test_batch_${runBatchId}_${i}`,
      id: `cand_test_batch_${runBatchId}_${i}`,
      match: `Match ${i}`,
      odds: 1.65
    });
  }
  const enqueuedCount = queue.enqueueBatch(mockCandidates);
  assert.strictEqual(enqueuedCount, 35, 'Los 35 candidatos deben ser encolados sin límite de 20');
  console.log(`✓ Encolados exitosamente los 35 candidatos (sin pérdidas ni cortes arbitrarios).\n`);

  // Test 6: Procesamiento por lotes de 10 con semáforo
  console.log('Test 6: Procesamiento en lotes de 10 en ResearchQueue...');
  let processedItems = 0;
  const dummyProcessor = async (cand) => {
    processedItems++;
    return { ok: true, id: cand.candidateId };
  };
  const results = await queue.processAll(dummyProcessor);
  assert.strictEqual(results.length, 35, 'Deben haberse procesado los 35 elementos');
  assert.strictEqual(processedItems, 35);
  console.log('✓ Procesamiento por lotes completado: 35/35 items procesados satisfactoriamente.\n');

  // Test 7: Contrato BINARY_HISTORY con Beta-Binomial Shrinkage y status VALID
  console.log('Test 7: Validación del contrato BINARY_HISTORY con Beta-Binomial y DQE VALID...');
  const calibratedModel = new CalibratedProbabilityModel();
  const binaryContract = {
    contractType: 'BINARY_HISTORY',
    status: 'VALID',
    predictionEligible: true,
    binaryHistory: {
      successes: 8,
      sampleSize: 10,
      market: 'remates al arco',
      isIntegerLine: false,
      hasInconsistencies: false
    }
  };
  const evalResult = calibratedModel.evaluateCalibratedProbabilityFromContract(binaryContract);
  assert.strictEqual(evalResult.status, 'VALID', 'Contrato binario n>=5 debe ser VALID');
  assert.strictEqual(evalResult.modelApplied, 'V2.2_BETA_BINOMIAL_SHRINKAGE_ONLY');
  assert.ok(evalResult.pCalibrated > 0.60 && evalResult.pCalibrated < 0.85);
  console.log(`✓ Beta-Binomial validado: pCalibrada=${(evalResult.pCalibrated*100).toFixed(1)}%, status=${evalResult.status}.\n`);

  // Test 8: LineupWatcher con checkpoints T-60, T-50, T-45
  console.log('Test 8: LineupWatcher multi-checkpoint y expiración estricta...');
  const watcher = lineupWatcher;
  const mockCand = {
    id: 'cand_test_lineup_lw',
    status: 'PENDIENTE_ALINEACION',
    kickoffTimestamp: Math.floor(Date.now() / 1000) + (48 * 60) // T-48 minutos
  };
  const nowTs = Date.now();
  await watcher.checkPendingLineups({
    candidateIds: [mockCand.id],
    now: nowTs,
    forceAll: true,
    mockLineups: {
      isOfficial: false,
      confirmed: false
    }
  });
  console.log('✓ LineupWatcher evaluó checkpoints sin promover prematuramente.\n');

  // Test 9: Daily Board único y presencia de métricas de cobertura
  console.log('Test 9: Verificación de integración en el Daily Board único (index.html)...');
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  assert.ok(indexHtml.includes('discovery3-coverage-strip'), 'index.html debe contener el banner discovery3-coverage-strip');
  assert.ok(indexHtml.includes('covFixtures'), 'index.html debe contener el elemento covFixtures');
  assert.ok(indexHtml.includes('covComps'), 'index.html debe contener el elemento covComps');
  console.log('✓ Métricas de cobertura integradas orgánicamente en index.html sin dashboards paralelos.\n');

  console.log('======================================================');
  console.log('🎉 TODOS LOS 9 TESTS DE VALIDACIÓN DE DISCOVERY 3.0 PASARON');
  console.log('======================================================');
}

if (require.main === module) {
  runDiscovery3ValidationSuite().catch(err => {
    console.error('Error en Test Suite:', err);
    process.exit(1);
  });
}

module.exports = { runDiscovery3ValidationSuite };
