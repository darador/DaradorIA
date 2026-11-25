/**
 * AGENT 1: PLAYER ANALYST (SOFÍA 2.0)
 * Investiga rendimiento individual real mediante StatsHub MCP:
 * - getPlayerStats(playerId, statType, limit: 10, line, appearances: 'starts'): totales, per90 y partidos superando la línea.
 * - getPlayerTrends(playerId): detecta tendencias reales vs espejismos de muestra corta (ej. racha 3/3 con last10 débil).
 *
 * No altera probabilidades del modelo ni EV. Mantiene compatibilidad total con formato legado.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_HISTORY_PATH = path.join(__dirname, '..', 'storage_data', 'sofia_player_history.json');

const VALID_SEVERITIES = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
const VALID_RECOMMENDATIONS = new Set(['FAVORABLE', 'NEUTRAL', 'PRECAUCION', 'DESFAVORABLE']);

function mapMarketToStatType(market) {
  const m = String(market || '').toLowerCase();
  if (m.includes('on_target') || m.includes('puerta') || m.includes('arco')) return 'shotsOnTarget';
  if (m.includes('shot') || m.includes('remate') || m.includes('tiro')) return 'shots';
  if (m.includes('foul_won') || m.includes('faltas ganadas')) return 'foulsWon';
  if (m.includes('foul') || m.includes('falta')) return 'fouls';
  if (m.includes('tackle') || m.includes('entrada')) return 'tackles';
  if (m.includes('card') || m.includes('tarjet')) return 'yellowCards';
  return 'shots';
}

class PlayerAnalyst {
  constructor() {
    this.name = 'Player Analyst';
    this.alias = 'Sofía';
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
    if (!signals || typeof signals !== 'object') throw new Error('Sofía 2.0: structuredSignals inválido');
    if (typeof signals.playerRiskDetected !== 'boolean') throw new Error('Sofía 2.0: playerRiskDetected debe ser booleano');
    if (!VALID_SEVERITIES.has(signals.riskSeverity)) throw new Error(`Sofía 2.0: riskSeverity inválido (${signals.riskSeverity})`);
    if (typeof signals.playerConfidence !== 'number' || signals.playerConfidence < 0 || signals.playerConfidence > 1) throw new Error('Sofía 2.0: playerConfidence fuera de [0, 1]');
    if (!VALID_RECOMMENDATIONS.has(signals.recommendation)) throw new Error(`Sofía 2.0: recommendation inválida (${signals.recommendation})`);
    if (!Array.isArray(signals.evidence)) throw new Error('Sofía 2.0: evidence debe ser un array');
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

    const isTeamProp = candidate.isTeamProp === true;
    const market = candidate.market || '';

    // Mercado colectivo: no depende de un solo jugador
    if (isTeamProp) {
      const structuredSignals = {
        playerRiskDetected: false,
        riskSeverity: 'NONE',
        playerConfidence: 0.90,
        sampleSize: null,
        statPer90: null,
        hitRateLast10: null,
        mirageTrendDetected: false,
        evidence: [{ source: 'local', classification: 'CONFIRMADO', summary: `Mercado colectivo (${market}); no requiere evaluación individual.` }],
        recommendation: 'FAVORABLE',
        reasoning: `Sofía 2.0: mercado colectivo (${market}), contribución evaluada como bloque de equipo.`
      };
      this.validateStructuredSignals(structuredSignals);
      return {
        agentName: this.name,
        alias: this.alias,
        version: this.version,
        candidateId: candidate.id || null,
        target: candidate.playerOrTeam || null,
        investigationStatus: 'NO_APLICA_EQUIPO',
        queriedAtUtc,
        sourcesConsulted: [],
        fromCacheCount: 0,
        mcpCallsCount: 0,
        mcpErrors: [],
        summary: `Mercado colectivo (${market}). La contribución se evalúa como bloque de equipo.`,
        favorableFindings: ['Mercado no dependiente de la sustitución o rendimiento de un único jugador.'],
        risks: [],
        missingData: [],
        confidenceScore: 0.90,
        recommendation: 'FAVORABLE',
        structuredSignals
      };
    }

    const player = candidate.researchData?.playerData || {};
    const favorable = [];
    const risks = [];
    const missing = [];
    const evidence = [];
    const sourcesConsulted = [];
    const mcpErrors = [];
    const counters = { fromCacheCount: 0, mcpCallsCount: 0 };

    let starts = Number(player.starts || 0);
    let avgMins = Number(player.avgMinutes || 0);
    let statP90 = Number(player.statPer90 || 0);
    const hist = Array.isArray(player.historicalValues) ? player.historicalValues : [];
    let hitRateLast10 = null;
    let mirageTrendDetected = false;

    const statType = mapMarketToStatType(market);
    const rawLine = Number.isFinite(Number(candidate.rawLine)) ? Number(candidate.rawLine) : (Number.isFinite(Number(candidate.line)) ? Number(candidate.line) : 1.5);

    // 1. Consulta real a StatsHub: getPlayerStats
    if (mcpClient && candidate.playerId) {
      const res = await this._callMcp(
        mcpClient,
        'getPlayerStats',
        { playerId: String(candidate.playerId), statType, limit: 10, line: rawLine, appearances: 'starts' },
        `playerStats:${candidate.playerId}:${statType}:${rawLine}`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getPlayerStats');
        const d = res.data;
        if (Number.isFinite(Number(d.starts ?? d.games))) starts = Number(d.starts ?? d.games);
        if (Number.isFinite(Number(d.avgMinutes))) avgMins = Number(d.avgMinutes);
        if (Number.isFinite(Number(d.per90))) statP90 = Number(d.per90);
        if (Number.isFinite(Number(d.hitRate))) hitRateLast10 = Number(d.hitRate);
        else if (Number.isFinite(Number(d.hitsOverLine)) && starts > 0) hitRateLast10 = Number(((Number(d.hitsOverLine) / starts) * 100).toFixed(1));

        evidence.push({
          source: 'statshub:getPlayerStats',
          classification: 'CONFIRMADO',
          summary: `${candidate.playerOrTeam || 'Jugador'} (${statType}): ${statP90} p90, ${avgMins} min/p, muestra ${starts} titularidades${hitRateLast10 != null ? `, hit-rate ${hitRateLast10}%` : ''}.`
        });
      } else if (res.error) {
        mcpErrors.push({ tool: 'getPlayerStats', error: res.error });
      }

      // 2. Consulta real a StatsHub: getPlayerTrends (detectar espejismo de muestra corta)
      if (typeof mcpClient.getPlayerTrends === 'function') {
        const trRes = await this._callMcp(
          mcpClient,
          'getPlayerTrends',
          { playerId: String(candidate.playerId), statTypes: [statType] },
          `playerTrends:${candidate.playerId}:${statType}`,
          nowMs,
          ttlMs,
          counters
        );
        if (trRes.ok && Array.isArray(trRes.data?.rows) && trRes.data.rows.length > 0) {
          sourcesConsulted.push('statshub:getPlayerTrends');
          const row = trRes.data.rows[0];
          const runHits = Number(row.runGames ?? 0);
          const l10Rate = Number(row.last10HitRate ?? hitRateLast10 ?? 100);
          if (runHits > 0 && runHits <= 4 && l10Rate < 50) {
            mirageTrendDetected = true;
            risks.push(`Espejismo de racha corta detectado (${row.hits || runHits + ' juegos'}, pero last10 ${l10Rate}%).`);
            evidence.push({
              source: 'statshub:getPlayerTrends',
              classification: 'PROBABLE',
              summary: `Racha corta ${row.hits || ''} no respaldada por ventana last10 (${l10Rate}%).`
            });
          } else {
            evidence.push({
              source: 'statshub:getPlayerTrends',
              classification: 'CONFIRMADO',
              summary: `Tendencia consistente en StatsHub (${row.hits || 'N/D'}, last10: ${row.last10 || l10Rate + '%'}).`
            });
          }
        } else if (trRes.error) {
          mcpErrors.push({ tool: 'getPlayerTrends', error: trRes.error });
        }
      }
    }

    // 3. Evaluación cuantitativa (compatible con formato legado y MCP)
    if (starts >= 10) {
      favorable.push(`Muestra sólida de titularidades (${starts} partidos de titular).`);
    } else if (starts >= 6) {
      favorable.push(`Muestra aceptable de titularidades (${starts} partidos).`);
    } else {
      risks.push(`Muestra corta de titularidades (${starts} partidos), susceptible a varianza.`);
    }

    if (avgMins >= 75) {
      favorable.push(`Volumen de minutos elevado (promedia ${avgMins} min por titularidad, titular indiscutido).`);
    } else if (avgMins >= 65) {
      favorable.push(`Minutos suficientes (${avgMins} min en promedio), susceptible a rotaciones tardías.`);
    } else {
      risks.push(`Minutos promedio reducidos (${avgMins} min), alto riesgo de sustitución temprana.`);
    }

    if (statP90 > rawLine) {
      favorable.push(`Tasa de producción destacada (${statP90} por 90 min) superando holgadamente la línea exigida (${candidate.line || rawLine}).`);
    } else {
      risks.push(`Tasa de producción ajustada (${statP90} por 90 min) respecto a la línea (${candidate.line || rawLine}).`);
    }

    const zeroGames = hist.filter(v => v === 0).length;
    if (hist.length > 0 && (zeroGames / hist.length) > 0.35) {
      risks.push(`Alta dispersión en la serie: en el ${((zeroGames / hist.length) * 100).toFixed(0)}% de los partidos no generó producción.`);
    }

    const investigationStatus = mcpErrors.length > 0
      ? 'INVESTIGACION_INCOMPLETA'
      : (sourcesConsulted.length > 0 ? 'COMPLETA' : 'SOLO_CONTEXTO_LOCAL');

    let playerRiskDetected = risks.length >= 2 || mirageTrendDetected;
    let riskSeverity = mirageTrendDetected ? 'MEDIUM' : (risks.length >= 2 ? 'MEDIUM' : (risks.length === 1 ? 'LOW' : 'NONE'));
    let recommendation = 'NEUTRAL';
    let confidence = 0.75;

    if (mcpErrors.length > 0) {
      recommendation = 'NEUTRAL';
      confidence = 0.50;
    } else if (mirageTrendDetected) {
      recommendation = 'PRECAUCION';
      confidence = 0.72;
    } else if (risks.length === 0 && favorable.length >= 2) {
      recommendation = 'FAVORABLE';
      confidence = 0.88;
    } else if (risks.length >= 2) {
      recommendation = 'DESFAVORABLE';
      confidence = 0.60;
    }

    const reasoning = mcpErrors.length > 0
      ? `Sofía 2.0: investigación incompleta por error en StatsHub (${mcpErrors.map(e => e.tool).join(', ')}).`
      : `Sofía 2.0 (${investigationStatus}): ${candidate.playerOrTeam || 'Jugador'} (${statP90} p90, ${avgMins} min, ${starts} titularidades).`;

    const structuredSignals = {
      playerRiskDetected,
      riskSeverity,
      playerConfidence: Number(confidence.toFixed(2)),
      sampleSize: starts,
      statPer90: statP90,
      hitRateLast10,
      mirageTrendDetected,
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
      target: candidate.playerOrTeam || null,
      investigationStatus,
      queriedAtUtc,
      sourcesConsulted,
      fromCacheCount: counters.fromCacheCount,
      mcpCallsCount: counters.mcpCallsCount,
      mcpErrors,
      summary: `${candidate.playerOrTeam || 'Jugador'} proyecta ${player.projectedMinutes || avgMins} min con una tasa de ${statP90} por 90 min en ${market}.`,
      favorableFindings: favorable,
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
        playerId: candidate.playerId || null,
        sourcesConsulted,
        investigationStatus,
        structuredSignals
      }, historyPath);
    }

    return report;
  }
}

module.exports = new PlayerAnalyst();
module.exports.PlayerAnalyst = PlayerAnalyst;
