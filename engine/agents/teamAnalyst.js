/**
 * AGENT 2: TEAM ANALYST (VALENTINA 2.0)
 * Analiza el comportamiento táctico colectivo real mediante StatsHub MCP:
 * - getTeamPerformance(teamId, limit: 10, venue): forma reciente (W/D/L), promedios de remates, córners, faltas, xG y split local/visitante.
 * - getTeamStatistics(teamId, seasonId): métricas de temporada cuando se provee seasonId.
 *
 * No altera probabilidades del modelo ni EV. Mantiene compatibilidad total con formato legado.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_HISTORY_PATH = path.join(__dirname, '..', 'storage_data', 'valentina_team_history.json');

const VALID_SEVERITIES = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
const VALID_RECOMMENDATIONS = new Set(['FAVORABLE', 'NEUTRAL', 'PRECAUCION', 'DESFAVORABLE']);

class TeamAnalyst {
  constructor() {
    this.name = 'Team Analyst';
    this.alias = 'Valentina';
    this.version = '2.0.0';
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  _getCached(key, nowMs, ttlMs) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (nowMs - entry.ts > ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  _setCached(key, data, nowMs) {
    this.cache.set(key, { ts: nowMs, data });
  }

  _appendHistory(entry, historyPath) {
    if (!historyPath) return;
    try {
      const dir = path.dirname(historyPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let history = [];
      if (fs.existsSync(historyPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
          if (Array.isArray(parsed)) history = parsed;
        } catch {}
      }
      history.push({ version: history.length + 1, agentVersion: this.version, ...entry });
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    } catch {}
  }

  validateStructuredSignals(signals) {
    if (!signals || typeof signals !== 'object') throw new Error('Valentina 2.0: structuredSignals inválido');
    if (typeof signals.teamRiskDetected !== 'boolean') throw new Error('Valentina 2.0: teamRiskDetected debe ser booleano');
    if (!VALID_SEVERITIES.has(signals.riskSeverity)) throw new Error(`Valentina 2.0: riskSeverity inválido (${signals.riskSeverity})`);
    if (typeof signals.teamConfidence !== 'number' || signals.teamConfidence < 0 || signals.teamConfidence > 1) throw new Error('Valentina 2.0: teamConfidence fuera de [0, 1]');
    if (!VALID_RECOMMENDATIONS.has(signals.recommendation)) throw new Error(`Valentina 2.0: recommendation inválida (${signals.recommendation})`);
    if (!Array.isArray(signals.evidence)) throw new Error('Valentina 2.0: evidence debe ser un array');
    return true;
  }

  async _callMcp(mcpClient, toolName, args, cacheKey, nowMs, ttlMs, counters) {
    const cached = this._getCached(cacheKey, nowMs, ttlMs);
    if (cached !== null) {
      counters.fromCacheCount++;
      return { ok: true, data: cached, fromCache: true };
    }
    if (!mcpClient || typeof mcpClient[toolName] !== 'function') {
      return { ok: false, noClient: true, data: null };
    }
    try {
      const data = await mcpClient[toolName](args);
      this._setCached(cacheKey, data, nowMs);
      counters.mcpCallsCount++;
      return { ok: true, data, fromCache: false };
    } catch (err) {
      return { ok: false, error: err.message || String(err), data: null };
    }
  }

  async analyze(candidate = {}, prediction = {}, options = {}) {
    const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
    const queriedAtUtc = new Date(nowMs).toISOString();
    const ttlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
    const mcpClient = options.mcpClient || global.statshubClient || null;
    const persistHistory = options.persistHistory !== false && Boolean(mcpClient);
    const historyPath = persistHistory ? (options.historyPath || DEFAULT_HISTORY_PATH) : null;

    const opponent = candidate.researchData?.opponentData || {};
    const team = candidate.team || 'Equipo';
    const opponentName = candidate.opponent || 'Rival';
    const market = candidate.market || '';
    const isHome = Boolean(candidate.match && candidate.match.startsWith(team));
    const venueSplit = isHome ? 'home' : 'away';

    const advantages = [];
    const risks = [];
    const missing = [];
    const evidence = [];
    const sourcesConsulted = [];
    const mcpErrors = [];
    const counters = { fromCacheCount: 0, mcpCallsCount: 0 };

    let teamForm = null;
    let opponentConcession = null;

    // 1. Consulta real a StatsHub: getTeamPerformance para equipo y rival
    if (mcpClient && candidate.teamId) {
      const res = await this._callMcp(
        mcpClient,
        'getTeamPerformance',
        { teamId: String(candidate.teamId), limit: 10, venue: venueSplit },
        `teamPerf:${candidate.teamId}:${venueSplit}:10`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getTeamPerformance(team)');
        const d = res.data;
        teamForm = {
          games: Number(d.games ?? d.matches ?? 0),
          wins: Number(d.wins ?? 0),
          draws: Number(d.draws ?? 0),
          losses: Number(d.losses ?? 0),
          avgCornersFor: Number.isFinite(Number(d.avgCornersFor)) ? Number(d.avgCornersFor) : null,
          avgShotsFor: Number.isFinite(Number(d.avgShotsFor)) ? Number(d.avgShotsFor) : null,
          avgFoulsFor: Number.isFinite(Number(d.avgFoulsFor)) ? Number(d.avgFoulsFor) : null
        };
        evidence.push({
          source: 'statshub:getTeamPerformance',
          classification: 'CONFIRMADO',
          summary: `${team} (${venueSplit}, últimos ${teamForm.games}): ${teamForm.wins}G-${teamForm.draws}E-${teamForm.losses}P.`
        });
        if (teamForm.games >= 5 && (teamForm.wins / teamForm.games) >= 0.6) {
          advantages.push(`Forma reciente sólida de ${team} (${teamForm.wins}/${teamForm.games} victorias en ${venueSplit}).`);
        } else if (teamForm.games >= 5 && (teamForm.losses / teamForm.games) >= 0.6) {
          risks.push(`Racha adversa reciente de ${team} (${teamForm.losses}/${teamForm.games} derrotas en ${venueSplit}).`);
        }
      } else if (res.error) {
        mcpErrors.push({ tool: 'getTeamPerformance(team)', error: res.error });
      }
    }

    if (mcpClient && candidate.opponentTeamId) {
      const oppVenue = isHome ? 'away' : 'home';
      const res = await this._callMcp(
        mcpClient,
        'getTeamPerformance',
        { teamId: String(candidate.opponentTeamId), limit: 10, venue: oppVenue },
        `teamPerf:${candidate.opponentTeamId}:${oppVenue}:10`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getTeamPerformance(opponent)');
        const d = res.data;
        opponentConcession = {
          games: Number(d.games ?? d.matches ?? 0),
          avgCornersAgainst: Number.isFinite(Number(d.avgCornersAgainst)) ? Number(d.avgCornersAgainst) : null,
          avgShotsAgainst: Number.isFinite(Number(d.avgShotsAgainst)) ? Number(d.avgShotsAgainst) : null,
          concessionRatio: Number.isFinite(Number(d.concessionRatio)) ? Number(d.concessionRatio) : null
        };
        evidence.push({
          source: 'statshub:getTeamPerformance',
          classification: 'CONFIRMADO',
          summary: `Rival ${opponentName} concede ${opponentConcession.avgCornersAgainst ?? 'N/D'} córners/p y ${opponentConcession.avgShotsAgainst ?? 'N/D'} remates/p.`
        });
      } else if (res.error) {
        mcpErrors.push({ tool: 'getTeamPerformance(opponent)', error: res.error });
      }
    }

    // 2. Análisis de concesión del rival (MCP o formato legado)
    const concessionRatio = opponentConcession?.concessionRatio ?? opponent.concessionRatio ?? 1.0;
    const isVulnerable = opponent.isVulnerable === true || concessionRatio >= 1.15;

    if (concessionRatio >= 1.15) {
      advantages.push(`Vulnerabilidad defensiva marcada de ${opponentName}: concede un ${((concessionRatio - 1) * 100).toFixed(1)}% más de ${market} que la media del torneo.`);
    } else if (concessionRatio >= 1.05) {
      advantages.push(`Rival permisivo: ${opponentName} concede ligeramente por encima del promedio (${concessionRatio}x).`);
    } else if (concessionRatio <= 0.88) {
      risks.push(`Defensa cerrada: ${opponentName} concede un ${((1 - concessionRatio) * 100).toFixed(1)}% menos de ${market} que el promedio de la liga.`);
    }

    // 3. Localía / Visitante
    if (isHome) {
      advantages.push(`${team} ejerce la localía, condición donde su volumen estadístico suele incrementarse.`);
    } else {
      risks.push(`${team} juega como visitante, donde la producción ofensiva y el dominio de posesión tienden a reducirse.`);
    }

    // 4. Compatibilidad de estilos
    if (market.includes('Remates') || market.includes('tiro') || market.toLowerCase().includes('shot')) {
      if (isVulnerable) {
        advantages.push('El planteo defensivo del rival concede espacios para transiciones y disparos de media distancia.');
      }
    } else if (market.includes('Faltas') || market.toLowerCase().includes('foul')) {
      advantages.push('Partido con fricción proyectada en zonas de disputa de balón.');
    }

    const investigationStatus = mcpErrors.length > 0
      ? 'INVESTIGACION_INCOMPLETA'
      : (sourcesConsulted.length > 0 ? 'COMPLETA' : 'SOLO_CONTEXTO_LOCAL');

    let teamRiskDetected = risks.length >= 2;
    let riskSeverity = risks.length >= 2 ? 'MEDIUM' : (risks.length === 1 ? 'LOW' : 'NONE');
    let recommendation = 'NEUTRAL';
    let confidence = 0.75;

    if (mcpErrors.length > 0) {
      recommendation = 'NEUTRAL';
      confidence = 0.50;
    } else if (advantages.length >= 2 && risks.length <= 1) {
      recommendation = 'FAVORABLE';
      confidence = 0.85;
    } else if (risks.length >= 2) {
      recommendation = 'DESFAVORABLE';
      confidence = 0.65;
    }

    const reasoning = mcpErrors.length > 0
      ? `Valentina 2.0: investigación incompleta por error en StatsHub (${mcpErrors.map(e => e.tool).join(', ')}).`
      : `Valentina 2.0 (${investigationStatus}): matchup ${team} vs ${opponentName} (${venueSplit}), ratio concesión ${concessionRatio}x.`;

    const structuredSignals = {
      teamRiskDetected,
      riskSeverity,
      teamConfidence: Number(confidence.toFixed(2)),
      teamForm,
      opponentConcession,
      venueSplit,
      evidence,
      recommendation,
      reasoning
    };

    this.validateStructuredSignals(structuredSignals);

    const report = {
      agentName: this.name,
      alias: this.alias,
      version: this.version,
      candidateId: candidate.id || null,
      match: candidate.match || null,
      investigationStatus,
      queriedAtUtc,
      sourcesConsulted,
      fromCacheCount: counters.fromCacheCount,
      mcpCallsCount: counters.mcpCallsCount,
      mcpErrors,
      tacticalSummary: `Matchup táctico entre ${team} y ${opponentName}. Ratio de concesión del rival: ${concessionRatio}x (${opponent.defensiveRank || 'Estándar'}).`,
      advantages,
      risks,
      missingData: missing,
      confidenceScore: Number(confidence.toFixed(2)),
      recommendation,
      structuredSignals
    };

    if (historyPath) {
      this._appendHistory({
        investigatedAtUtc: queriedAtUtc,
        candidateId: candidate.id || null,
        match: candidate.match || null,
        sourcesConsulted,
        investigationStatus,
        structuredSignals
      }, historyPath);
    }

    return report;
  }
}

module.exports = new TeamAnalyst();
module.exports.TeamAnalyst = TeamAnalyst;
