/**
 * SETTLEMENT ENGINE - LIQUIDACIÓN AUTOMÁTICA DE PRONÓSTICOS
 * Fase 6: Monitorea partidos disputados, valida resultados reales de las estadísticas
 * individuales o colectivas de StatsHub, determina si la apuesta fue GANADA / PERDIDA / NULA
 * y actualiza automáticamente el historial y las métricas de rendimiento (+ROI).
 */
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');
const syncRadar = require('../data/syncRadar');

class SettlementEngine {
  constructor() {
    this.name = 'SettlementEngine';
  }

  /**
   * Ejecuta el ciclo de liquidación para todos los picks aprobados pendientes
   * @param {Object} options
   * @returns {Promise<Object>} Resumen de liquidaciones
   */
  async settlePendingPicks(options = {}) {
    console.log('[Settlement] Iniciando ciclo de liquidación de resultados...');
    const approvedPicks = storage.getApprovedPicks();
    const existingHistory = storage.getResults();

    // Filtrar picks ya liquidados
    const settledIds = new Set(existingHistory.map(h => h.pickId || h.id));
    const pendingToSettle = approvedPicks.filter(p => !settledIds.has(p.id));

    console.log(`[Settlement] Picks aprobados a evaluar: ${pendingToSettle.length}`);

    const settledResults = [];

    for (const pick of pendingToSettle) {
      try {
        const result = await this.evaluatePick(pick, options.mockData);
        if (result) {
          storage.saveResult(result);
          settledResults.push(result);
          console.log(`[Settlement] Pick ${pick.player} (${pick.market} ${pick.line}): ${result.status} [${result.actualStat} vs ${result.targetLine}]`);
        }
      } catch (err) {
        console.warn(`[Settlement] Error evaluando pick ${pick.id}: ${err.message}`);
      }
    }

    // Sincronizar con historial_picks.json
    const historialSummary = syncRadar.exportToHistorial();

    return {
      evaluated: pendingToSettle.length,
      settled: settledResults.length,
      results: settledResults,
      historialSummary
    };
  }

  /**
   * Evalúa un pick específico comparando resultado real con la línea
   */
  async evaluatePick(pick, mockData = null) {
    let actualStat = null;
    let matchFinished = false;
    let score = null;

    if (mockData && mockData[pick.id]) {
      actualStat = mockData[pick.id].stat;
      matchFinished = true;
      score = mockData[pick.id].score || 'Final';
    } else {
      // Consultar StatsHub MCP para obtener estadísticas finales
      try {
        if (pick.matchId) {
          const matchDetails = await mcpClient.callTool('getMatchDetails', { matchId: pick.matchId });
          if (matchDetails && matchDetails.status === 'FT') {
            matchFinished = true;
            score = `${matchDetails.homeScore}-${matchDetails.awayScore}`;
          }
        }

        // Si es jugador individual, consultar playerStats
        if (pick.playerId) {
          const pStats = await mcpClient.callTool('getPlayerStats', { playerId: pick.playerId, lastGames: 1 });
          if (pStats && pStats.lastGame) {
            actualStat = this._extractStatFromGame(pStats.lastGame, pick.market);
            matchFinished = true;
          }
        }
      } catch (e) {
        // En sandbox o sin matchId, si no hay datos reales, no liquidar aún
        return null;
      }
    }

    if (!matchFinished || actualStat === null) {
      return null; // El partido sigue en juego o no hay datos
    }

    // Determinar resultado: GANADA vs PERDIDA
    const lineStr = String(pick.line || pick.linea || '0.5');
    const targetLineNum = parseFloat(lineStr.replace(/[^\d.]/g, '') || '0.5');
    const isOver = !lineStr || lineStr.toLowerCase().includes('más') || lineStr.toLowerCase().includes('over') || lineStr.includes('>');

    let status = 'PERDIDA';
    if (isOver) {
      if (actualStat > targetLineNum) status = 'GANADA';
      else if (actualStat === targetLineNum) status = 'NULA';
    } else {
      if (actualStat < targetLineNum) status = 'GANADA';
      else if (actualStat === targetLineNum) status = 'NULA';
    }

    const odds = Number(pick.odds || pick.cuota || 1.80);
    const stake = 1.0; // Unidad estándar
    let profitUnits = 0.0;

    if (status === 'GANADA') {
      profitUnits = Number(((odds - 1) * stake).toFixed(2));
    } else if (status === 'PERDIDA') {
      profitUnits = -stake;
    } else {
      profitUnits = 0.0;
    }

    return {
      pickId: pick.id,
      date: pick.date || new Date().toISOString().slice(0, 10),
      match: pick.match || pick.partido,
      player: pick.player || pick.seleccion,
      market: pick.market || pick.mercado,
      line: pick.line || pick.linea,
      odds,
      targetLine: targetLineNum,
      actualStat,
      matchScore: score,
      status, // 'GANADA' | 'PERDIDA' | 'NULA'
      stakedUnits: stake,
      profitUnits,
      settledAt: new Date().toISOString()
    };
  }

  _extractStatFromGame(game, market) {
    if (!game) return null;
    const m = (market || '').toLowerCase();
    if (m.includes('remates al arco') || m.includes('tiros a puerta')) return game.shotsOnTarget ?? game.shots_on_target ?? 0;
    if (m.includes('remates')) return game.shots ?? game.total_shots ?? 0;
    if (m.includes('falta') && m.includes('comet')) return game.foulsCommitted ?? game.fouls ?? 0;
    if (m.includes('falta') && m.includes('ganad')) return game.foulsWon ?? game.fouls_drawn ?? 0;
    if (m.includes('tackle') || m.includes('entrada')) return game.tackles ?? 0;
    if (m.includes('córner') || m.includes('corner')) return game.corners ?? 0;
    return 0;
  }
}

module.exports = new SettlementEngine();
