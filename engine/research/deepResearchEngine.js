/**
 * DEEP RESEARCH ENGINE - INVESTIGACIÓN PROFUNDA DE CANDIDATOS
 * Fase 3: Toma los candidatos detectados y recopila datos exhaustivos:
 * - Estadísticas individuales reales por 90 min y minutos históricos (getPlayerStats limit: 20)
 * - Métricas de rendimiento de equipo y concedidas por el rival (getTeamPerformance limit: 30)
 * - Estadísticas arbitrales reales en mercados de faltas y tarjetas (getReferee)
 * - Confirmación de alineaciones y rotaciones (getLineups)
 * - Multi-ventanas estadísticas L5, L10, L15, L20 (y L30 para equipos)
 * - Trazabilidad e integridad estricta: SIN DATOS SINTÉTICOS NI FALLBACKS SIMULADOS
 */
const mcpClient = require('../mcp/mcpClient');
const storage = require('../data/storage');
const config = require('../config');

class DeepResearchEngine {
  constructor() {
    this.minSampleMatches = config.sampling?.minPlayerValidMatches || 8;
  }

  /**
   * Ejecuta la investigación profunda sobre los candidatos activos
   * @param {Object} options { candidateIds: [], maxToInvestigate: 15 }
   */
  async runDeepResearch(options = {}) {
    console.log('[DeepResearch] Iniciando investigación profunda de candidatos...');

    // 1. Obtener candidatos pendientes de investigación
    const allCandidates = storage.getCandidates();
    let candidatesToResearch = allCandidates.filter(c => 
      c.status === 'DETECTADO' || c.status === 'PENDIENTE_INVESTIGACION'
    );

    if (options.candidateIds && options.candidateIds.length > 0) {
      candidatesToResearch = candidatesToResearch.filter(c => options.candidateIds.includes(c.id));
    }

    const maxToInvestigate = options.maxToInvestigate || 15;
    candidatesToResearch = candidatesToResearch.slice(0, maxToInvestigate);

    console.log(`[DeepResearch] ${candidatesToResearch.length} candidatos seleccionados para investigación profunda.`);

    const researchedCandidates = [];

    for (const candidate of candidatesToResearch) {
      try {
        console.log(`[DeepResearch] Investigando: ${candidate.playerOrTeam} (${candidate.market} en ${candidate.match})...`);
        const enriched = await this.investigateCandidate(candidate);
        storage.saveCandidate(enriched);
        researchedCandidates.push(enriched);
      } catch (err) {
        console.warn(`[DeepResearch] Error investigando candidato ${candidate.id}:`, err.message);
        candidate.status = 'INVESTIGACION_INCOMPLETA';
        candidate.researchNotes = `Error en consulta: ${err.message}`;
        storage.saveCandidate(candidate);
        researchedCandidates.push(candidate);
      }
    }

    return researchedCandidates;
  }

  /**
   * Investiga un único candidato de forma quirúrgica con datos 100% reales
   */
  async investigateCandidate(candidate) {
    const researchData = {
      queriedAt: new Date().toISOString(),
      toolsQueried: [],
      playerData: null,
      teamData: null,
      opponentData: null,
      refereeData: null,
      lineupData: null,
      missingData: []
    };

    const isTeamMarket = candidate.isTeamProp === true;
    const market = candidate.market ? candidate.market.toLowerCase() : '';

    // --- 1. INVESTIGACIÓN DE JUGADOR (SI APLICA) ---
    if (!isTeamMarket) {
      researchData.playerData = await this._fetchPlayerDetails(candidate);
      researchData.toolsQueried.push('getPlayerStats');
      if (!researchData.playerData.success) {
        researchData.missingData.push({
          tool: 'getPlayerStats',
          reason: researchData.playerData.reason
        });
      }
    } else {
      // --- INVESTIGACIÓN DE EQUIPO PROPIO (SI ES TEAM PROP) ---
      researchData.teamData = await this._fetchTeamPerformance(candidate);
      researchData.toolsQueried.push('getTeamPerformance');
      if (!researchData.teamData.success) {
        researchData.missingData.push({
          tool: 'getTeamPerformance',
          reason: researchData.teamData.reason
        });
      }
    }

    // --- 2. INVESTIGACIÓN DEL RIVAL (CONCESIÓN DEFENSIVA) ---
    researchData.opponentData = await this._fetchOpponentConcededMetrics(candidate);
    researchData.toolsQueried.push('getTeamPerformance');
    if (!researchData.opponentData.isAvailable) {
      researchData.missingData.push({
        tool: 'getTeamPerformance_opponent',
        reason: researchData.opponentData.reason
      });
    }

    // --- 3. INVESTIGACIÓN ARBITRAL (SOLO EN MERCADOS DE FALTAS / TARJETAS) ---
    if (market.includes('falta') || market.includes('tarjeta') || market.includes('foul') || market.includes('card')) {
      researchData.refereeData = await this._fetchRefereeMetrics(candidate);
      researchData.toolsQueried.push('getReferee');
      if (!researchData.refereeData.isAvailable) {
        researchData.missingData.push({
          tool: 'getReferee',
          reason: researchData.refereeData.reason
        });
      }
    }

    // --- 4. VERIFICACIÓN DE ALINEACIÓN ---
    researchData.lineupData = await this._fetchLineupStatus(candidate);
    researchData.toolsQueried.push('getLineups');

    // --- 5. EVALUACIÓN DE CALIDAD DE DATOS Y ESTADO ---
    const quality = this._assessDataQuality(researchData, isTeamMarket);
    
    // Determinar nuevo estado de investigación
    let newStatus = 'INVESTIGADO';
    if (quality.qualityStatus === 'INVESTIGACION_INCOMPLETA' || quality.qualityStatus === 'ERROR_DATOS') {
      newStatus = 'INVESTIGACION_INCOMPLETA';
    } else if (researchData.lineupData.status === 'PENDIENTE_ALINEACION' && !isTeamMarket) {
      newStatus = 'PENDIENTE_DE_ALINEACION';
    }

    // Retornar candidato enriquecido con trazabilidad
    return {
      ...candidate,
      status: newStatus,
      researchData: {
        ...researchData,
        qualityStatus: quality.qualityStatus
      },
      mcpToolsQueried: Array.from(new Set([...(candidate.mcpToolsQueried || []), ...researchData.toolsQueried])),
      sampleQuality: quality.score,
      sampleSize: quality.sampleSize,
      minutesExpected: researchData.playerData?.projectedMinutes || (isTeamMarket ? 90 : null),
      investigatedAt: new Date().toISOString()
    };
  }

  // --- MAPEO CANÓNICO DE STATS STATSHUB ---

  _getCanonicalStatType(marketName, rawStatType) {
    const raw = String(rawStatType || marketName || '').toLowerCase().trim();
    if (raw.includes('shotontarget') || raw === 'shotsontarget' || raw.includes('arco') || raw.includes('puerta')) {
      return 'shotsOnTarget';
    }
    if (raw.includes('foulwon') || raw.includes('foulswon') || raw.includes('ganada')) {
      return 'foulsWon';
    }
    if (raw.includes('foul') || raw.includes('falta')) {
      return 'fouls';
    }
    if (raw.includes('tackle') || raw.includes('entrada')) {
      return 'tackles';
    }
    if (raw.includes('card') || raw.includes('tarjeta') || raw.includes('yellow')) {
      return 'yellowCards';
    }
    if (raw.includes('corner') || raw.includes('córner')) {
      return 'corners';
    }
    if (raw.includes('scoredorassisted') || raw.includes('goalorassist') || raw.includes('gol o asistencia') || raw.includes('xgxa')) {
      return 'scoredOrAssisted';
    }
    if (raw.includes('goal') || raw.includes('gol')) {
      return 'goals';
    }
    if (raw.includes('assist') || raw.includes('asistencia')) {
      return 'assists';
    }
    if (raw.includes('pass') || raw.includes('pase')) {
      return 'passes';
    }
    if (raw.includes('shot') || raw.includes('remate') || raw.includes('tiro')) {
      return 'shots';
    }
    return 'shots';
  }

  // --- CÁLCULO DE VENTANAS ESTADÍSTICAS ---

  _calculateWindowStats(observations, windowSize, lineThreshold = 0) {
    if (!observations || observations.length === 0) return null;
    const windowSlice = observations.slice(0, windowSize);
    const n = windowSlice.length;
    if (n === 0) return null;

    const sum = windowSlice.reduce((a, b) => a + b, 0);
    const mean = Number((sum / n).toFixed(2));
    
    let variance = 0;
    if (n > 1) {
      const sqDiffs = windowSlice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
      variance = Number((sqDiffs / (n - 1)).toFixed(3));
    }
    const stdDev = Number(Math.sqrt(variance).toFixed(2));

    const sorted = [...windowSlice].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 
      ? sorted[mid] 
      : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));

    const hits = windowSlice.filter(v => v > lineThreshold).length;
    const hitRate = Number(((hits / n) * 100).toFixed(1));

    return {
      window: `L${n}`,
      count: n,
      mean,
      variance,
      stdDev,
      median,
      hits,
      hitRate
    };
  }

  // --- MÉTODOS DE RECOLECCIÓN DE DATOS REALES ---

  async _fetchPlayerDetails(candidate) {
    const playerId = candidate.playerId || candidate.rawSourceData?.playerId || null;
    const playerName = candidate.playerOrTeam;
    const statType = this._getCanonicalStatType(candidate.market, candidate.rawStatType);
    const maxMatches = config.sampling?.maxPlayerMatches || 20;

    if (!playerId) {
      return {
        success: false,
        reason: 'MISSING_PLAYER_ID',
        playerName,
        statType,
        validMatches: 0,
        observations: [],
        matches: [],
        qualityStatus: 'INVESTIGACION_INCOMPLETA'
      };
    }

    try {
      const res = await mcpClient.callTool('getPlayerStats', {
        playerId,
        statType,
        limit: maxMatches,
        appearances: 'all'
      });
      const data = res?.data;

      // Adaptador para respuestas tabulares de StatsHub (matchColumns + matchRows) o formato de objetos (matches)
      let rawMatches = [];
      if (Array.isArray(data?.matches)) {
        rawMatches = data.matches;
      } else if (Array.isArray(data?.matchRows) && Array.isArray(data?.matchColumns)) {
        rawMatches = data.matchRows.map(row => {
          const obj = {};
          data.matchColumns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          return obj;
        });
      }

      if (!data || rawMatches.length === 0) {
        return {
          success: false,
          reason: 'NO_MATCHES_RETURNED',
          playerName,
          playerId,
          statType,
          validMatches: 0,
          observations: [],
          matches: [],
          qualityStatus: 'INVESTIGACION_INCOMPLETA'
        };
      }

      // Parsear umbral numérico de la línea para aciertos
      const lineNum = candidate.rawLine 
        ? parseFloat(candidate.rawLine) 
        : (candidate.line && !isNaN(parseFloat(String(candidate.line).replace(/[^0-9.]/g, ''))) 
            ? parseFloat(String(candidate.line).replace(/[^0-9.]/g, '')) 
            : 0.5);

      const parsedMatches = [];
      const validAppearances = [];
      const homeMatches = [];
      const awayMatches = [];

      const marketMinMinutes = config.sampling?.minutesFilterByMarket?.[statType] 
        ?? config.sampling?.minutesFilterByMarket?.default 
        ?? 25;

      for (const m of rawMatches) {
        // Diferenciar estrictamente 0 real de null/ausente
        let rawVal = null;
        if (m[statType] !== undefined && m[statType] !== null) {
          rawVal = Number(m[statType]);
        } else if (statType === 'yellowCards' && (m.cards !== undefined && m.cards !== null)) {
          rawVal = Number(m.cards);
        } else if (m.stat !== undefined && m.stat !== null) {
          rawVal = Number(m.stat);
        }

        const minutes = typeof m.minutes === 'number' ? m.minutes : (m.minutesPlayed || 0);
        const venue = (m.venue || '').toLowerCase() === 'home' ? 'home' : 'away';
        const isStarter = minutes >= (config.sampling?.minStarterMinutes || 45);

        const matchRecord = {
          matchId: m.matchId || null,
          date: m.date || null,
          competition: m.competition || null,
          team: m.team || null,
          opponent: m.opponent || null,
          venue,
          minutes,
          isStarter,
          statValue: rawVal // 0 es un valor 100% válido, null es ausente
        };

        parsedMatches.push(matchRecord);

        // Aparición válida: minutos >= marketMinMinutes o titularidad, y statValue no nulo
        if (rawVal !== null && (minutes >= marketMinMinutes || isStarter)) {
          validAppearances.push(matchRecord);
          if (venue === 'home') homeMatches.push(matchRecord);
          else awayMatches.push(matchRecord);
        }
      }

      const observations = validAppearances.map(m => m.statValue);
      const homeObservations = homeMatches.map(m => m.statValue);
      const awayObservations = awayMatches.map(m => m.statValue);

      // Multi-ventanas L5, L10, L15, L20
      const windows = {
        L5: this._calculateWindowStats(observations, 5, lineNum),
        L10: this._calculateWindowStats(observations, 10, lineNum),
        L15: observations.length >= 15 ? this._calculateWindowStats(observations, 15, lineNum) : null,
        L20: observations.length >= 20 ? this._calculateWindowStats(observations, 20, lineNum) : null
      };

      // Splits Local y Visitante
      const homeSplit = this._calculateWindowStats(homeObservations, homeObservations.length, lineNum);
      const awaySplit = this._calculateWindowStats(awayObservations, awayObservations.length, lineNum);

      const totalMinutes = validAppearances.reduce((acc, m) => acc + m.minutes, 0);
      const avgMinutes = validAppearances.length > 0 
        ? Number((totalMinutes / validAppearances.length).toFixed(1)) 
        : (data.perGame?.minutes || null);

      const totalStat = observations.reduce((acc, v) => acc + v, 0);
      const statPer90 = (totalMinutes > 0)
        ? Number(((totalStat / totalMinutes) * 90).toFixed(2))
        : (data.per90?.[statType] || (data.requestedStat?.per90) || (observations.length > 0 ? Number((totalStat / observations.length).toFixed(2)) : 0));

      const startsCount = parsedMatches.filter(m => m.isStarter).length;
      const subCount = parsedMatches.filter(m => !m.isStarter && m.minutes > 0).length;

      return {
        success: true,
        playerName,
        playerId,
        statType,
        totalMatchesRetrieved: rawMatches.length,
        validMatches: validAppearances.length,
        starts: startsCount,
        subAppearances: subCount,
        totalMinutes,
        avgMinutes,
        projectedMinutes: avgMinutes,
        statPerGame: observations.length > 0 ? Number((totalStat / observations.length).toFixed(2)) : 0,
        statPer90,
        observations, // Array numérico real, orden más reciente primero
        windows,      // L5, L10, L15, L20
        splits: {
          home: homeSplit,
          away: awaySplit
        },
        matches: validAppearances,
        rawContext: data.context || null
      };
    } catch (e) {
      console.warn(`[DeepResearch] Error en getPlayerStats para ${playerName}:`, e.message);
      return {
        success: false,
        reason: `MCP_ERROR: ${e.message}`,
        playerName,
        playerId,
        statType,
        validMatches: 0,
        observations: [],
        matches: [],
        qualityStatus: 'ERROR_DATOS'
      };
    }
  }

  async _fetchTeamPerformance(candidate) {
    const teamId = candidate.teamId || candidate.rawSourceData?.teamId || null;
    const teamName = candidate.team;
    const statType = this._getCanonicalStatType(candidate.market, candidate.rawStatType);
    const maxMatches = config.sampling?.maxTeamMatches || 30;

    if (!teamId) {
      return {
        success: false,
        reason: 'MISSING_TEAM_ID',
        teamName,
        statType,
        validMatches: 0,
        observations: [],
        matches: [],
        qualityStatus: 'INVESTIGACION_INCOMPLETA'
      };
    }

    try {
      const res = await mcpClient.callTool('getTeamPerformance', {
        teamId,
        limit: maxMatches,
        venue: 'both'
      });
      const data = res?.data;
      const games = data?.games || data?.matches || (Array.isArray(data) ? data : []);

      if (!games || games.length === 0) {
        return {
          success: false,
          reason: 'NO_TEAM_MATCHES_RETURNED',
          teamName,
          teamId,
          statType,
          validMatches: 0,
          observations: [],
          matches: [],
          qualityStatus: 'INVESTIGACION_INCOMPLETA'
        };
      }

      const lineNum = candidate.rawLine 
        ? parseFloat(candidate.rawLine) 
        : (candidate.line && !isNaN(parseFloat(String(candidate.line).replace(/[^0-9.]/g, ''))) 
            ? parseFloat(String(candidate.line).replace(/[^0-9.]/g, '')) 
            : 0.5);

      const parsedMatches = [];
      const homeMatches = [];
      const awayMatches = [];

      for (const g of games) {
        let rawVal = null;
        if (g[statType] !== undefined && g[statType] !== null) {
          rawVal = Number(g[statType]);
        } else if (g.stats?.[statType] !== undefined && g.stats?.[statType] !== null) {
          rawVal = Number(g.stats[statType]);
        } else if (g.teamStats?.[statType] !== undefined && g.teamStats?.[statType] !== null) {
          rawVal = Number(g.teamStats[statType]);
        } else if (g.stat !== undefined && g.stat !== null) {
          rawVal = Number(g.stat);
        }

        const venue = (g.venue || '').toLowerCase() === 'home' ? 'home' : 'away';
        if (rawVal !== null) {
          const rec = {
            matchId: g.matchId || null,
            date: g.date || null,
            opponent: g.opponent || null,
            venue,
            statValue: rawVal
          };
          parsedMatches.push(rec);
          if (venue === 'home') homeMatches.push(rec);
          else awayMatches.push(rec);
        }
      }

      const observations = parsedMatches.map(m => m.statValue);
      const homeObs = homeMatches.map(m => m.statValue);
      const awayObs = awayMatches.map(m => m.statValue);

      const windows = {
        L5: this._calculateWindowStats(observations, 5, lineNum),
        L10: this._calculateWindowStats(observations, 10, lineNum),
        L15: observations.length >= 15 ? this._calculateWindowStats(observations, 15, lineNum) : null,
        L20: observations.length >= 20 ? this._calculateWindowStats(observations, 20, lineNum) : null,
        L30: observations.length >= 30 ? this._calculateWindowStats(observations, 30, lineNum) : null
      };

      return {
        success: true,
        teamName,
        teamId,
        statType,
        totalMatchesRetrieved: games.length,
        validMatches: observations.length,
        observations,
        windows,
        splits: {
          home: this._calculateWindowStats(homeObs, homeObs.length, lineNum),
          away: this._calculateWindowStats(awayObs, awayObs.length, lineNum)
        },
        matches: parsedMatches
      };
    } catch (e) {
      console.warn(`[DeepResearch] Error en getTeamPerformance para ${teamName}:`, e.message);
      return {
        success: false,
        reason: `MCP_ERROR: ${e.message}`,
        teamName,
        teamId,
        statType,
        validMatches: 0,
        observations: [],
        matches: [],
        qualityStatus: 'ERROR_DATOS'
      };
    }
  }

  async _fetchOpponentConcededMetrics(candidate) {
    const opponentTeamId = candidate.opponentTeamId || candidate.rawSourceData?.opponentTeamId || null;
    const opponentName = candidate.opponent;
    const statType = this._getCanonicalStatType(candidate.market, candidate.rawStatType);

    if (!opponentTeamId) {
      return {
        isAvailable: false,
        opponentName,
        concessionRatio: null,
        reason: 'MISSING_OPPONENT_ID'
      };
    }

    try {
      const res = await mcpClient.callTool('getTeamPerformance', {
        teamId: opponentTeamId,
        limit: config.sampling?.maxTeamMatches || 30,
        venue: 'both'
      });
      const data = res?.data;
      if (!data) {
        return {
          isAvailable: false,
          opponentName,
          opponentTeamId,
          concessionRatio: null,
          reason: 'NO_DATA_RETURNED'
        };
      }

      let concededAvg = null;
      if (data.totals?.opponentStats?.[statType]?.avg !== undefined) {
        concededAvg = Number(data.totals.opponentStats[statType].avg);
      } else if (data.opponentTotals && data.games) {
        const oppStat = data.opponentTotals[statType];
        if (typeof oppStat === 'number' && data.games > 0) {
          concededAvg = Number((oppStat / data.games).toFixed(2));
        }
      } else if (data.opponentAverages && typeof data.opponentAverages[statType] === 'number') {
        concededAvg = Number(data.opponentAverages[statType].toFixed(2));
      } else if (Array.isArray(data.matches) || Array.isArray(data.games)) {
        const games = data.matches || data.games;
        const concededVals = games.map(g => g.opponentStats?.[statType] ?? g[`opponent_${statType}`]).filter(v => typeof v === 'number');
        if (concededVals.length > 0) {
          concededAvg = Number((concededVals.reduce((a, b) => a + b, 0) / concededVals.length).toFixed(2));
        }
      }

      const benchmarks = {
        shots: 12.0,
        shotsOnTarget: 4.2,
        fouls: 12.5,
        foulsWon: 12.5,
        corners: 4.8,
        yellowCards: 2.2,
        goals: 1.3
      };
      const benchmark = benchmarks[statType] || 10.0;
      const concessionRatio = concededAvg !== null ? Number((concededAvg / benchmark).toFixed(3)) : 1.0;

      return {
        isAvailable: true,
        opponentName,
        opponentTeamId,
        concededPerGame: concededAvg,
        leagueAvg: benchmark,
        concessionRatio,
        isVulnerable: concessionRatio >= 1.05,
        defensiveRank: concessionRatio >= 1.15 ? 'VULNERABLE (Percentil bajo)' : 'ESTÁNDAR',
        raw: data
      };
    } catch (e) {
      console.warn(`[DeepResearch] Error en getTeamPerformance rival ${opponentName}:`, e.message);
      return {
        isAvailable: false,
        opponentName,
        opponentTeamId,
        concessionRatio: null,
        reason: `MCP_ERROR: ${e.message}`
      };
    }
  }

  async _fetchRefereeMetrics(candidate) {
    const refereeId = candidate.refereeId || candidate.rawSourceData?.refereeId || null;

    if (!refereeId) {
      return {
        isAvailable: false,
        refereeData: null,
        reason: 'REFEREE_UNASSIGNED'
      };
    }

    try {
      const res = await mcpClient.callTool('getReferee', { refereeId });
      const data = res?.data;

      if (!data) {
        return {
          isAvailable: false,
          refereeData: null,
          reason: 'REFEREE_DATA_NOT_FOUND'
        };
      }

      const avgFouls = typeof data.foulsPerGame === 'number' ? data.foulsPerGame : null;
      const avgCards = typeof data.yellowCardsPerGame === 'number' ? data.yellowCardsPerGame : null;
      const leagueAvgFouls = 24.2;

      return {
        isAvailable: true,
        refereeName: data.name || data.refereeName || 'Árbitro Designado',
        refereeId,
        avgFouls,
        avgCards,
        foulStrictnessRatio: avgFouls ? Number((avgFouls / leagueAvgFouls).toFixed(2)) : null,
        favorsOvers: avgFouls ? avgFouls >= leagueAvgFouls : null,
        raw: data
      };
    } catch (e) {
      console.warn(`[DeepResearch] Error en getReferee para ${refereeId}:`, e.message);
      return {
        isAvailable: false,
        refereeData: null,
        reason: `MCP_ERROR: ${e.message}`
      };
    }
  }

  async _fetchLineupStatus(candidate) {
    if (candidate.isTeamProp) {
      return { status: 'CONFIRMADA', isStarter: true, certainty: 1.0, isTeamProp: true };
    }

    const matchId = candidate.matchId || candidate.rawSourceData?.matchId || null;
    const playerName = candidate.playerOrTeam;

    if (!matchId) {
      return {
        status: 'PENDIENTE_ALINEACION',
        isStarter: null,
        certainty: null,
        reason: 'MISSING_MATCH_ID_FOR_LINEUP'
      };
    }

    try {
      const res = await mcpClient.callTool('getLineups', { matchId });
      const data = res?.data;

      if (!data || !data.confirmed) {
        return {
          status: 'PENDIENTE_ALINEACION',
          isStarter: null,
          certainty: null,
          reason: 'LINEUP_PENDING_CONFIRMATION'
        };
      }

      const startingXI = data.startingXI || data.starters || [];
      const foundInXI = startingXI.some(p => {
        const name = typeof p === 'string' ? p : (p.name || p.playerName || '');
        return name.toLowerCase().includes(playerName.toLowerCase());
      });

      const bench = data.bench || data.substitutes || [];
      const foundOnBench = bench.some(p => {
        const name = typeof p === 'string' ? p : (p.name || p.playerName || '');
        return name.toLowerCase().includes(playerName.toLowerCase());
      });

      return {
        status: foundInXI ? 'CONFIRMADA' : (foundOnBench ? 'SUPLENTE_CONFIRMADO' : 'DESCONOCIDA'),
        isStarter: foundInXI,
        certainty: 1.0,
        raw: data
      };
    } catch (e) {
      console.warn(`[DeepResearch] Error en getLineups para ${matchId}:`, e.message);
      return {
        status: 'PENDIENTE_ALINEACION',
        isStarter: null,
        certainty: null,
        reason: `MCP_ERROR: ${e.message}`
      };
    }
  }

  // --- EVALUACIÓN DE CALIDAD DE MUESTRA ---

  _assessDataQuality(researchData, isTeamMarket) {
    let sampleSize = 0;
    let qualityStatus = 'INVESTIGACION_INCOMPLETA';
    let score = 0.30;

    if (!isTeamMarket) {
      sampleSize = researchData.playerData?.observations?.length || 0;
      if (sampleSize === 0) {
        qualityStatus = 'ERROR_DATOS';
        score = 0.10;
      } else if (sampleSize < (config.sampling?.minPlayerValidMatches || 8)) {
        qualityStatus = 'INVESTIGACION_INCOMPLETA';
        score = 0.40;
      } else if (sampleSize < 15) {
        qualityStatus = 'PARCIAL';
        score = Number((0.65 + ((sampleSize - 8) / 7) * 0.20).toFixed(2));
      } else {
        qualityStatus = 'COMPLETA';
        score = Number((0.85 + Math.min(0.15, ((sampleSize - 15) / 5) * 0.15)).toFixed(2));
      }

      if (researchData.lineupData?.status === 'CONFIRMADA' && qualityStatus !== 'INVESTIGACION_INCOMPLETA') {
        score = Math.min(1.0, Number((score + 0.05).toFixed(2)));
      }
    } else {
      sampleSize = researchData.teamData?.observations?.length || 0;
      if (sampleSize === 0) {
        qualityStatus = 'ERROR_DATOS';
        score = 0.10;
      } else if (sampleSize < (config.sampling?.minTeamValidMatches || 10)) {
        qualityStatus = 'INVESTIGACION_INCOMPLETA';
        score = 0.40;
      } else if (sampleSize < 20) {
        qualityStatus = 'PARCIAL';
        score = Number((0.70 + ((sampleSize - 10) / 10) * 0.15).toFixed(2));
      } else {
        qualityStatus = 'COMPLETA';
        score = 0.95;
      }
    }

    return {
      score,
      sampleSize,
      qualityStatus
    };
  }
}

module.exports = new DeepResearchEngine();
