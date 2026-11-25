/**
 * SUITE DE PRUEBAS AISLADAS: RENATA 2.0 (OddsAnalyst)
 * 8 escenarios obligatorios sobre mocks sin escribir datos de producción.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { OddsAnalyst, computeNoVigProbabilities } = require('../agents/oddsAnalyst');
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
  console.log('\n=== TEST SUITE: RENATA 2.0 (8 ESCENARIOS AISLADOS) ===\n');
  const renata = new OddsAnalyst();

  // 1. Consenso multi-casa con no-vig y cuota fresca -> FAVORABLE
  {
    renata.clearCache();
    const mcpClient = {
      getMatchOdds: async () => ({
        priced: true,
        best: { odds: 1.85, bookmaker: 'Bet365', ageMinutes: 12 },
        average: 1.78,
        books: 8,
        marketOutcomesOdds: [1.85, 2.05]
      }),
      getOutliers: async () => ({ rows: [{ bestOdds: 1.85, averageOdds: 1.78, edge: 0.0393 }] })
    };
    const r = await renata.analyze(
      { id: 'r1', matchId: 'm1', market: 'team_corners', line: 4.5, bookmakerOdds: 1.85 },
      { fairOdds: 1.45, evPercentage: 27.5 },
      { mcpClient, persistHistory: false }
    );
    assert(
      r.version === '2.0.0' && r.recommendation === 'FAVORABLE' && r.structuredSignals.noVigConsensus.overroundPct > 0 && r.structuredSignals.booksCount === 8,
      '1. Consenso multi-casa con cálculo no-vig y cuota fresca devuelve FAVORABLE'
    );
  }

  // 2. Mercado aún no cotizado (priced: false) -> DESFAVORABLE + riskSeverity HIGH
  {
    renata.clearCache();
    const mcpClient = {
      getMatchOdds: async () => ({ priced: false })
    };
    const r = await renata.analyze(
      { id: 'r2', matchId: 'm2', market: 'cards', bookmakerOdds: 1.80 },
      { fairOdds: 1.50, evPercentage: 20.0 },
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.isPriced === false && r.structuredSignals.riskSeverity === 'HIGH' && r.recommendation === 'DESFAVORABLE',
      '2. Mercado sin cotización (priced: false) devuelve DESFAVORABLE con severidad HIGH'
    );
  }

  // 3. Cuota desactualizada (ageMinutes > 120) -> PRECAUCION + oddsRiskDetected
  {
    renata.clearCache();
    const mcpClient = {
      getMatchOdds: async () => ({ priced: true, best: { odds: 1.20, bookmaker: 'Bet365', ageMinutes: 240 }, average: 1.18, books: 5 })
    };
    const r = await renata.analyze(
      { id: 'r3', matchId: 'm3', market: 'double_chance', bookmakerOdds: 1.20 },
      { fairOdds: 1.10, evPercentage: 9.1 },
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.oddsRiskDetected === true && r.structuredSignals.riskSeverity === 'MEDIUM' && r.recommendation === 'PRECAUCION',
      '3. Cuota desactualizada (>120 min) dispara PRECAUCION y riesgo MEDIUM'
    );
  }

  // 4. Baja liquidez (books < 2) -> riesgo LOW registrado
  {
    renata.clearCache();
    const mcpClient = {
      getMatchOdds: async () => ({ priced: true, best: { odds: 1.22, bookmaker: 'Bet365', ageMinutes: 10 }, average: 1.22, books: 1 })
    };
    const r = await renata.analyze(
      { id: 'r4', matchId: 'm4', market: 'player_fouls', bookmakerOdds: 1.22 },
      { fairOdds: 1.12, evPercentage: 8.9 },
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.oddsRiskDetected === true && r.structuredSignals.riskSeverity === 'LOW' && r.risks.some(x => x.includes('Liquidez baja')),
      '4. Baja liquidez (1 sola casa) queda registrada como riesgo LOW'
    );
  }

  // 5. Movimiento de cuota (CLV): steam favorable vs drift adverso
  {
    renata.clearCache();
    const mcpClient = {
      getMatchOdds: async (args) => {
        if (args.movement) return { openingOdds: 1.95, currentOdds: 1.75 };
        return { priced: true, best: { odds: 1.75, bookmaker: 'Bet365', ageMinutes: 5 }, average: 1.72, books: 6 };
      }
    };
    const r = await renata.analyze(
      { id: 'r5', matchId: 'm5', market: 'shots', movementMarket: 'shots', selectionSide: 'over', bookmakerOdds: 1.75 },
      { fairOdds: 1.50, evPercentage: 16.6 },
      { mcpClient, persistHistory: false }
    );
    assert(
      r.structuredSignals.clvMovement.direction === 'STEAM_FAVORABLE' && r.clvAssessment.includes('ALTO'),
      '5. Movimiento de cuota detecta STEAM_FAVORABLE y eleva evaluación CLV'
    );
  }

  // 6. Error/timeout de StatsHub -> INVESTIGACION_INCOMPLETA sin romper
  {
    renata.clearCache();
    const mcpClient = {
      getMatchOdds: async () => { throw new Error('StatsHub 503'); }
    };
    const r = await renata.analyze(
      { id: 'r6', matchId: 'm6', market: '1x2', bookmakerOdds: 1.20 },
      { fairOdds: 1.10, evPercentage: 9.1 },
      { mcpClient, persistHistory: false }
    );
    assert(
      r.investigationStatus === 'INVESTIGACION_INCOMPLETA' && r.mcpErrors.length === 1 && r.recommendation === 'NEUTRAL',
      '6. Error/timeout de StatsHub se registra como INVESTIGACION_INCOMPLETA'
    );
  }

  // 7. Caché evita consultas duplicadas + historial append-only conserva versiones
  {
    renata.clearCache();
    let oddsCalls = 0;
    const mcpClient = {
      getMatchOdds: async () => {
        oddsCalls++;
        return { priced: true, best: { odds: 1.80, bookmaker: 'Bet365', ageMinutes: 8 }, average: 1.76, books: 5 };
      }
    };
    const tmpHistory = path.join(os.tmpdir(), `renata_hist_test_${Date.now()}.json`);
    try {
      await renata.analyze({ id: 'r7a', matchId: 'm7', market: 'team_corners', line: 4.5, bookmakerOdds: 1.80 }, { fairOdds: 1.45, evPercentage: 24.1 }, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const r2 = await renata.analyze({ id: 'r7b', matchId: 'm7', market: 'team_corners', line: 4.5, bookmakerOdds: 1.80 }, { fairOdds: 1.45, evPercentage: 24.1 }, { mcpClient, persistHistory: true, historyPath: tmpHistory });
      const hist = JSON.parse(fs.readFileSync(tmpHistory, 'utf8'));
      assert(
        oddsCalls === 1 && r2.fromCacheCount >= 1 && hist.length === 2 && hist[0].version === 1 && hist[1].version === 2,
        '7. Caché evita consultas duplicadas e historial append-only conserva versiones'
      );
    } finally {
      if (fs.existsSync(tmpHistory)) fs.unlinkSync(tmpHistory);
    }
  }

  // 8. Fórmula no-vig exacta + compatibilidad legada + 101 hashes SHA-256 intactos
  {
    const nv = computeNoVigProbabilities([2.0, 2.0]);
    const legacy = await renata.analyze(
      { id: 'r8', market: 'player_shots', bookmakerOdds: 1.80 },
      { fairOdds: 1.38, evPercentage: 30.4 },
      { persistHistory: false }
    );
    const integrity = observationTracker.verifyIntegrity();
    assert(
      nv.overroundPct === 0 && nv.noVigProbs[0] === 0.5 && legacy.recommendation === 'FAVORABLE' && legacy.fairOdds === 1.38 && integrity.intactCount === 101 && integrity.alteredCount === 0,
      '8. Consenso no-vig exacto, compatibilidad legada y 101 hashes SHA-256 intactos'
    );
  }

  console.log(`\n=== RESULTADO RENATA 2.0: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Error fatal en test_renata_odds_v2:', err);
  process.exit(1);
});
