/**
 * LINEUP WATCHER - MONITOREO PRE-PARTIDO DE ALINEACIONES OFICIALES (T-60 a T-45)
 * Fase 6: Revisa las planillas oficiales de los partidos de los candidatos pendientes.
 * Si el jugador es titular confirmado, levanta la condición y promueve a APROBADO.
 * Si es suplente o no convocado, aplica el VETO del Risk Manager y pasa a RECHAZADO.
 */
const storage = require('../data/storage');
const mcpClient = require('../mcp/mcpClient');
const syncRadar = require('../data/syncRadar');
const riskManager = require('../agents/riskManager');

class LineupWatcher {
  constructor() {
    this.name = 'LineupWatcher';
  }

  /**
   * Revisa todas las selecciones pendientes de alineación oficial
   * @param {Object} options
   * @returns {Promise<Object>} Resumen de cambios de estado
   */
  async checkPendingLineups(options = {}) {
    console.log('[LineupWatcher] Comprobando alineaciones oficiales para candidatos condicionales...');
    const allCandidates = storage.getCandidates();
    const pendingCandidates = allCandidates.filter(c => 
      c.status === 'PENDIENTE' || 
      c.status === 'PENDIENTE_ALINEACION' || 
      c.status === 'PENDIENTE_DE_ALINEACION'
    );

    console.log(`[LineupWatcher] Candidatos pendientes encontrados: ${pendingCandidates.length}`);

    const promoted = [];
    const vetoed = [];
    const stillPending = [];

    for (const cand of pendingCandidates) {
      try {
        const result = await this.evaluateCandidateLineup(cand, options.mockLineups);
        if (result.action === 'PROMOTE') {
          cand.status = 'APROBADO';
          cand.lineupStatus = 'CONFIRMADA';
          cand.decisionReason = result.reason;
          storage.saveCandidate(cand);
          storage.saveApprovedPick(cand);
          promoted.push(cand);
          console.log(`[LineupWatcher] ✅ Promovido a APROBADO: ${cand.player || cand.seleccion || cand.playerOrTeam} (Titular confirmado)`);
        } else if (result.action === 'VETO') {
          cand.status = 'RECHAZADO';
          cand.lineupStatus = 'SUPLENTE';
          cand.decisionReason = result.reason;
          storage.saveCandidate(cand);
          storage.saveRejectedPick(cand, result.reason);
          vetoed.push(cand);
          console.log(`[LineupWatcher] ❌ Veto de Risk Manager: ${cand.player || cand.seleccion || cand.playerOrTeam} (${result.reason})`);
        } else {
          stillPending.push(cand);
          console.log(`[LineupWatcher] ⏳ Aún sin alineación oficial: ${cand.player || cand.seleccion || cand.playerOrTeam}`);
        }
      } catch (err) {
        console.warn(`[LineupWatcher] Error evaluando alineación para ${cand.id}: ${err.message}`);
        stillPending.push(cand);
      }
    }

    // Sincronizar cambios en picks_hoy.json
    syncRadar.exportToPicksHoy();

    return {
      totalEvaluated: pendingCandidates.length,
      promotedCount: promoted.length,
      vetoedCount: vetoed.length,
      stillPendingCount: stillPending.length,
      promoted,
      vetoed,
      stillPending
    };
  }

  /**
   * Evalúa la alineación de un candidato individual
   */
  async evaluateCandidateLineup(candidate, mockLineups = null) {
    const playerName = (candidate.player || candidate.seleccion || candidate.playerOrTeam || '').toLowerCase().trim();
    const matchId = candidate.matchId || candidate.partido;

    let lineupData = null;

    if (mockLineups && mockLineups[matchId]) {
      lineupData = mockLineups[matchId];
    } else if (mockLineups && mockLineups[playerName]) {
      lineupData = mockLineups[playerName];
    } else {
      try {
        lineupData = await mcpClient.callTool('getLineups', { matchId: candidate.matchId });
      } catch (e) {
        return { action: 'WAIT', reason: 'Alineación aún no disponible' };
      }
    }

    if (!lineupData) {
      return { action: 'WAIT', reason: 'Alineación no publicada' };
    }

    // Analizar si el jugador es titular o suplente
    const isStarter = this._isPlayerInStartingXI(lineupData, playerName);
    const isSub = this._isPlayerInBench(lineupData, playerName);

    if (isStarter) {
      return {
        action: 'PROMOTE',
        reason: 'Alineación oficial confirmada: Jugador parte en el XI titular. Condición levantada por el Risk Manager.'
      };
    } else if (isSub) {
      return {
        action: 'VETO',
        reason: 'Alineación oficial confirmada: Jugador es SUPLENTE. Veto preventivo definitivo aplicado por el Risk Manager (minutos insuficientes).'
      };
    }

    // Si la alineación ya está publicada pero el jugador ni siquiera figura
    if (lineupData.status === 'OFFICIAL' || lineupData.confirmed) {
      return {
        action: 'VETO',
        reason: 'Planilla oficial confirmada: Jugador fuera de convocatoria o lesionado de última hora.'
      };
    }

    return { action: 'WAIT', reason: 'Planilla oficial pendiente de confirmación' };
  }

  _isPlayerInStartingXI(lineupData, targetName) {
    if (!lineupData) return false;
    if (lineupData.isStarter === true) return true;
    const starters = [
      ...(lineupData.home?.startingXI || []),
      ...(lineupData.away?.startingXI || []),
      ...(lineupData.starters || [])
    ];
    return starters.some(p => {
      const name = (typeof p === 'string' ? p : p.name || p.player || '').toLowerCase();
      return name.includes(targetName) || targetName.includes(name);
    });
  }

  _isPlayerInBench(lineupData, targetName) {
    if (!lineupData) return false;
    if (lineupData.isStarter === false) return true;
    const bench = [
      ...(lineupData.home?.substitutes || []),
      ...(lineupData.away?.substitutes || []),
      ...(lineupData.substitutes || []),
      ...(lineupData.bench || [])
    ];
    return bench.some(p => {
      const name = (typeof p === 'string' ? p : p.name || p.player || '').toLowerCase();
      return name.includes(targetName) || targetName.includes(name);
    });
  }
}

module.exports = new LineupWatcher();
