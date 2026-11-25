/**
 * DARADORBET — TEST SUITE: LUCÍA 2.0 (MATCH INTELLIGENCE ANALYST) — 12 ESCENARIOS AISLADOS
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { MatchIntelligenceAnalyst } = require('../agents/matchIntelligenceAnalyst');
const riskManager = require('../agents/riskManager');
const config = require('../config');
const tracker = require('../prediction/observationTracker');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failed++;
  }
}

function makeGoodPrediction() {
  return { ev: 0.14, evPercentage: 14.0, uncertaintyIndex: 0.12, pProjected: 0.65, modelDivergence: 0.04 };
}
function makeGoodReports(matchIntel) {
  return {
    playerAnalyst: { recommendation: 'FAVORABLE', risks: [] },
    teamAnalyst: { recommendation: 'FAVORABLE', risks: [] },
    matchContext: { recommendation: 'FAVORABLE' },
    oddsAnalyst: { recommendation: 'FAVORABLE' },
    matchIntel
  };
}

(async () => {
  console.log('\n=== TEST SUITE: LUCÍA 2.0 (12 ESCENARIOS OBLIGATORIOS) ===\n');
  const FUTURE_KO = '2026-11-28T20:00:00.000Z';
  const NOW = new Date('2026-11-25T10:00:00.000Z').getTime();

  // 1. Noticia confirmada de lesión de un jugador
  await test('1. Noticia confirmada de lesión: detecta riesgo CRITICAL/VETO y lo vincula al mercado afectado', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getTeamNews'
          ? { coverage: 'ok', injuries: [{ playerName: 'Marcus Thuram', reason: 'Lesión muscular', publishedAtUtc: '2026-11-25T08:00:00.000Z' }] }
          : {}
      }
    });
    const rep = await lucia.analyze({ id: 'c1', matchId: 'm1', match: 'Inter vs Stuttgart', playerOrTeam: 'Marcus Thuram', market: 'Remates al arco' }, {}, { now: NOW });
    assert.strictEqual(rep.structuredSignals.newsRiskDetected, true);
    assert.strictEqual(rep.structuredSignals.riskSeverity, 'CRITICAL');
    assert.strictEqual(rep.structuredSignals.recommendation, 'VETO');
    assert.strictEqual(rep.structuredSignals.affectedEntity, 'Marcus Thuram');
    assert.strictEqual(rep.structuredSignals.affectedMarket, 'PLAYER_SHOTS_ON_TARGET');
  });

  // 2. Rumor sin confirmación
  await test('2. Rumor sin confirmación: identificado como RUMOR y no genera veto automático en Elena', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getTeamNews'
          ? { coverage: 'ok', injuries: [{ playerName: 'Marcus Thuram', reason: 'Molestia leve', isRumor: true, publishedAtUtc: '2026-11-25T08:00:00.000Z' }] }
          : {}
      }
    });
    const cand = { id: 'c2', matchId: 'm1', playerOrTeam: 'Marcus Thuram', market: 'Remates al arco', eventDateUtc: FUTURE_KO, bookmakerOdds: 1.7, sampleSize: 15, researchData: { lineupData: { status: 'CONFIRMADA' } } };
    const rep = await lucia.analyze(cand, {}, { now: NOW });
    assert.strictEqual(rep.structuredSignals.evidence[0].verificationStatus, 'RUMOR');
    assert.strictEqual(rep.structuredSignals.recommendation, 'REVIEW');
    const verdict = await riskManager.evaluate(cand, makeGoodPrediction(), makeGoodReports(rep), { now: NOW });
    assert.notStrictEqual(verdict.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdict.finalStatus, 'PENDIENTE');
  });

  // 3. Sin noticias disponibles (noneOnRecord / noData)
  await test('3. Sin noticias disponibles (noneOnRecord): informa ausencia de evidencia sin inventar datos', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: { callTool: async () => ({ coverage: 'noneOnRecord' }) }
    });
    const rep = await lucia.analyze({ id: 'c3', matchId: 'm1', playerOrTeam: 'Jugador X', market: 'Remates totales' }, {}, { now: NOW });
    assert.strictEqual(rep.structuredSignals.newsRiskDetected, false);
    assert.strictEqual(rep.structuredSignals.evidence[0].verificationStatus, 'SIN_INFORMACION');
    assert.ok(rep.structuredSignals.evidence[0].info.includes('noneOnRecord'));
  });

  // 4. Jugador confirmado como titular
  await test('4. Jugador confirmado como titular oficial: incorpora fuente y confirmación', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getLineups'
          ? { confirmed: true, starters: ['Marcus Thuram'] }
          : { coverage: 'ok', injuries: [] }
      }
    });
    const rep = await lucia.analyze({ id: 'c4', matchId: 'm1', playerOrTeam: 'Marcus Thuram', market: 'Remates totales' }, {}, { now: NOW });
    assert.strictEqual(rep.recommendation, 'FAVORABLE');
    assert.ok(rep.structuredSignals.evidence.some(e => e.source === 'StatsHub:getLineups' && e.verificationStatus === 'CONFIRMADO'));
  });

  // 5. Noticia antigua (stale / playedSince)
  await test('5. Noticia antigua (>7 días o playedSince): marcada stale y no genera veto actual', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getTeamNews'
          ? { coverage: 'ok', injuries: [{ playerName: 'Marcus Thuram', reason: 'Golpe antiguo', publishedAtUtc: '2026-11-01T10:00:00.000Z', playedSince: true }] }
          : {}
      }
    });
    const rep = await lucia.analyze({ id: 'c5', matchId: 'm1', playerOrTeam: 'Marcus Thuram', market: 'Remates totales' }, {}, { now: NOW });
    assert.strictEqual(rep.structuredSignals.evidence[0].stale, true);
    assert.strictEqual(rep.structuredSignals.newsRiskDetected, false);
  });

  // 6. Riesgo individual no contamina otros mercados del partido
  await test('6. Riesgo individual de un jugador no contamina el mercado de otro jugador del mismo partido', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getTeamNews'
          ? { coverage: 'ok', injuries: [{ playerName: 'Marcus Thuram', reason: 'Lesión confirmada', publishedAtUtc: '2026-11-25T09:00:00.000Z' }] }
          : {}
      }
    });
    const repOther = await lucia.analyze({ id: 'c6', matchId: 'm1', playerOrTeam: 'Lautaro Martínez', market: 'Remates totales' }, {}, { now: NOW });
    assert.strictEqual(repOther.structuredSignals.newsRiskDetected, false);
  });

  // 7. Contradicción con otro agente
  await test('7. Contradicción con Sofía queda registrada sin alterar el reporte de Sofía', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getTeamNews'
          ? { coverage: 'ok', injuries: [{ playerName: 'Marcus Thuram', reason: 'Lesión confirmada', publishedAtUtc: '2026-11-25T09:00:00.000Z' }] }
          : {}
      }
    });
    const sofiaReport = { recommendation: 'FAVORABLE', summary: 'Estable' };
    const rep = await lucia.analyze({ id: 'c7', matchId: 'm1', playerOrTeam: 'Marcus Thuram', market: 'Remates al arco' }, {}, { now: NOW, otherAgentReports: { playerAnalyst: sofiaReport } });
    assert.strictEqual(rep.structuredSignals.contradictions.length, 1);
    assert.ok(rep.structuredSignals.contradictions[0].affectedAgent.includes('Sofía'));
    assert.strictEqual(sofiaReport.recommendation, 'FAVORABLE'); // Inmutable
  });

  // 8. Error o timeout de StatsHub
  await test('8. Error o timeout de StatsHub: registrado como INVESTIGACION_INCOMPLETA', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: { callTool: async () => { throw new Error('ETIMEDOUT'); } }
    });
    const rep = await lucia.analyze({ id: 'c8', matchId: 'm1', playerOrTeam: 'Jugador X', market: 'Remates totales' }, {}, { now: NOW });
    assert.strictEqual(rep.investigationStatus, 'INVESTIGACION_INCOMPLETA');
    assert.ok(rep.mcpErrors.length >= 1);
  });

  // 9. Respuesta MCP incompleta
  await test('9. Respuesta MCP incompleta: no genera conclusiones ficticias', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: { callTool: async () => null }
    });
    const rep = await lucia.analyze({ id: 'c9', matchId: 'm1', playerOrTeam: 'Jugador X', market: 'Remates totales' }, {}, { now: NOW });
    assert.strictEqual(rep.structuredSignals.newsRiskDetected, false);
    assert.strictEqual(rep.structuredSignals.evidence[0].verificationStatus, 'SIN_INFORMACION');
  });

  // 10. Integración con Elena y risk_verdict formal (VETO en lesión confirmada)
  await test('10. Integración con Elena: esquema validado y risk_verdict formal de VETO', async () => {
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async (tool) => tool === 'getTeamNews'
          ? { coverage: 'ok', injuries: [{ playerName: 'Marcus Thuram', reason: 'Lesión confirmada', publishedAtUtc: '2026-11-25T09:00:00.000Z' }] }
          : {}
      }
    });
    const cand = { id: 'c10', matchId: 'm1', playerOrTeam: 'Marcus Thuram', market: 'Remates al arco', eventDateUtc: FUTURE_KO, bookmakerOdds: 1.7, sampleSize: 15, researchData: { lineupData: { status: 'CONFIRMADA' } } };
    const rep = await lucia.analyze(cand, {}, { now: NOW });
    const verdict = await riskManager.evaluate(cand, makeGoodPrediction(), makeGoodReports(rep), { now: NOW });
    assert.strictEqual(verdict.finalStatus, 'RECHAZADO');
    assert.strictEqual(verdict.vetoApplied, true);
    assert.ok(verdict.finalReason.includes('VETO DE NOTICIAS'));
  });

  // 11. Caché + historial append-only versionado
  await test('11. Caché evita consultas duplicadas e historial append-only conserva versiones', async () => {
    let calls = 0;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'darador_lucia_'));
    const histPath = path.join(tmpDir, 'lucia_hist.json');
    const lucia = new MatchIntelligenceAnalyst({
      mcpClient: {
        callTool: async () => { calls++; return { coverage: 'ok', injuries: [] }; }
      }
    });
    await lucia.analyze({ id: 'c11', matchId: 'm_cache', playerOrTeam: 'Team A (Equipo)', isTeamProp: true, market: 'Córners de equipo' }, {}, { now: NOW, historyPath: histPath });
    const r2 = await lucia.analyze({ id: 'c11', matchId: 'm_cache', playerOrTeam: 'Team A (Equipo)', isTeamProp: true, market: 'Córners de equipo' }, {}, { now: NOW + 60000, historyPath: histPath });
    assert.strictEqual(calls, 1, 'Segunda consulta debe venir de caché');
    assert.strictEqual(r2.fromCacheCount, 1);
    const hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    assert.strictEqual(hist.records.length, 2);
    assert.strictEqual(hist.records[1].versionNumber, 2);
  });

  // 12. Shadow Mode activo + 101 hashes SHA-256 intactos
  await test('12. Shadow Mode activo (0 apuestas reales) y 101 hashes SHA-256 intactos', async () => {
    assert.strictEqual(config.shadowMode.enabled, true);
    assert.strictEqual(config.shadowMode.allowRealBets, false);
    const audit = tracker.verifyIntegrity();
    assert.strictEqual(audit.alteredCount, 0);
    assert.strictEqual(audit.intactCount, 101);
  });

  console.log(`\n=== RESULTADO LUCÍA 2.0: ${passed} PASS | ${failed} FAIL ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
