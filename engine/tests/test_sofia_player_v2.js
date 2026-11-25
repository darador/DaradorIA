/**
 * SUITE DE PRUEBAS AISLADAS: SOFÍA 2.0 (PlayerAnalyst)
 * 6 escenarios obligatorios sobre mocks sin escribir datos de producción.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PlayerAnalyst } = require('../agents/playerAnalyst');
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
  console.log('\n=== TEST SUITE: SOFÍA 2.0 (6 ESCENARIOS AISLADOS) ===\n');
  const sofia = new PlayerAnalyst();

  // 1. Jugador consistente en StatsHub (getPlayerStats + getPlayerTrends) -> FAVORABLE
  {
    sofia.clearCache();
    const mcpClient = {
      getPlayerStats: async () => ({ starts: 10, avgMinutes: 86, per90: 4.2, hitsOverLine: 8 }),
      getPlayerTrends: async () => ({ rows: [{ hits: '8/10', runGames: 8, last10HitRate: 80, last10: '8/10, avg 4.2' }] })
    };
    const r = await sofia.analyze(
      { id: 's1', playerId: 'p1', playerOrTeam: 'Erling Haaland', market: 'player_shots', rawLine: 2.5, line: 'Más de 2.5' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.version === '2.0.0' && r.recommendation === 'FAVORABLE' && r.structuredSignals.hitRateLast10 === 80 && r.structuredSignals.mirageTrendDetected === false,
      '1. Jugador consistente en StatsHub devuelve FAVORABLE con hit-rate real'
    );
  }

  // 2. Espejismo de racha corta (3/3 pero last10 40%) -> PRECAUCION + mirageTrendDetected
  {
    sofia.clearCache();
    const mcpClient = {
      getPlayerStats: async () => ({ starts: 10, avgMinutes: 80, per90: 2.1, hitsOverLine: 4 }),
      getPlayerTrends: async () => ({ rows: [{ hits: '3/3', runGames: 3, last10HitRate: 40, last10: '4/10, avg 1.8' }] })
    };
    const r = await sofia.analyze(
      { id: 's2', playerId: 'p2', playerOrTeam: 'Jugador Racha Corta', market: 'player_shots', rawLine: 1.5, line: 'Más de 1.5' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.mirageTrendDetected === true && r.recommendation === 'PRECAUCION' && r.structuredSignals.playerRiskDetected === true,
      '2. Espejismo de racha corta (3/3 con last10 40%) activa PRECAUCION'
    );
  }

  // 3. Mercado colectivo (isTeamProp: true) no llama a getPlayerStats
  {
    sofia.clearCache();
    let called = false;
    const mcpClient = {
      getPlayerStats: async () => { called = true; return {}; }
    };
    const r = await sofia.analyze(
      { id: 's3', isTeamProp: true, playerOrTeam: 'Slavia Praha', market: 'team_corners' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      called === false && r.recommendation === 'FAVORABLE' && r.investigationStatus === 'NO_APLICA_EQUIPO',
      '3. Mercado colectivo no consulta getPlayerStats y devuelve FAVORABLE'
    );
  }

  // 4. Error de StatsHub -> INVESTIGACION_INCOMPLETA sin romper
  {
    sofia.clearCache();
    const mcpClient = {
      getPlayerStats: async () => { throw new Error('StatsHub error'); },
      getPlayerTrends: async () => { throw new Error('StatsHub error'); }
    };
    const r = await sofia.analyze(
      { id: 's4', playerId: 'p4', playerOrTeam: 'Player X', market: 'player_fouls', rawLine: 0.5 },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.investigationStatus === 'INVESTIGACION_INCOMPLETA' && r.mcpErrors.length === 2 && r.recommendation === 'NEUTRAL',
      '4. Error de StatsHub se registra como INVESTIGACION_INCOMPLETA'
    );
  }

  // 5. Caché evita consultas duplicadas + historial append-only conserva versiones
  {
    sofia.clearCache();
    let calls = 0;
    const mcpClient = {
      getPlayerStats: async () => { calls++; return { starts: 10, avgMinutes: 85, per90: 3.1, hitsOverLine: 7 }; },
      getPlayerTrends: async () => ({ rows: [] })
    };
    const tmpHistory = path.join(os.tmpdir(), `sofia_hist_test_${Date.now()}.json`);
    try {
      await sofia.analyze({ id: 's5a', playerId: 'p5', playerOrTeam: 'Player 5', market: 'player_shots', rawLine: 1.5 }, {}, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const r2 = await sofia.analyze({ id: 's5b', playerId: 'p5', playerOrTeam: 'Player 5', market: 'player_shots', rawLine: 1.5 }, {}, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const hist = JSON.parse(fs.readFileSync(tmpHistory, 'utf8'));
      assert(
        calls === 1 && r2.fromCacheCount >= 2 && hist.length === 2 && hist[0].version === 1 && hist[1].version === 2,
        '5. Caché evita consultas duplicadas e historial append-only conserva versiones'
      );
    } finally {
      if (fs.existsSync(tmpHistory)) fs.unlinkSync(tmpHistory);
    }
  }

  // 6. Compatibilidad legada + 101 hashes SHA-256 intactos
  {
    const legacy = await sofia.analyze({
      id: 's6',
      playerOrTeam: 'Erling Haaland',
      market: 'Remates totales',
      rawLine: 2.5,
      line: 'Más de 2.5',
      researchData: { playerData: { starts: 18, avgMinutes: 85, statPer90: 4.8, historicalValues: [4, 5, 3, 6, 4] } }
    }, {}, { persistHistory: false });
    const integrity = observationTracker.verifyIntegrity();
    assert(
      legacy.recommendation === 'FAVORABLE' && legacy.favorableFindings.length >= 2 && integrity.intactCount === 101 && integrity.alteredCount === 0,
      '6. Compatibilidad legada preservada y 101 hashes SHA-256 intactos'
    );
  }

  console.log(`\n=== RESULTADO SOFÍA 2.0: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Error fatal en test_sofia_player_v2:', err);
  process.exit(1);
});
