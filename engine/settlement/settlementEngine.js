/**
 * SETTLEMENT ENGINE - LIQUIDACIÓN AUTOMÁTICA DE PRONÓSTICOS
 * Fase 6: Monitorea partidos disputados, valida resultados reales de las estadísticas
 * individuales o colectivas de StatsHub, determina si la apuesta fue GANADA / PERDIDA / NULA
 * y actualiza automáticamente el historial y las métricas de rendimiento (+ROI).
 */
const fs = require('fs');
const config = require('../config');
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');
const syncRadar = require('../data/syncRadar');
const observationTracker = require('../prediction/observationTracker');

function normalizeName(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(equipo\)/gi, '')
    .trim()
    .toLowerCase();
}

function isTeamMarketPick(pick) {
  const player = String(pick.player || pick.playerOrTeam || pick.seleccion || '');
  const market = String(pick.market || pick.mercado || '').toLowerCase();
  return Boolean(
    pick.isTeamProp ||
    pick.teamId ||
    player.toLowerCase().includes('(equipo)') ||
    market.includes('de equipo')
  );
}

class SettlementEngine {
  constructor() {
    this.name = 'SettlementEngine';
  }

  /**
   * Ejecuta el ciclo de liquidación para todos los picks aprobados y pendientes en historial
   * @param {Object} options
   * @returns {Promise<Object>} Resumen de liquidaciones
   */
  async settlePendingPicks(options = {}) {
    console.log('[Settlement] Iniciando ciclo de liquidación de resultados...');
    const approvedPicks = storage.getApprovedPicks();
    const allCandidates = storage.getCandidates();
    const existingHistory = storage.getResults();

    // Índices de candidatos y duplicados
    const candById = new Map(allCandidates.map(c => [c.id, c]));
    const duplicateIds = new Set(allCandidates.filter(c => c && c.status === 'DUPLICADO').map(c => c.id));

    // Filtrar picks ya liquidados (idempotencia por pickId y canonicalId)
    const settledIds = new Set();
    for (const h of existingHistory) {
      if (h.pickId) settledIds.add(h.pickId);
      if (h.id) settledIds.add(h.id);
      if (h.canonicalId) settledIds.add(h.canonicalId);
    }

    // Consolidar universo elegible: approved_picks.json + pendientes en historial_picks.json
    const combinedById = new Map();
    for (const p of approvedPicks) {
      if (!p || !p.id || duplicateIds.has(p.id)) continue;
      const canonical = p.canonicalId || p.id;
      if (settledIds.has(p.id) || settledIds.has(canonical)) continue;
      const cand = candById.get(p.id) || {};
      combinedById.set(p.id, { ...cand, ...p, elenaDecision: p.elenaDecision || 'APROBADO' });
    }

    // Incorporar selecciones PENDIENTE / PENDIENTE_DE_LIQUIDACION de historial_picks.json
    if (fs.existsSync(config.paths.historialPicks)) {
      try {
        const histRaw = JSON.parse(fs.readFileSync(config.paths.historialPicks, 'utf8'));
        const histList = histRaw.history || histRaw.picks || [];
        for (const h of histList) {
          if (!h || !h.id || duplicateIds.has(h.id)) continue;
          const isHistPending = h.status === 'PENDIENTE' || h.status === 'PENDIENTE_DE_LIQUIDACION';
          if (!isHistPending) continue;
          const canonical = h.canonicalId || h.id;
          if (settledIds.has(h.id) || settledIds.has(canonical) || combinedById.has(h.id)) continue;
          const cand = candById.get(h.id) || {};
          combinedById.set(h.id, {
            ...cand,
            ...h,
            elenaDecision: h.elena_decision || h.elenaDecision || 'APROBADO',
            isTeamProp: isTeamMarketPick(h)
          });
        }
      } catch (e) {
        console.warn('[Settlement] Error leyendo historial_picks.json:', e.message);
      }
    }

    let pendingToSettle = Array.from(combinedById.values());

    if (options.pickIds && options.pickIds.length > 0) {
      pendingToSettle = pendingToSettle.filter(p => options.pickIds.includes(p.id));
    }

    console.log(`[Settlement] Picks elegibles a evaluar: ${pendingToSettle.length}`);

    const settledResults = [];
    const pendingVerification = [];
    const errors = [];

    for (const pick of pendingToSettle) {
      try {
        const result = await this.evaluatePick(pick, options.mockData, options.verifiedStatsHubData);
        if (result && result.isSettled === true) {
          // Segregar fixtures o simulaciones de prueba
          const isTest = pick.id?.startsWith('pick_settle_') || 
                         result.verificationSource?.includes('Mock Provider') || 
                         pick.isTestPick || pick.isTest;

          if (isTest) {
            const testResults = storage._readCollection('test_pick_results');
            testResults.push(result);
            storage._writeCollection('test_pick_results', testResults);
            console.log(`[Settlement] Registro de prueba segregado para ${pick.id}`);
          } else {
            // Verificación adicional de idempotencia antes de persistir
            const freshResults = storage.getResults();
            if (freshResults.some(r => r.pickId === pick.id)) {
              console.log(`[Settlement] Pick ${pick.id} ya liquidado previamente (idempotencia).`);
              continue;
            }

            storage.saveResult(result);
            settledResults.push(result);

            // Loopback 1: Actualizar approved_picks.json preservando el veredicto APROBADO de Elena
            const approvedList = storage.getApprovedPicks();
            const appPick = approvedList.find(a => a.id === pick.id);
            if (appPick) {
              appPick.isSettled = true;
              appPick.sportsResult = result.status;
              appPick.actualStat = result.actualStat;
              appPick.settledAt = result.settledAt;
              appPick.elenaDecision = 'APROBADO';
              storage._writeCollection('approved_picks', approvedList);
            }

            // Loopback 2: Actualizar research_candidates.json
            const candidates = storage.getCandidates();
            const cand = candidates.find(c => c.id === pick.id);
            if (cand) {
              cand.status = 'LIQUIDADO';
              cand.isSettled = true;
              cand.sportsResult = result.status;
              cand.actualStat = result.actualStat;
              cand.settledAt = result.settledAt;
              cand.operationalStatus = result.status.includes('ANULADA') ? 'ANULADA_LINEUP' : 'ACEPTADO';
              storage._writeCollection('research_candidates', candidates);
            }

            try {
              observationTracker.recordSettlement(pick.id, result);
            } catch (trErr) {
              console.warn(`[Settlement] Error actualizando tracker para ${pick.id}:`, trErr.message);
            }
          }
          console.log(`[Settlement] Pick ${pick.player || pick.id} (${pick.market} ${pick.line}): ${result.status} [${result.actualStat} vs ${result.targetLine}]`);
        } else if (result && result.verificationStatus) {
          if (result.verificationStatus === 'ERROR_DE_VERIFICACION') {
            errors.push({ pickId: pick.id, reason: result.verificationReason });
            console.warn(`[Settlement] ⚠️ Error de verificación para ${pick.id}: ${result.verificationReason}`);
          } else {
            pendingVerification.push({
              pickId: pick.id,
              status: result.status || 'PENDIENTE_DE_LIQUIDACION',
              verificationStatus: result.verificationStatus,
              reason: result.verificationReason
            });
            // Persistir trazabilidad en historial_picks.json si falta evidencia oficial (sin inventar actualStat)
            this._markPendingVerificationInHistorial(pick.id, result);
            console.log(`[Settlement] ⏳ Pick ${pick.player || pick.id}: ${result.verificationStatus} - ${result.verificationReason}`);
          }
          try {
            observationTracker.recordSettlement(pick.id, result);
          } catch (trErr) {
            console.warn(`[Settlement] Error actualizando tracker provisional para ${pick.id}:`, trErr.message);
          }
        }
      } catch (err) {
        errors.push({ pickId: pick.id, reason: err.message });
        console.warn(`[Settlement] Error evaluando pick ${pick.id}: ${err.message}`);
      }
    }

    // Sincronizar con historial_picks.json y picks_hoy.json
    const historialSummary = syncRadar.exportToHistorial();
    syncRadar.exportToPicksHoy();

    return {
      evaluated: pendingToSettle.length,
      settled: settledResults.length,
      results: settledResults,
      pendingVerification,
      errors,
      historialSummary
    };
  }

  _markPendingVerificationInHistorial(pickId, result) {
    if (!fs.existsSync(config.paths.historialPicks)) return;
    try {
      const hData = JSON.parse(fs.readFileSync(config.paths.historialPicks, 'utf8'));
      const list = hData.history || hData.picks || [];
      const item = list.find(b => b.id === pickId);
      if (item && (item.status === 'PENDIENTE' || item.status === 'PENDIENTE_DE_LIQUIDACION')) {
        item.status = 'PENDIENTE_DE_LIQUIDACION';
        item.actual_stat = null;
        item.notes = result.verificationReason || 'Pendiente de liquidación: ausencia de estadísticas oficiales en StatsHub.';
        item.verification_status = result.verificationStatus;
        hData.history = list;
        hData.picks = list;
        fs.writeFileSync(config.paths.historialPicks, JSON.stringify(hData, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn(`[Settlement] Error actualizando estado pendiente en historial para ${pickId}:`, e.message);
    }
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
  async evaluatePick(pick, mockData = null, verifiedStatsHubData = null) {
    let actualStat = null;
    let matchFinished = false;
    let score = null;
    let verificationStatus = 'PENDIENTE';
    let verificationSource = null;
    let verificationReason = null;
    let lineupStarterFlag = pick.isStarter;

    if (mockData && mockData[pick.id]) {
      actualStat = mockData[pick.id].stat;
      matchFinished = true;
      score = mockData[pick.id].score || 'Final';
      verificationStatus = 'RESULTADO_CONFIRMADO';
      verificationSource = 'Mock Provider (Test Suite)';
      verificationReason = 'Liquidación de prueba con datos simulados confirmados';
    } else {
      // Consultar StatsHub MCP (o acta oficial verificada provista por el flujo de StatsHub)
      try {
        let matchDetails = null;
        let lineupRecord = null;
        const verifiedEntry = verifiedStatsHubData && verifiedStatsHubData[pick.id] ? verifiedStatsHubData[pick.id] : null;

        if (verifiedEntry) {
          matchDetails = verifiedEntry.matchDetails || null;
          lineupRecord = verifiedEntry.lineup || null;
        } else if (pick.matchId) {
          matchDetails = await mcpClient.callTool('getMatchDetails', {
            matchId: pick.matchId,
            include: ['players', 'teamStats'],
            allPlayers: true
          });
        }

        const rawStatus = matchDetails?.data?.matches?.status || matchDetails?.status || '';
        const statusLower = String(rawStatus).toLowerCase();
        const isFT = ['ft', 'finished', 'full_time', 'ended'].includes(statusLower);
        const isLive = ['live', 'in_play', 'inplay', 'ht', '1h', '2h'].includes(statusLower);

        if (isFT) {
          matchFinished = true;
          score = matchDetails?.score?.final || matchDetails?.score?.current || matchDetails?.score || `${matchDetails?.homeScore ?? ''}-${matchDetails?.awayScore ?? ''}`.trim();
        } else if (isLive) {
          score = matchDetails?.score?.current || matchDetails?.score?.final || matchDetails?.score || null;
        }

        const teamPick = isTeamMarketPick(pick);

        if (teamPick) {
          if (matchDetails) {
            actualStat = this._extractTeamStatFromMatch(matchDetails, pick.market || pick.mercado, pick.player || pick.team || pick.seleccion);
          }
        } else {
          // Jugador individual: primero buscar en el acta oficial del partido (players + lineup)
          if (matchDetails && matchDetails.players) {
            const pRow = this._extractPlayerRowFromMatch(matchDetails, pick.player || pick.playerOrTeam || pick.seleccion, pick.playerId);
            if (pRow) {
              actualStat = this._extractStatFromGame(pRow, pick.market || pick.mercado);
            }
          }

          if (lineupRecord && typeof lineupRecord.started === 'boolean') {
            lineupStarterFlag = lineupRecord.started;
          }

          // Fallback a getPlayerStats vía MCP si no hubo acta embebida y existe playerId
          if (actualStat === null && pick.playerId && !verifiedEntry) {
            const pStats = await mcpClient.callTool('getPlayerStats', {
              playerId: pick.playerId,
              statType: this._mapMarketToStatType(pick.market),
              limit: 1,
              appearances: 'all'
            });
            const lastGame = pStats?.data?.matches?.[0] || pStats?.data?.matchRows?.[0] || pStats?.lastGame || null;
            if (lastGame) {
              actualStat = this._extractStatFromGame(lastGame, pick.market, pStats?.data?.matchColumns);
            }
          }
        }

        const fixtureRef = matchDetails?.data?.matches?.id || pick.matchId || 'sin-matchId';

        if (matchFinished && lineupStarterFlag === false && !teamPick) {
          // Regla de Elena T-60: jugador no titular -> anulación confirmada aunque no alcance stats
          actualStat = actualStat ?? 0;
          verificationStatus = 'RESULTADO_CONFIRMADO';
          verificationSource = `StatsHub Oficial (${fixtureRef})`;
          verificationReason = 'Alineación oficial confirmada: jugador NO inició como titular (regla T-60).';
        } else if (matchFinished && actualStat !== null && actualStat !== undefined) {
          verificationStatus = 'RESULTADO_CONFIRMADO';
          verificationSource = `StatsHub Oficial (${fixtureRef})`;
          verificationReason = 'Partido concluido (FT) con estadísticas oficiales confirmadas en StatsHub.';
        } else if ((matchFinished || isLive) && (actualStat === null || actualStat === undefined)) {
          verificationStatus = 'PENDIENTE_DE_LIQUIDACION';
          verificationSource = `StatsHub Oficial (${fixtureRef})`;
          verificationReason = `Partido en estado '${rawStatus}' sin estadísticas oficiales consolidadas en StatsHub para ${pick.market || pick.mercado}.`;
        } else if (!matchDetails) {
          verificationStatus = 'PENDIENTE_DE_LIQUIDACION';
          verificationSource = 'StatsHub MCP';
          verificationReason = `Sin fixture verificable (matchId ausente o sin respuesta de StatsHub para ${pick.match || pick.id}).`;
        } else {
          verificationStatus = 'PENDIENTE';
          verificationSource = `StatsHub Oficial (${fixtureRef})`;
          verificationReason = 'Partido pendiente de inicio o sin datos consolidados.';
        }
      } catch (e) {
        verificationStatus = 'ERROR_DE_VERIFICACION';
        verificationSource = 'StatsHub MCP Error';
        verificationReason = `Error durante consulta de liquidación: ${e.message}`;
        console.warn(`[Settlement] Error StatsHub en ${pick.id}: ${e.message}`);
      }
    }

    // Regla de integridad: No liquidar definitivamente si no está confirmado
    if (verificationStatus !== 'RESULTADO_CONFIRMADO' || actualStat === null || actualStat === undefined) {
      return {
        pickId: pick.id,
        date: pick.date || pick.eventDateLocal || new Date().toISOString().slice(0, 10),
        match: pick.match || pick.partido,
        player: pick.player || pick.seleccion,
        market: pick.market || pick.mercado,
        line: pick.line || pick.linea,
        odds: Number(pick.odds || pick.cuota || 1.80),
        targetLine: parseFloat(String(pick.line || pick.linea || '0.5').replace(/[^\d.]/g, '') || '0.5'),
        actualStat: null,
        matchScore: score,
        status: verificationStatus === 'ERROR_DE_VERIFICACION' ? 'ERROR_DE_VERIFICACION' : 'PENDIENTE_DE_LIQUIDACION',
        stakedUnits: 1.0,
        profitUnits: 0.0,
        verificationStatus,
        verificationSource: verificationSource || 'StatsHub MCP',
        verificationReason: verificationReason || 'Pendiente de consolidación oficial',
        verifiedAt: new Date().toISOString(),
        isSettled: false
      };
    }

    // Determinar resultado oficial: GANADA vs PERDIDA vs ANULADA_NO_TITULAR
    const lineStr = String(pick.line || pick.linea || '0.5');
    const targetLineNum = parseFloat(lineStr.replace(/[^\d.]/g, '') || '0.5');
    const isOver = !lineStr || lineStr.toLowerCase().includes('más') || lineStr.toLowerCase().includes('over') || lineStr.includes('>');

    let status = 'PERDIDA';
    if (pick.lineupStatus === 'NO_TITULAR' || lineupStarterFlag === false || pick.voidReason || pick.isVoid) {
      status = 'ANULADA_NO_TITULAR';
    } else if (isOver) {
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
      profitUnits = 0.0; // VOID / NULA / ANULADA
    }

    return {
      pickId: pick.id,
      date: pick.date || pick.eventDateLocal || new Date().toISOString().slice(0, 10),
      match: pick.match || pick.partido,
      player: pick.player || pick.seleccion,
      market: pick.market || pick.mercado,
      line: pick.line || pick.linea,
      odds,
      targetLine: targetLineNum,
      actualStat,
      matchScore: score,
      status, // 'GANADA' | 'PERDIDA' | 'NULA' | 'ANULADA_NO_TITULAR'
      elenaDecision: pick.elenaDecision || (pick.status === 'APROBADO' ? 'APROBADO' : 'PENDIENTE'),
      operationalStatus: status.includes('ANULADA') ? 'ANULADA_LINEUP' : 'ACEPTADO',
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

  _extractPlayerRowFromMatch(matchDetails, playerName, playerId = null) {
    if (!matchDetails || !matchDetails.players) return null;
    const rows = [
      ...(matchDetails.players.home?.rows || []),
      ...(matchDetails.players.away?.rows || [])
    ];
    if (playerId) {
      const byId = rows.find(r => r.playerId === playerId || r.id === playerId);
      if (byId) return byId;
    }
    const target = normalizeName(playerName);
    if (!target) return null;
    return rows.find(r => {
      const rn = normalizeName(r.name);
      return rn === target || rn.includes(target) || target.includes(rn);
    }) || null;
  }

  _extractTeamStatFromMatch(matchDetails, market, teamName) {
    if (!matchDetails) return null;
    const m = (market || '').toLowerCase();
    const targetTeam = normalizeName(teamName);

    // Determinar índice [0 = home, 1 = away] desde StatsHub (data.homeTeam / data.awayTeam o teamStats.columns)
    const homeName = normalizeName(matchDetails.data?.homeTeam?.name || matchDetails.data?.homeTeam?.shortName || matchDetails.teamStats?.columns?.[0] || matchDetails.homeTeam);
    const awayName = normalizeName(matchDetails.data?.awayTeam?.name || matchDetails.data?.awayTeam?.shortName || matchDetails.teamStats?.columns?.[1] || matchDetails.awayTeam);

    let teamIdx = -1;
    if (targetTeam && homeName && (homeName.includes(targetTeam) || targetTeam.includes(homeName))) {
      teamIdx = 0;
    } else if (targetTeam && awayName && (awayName.includes(targetTeam) || targetTeam.includes(awayName))) {
      teamIdx = 1;
    }

    if (teamIdx === -1) return null;

    // 1. Goles de equipo desde marcador final oficial (score.final)
    if (m.includes('gol')) {
      const finalScore = matchDetails.score?.final || (typeof matchDetails.score === 'string' ? matchDetails.score : null);
      if (finalScore && /^\d+\s*-\s*\d+$/.test(String(finalScore).trim())) {
        const parts = String(finalScore).split('-').map(n => Number(n.trim()));
        if (Number.isFinite(parts[teamIdx])) return parts[teamIdx];
      }
      return null;
    }

    // 2. Estadísticas de equipo desde StatsHub teamStats.fullTime
    const ft = matchDetails.teamStats?.fullTime;
    if (ft) {
      if (m.includes('remates al arco') || m.includes('tiros a puerta')) {
        return ft.shotsOnTarget ? ft.shotsOnTarget[teamIdx] : null;
      }
      if (m.includes('remates') || m.includes('tiros')) {
        return ft.shots ? ft.shots[teamIdx] : null;
      }
      if (m.includes('córner') || m.includes('corner')) {
        return ft.corners ? ft.corners[teamIdx] : null;
      }
      if (m.includes('falta')) {
        return ft.fouls ? ft.fouls[teamIdx] : null;
      }
      if (m.includes('tarjeta')) {
        return ft.yellowCards ? ft.yellowCards[teamIdx] : null;
      }
      return null;
    }

    // Fallback estructura plana legacy
    const isHome = teamIdx === 0;
    if (m.includes('remates al arco') || m.includes('tiros a puerta')) {
      return isHome ? (matchDetails.homeShotsOnTarget ?? null) : (matchDetails.awayShotsOnTarget ?? null);
    }
    if (m.includes('remates')) {
      return isHome ? (matchDetails.homeShots ?? null) : (matchDetails.awayShots ?? null);
    }
    if (m.includes('córner') || m.includes('corner')) {
      return isHome ? (matchDetails.homeCorners ?? null) : (matchDetails.awayCorners ?? null);
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
