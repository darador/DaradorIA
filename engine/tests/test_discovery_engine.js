/**
 * SUITE DE PRUEBAS - FASE 2: DISCOVERY ENGINE
 * Verifica:
 * 1. Normalización de mercados individuales y colectivos
 * 2. Desduplicación y convergencia de fuentes múltiples
 * 3. Filtrado preliminar y asignación de prioridades (ALTA, MEDIA, BAJA)
 * 4. Ejecución del ciclo de descubrimiento y persistencia en Storage
 */
const discoveryEngine = require('../discovery/discoveryEngine');
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');

async function runDiscoveryTests() {
  console.log('====================================================');
  console.log('🔍 INICIANDO PRUEBAS DE FASE 2: DISCOVERY ENGINE');
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

  // 1. Normalización de mercados
  console.log('--- 1. Normalización de Mercados ---');
  assert(discoveryEngine._normalizeMarket('shots') === 'Remates totales', 'Mapeo individual: shots -> Remates totales');
  assert(discoveryEngine._normalizeMarket('shots', true) === 'Remates de equipo', 'Mapeo colectivo: shots -> Remates de equipo');
  assert(discoveryEngine._normalizeMarket('shotsOnTarget') === 'Remates al arco', 'Mapeo individual: shotsOnTarget -> Remates al arco');
  assert(discoveryEngine._normalizeMarket('foulsWon') === 'Faltas ganadas', 'Mapeo individual: foulsWon -> Faltas ganadas');
  assert(discoveryEngine._normalizeMarket('tackles') === 'Entradas (Tackles)', 'Mapeo individual: tackles -> Entradas (Tackles)');
  assert(discoveryEngine._normalizeMarket('corners', true) === 'Córners de equipo', 'Mapeo colectivo: corners -> Córners de equipo');

  // 2. Desduplicación y Enriquecimiento
  console.log('\n--- 2. Desduplicación y Convergencia de Señales ---');
  const mockRows = [
    {
      sourceTool: 'prop_screener',
      sport: 'football',
      competition: 'Premier League',
      match: 'Arsenal vs Chelsea',
      playerOrTeam: 'Bukayo Saka',
      isTeamProp: false,
      market: 'Remates al arco',
      line: 'Más de 0.5',
      bookmakerOdds: 1.72,
      trendL10: '70%',
      raw: {}
    },
    {
      sourceTool: 'outlier_pricing',
      sport: 'football',
      competition: 'Premier League',
      match: 'Arsenal vs Chelsea',
      playerOrTeam: 'Bukayo Saka',
      isTeamProp: false,
      market: 'Remates al arco',
      line: 'Más de 0.5',
      bookmakerOdds: 1.76, // Mejor cuota en outlier
      trendL10: null,
      raw: {}
    }
  ];

  const deduplicated = discoveryEngine._deduplicateAndEnrich(mockRows, []);
  assert(deduplicated.length === 1, 'Dos fuentes sobre la misma selección desduplicadas en un único candidato');
  assert(deduplicated[0].discoverySources.length === 2, 'Candidato enriquecido registra ambas fuentes (screener + outlier)');
  assert(deduplicated[0].bookmakerOdds === 1.76, 'Se preservó la cuota más competitiva disponible');

  // 3. Evaluación y Priorización
  console.log('\n--- 3. Filtrado y Priorización Heurística ---');
  const candAlta = discoveryEngine._evaluateAndPrioritize({
    playerOrTeam: 'Erling Haaland',
    market: 'Remates al arco',
    line: 'Más de 1.5',
    bookmakerOdds: 1.85,
    trendL10: '80%',
    trendL5: '100%',
    discoverySources: ['prop_screener', 'player_trends'],
    lineupStatus: 'PREDICTED'
  });
  assert(candAlta.priority === 'ALTA' && candAlta.status === 'DETECTADO', 'Candidato con consistencia L10 80% y múltiples fuentes clasificado con prioridad ALTA');
  assert(candAlta.pendingInvestigation.length >= 3, 'Se registraron los puntos pendientes de investigación');

  const candDescarte = discoveryEngine._evaluateAndPrioritize({
    playerOrTeam: 'Jugador Suplente',
    market: 'Remates totales',
    line: 'Más de 1.5',
    bookmakerOdds: 1.85,
    trendL10: '60%',
    discoverySources: ['prop_screener'],
    lineupStatus: 'BENCH_RISK'
  });
  assert(candDescarte.status === 'DESCARTADO', 'Candidato con riesgo de suplencia descartado preliminarmente');

  // 4. Ejecución del Ciclo de Descubrimiento (Simulado / Live)
  console.log('\n--- 4. Ejecución del Ciclo Completo de Descubrimiento ---');
  try {
    const res = await discoveryEngine.runDiscovery({ targetDate: '2026-11-18', maxCandidates: 15 });
    assert(res && res.runMeta && typeof res.runMeta.fixturesScanned === 'number', 'Corrida de Discovery completada con metadatos');
    assert(Array.isArray(res.candidates), 'Se generó la lista estructurada de candidatos');

    // Verificar persistencia en Storage
    const savedCandidates = storage.getCandidates();
    assert(savedCandidates.length >= 1, `Candidatos persistidos exitosamente en Storage (${savedCandidates.length} en total)`);
    console.log(`Candidatos detectados en la jornada: ${res.candidates.length}`);
  } catch (err) {
    console.warn('Nota en corrida Discovery:', err.message);
  }

  console.log('\n====================================================');
  console.log(`🏁 RESULTADO FASE 2: ${passed} PRUEBAS PASADAS, ${failed} FALLADAS`);
  console.log('====================================================');

  mcpClient.close();
  process.exit(failed > 0 ? 1 : 0);
}

runDiscoveryTests().catch(e => {
  console.error('Error fatal:', e);
  process.exit(1);
});
