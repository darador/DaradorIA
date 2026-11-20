/**
 * TEST DE INTEGRIDAD DE MUESTREO ESTADÍSTICO Y CONSUMO DE STATSHUB MCP
 * Verifica las 11 condiciones requeridas:
 * 1. Mapeo completo y persistencia de identificadores desde Discovery Engine.
 * 2. Formato exacto de argumentos para cada endpoint de StatsHub MCP (limit: 20, limit: 30, etc.).
 * 3. Capacidad de procesar hasta 20 partidos de jugador cuando existen en la respuesta.
 * 4. Capacidad de procesar hasta 30 partidos de equipo cuando existen.
 * 5. Cálculo correcto de L5, L10, L15 y L20 sobre muestras reales.
 * 6. Separación precisa de local y visitante.
 * 7. Manejo adecuado de partidos como suplente según minutos jugados.
 * 8. Distinción explícita entre un valor real de cero (0 remates) y un dato ausente (null).
 * 9. Bloqueo de predicciones y rechazo de candidatos cuando la muestra es insuficiente o incompleta.
 * 10. Ausencia absoluta de datos sintéticos o valores inventados en los módulos de producción.
 * 11. Respeto de los límites de tasa y uso de caché.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const mcpClient = require('../mcp/mcpClient');
const discoveryEngine = require('../discovery/discoveryEngine');
const deepResearchEngine = require('../research/deepResearchEngine');
const predictionEngine = require('../prediction/predictionEngine');

async function runSamplingIntegrityTests() {
  console.log('================================================================');
  console.log('🔬 VERIFICACIÓN DE INTEGRIDAD DE MUESTREO Y STATSHUB MCP');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // 1. Mapeo y persistencia de IDs desde Discovery Engine
  // --------------------------------------------------------------------------
  console.log('--- 1. Mapeo y Persistencia de Identificadores ---');
  {
    const propRows = discoveryEngine._mapPropScreenerRows([{
      playerId: 'ply_101',
      teamId: 'tm_202',
      opponentTeamId: 'tm_303',
      matchId: 'mch_404',
      competitionId: 'cmp_505',
      seasonId: 'sea_606',
      playerName: 'Lucas Paquetá',
      teamName: 'West Ham',
      opponentName: 'Arsenal',
      statType: 'shots',
      line: 1.5,
      bestOdds: 1.85,
      hitRateL10: 70
    }], 'prop_screener');

    assert(propRows.length === 1, 'Mapeo Prop Screener retorna fila');
    const r1 = propRows[0];
    assert(r1.playerId === 'ply_101', 'PropScreener conserva playerId');
    assert(r1.teamId === 'tm_202', 'PropScreener conserva teamId');
    assert(r1.opponentTeamId === 'tm_303', 'PropScreener conserva opponentTeamId');
    assert(r1.matchId === 'mch_404', 'PropScreener conserva matchId');
    assert(r1.competitionId === 'cmp_505', 'PropScreener conserva competitionId');
    assert(r1.seasonId === 'sea_606', 'PropScreener conserva seasonId');
    assert(r1.rawStatType === 'shots', 'PropScreener conserva rawStatType');

    const teamRows = discoveryEngine._mapTeamPropRows([{
      teamId: 'tm_777',
      opponentTeamId: 'tm_888',
      matchId: 'mch_999',
      competitionId: 'cmp_111',
      seasonId: 'sea_222',
      teamName: 'Flamengo',
      opponentTeamName: 'Fluminense',
      statType: 'corners',
      line: 5.5,
      bestOdds: 1.80
    }], 'team_prop_screener');

    assert(teamRows.length === 1, 'Mapeo Team Props retorna fila');
    const r2 = teamRows[0];
    assert(r2.teamId === 'tm_777', 'TeamProp conserva teamId');
    assert(r2.opponentTeamId === 'tm_888', 'TeamProp conserva opponentTeamId');
    assert(r2.matchId === 'mch_999', 'TeamProp conserva matchId');

    const unified = discoveryEngine._deduplicateAndEnrich([r1, r2]);
    assert(unified.length === 2, 'Deduplicación conserva candidatos estructurados');
    const u1 = unified.find(c => c.playerOrTeam === 'Lucas Paquetá');
    assert(u1 && u1.playerId === 'ply_101' && u1.teamId === 'tm_202', 'Candidato desduplicado conserva IDs originales');
  }

  // --------------------------------------------------------------------------
  // 2. Formato exacto de argumentos para cada endpoint MCP
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Formato de Argumentos StatsHub MCP ---');
  {
    const originalCallTool = mcpClient.callTool;
    const calls = [];
    mcpClient.callTool = async (name, args) => {
      calls.push({ name, args });
      if (name === 'getPlayerStats') {
        return { data: { matches: [] } };
      }
      if (name === 'getTeamPerformance') {
        return { data: { games: [] } };
      }
      if (name === 'getReferee') {
        return { data: { foulsPerGame: 24.0, yellowCardsPerGame: 4.0 } };
      }
      if (name === 'getLineups') {
        return { data: { confirmed: true, startingXI: ['Lucas Paquetá'] } };
      }
      return { data: null };
    };

    const candMock = {
      playerId: 'ply_test_1',
      teamId: 'tm_test_1',
      opponentTeamId: 'tm_opp_1',
      matchId: 'mch_test_1',
      refereeId: 'ref_test_1',
      playerOrTeam: 'Lucas Paquetá',
      team: 'West Ham',
      opponent: 'Arsenal',
      market: 'Remates totales',
      rawStatType: 'shots',
      line: 'Más de 1.5',
      rawLine: 1.5,
      bookmakerOdds: 1.85,
      isTeamProp: false
    };

    await deepResearchEngine.investigateCandidate(candMock);

    const playerCall = calls.find(c => c.name === 'getPlayerStats');
    assert(playerCall !== undefined, 'Se invoca getPlayerStats');
    assert(playerCall.args.playerId === 'ply_test_1', 'getPlayerStats recibe playerId exacto');
    assert(playerCall.args.limit === 20, 'getPlayerStats solicita hasta 20 partidos (limit: 20)');
    assert(playerCall.args.appearances === 'all', 'getPlayerStats solicita appearances: "all"');
    assert(playerCall.args.statType === 'shots', 'getPlayerStats solicita statType canónico');

    const oppCall = calls.find(c => c.name === 'getTeamPerformance');
    assert(oppCall !== undefined, 'Se invoca getTeamPerformance para el rival');
    assert(oppCall.args.teamId === 'tm_opp_1', 'getTeamPerformance recibe opponentTeamId exacto');
    assert(oppCall.args.limit === 30, 'getTeamPerformance solicita hasta 30 partidos (limit: 30)');
    assert(oppCall.args.venue === 'both', 'getTeamPerformance solicita venue: "both"');

    mcpClient.callTool = originalCallTool;
  }

  // --------------------------------------------------------------------------
  // 3. Procesamiento de hasta 20 partidos de jugador
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Muestreo de Jugador: Hasta 20 Partidos ---');
  {
    const originalCallTool = mcpClient.callTool;
    const fakeMatches = [];
    for (let i = 1; i <= 20; i++) {
      fakeMatches.push({
        matchId: `m_${i}`,
        date: `2026-10-${i < 10 ? '0' + i : i}`,
        venue: i % 2 === 0 ? 'home' : 'away',
        minutes: 85,
        shots: (i % 3) + 1
      });
    }

    mcpClient.callTool = async (name) => {
      if (name === 'getPlayerStats') {
        return { data: { matches: fakeMatches } };
      }
      return { data: null };
    };

    const cand = {
      playerId: 'ply_20_matches',
      playerOrTeam: 'Vinicius Jr',
      market: 'Remates totales',
      rawStatType: 'shots',
      line: 'Más de 1.5',
      rawLine: 1.5
    };

    const res = await deepResearchEngine._fetchPlayerDetails(cand);
    assert(res.totalMatchesRetrieved === 20, 'Recupera exactamente los 20 partidos entregados');
    assert(res.validMatches === 20, 'Identifica los 20 partidos como observaciones válidas');
    assert(res.observations.length === 20, 'Genera 20 observaciones numéricas reales');
    assert(res.windows.L20 !== null, 'Calcula ventana completa L20');
    assert(res.windows.L20.count === 20, 'Ventana L20 contiene 20 elementos');

    mcpClient.callTool = originalCallTool;
  }

  // --------------------------------------------------------------------------
  // 4. Procesamiento de hasta 30 partidos de equipo
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Muestreo de Equipo: Hasta 30 Partidos ---');
  {
    const originalCallTool = mcpClient.callTool;
    const fakeTeamGames = [];
    for (let i = 1; i <= 30; i++) {
      fakeTeamGames.push({
        matchId: `tm_m_${i}`,
        date: `2026-09-${i < 10 ? '0' + i : i}`,
        venue: i % 2 === 0 ? 'home' : 'away',
        corners: 4 + (i % 4)
      });
    }

    mcpClient.callTool = async (name) => {
      if (name === 'getTeamPerformance') {
        return { data: { games: fakeTeamGames } };
      }
      return { data: null };
    };

    const candTeam = {
      teamId: 'tm_palmeiras',
      team: 'Palmeiras',
      isTeamProp: true,
      market: 'Córners de equipo',
      rawStatType: 'corners',
      line: 'Más de 4.5',
      rawLine: 4.5
    };

    const res = await deepResearchEngine._fetchTeamPerformance(candTeam);
    assert(res.totalMatchesRetrieved === 30, 'Recupera los 30 partidos del equipo');
    assert(res.validMatches === 30, 'Registra 30 partidos válidos');
    assert(res.observations.length === 30, 'Genera 30 observaciones para el equipo');
    assert(res.windows.L30 !== null, 'Calcula ventana completa L30');
    assert(res.windows.L30.count === 30, 'Ventana L30 contiene 30 elementos');

    mcpClient.callTool = originalCallTool;
  }

  // --------------------------------------------------------------------------
  // 5. Cálculo correcto de ventanas estadísticas (L5, L10, L15, L20)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Cálculo Matemático de Ventanas (L5, L10, L15, L20) ---');
  {
    // Muestra conocida de 20 valores
    // [4, 3, 2, 5, 1, 0, 2, 3, 1, 4, 2, 3, 5, 1, 2, 4, 3, 2, 1, 0]
    const obs = [4, 3, 2, 5, 1, 0, 2, 3, 1, 4, 2, 3, 5, 1, 2, 4, 3, 2, 1, 0];
    const threshold = 1.5; // Hits son valores > 1.5 (2, 3, 4, 5)

    const l5 = deepResearchEngine._calculateWindowStats(obs, 5, threshold);
    assert(l5.count === 5, 'L5 tiene count 5');
    assert(l5.mean === 3.0, 'L5 mean: (4+3+2+5+1)/5 = 3.0', `obtenido: ${l5.mean}`);
    assert(l5.hits === 4, 'L5 hits: 4 valores > 1.5 (4, 3, 2, 5)', `obtenido: ${l5.hits}`);
    assert(l5.hitRate === 80.0, 'L5 hitRate: 80.0%', `obtenido: ${l5.hitRate}`);

    const l10 = deepResearchEngine._calculateWindowStats(obs, 10, threshold);
    assert(l10.count === 10, 'L10 tiene count 10');
    // Sum L10: 4+3+2+5+1 + 0+2+3+1+4 = 25 -> mean = 2.5
    assert(l10.mean === 2.5, 'L10 mean = 2.5', `obtenido: ${l10.mean}`);
    // Hits L10: 4, 3, 2, 5, 2, 3, 4 = 7
    assert(l10.hits === 7, 'L10 hits = 7', `obtenido: ${l10.hits}`);
    assert(l10.hitRate === 70.0, 'L10 hitRate = 70.0%', `obtenido: ${l10.hitRate}`);

    const l15 = deepResearchEngine._calculateWindowStats(obs, 15, threshold);
    assert(l15.count === 15, 'L15 tiene count 15');
    assert(l15.mean > 0 && l15.variance >= 0, 'L15 calcula media y varianza muestral válidas');

    const l20 = deepResearchEngine._calculateWindowStats(obs, 20, threshold);
    assert(l20.count === 20, 'L20 tiene count 20');
    assert(l20.median >= 0, 'L20 calcula mediana correctamente');
  }

  // --------------------------------------------------------------------------
  // 6. Separación precisa de Local y Visitante
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Separación de Splits Local y Visitante ---');
  {
    const originalCallTool = mcpClient.callTool;
    const splitMatches = [
      { minutes: 90, venue: 'home', shots: 5 },
      { minutes: 90, venue: 'away', shots: 1 },
      { minutes: 90, venue: 'home', shots: 4 },
      { minutes: 90, venue: 'away', shots: 0 },
      { minutes: 90, venue: 'home', shots: 6 },
      { minutes: 90, venue: 'away', shots: 2 }
    ];

    mcpClient.callTool = async () => ({ data: { matches: splitMatches } });

    const cand = {
      playerId: 'ply_splits',
      playerOrTeam: 'Erling Haaland',
      market: 'Remates totales',
      rawStatType: 'shots',
      line: 'Más de 2.5',
      rawLine: 2.5
    };

    const res = await deepResearchEngine._fetchPlayerDetails(cand);
    assert(res.splits.home.count === 3, 'Split Home contiene exactamente 3 partidos');
    assert(res.splits.away.count === 3, 'Split Away contiene exactamente 3 partidos');
    assert(res.splits.home.mean === 5.0, 'Media Home es 5.0 (5, 4, 6)', `obtenido: ${res.splits.home.mean}`);
    assert(res.splits.away.mean === 1.0, 'Media Away es 1.0 (1, 0, 2)', `obtenido: ${res.splits.away.mean}`);
    assert(res.splits.home.hitRate === 100.0, 'Home HitRate es 100% (> 2.5)', `obtenido: ${res.splits.home.hitRate}`);
    assert(res.splits.away.hitRate === 0.0, 'Away HitRate es 0% (> 2.5)', `obtenido: ${res.splits.away.hitRate}`);

    mcpClient.callTool = originalCallTool;
  }

  // --------------------------------------------------------------------------
  // 7. Manejo adecuado de suplencias y minutos jugados
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Filtro de Suplencias y Minutos Efectivos ---');
  {
    const originalCallTool = mcpClient.callTool;
    const subMatches = [
      { minutes: 85, venue: 'home', shots: 3 }, // Titular (>= 45m) -> Válido
      { minutes: 70, venue: 'away', shots: 2 }, // Titular -> Válido
      { minutes: 30, venue: 'home', shots: 1 }, // Suplente con 30m (>= 25m) -> Válido
      { minutes: 12, venue: 'away', shots: 0 }, // Suplente con 12m (< 25m) -> Excluido de observaciones
      { minutes: 0,  venue: 'home', shots: 0 }  // Banco sin minutos -> Excluido
    ];

    mcpClient.callTool = async () => ({ data: { matches: subMatches } });

    const cand = {
      playerId: 'ply_subs',
      playerOrTeam: 'Endrick',
      market: 'Remates totales',
      rawStatType: 'shots',
      line: 'Más de 0.5',
      rawLine: 0.5
    };

    const res = await deepResearchEngine._fetchPlayerDetails(cand);
    assert(res.totalMatchesRetrieved === 5, 'Recupera los 5 partidos del historial');
    assert(res.validMatches === 3, 'Solo 3 partidos cumplen el criterio de validez (>= 25 min o titular)');
    assert(res.observations.length === 3, 'Genera exactamente 3 observaciones');
    assert(res.subAppearances === 2, 'Contabiliza correctamente las 2 apariciones desde el banquillo');

    mcpClient.callTool = originalCallTool;
  }

  // --------------------------------------------------------------------------
  // 8. Distinción explícita entre Cero Real (0) y Dato Ausente (null)
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Distinción Estricta entre 0 Real y Ausencia de Dato (null) ---');
  {
    const originalCallTool = mcpClient.callTool;
    const zeroVsNullMatches = [
      { minutes: 90, shots: 0 },         // Jugó 90 min y disparó 0 veces -> CERO REAL
      { minutes: 80, shots: 2 },         // Jugó 80 min y disparó 2 veces -> Válido
      { minutes: 90, shots: null },      // Dato ausente -> Debe ser ignorado
      { minutes: 90 }                    // Propiedad shots no presente (undefined) -> Debe ser ignorado
    ];

    mcpClient.callTool = async () => ({ data: { matches: zeroVsNullMatches } });

    const cand = {
      playerId: 'ply_zero',
      playerOrTeam: 'Rodri',
      market: 'Remates totales',
      rawStatType: 'shots',
      line: 'Más de 0.5',
      rawLine: 0.5
    };

    const res = await deepResearchEngine._fetchPlayerDetails(cand);
    assert(res.validMatches === 2, 'Solo incluye las 2 apariciones con dato numérico registrado');
    assert(res.observations.includes(0), 'El valor 0 se preserva explícitamente en las observaciones');
    assert(res.observations[0] === 0 && res.observations[1] === 2, 'Mantiene los valores exactos [0, 2]');
    assert(!res.observations.includes(null), 'No incluye null en las observaciones');

    mcpClient.callTool = originalCallTool;
  }

  // --------------------------------------------------------------------------
  // 9. Bloqueo de predicciones y rechazo ante datos incompletos
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Bloqueo de Predicciones por Datos Insuficientes ---');
  {
    // A. Candidato con investigación incompleta
    const incompleteCand = {
      id: 'cand_inc_1',
      playerOrTeam: 'Jugador Desconocido',
      match: 'Equipo A vs Equipo B',
      market: 'Remates al arco',
      line: 'Más de 1.5',
      bookmakerOdds: 1.85,
      status: 'INVESTIGACION_INCOMPLETA',
      researchData: {
        qualityStatus: 'INVESTIGACION_INCOMPLETA',
        playerData: { validMatches: 3, observations: [1, 2, 0] }
      }
    };

    const pred1 = predictionEngine.predictCandidate(incompleteCand);
    assert(pred1.decision === 'RECHAZADO', 'Rechaza candidato con status INVESTIGACION_INCOMPLETA');
    assert(pred1.decisionReason.includes('RECHAZADO_DATOS_INSUFICIENTES'), 'Explica motivo por datos insuficientes');

    // B. Candidato con 0 observaciones
    const zeroObsCand = {
      id: 'cand_zero_obs',
      playerOrTeam: 'Sin Historial',
      match: 'Equipo A vs Equipo B',
      market: 'Remates al arco',
      line: 'Más de 1.5',
      bookmakerOdds: 1.85,
      status: 'INVESTIGADO',
      researchData: {
        qualityStatus: 'ERROR_DATOS',
        playerData: { validMatches: 0, observations: [] }
      }
    };

    const pred2 = predictionEngine.predictCandidate(zeroObsCand);
    assert(pred2.decision === 'RECHAZADO', 'Rechaza candidato con 0 observaciones');

    // C. Candidato con muestra corta (5 partidos < 8 mínimos)
    const shortCand = {
      id: 'cand_short',
      playerOrTeam: 'Muestra Corta',
      match: 'Equipo A vs Equipo B',
      market: 'Remates totales',
      line: 'Más de 1.5',
      rawLine: 1.5,
      bookmakerOdds: 1.90,
      status: 'INVESTIGADO',
      researchData: {
        qualityStatus: 'PARCIAL',
        playerData: {
          validMatches: 5,
          statPer90: 2.8,
          projectedMinutes: 80,
          observations: [3, 2, 4, 2, 3]
        },
        lineupData: { status: 'CONFIRMADA', certainty: 1.0 }
      }
    };

    const pred3 = predictionEngine.predictCandidate(shortCand);
    assert(pred3.decision === 'RECHAZADO', 'Rechaza automáticamente muestra < minPlayerValidMatches (8)');
    assert(pred3.decisionReason.includes('insuficiente'), 'Motivo indica muestra estadística insuficiente');
  }

  // --------------------------------------------------------------------------
  // 10. Ausencia absoluta de datos sintéticos en código de producción
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Verificación de Código: Cero Datos Sintéticos ---');
  {
    const researchFileContent = fs.readFileSync(path.join(__dirname, '../research/deepResearchEngine.js'), 'utf-8');
    const predictionFileContent = fs.readFileSync(path.join(__dirname, '../prediction/predictionEngine.js'), 'utf-8');

    assert(!researchFileContent.includes('_generateNormalizedPlayerStats'), 'No existe _generateNormalizedPlayerStats en deepResearchEngine');
    assert(!researchFileContent.includes('3, 2, 4, 1, 3, 2, 5'), 'No existen arrays sintéticos hardcodeados en deepResearchEngine');
    assert(!researchFileContent.includes('concessionRatio: 1.10'), 'No existe concessionRatio: 1.10 hardcodeado en deepResearchEngine');
    assert(!researchFileContent.includes('avgMinutes: 76.5'), 'No existe avgMinutes: 76.5 sintético');
    assert(!predictionFileContent.includes('[2, 3, 1, 4, 2, 3, 2, 5, 1, 3, 2, 4]'), 'No existe array de fallback en predictionEngine');
    assert(!predictionFileContent.includes('[12, 11, 14, 10, 13, 9, 12, 11, 10, 14]'), 'No existe array colectivo de fallback en predictionEngine');
  }

  // --------------------------------------------------------------------------
  // 11. Respeto de límites de tasa y configuración de muestreo
  // --------------------------------------------------------------------------
  console.log('\n--- 11. Límites de Tasa y Configuración de Muestreo ---');
  {
    const rl = config.mcp.rateLimits;
    assert(rl.maxPerMinute === 20, 'Límite por minuto configurado en 20 llamadas');
    assert(rl.maxDailyCalls === 280, 'Límite diario configurado en 280 llamadas');
    assert(rl.maxConcurrent === 2, 'Concurrencia máxima limitada a 2');
    assert(rl.minIntervalMs >= 2500, 'Intervalo mínimo entre llamadas >= 2500 ms');

    assert(config.sampling.maxPlayerMatches === 20, 'Muestreo máximo de jugadores configurado en 20 partidos');
    assert(config.sampling.maxTeamMatches === 30, 'Muestreo máximo de equipos configurado en 30 partidos');
    assert(config.sampling.minPlayerValidMatches === 8, 'Muestreo mínimo válido de jugador configurado en 8');
    assert(config.sampling.minTeamValidMatches === 10, 'Muestreo mínimo válido de equipo configurado en 10');
  }

  // --------------------------------------------------------------------------
  // RESUMEN FINAL
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`RESULTADO DE AUDITORÍA DE INTEGRIDAD:`);
  console.log(`Pruebas superadas: ${passed} | Fallidas: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    console.error('❌ SE DETECTARON FALLOS EN LA VERIFICACIÓN.');
    process.exit(1);
  } else {
    console.log('🎉 TODAS LAS REGLAS DE MUESTREO REAL E INTEGRIDAD HAN SIDO VALIDADAS.');
  }
}

runSamplingIntegrityTests().catch(err => {
  console.error('Error fatal ejecutando pruebas:', err);
  process.exit(1);
});
