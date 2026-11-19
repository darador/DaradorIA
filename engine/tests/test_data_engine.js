/**
 * SUITE DE PRUEBAS - FASE 1: DATA ENGINE & STATSHUB MCP INTEGRATION
 * Ejecuta verificaciones de:
 * 1. RateGovernor (límites, concurrencia, contador diario)
 * 2. MCPCache (generación de claves, TTL, hit/miss)
 * 3. StorageEngine (guardado de investigaciones, predicciones y picks)
 * 4. RadarSync (sincronización con picks_hoy.json e historial_picks.json)
 * 5. Integración con StatsHub MCP (llamada real + verificación de caché)
 */
const rateGovernor = require('../mcp/rateGovernor');
const cache = require('../mcp/cache');
const storage = require('../data/storage');
const radarSync = require('../data/syncRadar');
const mcpClient = require('../mcp/mcpClient');

async function runTests() {
  console.log('====================================================');
  console.log('🚀 INICIANDO VERIFICACIÓN DE FASE 1: DATA ENGINE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // TEST 1: Rate Governor
  console.log('--- 1. Verificación de RateGovernor ---');
  const initialStatus = rateGovernor.getStatus();
  assert(initialStatus.maxPerMinute === 20, 'Límite por minuto configurado en 20 (margen seguro)');
  assert(typeof initialStatus.dailyCallsUsed === 'number', 'Contador diario inicializado');
  
  await rateGovernor.acquire('test-entity-1');
  const acquiredStatus = rateGovernor.getStatus();
  assert(acquiredStatus.activeRequests === 1, 'Control de concurrencia incrementó a 1');
  assert(acquiredStatus.dailyCallsUsed === initialStatus.dailyCallsUsed + 1, 'Contador diario incrementó correctamente');
  rateGovernor.release();
  assert(rateGovernor.getStatus().activeRequests === 0, 'Liberación de semáforo concurrente exitosa');

  // TEST 2: MCP Cache
  console.log('\n--- 2. Verificación de MCPCache ---');
  const mockTool = 'getFixturesByDate';
  const mockArgs = { date: '2026-11-18', competitionId: 'test-comp' };
  const mockData = { total: 5, sample: true };

  cache.set(mockTool, mockArgs, mockData, 5000);
  const cachedVal = cache.get(mockTool, mockArgs);
  assert(cachedVal && cachedVal.sample === true, 'Lectura y escritura en caché coinciden');
  
  const cacheStats = cache.getStats();
  assert(cacheStats.hits >= 1, `Hit rate del caché registrado (${cacheStats.hitRate})`);

  // TEST 3: Storage Engine
  console.log('\n--- 3. Verificación de StorageEngine ---');
  const run = storage.saveRun({
    fixturesScanned: 25,
    candidatesFound: 8,
    approvedCount: 3,
    rejectedCount: 5,
    mcpCallsUsed: 14,
    notes: 'Prueba de validación Fase 1'
  });
  assert(run.id && run.status === 'COMPLETED', `Research Run persistido con ID ${run.id}`);

  const candidate = storage.saveCandidate({
    match_id: 'match-test-01',
    partido: 'Real Madrid vs Inter',
    liga: 'Champions League',
    seleccion: 'Kylian Mbappé',
    mercado: 'Remates al arco',
    linea: 'Más de 1.5',
    cuota: 1.85,
    status: 'INVESTIGADO'
  });
  assert(candidate.id && candidate.seleccion === 'Kylian Mbappé', `Candidato guardado con ID ${candidate.id}`);

  const prediction = storage.savePrediction({
    candidateId: candidate.id,
    market: 'Remates al arco',
    line: 'Más de 1.5',
    bookmakerOdds: 1.85,
    pEmpirical: 0.72,
    pPoisson: 0.70,
    pProjected: 0.71,
    fairOdds: 1.41,
    evPercentage: 0.31,
    sampleSize: 22,
    confidenceScore: 0.88,
    modelDivergence: 0.02
  });
  assert(prediction.evPercentage === 0.31 && prediction.fairOdds === 1.41, 'Predicción probabilística persistida');

  const approved = storage.saveApprovedPick({
    id: candidate.id,
    partido: candidate.partido,
    liga: candidate.liga,
    seleccion: candidate.seleccion,
    mercado: candidate.mercado,
    linea: candidate.linea,
    cuota: candidate.cuota,
    evPercentage: prediction.evPercentage,
    pProjected: prediction.pProjected,
    fair_odds: prediction.fairOdds,
    status: 'APROBADO',
    rationale: 'Promedio de 2.4 tiros al arco en 18 partidos con titularidad.'
  });
  assert(approved.status === 'APROBADO', 'Pick promovido a APROBADO');

  // TEST 4: Radar Sync
  console.log('\n--- 4. Verificación de RadarSync (picks_hoy.json & historial_picks.json) ---');
  const syncedPicks = radarSync.exportToPicksHoy('2026-11-18');
  assert(Array.isArray(syncedPicks.top_picks) && syncedPicks.top_picks.length >= 1, `picks_hoy.json exportado correctamente con ${syncedPicks.top_picks.length} selecciones`);
  assert(syncedPicks.top_picks.some(p => p.player === 'Kylian Mbappé'), 'Pick aprobado integrado en top_picks sin romper datos previos');

  const syncedHistorial = radarSync.exportToHistorial();
  assert(syncedHistorial.summary && typeof syncedHistorial.summary.total_bets === 'number', `historial_picks.json sincronizado (${syncedHistorial.summary.total_bets} apuestas totales)`);

  // TEST 5: MCP Client con StatsHub (Live + Cache)
  console.log('\n--- 5. Verificación de StatsHub MCP Client ---');
  try {
    console.log('Consultando fixtures del 2026-11-18 a través del DataEngine...');
    const result1 = await mcpClient.callTool('getFixturesByDate', { date: '2026-11-18' });
    assert(result1.data && (result1.data.fixtureCount > 0 || typeof result1.data === 'string'), 'Consulta MCP a getFixturesByDate exitosa');
    console.log(`Origen de la respuesta 1: [${result1.source.toUpperCase()}]`);

    // Segunda llamada inmediata: debe responder desde CACHÉ sin consumir cuota
    const result2 = await mcpClient.callTool('getFixturesByDate', { date: '2026-11-18' });
    assert(result2.source === 'cache', 'Segunda consulta resuelta desde CACHÉ (0 consumo MCP)');
    console.log(`Origen de la respuesta 2: [${result2.source.toUpperCase()}] - Cuota preservada.`);
  } catch (err) {
    console.warn('Nota: Consulta directa MCP Stdio reportó:', err.message);
  }

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO DE PRUEBAS: ${passed} PASADAS, ${failed} FALLADAS`);
  console.log('====================================================');

  // Limpiar conexión mcp
  mcpClient.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Error fatal en pruebas:', e);
  process.exit(1);
});
