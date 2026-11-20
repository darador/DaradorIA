/**
 * SETTLEMENT ENGINE - LIQUIDACIÓN AUTOMÁTICA DE PRONÓSTICOS
 * Fase 6: Monitorea partidos disputados, valida resultados reales de las estadísticas
 * individuales o colectivas de StatsHub, determina si la apuesta fue GANADA / PERDIDA / NULA
 * y actualiza automáticamente el historial y las métricas de rendimiento (+ROI).
 */
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');
const syncRadar = require('../data/syncRadar');
const observationTracker = require('../prediction/observationTracker');

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
        if (result && result.isSettled !== false) {
          storage.saveResult(result);
          settledResults.push(result);
          try {
            observationTracker.recordSettlement(pick.id, result);
          } catch (trErr) {
            console.warn(`[Settlement] Error actualizando tracker para ${pick.id}:`, trErr.message);
          }
          console.log(`[Settlement] Pick ${pick.player} (${pick.market} ${pick.line}): ${result.status} [${result.actualStat} vs ${result.targetLine}]`);
        } else if (result && result.verificationStatus) {
          try {
            observationTracker.recordSettlement(pick.id, result);
          } catch (trErr) {
            console.warn(`[Settlement] Error actualizando tracker provisional para ${pick.id}:`, trErr.message);
          }
          console.log(`[Settlement] Pick ${pick.player || pick.id}: ${result.verificationStatus} - ${result.verificationReason}`);
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
   * Estados oficiales del ciclo de vida de liquidación:
   * - PENDIENTE: Partido no iniciado o en disputa.
   * - RESULTADO_PROVISIONAL: Marcador provisional o sin confirmación oficial consolidada en StatsHub.
   * - RESULTADO_CONFIRMADO: Silbato final (FT) y acta de estadísticas individuales/colectivas verificada en StatsHub.
   * - ERROR_DE_VERIFICACION: Discrepancia entre fuentes o jugador no localizado en la planilla oficial.
   */

  /**
   * Evalúa un pick específico comparando resultado real con la línea
   */
  async evaluatePick(pick, mockData = null) {
    let actualStat = null;
    let matchFinished = false;
    let score = null;
    let verificationStatus = 'PENDIENTE';
    let verificationSource = null;
    let verificationReason = null;

    if (mockData && mockData[pick.id]) {
      actualStat = mockData[pick.id].stat;
      matchFinished = true;
      score = mockData[pick.id].score || 'Final';
      verificationStatus = 'RESULTADO_CONFIRMADO';
      verificationSource = 'Mock Provider (Test Suite)';
      verificationReason = 'Liquidación de prueba con datos simulados confirmados';
    } else {
      // Consultar StatsHub MCP para obtener estadísticas finales
      try {
        let matchDetails = null;
        if (pick.matchId) {
          matchDetails = await mcpClient.callTool('getMatchDetails', { matchId: pick.matchId });
        }

        const isFT = matchDetails && (matchDetails.status === 'FT' || matchDetails.status === 'FINISHED');
        if (isFT) {
          matchFinished = true;
          score = matchDetails.score || `${matchDetails.homeScore ?? ''}-${matchDetails.awayScore ?? ''}`.trim();
        }

        // Si es jugador individual, consultar playerStats
        if (pick.playerId) {
          const pStats = await mcpClient.callTool('getPlayerStats', { 
            playerId: pick.playerId, 
            statType: this._mapMarketToStatType(pick.market),
            limit: 1,
            appearances: 'all'
          });

          // Extraer último partido
          const lastGame = pStats?.data?.matches?.[0] || pStats?.data?.matchRows?.[0] || pStats?.lastGame || null;
          if (lastGame) {
            actualStat = this._extractStatFromGame(lastGame, pick.market, pStats?.data?.matchColumns);
          }
        } else if (pick.isTeamProp || pick.teamId) {
          // Si es mercado de equipo
          if (matchDetails) {
            actualStat = this._extractTeamStatFromMatch(matchDetails, pick.market, pick.player || pick.team);
          }
        }

        if (matchFinished && actualStat !== null) {
          verificationStatus = 'RESULTADO_CONFIRMADO';
          verificationSource = 'StatsHub MCP: getMatchDetails + getPlayerStats (FT Oficial)';
          verificationReason = 'Partido concluido con estado oficial FT y estadísticas individuales confirmadas';
        } else if (matchFinished && actualStat === null) {
          verificationStatus = 'RESULTADO_PROVISIONAL';
          verificationSource = 'StatsHub MCP: getMatchDetails (FT)';
          verificationReason = 'Partido finalizado pero estadísticas individuales aún no consolidadas en StatsHub';
        } else if (!matchFinished && actualStat !== null) {
          verificationStatus = 'RESULTADO_PROVISIONAL';
          verificationSource = 'StatsHub MCP: En Juego';
          verificationReason = 'Estadística preliminar durante el transcurso del partido';
        } else {
          verificationStatus = 'PENDIENTE';
          verificationSource = 'StatsHub MCP';
          verificationReason = 'Partido pendiente de inicio o en disputa sin datos consolidados';
        }
      } catch (e) {
        verificationStatus = 'ERROR_DE_VERIFICACION';
        verificationSource = 'StatsHub MCP Error';
        verificationReason = `Error durante consulta de liquidación: ${e.message}`;
      }
    }

    // Regla de integridad: No liquidar definitivamente si no está confirmado
    if (verificationStatus !== 'RESULTADO_CONFIRMADO' || actualStat === null) {
      if (verificationStatus === 'ERROR_DE_VERIFICACION' || verificationStatus === 'RESULTADO_PROVISIONAL') {
        return {
          pickId: pick.id,
          date: pick.date || new Date().toISOString().slice(0, 10),
          match: pick.match || pick.partido,
          player: pick.player || pick.seleccion,
          market: pick.market || pick.mercado,
          line: pick.line || pick.linea,
          odds: Number(pick.odds || pick.cuota || 1.80),
          targetLine: parseFloat(String(pick.line || pick.linea || '0.5').replace(/[^\d.]/g, '') || '0.5'),
          actualStat: actualStat ?? null,
          matchScore: score,
          status: verificationStatus === 'ERROR_DE_VERIFICACION' ? 'ERROR_DE_VERIFICACION' : 'PENDIENTE',
          stakedUnits: 1.0,
          profitUnits: 0.0,
          verificationStatus,
          verificationSource: verificationSource || 'StatsHub MCP',
          verificationReason: verificationReason || 'Pendiente de consolidación oficial',
          verifiedAt: new Date().toISOString(),
          isSettled: false
        };
      }
      return null; // El partido sigue en juego o pendiente
    }

    // Determinar resultado oficial: GANADA vs PERDIDA
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
      settledAt: new Date().toISOString(),
      verificationStatus: 'RESULTADO_CONFIRMADO',
      verificationSource,
      verificationReason,
      verifiedAt: new Date().toISOString(),
      isSettled: true
    };
  }

  _mapMarketToStatType(market) {
    const m = (market || '').toLowerCase();
    if (m.includes('tiros a puerta') || m.includes('remates al arco')) return 'shotsOnTarget';
    if (m.includes('remate') || m.includes('tiro')) return 'shots';
    if (m.includes('falta') && m.includes('ganad')) return 'foulsWon';
    if (m.includes('falta') && m.includes('comet')) return 'fouls';
    if (m.includes('tarjeta') || m.includes('amarilla')) return 'yellowCards';
    if (m.includes('tackle') || m.includes('entrada')) return 'tackles';
    if (m.includes('asistencia')) return 'assists';
    return 'shots';
  }

  _extractTeamStatFromMatch(matchDetails, market, teamName) {
    if (!matchDetails) return null;
    const m = (market || '').toLowerCase();
    const isHome = teamName && matchDetails.homeTeam && matchDetails.homeTeam.toLowerCase().includes(teamName.toLowerCase());
    if (m.includes('remates al arco') || m.includes('tiros a puerta')) {
      return isHome ? matchDetails.homeShotsOnTarget : matchDetails.awayShotsOnTarget;
    }
    if (m.includes('remates')) {
      return isHome ? matchDetails.homeShots : matchDetails.awayShots;
    }
    if (m.includes('córner') || m.includes('corner')) {
      return isHome ? matchDetails.homeCorners : matchDetails.awayCorners;
    }
    return null;
  }

  _extractStatFromGame(game, market, columns = null) {
    if (!game) return null;
    
    // Si viene como array de valores tabulares (matchRows)
    if (Array.isArray(game) && Array.isArray(columns)) {
      const obj = {};
      columns.forEach((col, idx) => {
        obj[col] = game[idx];
      });
      game = obj;
    }

    const m = (market || '').toLowerCase();
    if (m.includes('remates al arco') || m.includes('tiros a puerta')) return game.shotsOnTarget ?? game.shots_on_target ?? game.sot ?? 0;
    if (m.includes('remates')) return game.shots ?? game.total_shots ?? 0;
    if (m.includes('falta') && m.includes('comet')) return game.foulsCommitted ?? game.fouls ?? 0;
    if (m.includes('falta') && m.includes('ganad')) return game.foulsWon ?? game.fouls_drawn ?? 0;
    if (m.includes('tackle') || m.includes('entrada')) return game.tackles ?? 0;
    if (m.includes('córner') || m.includes('corner')) return game.corners ?? 0;
    if (m.includes('tarjeta') || m.includes('amarilla')) return game.yellowCards ?? game.cards ?? 0;
    if (game.stat !== undefined && game.stat !== null) return Number(game.stat);
    return 0;
  }
}

module.exports = new SettlementEngine();
