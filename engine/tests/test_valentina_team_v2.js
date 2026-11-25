/**
 * SUITE DE PRUEBAS AISLADAS: VALENTINA 2.0 (TeamAnalyst)
 * 6 escenarios obligatorios sobre mocks sin escribir datos de producción.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TeamAnalyst } = require('../agents/teamAnalyst');
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
  console.log('\n=== TEST SUITE: VALENTINA 2.0 (6 ESCENARIOS AISLADOS) ===\n');
  const valentina = new TeamAnalyst();

  // 1. Forma sólida local + rival vulnerable -> FAVORABLE
  {
    valentina.clearCache();
    const mcpClient = {
      getTeamPerformance: async (args) => {
        if (args.teamId === 't_home') return { games: 10, wins: 7, draws: 2, losses: 1, avgCornersFor: 6.4, avgShotsFor: 16.2 };
        return { games: 10, avgCornersAgainst: 6.8, avgShotsAgainst: 15.5, concessionRatio: 1.22 };
      }
    };
    const r = await valentina.analyze(
      { id: 'v1', teamId: 't_home', opponentTeamId: 't_away', team: 'Slavia Praha', opponent: 'Villarreal', match: 'Slavia Praha vs Villarreal', market: 'team_corners' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.version === '2.0.0' && r.recommendation === 'FAVORABLE' && r.structuredSignals.teamForm.wins === 7 && r.structuredSignals.opponentConcession.concessionRatio === 1.22,
      '1. Forma sólida local + rival vulnerable devuelve FAVORABLE con datos reales'
    );
  }

  // 2. Visitante en mala racha ante defensa cerrada -> DESFAVORABLE + teamRiskDetected
  {
    valentina.clearCache();
    const mcpClient = {
      getTeamPerformance: async (args) => {
        if (args.teamId === 't_away') return { games: 10, wins: 2, draws: 1, losses: 7 };
        return { games: 10, concessionRatio: 0.82 };
      }
    };
    const r = await valentina.analyze(
      { id: 'v2', teamId: 't_away', opponentTeamId: 't_home', team: 'Visitante FC', opponent: 'Local FC', match: 'Local FC vs Visitante FC', market: 'team_corners' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.recommendation === 'DESFAVORABLE' && r.structuredSignals.teamRiskDetected === true && r.structuredSignals.riskSeverity === 'MEDIUM',
      '2. Visitante en mala racha ante defensa cerrada devuelve DESFAVORABLE'
    );
  }

  // 3. Error de StatsHub -> INVESTIGACION_INCOMPLETA sin romper
  {
    valentina.clearCache();
    const mcpClient = {
      getTeamPerformance: async () => { throw new Error('StatsHub timeout'); }
    };
    const r = await valentina.analyze(
      { id: 'v3', teamId: 't1', opponentTeamId: 't2', team: 'A', opponent: 'B', match: 'A vs B', market: 'team_corners' },
      {},
      { mcpClient, persistHistory: false }
    );
    assert(
      r.investigationStatus === 'INVESTIGACION_INCOMPLETA' && r.mcpErrors.length === 2 && r.recommendation === 'NEUTRAL',
      '3. Error de StatsHub se registra como INVESTIGACION_INCOMPLETA'
    );
  }

  // 4. Caché evita consultas duplicadas + historial append-only conserva versiones
  {
    valentina.clearCache();
    let calls = 0;
    const mcpClient = {
      getTeamPerformance: async () => { calls++; return { games: 10, wins: 6, draws: 2, losses: 2, concessionRatio: 1.18 }; }
    };
    const tmpHistory = path.join(os.tmpdir(), `valentina_hist_test_${Date.now()}.json`);
    try {
      await valentina.analyze({ id: 'v4a', teamId: 't10', opponentTeamId: 't20', team: 'Home', opponent: 'Away', match: 'Home vs Away', market: 'team_corners' }, {}, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const r2 = await valentina.analyze({ id: 'v4b', teamId: 't10', opponentTeamId: 't20', team: 'Home', opponent: 'Away', match: 'Home vs Away', market: 'team_shots' }, {}, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const hist = JSON.parse(fs.readFileSync(tmpHistory, 'utf8'));
      assert(
        calls === 2 && r2.fromCacheCount === 2 && hist.length === 2 && hist[0].version === 1 && hist[1].version === 2,
        '4. Caché evita consultas duplicadas e historial append-only conserva versiones'
      );
    } finally {
      if (fs.existsSync(tmpHistory)) fs.unlinkSync(tmpHistory);
    }
  }

  // 5. Compatibilidad legada (sin MCP) preservada
  {
    const legacy = await valentina.analyze({
      id: 'v5',
      team: 'Manchester City',
      opponent: 'Arsenal',
      match: 'Manchester City vs Arsenal',
      market: 'Remates totales',
      researchData: { opponentData: { concessionRatio: 1.18, isVulnerable: true, defensiveRank: 'Baja' } }
    }, {}, { persistHistory: false });
    assert(
      legacy.recommendation === 'FAVORABLE' && legacy.tacticalSummary.includes('1.18x'),
      '5. Compatibilidad legada preservada sin MCP'
    );
  }

  // 6. Integridad de 101 hashes SHA-256 intacta
  {
    const integrity = observationTracker.verifyIntegrity();
    assert(
      integrity.intactCount === 101 && integrity.alteredCount === 0,
      '6. 101 hashes SHA-256 históricos permanecen intactos'
    );
  }

  console.log(`\n=== RESULTADO VALENTINA 2.0: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Error fatal en test_valentina_team_v2:', err);
  process.exit(1);
});
