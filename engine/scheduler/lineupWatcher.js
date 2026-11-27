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

  _getKickoffTimestamp(cand) {
    if (!cand) return null;
    if (cand.kickoffTimestamp || cand.kickoff_timestamp) {
      const raw = cand.kickoffTimestamp || cand.kickoff_timestamp;
      return raw < 10000000000 ? raw * 1000 : raw;
    }
    const iso = cand.eventDateUtc || cand.kickoffUtc || cand.kickoff_utc || cand.eventDate || cand.matchTime;
    if (iso) {
      const ts = new Date(iso).getTime();
      if (!isNaN(ts)) return ts;
    }
    return null;
  }

  _isMatchFinished(cand) {
    if (!cand) return false;
    if (cand.is_finished === true || cand.isFinished === true) return true;
    if (cand.isLive === true || cand.is_live === true) return true;
    const ms = String(cand.matchStatus || cand.match_status || cand.status || '').toUpperCase();
    return ['FINALIZADO', 'FINISHED', 'EN_CURSO', 'LIVE', 'IN_PLAY', 'STARTED'].includes(ms);
  }

  _isAlreadyExpired(cand) {
    if (!cand) return false;
    return (
      cand.evaluationExpired === true ||
      cand.status === 'EXPIRADO_SIN_EVALUACION' ||
      cand.elena_decision === 'EXPIRADO_SIN_EVALUACION' ||
      cand.evaluationStatus === 'EXPIRED'
    );
  }

  /**
   * Revisa todas las selecciones pendientes de alineación oficial,
   * priorizando encuentros en la ventana T-60 a T-45 minutos.
   * Guarda temporal estricta: si now >= kickoffTs o is_finished === true,
   * expira irreversiblemente la evaluación (checkpoint MISSED / evaluación EXPIRED)
   * y prohíbe promover a APROBADO.
   * @param {Object} options
   * @returns {Promise<Object>} Resumen de cambios de estado
   */
  async checkPendingLineups(options = {}) {
    console.log('[LineupWatcher] Comprobando alineaciones oficiales para candidatos condicionales...');
    const allCandidates = storage.getCandidates();
    let pendingCandidates = allCandidates.filter(c =>
      c.status === 'PENDIENTE' ||
      c.status === 'PENDIENTE_ALINEACION' ||
      c.status === 'PENDIENTE_DE_ALINEACION' ||
      (options.candidateIds && options.candidateIds.includes(c.id) && this._isAlreadyExpired(c))
    );

    if (options.candidateIds && options.candidateIds.length > 0) {
      pendingCandidates = pendingCandidates.filter(c => options.candidateIds.includes(c.id));
    }

    console.log(`[LineupWatcher] Candidatos pendientes encontrados: ${pendingCandidates.length}`);

    // Priorizar por proximidad al inicio del encuentro (más cercanos primero)
    const now = typeof options.now === 'number' ? options.now : Date.now();
    pendingCandidates.sort((a, b) => {
      const tsA = this._getKickoffTimestamp(a) || Infinity;
      const tsB = this._getKickoffTimestamp(b) || Infinity;
      return tsA - tsB;
    });

    const promoted = [];
    const vetoed = [];
    const expired = [];
    const stillPending = [];

    for (const cand of pendingCandidates) {
      // Irreversibilidad: una selección expirada jamás puede ser reevaluada ni promovida
      if (this._isAlreadyExpired(cand)) {
        expired.push(cand);
        console.log(`[LineupWatcher] ⛔ Expiración irreversible preservada: ${cand.player || cand.seleccion || cand.playerOrTeam}`);
        continue;
      }

      const ts = this._getKickoffTimestamp(cand);
      const isFinished = this._isMatchFinished(cand);
      const diffMinutes = ts !== null ? (ts - now) / 60000 : null;

      // Guarda estricta post-kickoff / partido finalizado: prohibir promoción tardía
      if (isFinished || (ts !== null && now >= ts)) {
        const reason = isFinished
          ? 'PARTIDO_FINALIZADO_SIN_EVALUACION_T60: El partido finalizó sin confirmación T-60 de XI titular.'
          : 'KICKOFF_ALCANZADO_SIN_EVALUACION_T60: Kickoff alcanzado sin confirmación T-60 de XI titular.';
        cand.status = 'EXPIRADO_SIN_EVALUACION';
        cand.elena_decision = 'EXPIRADO_SIN_EVALUACION';
        cand.evaluationExpired = true;
        cand.checkpointStatus = 'MISSED';
        cand.evaluationStatus = 'EXPIRED';
        cand.expiredAtUtc = new Date(now).toISOString();
        cand.expirationReason = reason;
        cand.decisionReason = reason;
        cand.lineupCheckpoint = 'EXPIRED_LINEUP';
        storage.saveCandidate(cand);
        expired.push(cand);
        console.log(`[LineupWatcher] ⊘ Expirado (checkpoint MISSED / eval EXPIRED): ${cand.player || cand.seleccion || cand.playerOrTeam} (${reason})`);
        continue;
      }

      // Checkpoints automáticos: T-60 (60 min), T-50 (50 min), T-45 (45 min)
      let currentCheckpoint = 'T_MONITOR';
      if (diffMinutes !== null) {
        if (diffMinutes <= 45) {
          currentCheckpoint = 'T-45';
        } else if (diffMinutes <= 50) {
          currentCheckpoint = 'T-50';
        } else if (diffMinutes <= 60) {
          currentCheckpoint = 'T-60';
        }
      }
      cand.lineupCheckpoint = currentCheckpoint;
      cand.lineupCheckpointCheckedAt = new Date(now).toISOString();

      // Si el partido está a más de 120 min, las alineaciones oficiales aún no se publican (StatsHub las emite ~60m antes)
      // Ahorrar cuota de MCP a menos que sea forzado por test suite
      if (diffMinutes !== null && diffMinutes > 120 && !options.forceAll && !options.mockLineups) {
        stillPending.push(cand);
        continue;
      }

      try {
        const result = await this.evaluateCandidateLineup(cand, options.mockLineups);
        if (result.action === 'PROMOTE') {
          cand.status = 'APROBADO';
          cand.elena_decision = 'APROBADO';
          cand.lineupStatus = 'CONFIRMADA';
          cand.checkpointStatus = 'EXECUTED';
          cand.evaluationStatus = 'APPROVED';
          cand.decisionReason = result.reason;
          storage.saveCandidate(cand);
          storage.saveApprovedPick(cand, { now });
          promoted.push(cand);
          console.log(`[LineupWatcher] ✅ Promovido a APROBADO: ${cand.player || cand.seleccion || cand.playerOrTeam} (Titular confirmado)`);
        } else if (result.action === 'VETO') {
          cand.status = 'RECHAZADO';
          cand.elena_decision = 'RECHAZADO';
          cand.lineupStatus = 'SUPLENTE';
          cand.checkpointStatus = 'EXECUTED';
          cand.evaluationStatus = 'VETOED';
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
    if (!options.skipSync) {
      syncRadar.exportToPicksHoy(null, { now });
    }

    return {
      totalEvaluated: pendingCandidates.length,
      promotedCount: promoted.length,
      vetoedCount: vetoed.length,
      expiredCount: expired.length,
      stillPendingCount: stillPending.length,
      promoted,
      vetoed,
      expired,
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
