/**
 * DARADORIA / DARADORBET - PHASE 11.2 COMPREHENSIVE RECONCILIATION TEST SUITE
 * 
 * Verifies:
 * 1. Strict separation of 119 candidates, 30 quarantine mocks, and 27 picks_hoy.
 * 2. 19-Nov 18th pick identification (cand_1795110774831_6rsb2k).
 * 3. Exact settlement status of Karim Dermane (GANADA, +0.80U) & Javi Puado (ANULADA_NO_TITULAR, 0.00U).
 * 4. Mathematical recalculation: 11 Won, 8 Lost, 1 Void, 57.9% Win Rate, +0.67 U Net Profit, +3.5% Yield.
 * 5. Settlement idempotency (multiple runs yield 0 duplicates and 0 profit mutation).
 * 6. Dynamic API /api/metrics health and schema contract.
 * 7. Cryptographic integrity of the SHA-256 Ledger (57/57 intact seals, 0 violations).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('================================================================');
console.log('🧪 EJECUTANDO SUITE DE PRUEBAS - FASE 11.2 RECONCILIACIÓN');
console.log('================================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function executeSuite() {
  const rootDir = path.resolve(__dirname, '../..');
  const candidatesPath = path.join(rootDir, 'engine/storage_data/research_candidates.json');
  const quarantinePath = path.join(rootDir, 'engine/storage_data/quarantine_candidates.json');
  const recon119Path = path.join(rootDir, 'engine/storage_data/reconciliation_119_candidates.json');
  const picksHoyPath = path.join(rootDir, 'picks_hoy.json');
  const pickResultsPath = path.join(rootDir, 'engine/storage_data/pick_results.json');
  const historialPath = path.join(rootDir, 'historial_picks.json');
  const registryPath = path.join(rootDir, 'engine/storage_data/model_observation_registry.json');

  // TEST 1: Separación de conjuntos
  runTest('1. Separación estricta de conjuntos de datos (119 candidatos, 30 cuarentena)', () => {
    const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    assert.strictEqual(candidates.length, 119, `research_candidates.json debe tener 119 registros, se encontraron ${candidates.length}`);

    const quarantine = JSON.parse(fs.readFileSync(quarantinePath, 'utf8'));
    const mockList = quarantine.quarantinedCandidates || [];
    assert.strictEqual(mockList.length, 30, `quarantine_candidates.json debe aislar exactamente 30 candidatos mock, se encontraron ${mockList.length}`);

    const recon = JSON.parse(fs.readFileSync(recon119Path, 'utf8'));
    assert.strictEqual(recon.length, 119, `La reconciliación debe cubrir exactamente 119 registros, se encontraron ${recon.length}`);

    // Comprobar que ningún mock de cuarentena está en picks_hoy ni en historial
    const picksHoy = JSON.parse(fs.readFileSync(picksHoyPath, 'utf8')).top_picks || [];
    const historial = JSON.parse(fs.readFileSync(historialPath, 'utf8')).picks || [];
    const mockIds = new Set(mockList.map(m => m.id));

    const leakedInPicks = picksHoy.filter(p => mockIds.has(p.id));
    const leakedInHist = historial.filter(h => mockIds.has(h.id));

    assert.strictEqual(leakedInPicks.length, 0, `Hay ${leakedInPicks.length} mocks filtrados en picks_hoy.json`);
    assert.strictEqual(leakedInHist.length, 0, `Hay ${leakedInHist.length} mocks filtrados en historial_picks.json`);
  });

  // TEST 2: Identificación del pick faltante del 19-Nov
  runTest('2. Identificación formal del pick 18 del 19-Nov (cand_1795110774831_6rsb2k)', () => {
    const historial = JSON.parse(fs.readFileSync(historialPath, 'utf8')).picks || [];
    const pick18 = historial.find(p => p.id === 'cand_1795110774831_6rsb2k');
    assert(pick18, 'El pick cand_1795110774831_6rsb2k debe existir en el historial');
    assert.strictEqual(pick18.date, '2026-11-19', 'Debe pertenecer a la jornada del 19-Nov');
    assert.strictEqual(pick18.match, 'Internacional vs Vasco da Gama');
    assert.strictEqual(pick18.player, 'Internacional (Equipo)');
    assert.strictEqual(pick18.market, 'Remates al arco de equipo');
    assert.strictEqual(pick18.status, 'FALLADA');
    assert.strictEqual(pick18.profit, -1);

    // Verificar en candidates por qué no estaba en top_picks
    const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    const cand18 = candidates.find(c => c.id === 'cand_1795110774831_6rsb2k');
    assert(cand18, 'El candidato debe existir en research_candidates.json');
    assert.strictEqual(cand18.status, 'INVESTIGACION_INCOMPLETA', 'Fue descartado para top_picks por INVESTIGACION_INCOMPLETA');
  });

  // TEST 3: Verificación de Dermane y Puado
  runTest('3. Liquidación exacta de Karim Dermane y Javi Puado', () => {
    const results = JSON.parse(fs.readFileSync(pickResultsPath, 'utf8'));
    const historial = JSON.parse(fs.readFileSync(historialPath, 'utf8')).picks || [];
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

    const dermaneRes = results.find(r => r.pickId === 'cand_1795187331561_zeldy6' || r.id === 'cand_1795187331561_zeldy6');
    const dermaneHist = historial.find(h => h.id === 'cand_1795187331561_zeldy6');
    const dermaneReg = registry.find(reg => reg.pickId === 'cand_1795187331561_zeldy6');

    assert(dermaneRes && dermaneHist && dermaneReg, 'Dermane debe estar presente en results, historial y registry');
    assert.strictEqual(dermaneRes.status, 'GANADA');
    assert.strictEqual(dermaneRes.actualStat, 3);
    assert.strictEqual(dermaneHist.profit, 0.8);
    assert.strictEqual(dermaneReg.profitUnits, 0.8);
    assert.strictEqual(dermaneReg.finalResultConfirmed, 'GANADA');

    const puadoRes = results.find(r => r.pickId === 'cand_1795187331561_xmcbes' || r.id === 'cand_1795187331561_xmcbes');
    const puadoHist = historial.find(h => h.id === 'cand_1795187331561_xmcbes');
    const puadoReg = registry.find(reg => reg.pickId === 'cand_1795187331561_xmcbes');

    assert(puadoRes && puadoHist && puadoReg, 'Puado debe estar presente en results, historial y registry');
    assert.strictEqual(puadoRes.status, 'ANULADA_NO_TITULAR');
    assert.strictEqual(puadoHist.status, 'ANULADA_NO_TITULAR');
    assert.strictEqual(puadoHist.profit, 0);
    assert.strictEqual(puadoReg.profitUnits, 0);
    assert.strictEqual(puadoReg.finalResultConfirmed, 'ANULADA_NO_TITULAR');
  });

  // TEST 4: Recalculación matemática desde cero
  runTest('4. Recalculación matemática de métricas consolidadas (57.9% WR, +0.67U PnL, +3.5% ROI)', () => {
    const historial = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
    const picks = historial.picks || [];

    let won = 0;
    let lost = 0;
    let voidBets = 0;
    let staked = 0;
    let netProfit = 0;

    picks.forEach(p => {
      const isWon = p.status === 'GANADA' || p.status === 'ACERTADA';
      const isLost = p.status === 'PERDIDA' || p.status === 'FALLADA';
      const isVoid = p.status === 'ANULADA' || p.status === 'ANULADA_NO_TITULAR';

      if (isWon) {
        won++;
        staked += p.stake;
        netProfit += p.profit;
      } else if (isLost) {
        lost++;
        staked += p.stake;
        netProfit += p.profit;
      } else if (isVoid) {
        voidBets++;
        // stake reembolsado, ganancia 0
      }
    });

    const settled = won + lost;
    const winRate = Number(((won / settled) * 100).toFixed(1));
    const roi = Number(((netProfit / staked) * 100).toFixed(1));
    const finalProfit = Number(netProfit.toFixed(2));

    assert.strictEqual(picks.length, 20, `Deben ser 20 apuestas en total`);
    assert.strictEqual(won, 11, `Deben ser 11 apuestas ganadas`);
    assert.strictEqual(lost, 8, `Deben ser 8 apuestas perdidas`);
    assert.strictEqual(voidBets, 1, `Debe haber 1 apuesta anulada`);
    assert.strictEqual(settled, 19, `Deben ser 19 apuestas resueltas decisorias`);
    assert.strictEqual(winRate, 57.9, `Win Rate esperado 57.9%, obtenido ${winRate}%`);
    assert.strictEqual(finalProfit, 0.67, `Beneficio neto esperado +0.67U, obtenido ${finalProfit}U`);
    assert.strictEqual(roi, 3.5, `ROI esperado +3.5%, obtenido ${roi}%`);

    // Comparar con el summary almacenado
    const sum = historial.summary;
    assert.strictEqual(sum.win_rate_pct, 57.9);
    assert.strictEqual(sum.net_profit_units, 0.67);
    assert.strictEqual(sum.roi_pct, 3.5);
    assert.strictEqual(sum.void_bets, 1);
  });

  // TEST 5: Idempotencia de la sincronización
  runTest('5. Idempotencia de Settlement (ejecución reiterada no duplica registros)', () => {
    const syncRadar = require('../data/syncRadar');
    const tracker = require('../prediction/observationTracker');

    const beforeHist = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
    const beforeCount = beforeHist.picks.length;
    const beforeProfit = beforeHist.summary.net_profit_units;

    // Ejecutar exportación de nuevo
    syncRadar.exportToHistorial();

    const afterHist = JSON.parse(fs.readFileSync(historialPath, 'utf8'));
    const afterCount = afterHist.picks.length;
    const afterProfit = afterHist.summary.net_profit_units;

    assert.strictEqual(afterCount, beforeCount, `El conteo de picks no debe cambiar (esperado ${beforeCount}, obtenido ${afterCount})`);
    assert.strictEqual(afterProfit, beforeProfit, `El profit neto no debe inflarse (esperado ${beforeProfit}, obtenido ${afterProfit})`);
  });

  // TEST 6: Verificación de Integridad SHA-256
  runTest('6. Verificación de Integridad Criptográfica (57 sellos intactos, 0 violaciones)', () => {
    const tracker = require('../prediction/observationTracker');
    const audit = tracker.verifyIntegrity();

    assert.strictEqual(audit.alteredCount, 0, `Se detectaron ${audit.alteredCount} registros alterados`);
    assert.strictEqual(audit.intactCount, 57, `Se esperaban 57 registros intactos, se verificaron ${audit.intactCount}`);
    assert.strictEqual(audit.violations.length, 0, `La lista de violaciones debe estar vacía`);
  });

  // TEST 7: Contrato de la API /api/metrics
  await runAsyncTest('7. Contrato dinámico HTTP 200 en /api/metrics', async () => {
    return new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3333/api/metrics', (res) => {
        assert.strictEqual(res.statusCode, 200, `Código de estado HTTP esperado 200, obtenido ${res.statusCode}`);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            assert.strictEqual(json.status, 'ok', 'Status de respuesta debe ser ok');
            assert.strictEqual(json.totalTrackedPicks, 20, 'Total de picks en historial debe ser 20');
            assert.strictEqual(json.summary.win_rate_pct, 57.9, 'Win rate en summary debe ser 57.9%');
            assert.strictEqual(json.summary.net_profit_units, 0.67, 'Net profit en summary debe ser 0.67');
            assert.strictEqual(json.evaluation.financialMetrics.wonBets, 11, 'Evaluator debe reportar 11 wonBets');
            assert.strictEqual(json.evaluation.financialMetrics.lostBets, 8, 'Evaluator debe reportar 8 lostBets');
            assert.strictEqual(json.evaluation.financialMetrics.yieldPct, 3.5, 'Evaluator yieldPct debe ser 3.5%');
            assert(json.evaluation.probabilisticMetrics.brierScore !== null, 'Brier score debe estar presente');
            assert(json.evaluation.probabilisticMetrics.logLoss !== null, 'Log loss debe estar presente');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', (err) => {
        reject(new Error(`Fallo de conexión al servidor: ${err.message}`));
      });
    });
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADOS SUITE FASE 11.2: ${passedTests} PASADOS, ${failedTests} FALLADOS`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

executeSuite();
