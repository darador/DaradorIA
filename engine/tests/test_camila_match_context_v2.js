/**
 * SUITE DE PRUEBAS AISLADAS: CAMILA 2.0 (MatchContextAnalyst)
 * 8 escenarios obligatorios sobre mocks sin escribir datos de producción.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MatchContextAnalyst } = require('../agents/matchContextAnalyst');
const observationTracker = require('../prediction/observationTracker');

let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== TEST SUITE: CAMILA 2.0 (8 ESCENARIOS AISLADOS) ===\n');
  const camila = new MatchContextAnalyst();

  // 1. Árbitro estricto en mercado de faltas -> FAVORABLE
  {
    camila.clearCache();
    const mcpClient = {
      getMatchDetails: async () => ({ venue: 'Anfield', kickoffUtc: '2026-11-26T20:00:00Z', referee: { id: 'ref_1', name: 'Michael Oliver' } }),
      getReferee: async () => ({ id: 'ref_1', name: 'Michael Oliver', foulsPerGame: 26.4, yellowCardsPerGame: 4.9, gamesCount: 10 }),
      getLineups: async () => ({ confirmed: true })
    };
    const r = await camila.analyze(
      { id: 'c1', matchId: 'm1', match: 'Liverpool vs Arsenal', market: 'player_fouls', selection: 'Over 1.5' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.version === '2.0.0' && r.recommendation === 'FAVORABLE' && r.structuredSignals.refereeProfile.refereeName === 'Michael Oliver' && r.structuredSignals.contextRiskDetected === false,
      '1. Árbitro estricto en mercado de faltas devuelve FAVORABLE con perfil real'
    );
  }

  // 2. Árbitro permisivo en Over de faltas -> PRECAUCION + contextRiskDetected
  {
    camila.clearCache();
    const mcpClient = {
      getMatchDetails: async () => ({ venue: 'Etihad', referee: { id: 'ref_2', name: 'Simon Hooper' } }),
      getReferee: async () => ({ id: 'ref_2', name: 'Simon Hooper', foulsPerGame: 17.8, yellowCardsPerGame: 2.7, gamesCount: 10 }),
      getLineups: async () => ({ confirmed: true })
    };
    const r = await camila.analyze(
      { id: 'c2', matchId: 'm2', match: 'Man City vs Chelsea', market: 'player_fouls', selection: 'Más de 1.5' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.contextRiskDetected === true && r.structuredSignals.riskSeverity === 'MEDIUM' && r.recommendation === 'PRECAUCION',
      '2. Árbitro permisivo en Over de faltas activa PRECAUCION y riesgo MEDIUM'
    );
  }

  // 3. Sin árbitro designado todavía -> SIN_ARBITRO_DESIGNADO sin inventar datos
  {
    camila.clearCache();
    const mcpClient = {
      getMatchDetails: async () => ({ venue: 'Eden Arena', referee: null }),
      getReferee: async () => { throw new Error('No debería llamarse getReferee sin refereeId'); },
      getLineups: async () => ({ confirmed: false })
    };
    const r = await camila.analyze(
      { id: 'c3', matchId: 'm3', match: 'Slavia Praha vs Villarreal', market: 'team_corners', isTeamProp: true },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.refereeCoverage === 'SIN_ARBITRO_DESIGNADO' && r.structuredSignals.refereeProfile === null,
      '3. Sin árbitro designado informa SIN_ARBITRO_DESIGNADO sin inventar nombres'
    );
  }

  // 4. Alineación predicted nunca se trata como CONFIRMADA
  {
    camila.clearCache();
    const mcpClient = {
      getMatchDetails: async () => ({ venue: 'San Siro', referee: null }),
      getLineups: async () => ({ confirmed: false, status: 'PREDICTED' })
    };
    const r = await camila.analyze(
      { id: 'c4', matchId: 'm4', match: 'Milan vs Inter', market: 'player_shots' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.lineupStatus === 'PROYECTADA' && r.rotationRisks.length >= 1,
      '4. Alineación predicted se clasifica como PROYECTADA y nunca como oficial'
    );
  }

  // 5. Árbitro permisivo NO penaliza mercados no sensibles (remates / córners)
  {
    camila.clearCache();
    const mcpClient = {
      getMatchDetails: async () => ({ venue: 'Camp Nou', referee: { id: 'ref_3', name: 'Ref Permisivo' } }),
      getReferee: async () => ({ id: 'ref_3', name: 'Ref Permisivo', foulsPerGame: 16.5, yellowCardsPerGame: 2.2, gamesCount: 10 }),
      getLineups: async () => ({ confirmed: true })
    };
    const r = await camila.analyze(
      { id: 'c5', matchId: 'm5', match: 'Barcelona vs Sevilla', market: 'player_shots', selection: 'Más de 2.5' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.contextRiskDetected === false && r.structuredSignals.riskSeverity === 'NONE',
      '5. Árbitro permisivo no penaliza mercados no sensibles (player_shots)'
    );
  }

  // 6. Error/timeout de StatsHub -> INVESTIGACION_INCOMPLETA sin romper
  {
    camila.clearCache();
    const mcpClient = {
      getMatchDetails: async () => { throw new Error('ETIMEDOUT StatsHub'); },
      getLineups: async () => { throw new Error('ETIMEDOUT StatsHub'); }
    };
    const r = await camila.analyze(
      { id: 'c6', matchId: 'm6', match: 'Ajax vs PSV', market: 'player_fouls' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.investigationStatus === 'INVESTIGACION_INCOMPLETA' && r.mcpErrors.length === 2 && r.recommendation === 'NEUTRAL',
      '6. Error/timeout de StatsHub se registra como INVESTIGACION_INCOMPLETA'
    );
  }

  // 7. Caché evita consultas duplicadas + historial append-only conserva versiones
  {
    camila.clearCache();
    let detailsCalls = 0;
    const mcpClient = {
      getMatchDetails: async () => { detailsCalls++; return { venue: 'Bernabéu', referee: { id: 'ref_7', name: 'Gil Manzano' } }; },
      getReferee: async () => ({ id: 'ref_7', name: 'Gil Manzano', foulsPerGame: 25.1, yellowCardsPerGame: 5.0, gamesCount: 10 }),
      getLineups: async () => ({ confirmed: true })
    };
    const tmpHistory = path.join(os.tmpdir(), `camila_hist_test_${Date.now()}.json`);
    try {
      await camila.analyze({ id: 'c7a', matchId: 'm7', match: 'Real Madrid vs Betis', market: 'player_fouls' }, {}, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const r2 = await camila.analyze({ id: 'c7b', matchId: 'm7', match: 'Real Madrid vs Betis', market: 'player_tackles' }, {}, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const hist = JSON.parse(fs.readFileSync(tmpHistory, 'utf8'));
      assert(
        detailsCalls === 1 && r2.fromCacheCount >= 3 && hist.length === 2 && hist[0].version === 1 && hist[1].version === 2,
        '7. Caché evita consultas duplicadas e historial append-only conserva versiones'
      );
    } finally {
      if (fs.existsSync(tmpHistory)) fs.unlinkSync(tmpHistory);
    }
  }

  // 8. Compatibilidad legada + 101 hashes SHA-256 intactos
  {
    const legacy = await camila.analyze({
      id: 'c8',
      match: 'Man City vs Arsenal',
      market: 'player_shots',
      researchData: {
        lineupData: { status: 'CONFIRMADA' },
        refereeData: { refereeName: 'Anthony Taylor', avgFouls: 23.5, foulStrictnessRatio: 1.08, favorsOvers: true }
      }
    }, {}, { persistHistory: false });
    const integrity = observationTracker.verifyIntegrity();
    assert(
      legacy.recommendation === 'FAVORABLE' && legacy.impactAnalysis.includes('Bajo riesgo') && integrity.intactCount === 101 && integrity.alteredCount === 0,
      '8. Compatibilidad legada preservada y 101 hashes SHA-256 intactos'
    );
  }

  console.log(`\n=== RESULTADO CAMILA 2.0: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Error fatal en test_camila_match_context_v2:', err);
  process.exit(1);
});
