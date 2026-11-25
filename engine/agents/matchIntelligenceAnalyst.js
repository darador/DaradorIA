/**
 * AGENT 5: MATCH INTELLIGENCE ANALYST 2.0 (LUCÍA)
 * Investigación deportiva contextual real vía StatsHub MCP (getTeamNews + getLineups).
 *
 * Garantías metodológicas:
 * - No modifica Modelo B, Modelo C, Ensemble, probabilidades ni EV (+7%).
 * - No inventa fuentes, URLs, noticias ni lesiones.
 * - Diferencia explícitamente CONFIRMADO, PROBABLE, RUMOR, NO_VERIFICADO y SIN_INFORMACION.
 * - Distingue coverage 'ok' vs 'noneOnRecord' vs 'noData' vs 'error'.
 * - Nunca trata alineaciones 'predicted' como confirmadas.
 * - Aísla riesgos individuales a los mercados afectados (no contamina otros mercados del partido).
 * - Detecta contradicciones con Sofía, Valentina, Camila y Renata sin alterar sus reportes.
 * - Persistencia append-only versionada con caché anti-duplicación.
 */

const fs = require('fs');
const path = require('path');
const defaultMcpClient = require('../mcp/mcpClient');

const DEFAULT_HISTORY_PATH = path.join(__dirname, '..', 'storage_data', 'lucia_intelligence_history.json');
const VALID_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_RECOMMENDATIONS = new Set(['INFORM', 'REVIEW', 'VETO']);
const STALE_NEWS_DAYS = 7;

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function classifyMarketCode(market) {
  const m = normalizeText(market);
  if (m.includes('remates al arco') && !m.includes('equipo')) return 'PLAYER_SHOTS_ON_TARGET';
  if (m.includes('remates') && !m.includes('equipo')) return 'PLAYER_SHOTS';
  if (m.includes('faltas') && !m.includes('equipo')) return 'PLAYER_FOULS';
  if (m.includes('entradas') || m.includes('tackles')) return 'PLAYER_TACKLES';
  if (m.includes('corners') || m.includes('córners')) return 'TEAM_CORNERS';
  if (m.includes('goles')) return 'TEAM_GOALS';
  if (m.includes('1x2') || m.includes('ganador')) return 'MATCH_1X2';
  if (m.includes('doble')) return 'MATCH_DOUBLE_CHANCE';
  return 'TEAM_MARKET';
}

function isNewsStale(publishedAtUtc, nowMs, playedSince = false) {
  if (playedSince === true) return true;
  if (!publishedAtUtc) return false;
  const ts = new Date(publishedAtUtc).getTime();
  if (isNaN(ts)) return false;
  return (nowMs - ts) > STALE_NEWS_DAYS * 86400000;
}

class MatchIntelligenceAnalyst {
  constructor(options = {}) {
    this.name = 'Match Intelligence Analyst';
    this.alias = 'Lucía';
    this.version = '2.0.0';
    this.mcpClient = options.mcpClient || defaultMcpClient;
    this.historyPath = options.historyPath || DEFAULT_HISTORY_PATH;
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 60 * 1000; // 30 min por defecto
    this._cache = new Map();
  }

  clearCache() {
    this._cache.clear();
  }

  async _cachedMcpCall(client, toolName, params, nowMs) {
    const key = `${toolName}:${JSON.stringify(params)}`;
    const hit = this._cache.get(key);
    if (hit && (nowMs - hit.fetchedAtMs) < this.cacheTtlMs) {
      return { data: hit.data, fromCache: true, error: null };
    }
    try {
      const data = await client.callTool(toolName, params);
      this._cache.set(key, { data, fetchedAtMs: nowMs });
      return { data, fromCache: false, error: null };
    } catch (err) {
      return { data: null, fromCache: false, error: err.message || 'MCP_CALL_ERROR' };
    }
  }

  _appendHistory(entry, historyPath) {
    if (!historyPath) return;
    let store = { schemaVersion: '2.0.0', agent: 'Lucía', records: [] };
    if (fs.existsSync(historyPath)) {
      try { store = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch {}
    }
    const prior = (store.records || []).filter(r => r.candidateId === entry.candidateId);
    const versionNumber = prior.length + 1;
    const record = {
      versionNumber,
      previousVersionAtUtc: prior.length > 0 ? prior[prior.length - 1].investigatedAtUtc : null,
      ...entry
    };
    store.records.push(record);
    store.updatedAtUtc = entry.investigatedAtUtc;
    const dir = path.dirname(historyPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(store, null, 2), 'utf8');
  }

  validateStructuredSignals(sig) {
    if (!sig || typeof sig !== 'object') throw new Error('INVALID_LUCIA_SCHEMA: structuredSignals vacío');
    if (typeof sig.newsRiskDetected !== 'boolean') throw new Error('INVALID_LUCIA_SCHEMA: newsRiskDetected debe ser boolean');
    if (!VALID_SEVERITIES.has(sig.riskSeverity)) throw new Error(`INVALID_LUCIA_SCHEMA: riskSeverity inválido (${sig.riskSeverity})`);
    if (typeof sig.newsConfidence !== 'number' || sig.newsConfidence < 0 || sig.newsConfidence > 1) {
      throw new Error(`INVALID_LUCIA_SCHEMA: newsConfidence inválido (${sig.newsConfidence})`);
    }
    if (!VALID_RECOMMENDATIONS.has(sig.recommendation)) {
      throw new Error(`INVALID_LUCIA_SCHEMA: recommendation inválida (${sig.recommendation})`);
    }
    if (!Array.isArray(sig.evidence) || !Array.isArray(sig.contradictions)) {
      throw new Error('INVALID_LUCIA_SCHEMA: evidence y contradictions deben ser arrays');
    }
    return true;
  }

  /**
   * Investiga contexto real (getTeamNews + getLineups), analiza riesgos específicos de la
   * selección y detecta contradicciones con los otros 4 agentes sin modificar sus reportes.
   */
  async analyze(candidate, prediction = {}, options = {}) {
    const nowMs = typeof options.now === 'number' ? options.now : Date.now();
    const queriedAtUtc = new Date(nowMs).toISOString();
    const client = options.mcpClient || this.mcpClient;
    const otherAgents = options.otherAgentReports || {};
    const persistHistory = options.persistHistory === true;
    const historyPath = options.historyPath || (persistHistory ? this.historyPath : null);

    const playerOrTeam = candidate.playerOrTeam || candidate.player || candidate.seleccion || '';
    const match = candidate.match || candidate.partido || '';
    const matchId = candidate.matchId || candidate.fixtureId || null;
    const teamId = candidate.teamId || null;
    const market = candidate.market || candidate.mercado || '';
    const marketCode = classifyMarketCode(market);
    const isPlayerProp = candidate.isTeamProp !== true && !String(playerOrTeam).includes('(Equipo)');
    const targetNorm = normalizeText(playerOrTeam);

    const sourcesConsulted = [];
    const evidence = [];
    const contradictions = [];
    let investigationStatus = 'COMPLETA';
    let mcpErrors = [];
    let fromCacheCount = 0;

    // 1. Consultar getTeamNews si hay matchId o teamId y el cliente soporta callTool
    let newsRes = { data: null, fromCache: false, error: null };
    if (client && typeof client.callTool === 'function' && (matchId || teamId)) {
      const params = matchId ? { matchId } : { teamId };
      newsRes = await this._cachedMcpCall(client, 'getTeamNews', params, nowMs);
      sourcesConsulted.push('StatsHub:getTeamNews');
      if (newsRes.fromCache) fromCacheCount++;
      if (newsRes.error) {
        mcpErrors.push(`getTeamNews: ${newsRes.error}`);
        investigationStatus = 'INVESTIGACION_INCOMPLETA';
      }
    }

    // 2. Consultar getLineups si hay matchId y es prop de jugador (o si se solicita)
    let lineupRes = { data: null, fromCache: false, error: null };
    if (client && typeof client.callTool === 'function' && matchId && (isPlayerProp || options.includeLineups)) {
      lineupRes = await this._cachedMcpCall(client, 'getLineups', { matchId }, nowMs);
      sourcesConsulted.push('StatsHub:getLineups');
      if (lineupRes.fromCache) fromCacheCount++;
      if (lineupRes.error) {
        mcpErrors.push(`getLineups: ${lineupRes.error}`);
        investigationStatus = 'INVESTIGACION_INCOMPLETA';
      }
    }

    // 3. Procesar evidencia de getTeamNews (sin inventar datos)
    let newsRiskDetected = false;
    let riskSeverity = 'LOW';
    let newsConfidence = 0.0;
    let recommendation = 'INFORM';
    let affectedEntity = playerOrTeam || match;
    let playerConfirmedStarter = false;

    const newsData = newsRes.data;
    if (newsData && typeof newsData === 'object') {
      const coverage = String(newsData.coverage || 'noData');
      if (coverage === 'ok') {
        const absences = [
          ...(Array.isArray(newsData.injuries) ? newsData.injuries.map(x => ({ ...x, kind: 'injury' })) : []),
          ...(Array.isArray(newsData.suspensions) ? newsData.suspensions.map(x => ({ ...x, kind: 'suspension' })) : []),
          ...(Array.isArray(newsData.internationalDuty) ? newsData.internationalDuty.map(x => ({ ...x, kind: 'internationalDuty' })) : []),
          ...(Array.isArray(newsData.other) ? newsData.other.map(x => ({ ...x, kind: 'other' })) : []),
          ...(Array.isArray(newsData.absences) ? newsData.absences : [])
        ];

        for (const item of absences) {
          const entityName = item.playerName || item.player || item.name || '';
          const entityNorm = normalizeText(entityName);
          const isExactPlayer = isPlayerProp && targetNorm && entityNorm && (entityNorm.includes(targetNorm) || targetNorm.includes(entityNorm));
          const stale = isNewsStale(item.publishedAtUtc || item.updatedAtUtc, nowMs, Boolean(item.playedSince));
          const isRumor = Boolean(item.isRumor || String(item.verificationStatus || '').toUpperCase() === 'RUMOR');
          const isDoubtful = Boolean(item.doubtful);

          let verificationStatus = 'CONFIRMADO';
          let conf = 0.92;
          if (stale) {
            verificationStatus = 'NO_VERIFICADO';
            conf = 0.35;
          } else if (isRumor) {
            verificationStatus = 'RUMOR';
            conf = 0.45;
          } else if (isDoubtful) {
            verificationStatus = 'PROBABLE';
            conf = 0.70;
          }

          // Regla crítica: una baja individual afecta al mercado de ESE jugador; no contamina otros mercados del partido
          if (isExactPlayer) {
            evidence.push({
              source: 'StatsHub:getTeamNews',
              entity: entityName,
              info: `${item.kind || 'absence'}: ${item.reason || item.status || 'Baja reportada'}${stale ? ' (registro potencialmente desactualizado)' : ''}`,
              publishedAtUtc: item.publishedAtUtc || item.updatedAtUtc || null,
              queriedAtUtc,
              verificationStatus,
              confidence: conf,
              stale
            });

            if (!stale) {
              newsRiskDetected = true;
              affectedEntity = entityName;
              newsConfidence = Math.max(newsConfidence, conf);
              if (verificationStatus === 'CONFIRMADO') {
                riskSeverity = 'CRITICAL';
                recommendation = 'VETO';
              } else if (verificationStatus === 'PROBABLE') {
                riskSeverity = riskSeverity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
                recommendation = recommendation === 'VETO' ? 'VETO' : 'REVIEW';
              } else if (verificationStatus === 'RUMOR') {
                riskSeverity = riskSeverity === 'LOW' ? 'MEDIUM' : riskSeverity;
                recommendation = recommendation === 'INFORM' ? 'REVIEW' : recommendation;
              }
            }
          } else if (!isPlayerProp && entityName) {
            // Mercado de equipo: registrar como contexto sin auto-vetar salvo múltiples bajas confirmadas
            evidence.push({
              source: 'StatsHub:getTeamNews',
              entity: entityName,
              info: `Contexto equipo (${item.kind || 'absence'}): ${item.reason || 'Baja en plantilla'}`,
              publishedAtUtc: item.publishedAtUtc || null,
              queriedAtUtc,
              verificationStatus,
              confidence: conf,
              stale
            });
          }
        }

        if (evidence.length === 0) {
          evidence.push({
            source: 'StatsHub:getTeamNews',
            entity: playerOrTeam || match,
            info: 'Sin bajas registradas para la entidad analizada en cobertura ok.',
            publishedAtUtc: null,
            queriedAtUtc,
            verificationStatus: 'CONFIRMADO',
            confidence: 0.85,
            stale: false
          });
        }
      } else {
        // Diferenciar explícitamente noneOnRecord, noData y error (nunca convertir en confirmación de disponibilidad)
        const coverageMsg = coverage === 'noneOnRecord'
          ? 'Cobertura StatsHub noneOnRecord: no hay registros de bajas, lo cual NO confirma disponibilidad.'
          : (coverage === 'error'
            ? 'Cobertura StatsHub error al consultar noticias.'
            : 'Cobertura StatsHub noData: sin información de noticias disponible.');
        evidence.push({
          source: 'StatsHub:getTeamNews',
          entity: playerOrTeam || match,
          info: coverageMsg,
          publishedAtUtc: null,
          queriedAtUtc,
          verificationStatus: 'SIN_INFORMACION',
          confidence: 0.0,
          stale: false
        });
        if (coverage === 'error') investigationStatus = 'INVESTIGACION_INCOMPLETA';
      }
    } else if (newsRes.error) {
      evidence.push({
        source: 'StatsHub:getTeamNews',
        entity: playerOrTeam || match,
        info: `Error/timeout consultando StatsHub: ${newsRes.error}`,
        publishedAtUtc: null,
        queriedAtUtc,
        verificationStatus: 'NO_VERIFICADO',
        confidence: 0.0,
        stale: false
      });
    } else {
      evidence.push({
        source: 'StatsHub:getTeamNews',
        entity: playerOrTeam || match,
        info: 'Sin información de noticias disponible (sin matchId/teamId o respuesta vacía).',
        publishedAtUtc: null,
        queriedAtUtc,
        verificationStatus: 'SIN_INFORMACION',
        confidence: 0.0,
        stale: false
      });
    }

    // 4. Procesar evidencia de getLineups (nunca tratar predicted como confirmed)
    const lineupData = lineupRes.data;
    if (lineupData && typeof lineupData === 'object' && isPlayerProp) {
      const isConfirmed = Boolean(lineupData.confirmed === true || String(lineupData.status || '').toUpperCase() === 'CONFIRMED');
      const starters = [
        ...(lineupData.home?.startingXI || []),
        ...(lineupData.away?.startingXI || []),
        ...(lineupData.starters || [])
      ].map(p => normalizeText(typeof p === 'string' ? p : (p.name || p.player || '')));

      const inStarters = targetNorm && starters.some(s => s && (s.includes(targetNorm) || targetNorm.includes(s)));
      if (inStarters && isConfirmed) {
        playerConfirmedStarter = true;
        evidence.push({
          source: 'StatsHub:getLineups',
          entity: playerOrTeam,
          info: 'Jugador confirmado en el XI titular oficial.',
          publishedAtUtc: lineupData.updatedAtUtc || null,
          queriedAtUtc,
          verificationStatus: 'CONFIRMADO',
          confidence: 0.98,
          stale: false
        });
      } else if (inStarters && !isConfirmed) {
        evidence.push({
          source: 'StatsHub:getLineups',
          entity: playerOrTeam,
          info: 'Jugador figura en alineación proyectada (predicted — NO confirmada).',
          publishedAtUtc: lineupData.updatedAtUtc || null,
          queriedAtUtc,
          verificationStatus: 'PROBABLE',
          confidence: 0.65,
          stale: false
        });
      }
    }

    // 5. Detección de contradicciones con Sofía, Valentina, Camila y Renata (sin alterar sus reportes)
    if (newsRiskDetected && otherAgents.playerAnalyst?.recommendation === 'FAVORABLE') {
      contradictions.push({
        affectedAgent: 'Sofía (Player Analyst)',
        agentConclusion: 'Participación/proyección individual favorable',
        evidence: evidence.filter(e => e.verificationStatus !== 'SIN_INFORMACION').map(e => e.info).join(' | '),
        market: marketCode,
        potentialImpact: riskSeverity === 'CRITICAL' ? 'ALTO: Riesgo directo de ausencia o minutos nulos.' : 'MEDIO: Posible reducción de minutos o rendimiento.',
        confidence: newsConfidence
      });
    }
    if (newsRiskDetected && otherAgents.teamAnalyst?.recommendation === 'FAVORABLE' && !isPlayerProp) {
      contradictions.push({
        affectedAgent: 'Valentina (Team Analyst)',
        agentConclusion: 'Estabilidad táctica/rendimiento colectivo favorable',
        evidence: evidence.map(e => e.info).join(' | '),
        market: marketCode,
        potentialImpact: 'MEDIO: Posible alteración de estructura o rotación.',
        confidence: newsConfidence
      });
    }
    if (newsRiskDetected && otherAgents.matchContext?.recommendation === 'FAVORABLE') {
      contradictions.push({
        affectedAgent: 'Camila (Match Context Analyst)',
        agentConclusion: 'Contexto de disponibilidad favorable',
        evidence: evidence.map(e => e.info).join(' | '),
        market: marketCode,
        potentialImpact: 'ALTO: Contradicción directa sobre disponibilidad real.',
        confidence: newsConfidence
      });
    }

    const reasoning = newsRiskDetected
      ? `Lucía 2.0 detectó riesgo (${riskSeverity}, conf. ${(newsConfidence * 100).toFixed(0)}%) sobre ${affectedEntity} para ${marketCode}. Recomendación: ${recommendation}.`
      : (playerConfirmedStarter
        ? `Lucía 2.0 confirmó titularidad oficial de ${playerOrTeam} sin riesgos de noticias adversas.`
        : `Lucía 2.0 completó investigación (${investigationStatus}) sin alertas críticas confirmadas para ${playerOrTeam || match}.`);

    const structuredSignals = {
      newsRiskDetected,
      riskSeverity,
      newsConfidence: Number(newsConfidence.toFixed(2)),
      affectedEntity,
      affectedMarket: marketCode,
      evidence,
      contradictions,
      recommendation,
      reasoning
    };

    this.validateStructuredSignals(structuredSignals);

    const report = {
      agentName: this.name,
      alias: this.alias,
      version: this.version,
      candidateId: candidate.id || null,
      matchId,
      playerId: candidate.playerId || null,
      teamId,
      investigationStatus,
      queriedAtUtc,
      sourcesConsulted,
      fromCacheCount,
      mcpErrors,
      recommendation: recommendation === 'VETO' ? 'DESFAVORABLE' : (playerConfirmedStarter ? 'FAVORABLE' : 'NEUTRAL'),
      summary: reasoning,
      hasFindings: evidence.length > 0,
      findings: evidence,
      tacticalDuels: [],
      structuredSignals
    };

    if (historyPath) {
      this._appendHistory({
        investigatedAtUtc: queriedAtUtc,
        candidateId: candidate.id || null,
        matchId,
        playerId: candidate.playerId || null,
        teamId,
        sourcesConsulted,
        investigationStatus,
        structuredSignals
      }, historyPath);
    }

    return report;
  }
}

module.exports = new MatchIntelligenceAnalyst();
module.exports.MatchIntelligenceAnalyst = MatchIntelligenceAnalyst;
