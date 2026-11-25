/**
 * AGENT 3: MATCH CONTEXT ANALYST (CAMILA 2.0)
 * Investiga el contexto deportivo real mediante StatsHub MCP:
 * - getMatchDetails(matchId): sede, kickoff, estado y árbitro designado.
 * - getReferee(refereeId, recentGames: 10): promedios reales de faltas, amarillas, rojas y penales.
 * - getLineups(matchId): estado real de alineación (confirmed vs predicted; nunca confunde proyectada con oficial).
 *
 * Mantiene compatibilidad total con formato legado (candidate.researchData) y no altera modelos predictivos.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const DEFAULT_HISTORY_PATH = path.join(__dirname, '..', 'storage_data', 'camila_context_history.json');

const REFEREE_SENSITIVE_MARKETS = new Set([
  'player_fouls', 'fouls', 'fouls_committed', 'player_fouls_committed',
  'player_fouls_won', 'fouls_won',
  'player_tackles', 'tackles',
  'cards', 'yellow_cards', 'player_cards', 'team_cards', 'total_cards'
]);

const VALID_SEVERITIES = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
const VALID_RECOMMENDATIONS = new Set(['FAVORABLE', 'NEUTRAL', 'PRECAUCION', 'DESFAVORABLE']);

function normalizeMarketCode(market) {
  return String(market || '').toLowerCase().trim().replace(/\s+/g, '_');
}

function isRefereeSensitiveMarket(market) {
  const norm = normalizeMarketCode(market);
  if (REFEREE_SENSITIVE_MARKETS.has(norm)) return true;
  return norm.includes('foul') || norm.includes('falta') || norm.includes('card') || norm.includes('tarjet') || norm.includes('tackle') || norm.includes('entrada');
}

function isUnderSelection(candidate) {
  const side = String(candidate.side || candidate.selection || candidate.line || '').toLowerCase();
  return side.includes('under') || side.includes('menos de');
}

class MatchContextAnalyst {
  constructor() {
    this.name = 'Match Context Analyst';
    this.alias = 'Camila';
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
      history.push({
        version: history.length + 1,
        agentVersion: this.version,
        ...entry
      });
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    } catch {}
  }

  validateStructuredSignals(signals) {
    if (!signals || typeof signals !== 'object') {
      throw new Error('Camila 2.0: structuredSignals debe ser un objeto');
    }
    if (typeof signals.contextRiskDetected !== 'boolean') {
      throw new Error('Camila 2.0: contextRiskDetected debe ser booleano');
    }
    if (!VALID_SEVERITIES.has(signals.riskSeverity)) {
      throw new Error(`Camila 2.0: riskSeverity inválido (${signals.riskSeverity})`);
    }
    if (typeof signals.contextConfidence !== 'number' || signals.contextConfidence < 0 || signals.contextConfidence > 1) {
      throw new Error(`Camila 2.0: contextConfidence fuera de [0, 1] (${signals.contextConfidence})`);
    }
    if (!VALID_RECOMMENDATIONS.has(signals.recommendation)) {
      throw new Error(`Camila 2.0: recommendation inválida (${signals.recommendation})`);
    }
    if (!Array.isArray(signals.evidence)) {
      throw new Error('Camila 2.0: evidence debe ser un array');
    }
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

  /**
   * Evalúa el contexto global del encuentro, alineación y árbitro real.
   * @param {Object} candidate
   * @param {Object} prediction
   * @param {Object} [options] - { mcpClient, nowMs, cacheTtlMs, persistHistory, historyPath }
   */
  async analyze(candidate = {}, prediction = {}, options = {}) {
    const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
    const queriedAtUtc = new Date(nowMs).toISOString();
    const ttlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
    const mcpClient = options.mcpClient || global.statshubClient || null;
    const persistHistory = options.persistHistory !== false && Boolean(mcpClient);
    const historyPath = persistHistory ? (options.historyPath || DEFAULT_HISTORY_PATH) : null;

    const matchId = candidate.matchId || candidate.fixtureId || null;
    const market = candidate.market || '';
    const marketCode = normalizeMarketCode(market);
    const refSensitive = isRefereeSensitiveMarket(market);
    const isUnder = isUnderSelection(candidate);
    const isTeamProp = candidate.isTeamProp === true;

    const research = candidate.researchData || {};
    const legacyLineup = research.lineupData || {};
    const legacyReferee = research.refereeData || null;

    const advantages = [];
    const rotationRisks = [];
    const confirmedAbsences = [];
    const probableAbsences = [];
    const evidence = [];
    const sourcesConsulted = [];
    const mcpErrors = [];
    const counters = { fromCacheCount: 0, mcpCallsCount: 0 };

    let venue = candidate.venue || null;
    let kickoffUtc = candidate.kickoffUtc || null;
    let lineupStatus = 'NO_DISPONIBLE';
    let isConfirmedLineup = false;
    let refereeProfile = null;
    let refereeCoverage = 'SIN_DATOS';

    // 1. Consulta real a StatsHub: getMatchDetails
    let matchDetailsData = null;
    if (mcpClient && matchId) {
      const res = await this._callMcp(
        mcpClient,
        'getMatchDetails',
        { matchId: String(matchId) },
        `matchDetails:${matchId}`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getMatchDetails');
        matchDetailsData = res.data;
        if (res.data.venue) venue = typeof res.data.venue === 'string' ? res.data.venue : (res.data.venue.name || venue);
        if (res.data.kickoffUtc || res.data.kickoff) kickoffUtc = res.data.kickoffUtc || res.data.kickoff;
      } else if (res.error) {
        mcpErrors.push({ tool: 'getMatchDetails', error: res.error });
      }
    }

    // 2. Consulta real a StatsHub: getReferee (solo si getMatchDetails o candidate trae refereeId/nombre)
    const refIdOrName = matchDetailsData?.referee?.id
      || matchDetailsData?.referee?.name
      || (typeof matchDetailsData?.referee === 'string' ? matchDetailsData.referee : null)
      || candidate.refereeId
      || null;

    if (mcpClient && refIdOrName) {
      const res = await this._callMcp(
        mcpClient,
        'getReferee',
        { refereeId: String(refIdOrName), recentGames: 10 },
        `referee:${refIdOrName}:10`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getReferee');
        const r = res.data;
        const avgFouls = Number(r.foulsPerGame ?? r.avgFouls ?? r.matchRecords?.foulsPerGame);
        const avgYellows = Number(r.yellowCardsPerGame ?? r.cardsPerGame ?? r.avgCards ?? r.matchRecords?.cardsPerGame);
        const gamesSample = Number(r.gamesCount ?? r.recentGamesCount ?? r.matchRecords?.games ?? 0);
        refereeProfile = {
          refereeId: r.id || String(refIdOrName),
          refereeName: r.name || matchDetailsData?.referee?.name || String(refIdOrName),
          avgFouls: Number.isFinite(avgFouls) ? Number(avgFouls.toFixed(2)) : null,
          avgCards: Number.isFinite(avgYellows) ? Number(avgYellows.toFixed(2)) : null,
          gamesSample,
          source: 'statshub:getReferee'
        };
        refereeCoverage = 'CONFIRMADO';
        evidence.push({
          source: 'statshub:getReferee',
          classification: 'CONFIRMADO',
          summary: `Árbitro ${refereeProfile.refereeName}: ${refereeProfile.avgFouls ?? 'N/D'} faltas/partido, ${refereeProfile.avgCards ?? 'N/D'} tarjetas/partido (muestra: ${gamesSample || 'N/D'} partidos).`
        });
      } else if (res.error) {
        refereeCoverage = 'ERROR_MCP';
        mcpErrors.push({ tool: 'getReferee', error: res.error });
      }
    } else if (matchDetailsData && !refIdOrName) {
      refereeCoverage = 'SIN_ARBITRO_DESIGNADO';
      evidence.push({
        source: 'statshub:getMatchDetails',
        classification: 'SIN_INFORMACION',
        summary: 'Árbitro aún no designado oficialmente en StatsHub para este encuentro.'
      });
    } else if (!mcpClient && legacyReferee) {
      // Compatibilidad con formato legado (candidate.researchData.refereeData)
      refereeProfile = {
        refereeId: legacyReferee.refereeId || null,
        refereeName: legacyReferee.refereeName || 'Árbitro informado',
        avgFouls: Number.isFinite(Number(legacyReferee.avgFouls)) ? Number(legacyReferee.avgFouls) : null,
        avgCards: Number.isFinite(Number(legacyReferee.avgCards)) ? Number(legacyReferee.avgCards) : null,
        foulStrictnessRatio: legacyReferee.foulStrictnessRatio ?? null,
        favorsOvers: legacyReferee.favorsOvers,
        source: 'legacy:researchData'
      };
      refereeCoverage = 'LEGADO';
    }

    // 3. Consulta real a StatsHub: getLineups (nunca tratar predicted como confirmada)
    if (mcpClient && matchId) {
      const res = await this._callMcp(
        mcpClient,
        'getLineups',
        { matchId: String(matchId) },
        `lineups:${matchId}`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getLineups');
        const confirmed = res.data.confirmed === true || String(res.data.status || '').toUpperCase() === 'CONFIRMED';
        if (confirmed) {
          lineupStatus = 'CONFIRMADA';
          isConfirmedLineup = true;
          evidence.push({
            source: 'statshub:getLineups',
            classification: 'CONFIRMADO',
            summary: 'Planilla oficial confirmada en StatsHub (T-60).'
          });
        } else {
          lineupStatus = 'PROYECTADA';
          isConfirmedLineup = false;
          evidence.push({
            source: 'statshub:getLineups',
            classification: 'PROBABLE',
            summary: 'Alineación proyectada (predicted) en StatsHub; no cuenta como confirmación oficial T-60.'
          });
        }
      } else if (res.error) {
        mcpErrors.push({ tool: 'getLineups', error: res.error });
      }
    } else if (legacyLineup.status) {
      const st = String(legacyLineup.status).toUpperCase();
      isConfirmedLineup = st === 'CONFIRMADA' || st === 'CONFIRMADO';
      lineupStatus = isConfirmedLineup ? 'CONFIRMADA' : st;
    }

    // 4. Evaluación de Alineación
    if (isConfirmedLineup) {
      advantages.push('Alineación oficial verificada: el jugador está confirmado en el once inicial.');
    } else if (isTeamProp) {
      advantages.push('Mercado colectivo: alineación individual no compromete la selección.');
    } else {
      rotationRisks.push('Alineación previa (proyectada): aún no se cuenta con la planilla oficial del colegiado (T-60 min).');
    }

    // 5. Evaluación Arbitral (solo impacta severidad en mercados sensibles a faltas/tarjetas/entradas)
    let contextRiskDetected = false;
    let riskSeverity = 'NONE';

    if (refereeProfile) {
      const highFouls = (refereeProfile.avgFouls != null && refereeProfile.avgFouls >= 24.5)
        || (refereeProfile.avgCards != null && refereeProfile.avgCards >= 4.5)
        || refereeProfile.favorsOvers === true;
      const lowFouls = (refereeProfile.avgFouls != null && refereeProfile.avgFouls <= 19.5)
        || (refereeProfile.avgCards != null && refereeProfile.avgCards <= 3.0)
        || refereeProfile.favorsOvers === false;

      if (refSensitive) {
        if (highFouls && !isUnder) {
          advantages.push(`Árbitro favorable para ${market}: ${refereeProfile.refereeName} (${refereeProfile.avgFouls ?? 'N/D'} faltas/p, ${refereeProfile.avgCards ?? 'N/D'} tarj./p).`);
        } else if (lowFouls && !isUnder) {
          rotationRisks.push(`Árbitro permisivo para ${market}: ${refereeProfile.refereeName} (${refereeProfile.avgFouls ?? 'N/D'} faltas/p, ${refereeProfile.avgCards ?? 'N/D'} tarj./p).`);
          contextRiskDetected = true;
          riskSeverity = 'MEDIUM';
        } else if (highFouls && isUnder) {
          rotationRisks.push(`Árbitro estricto adverso para Under en ${market}: ${refereeProfile.refereeName}.`);
          contextRiskDetected = true;
          riskSeverity = 'MEDIUM';
        } else if (lowFouls && isUnder) {
          advantages.push(`Árbitro permisivo favorable para Under en ${market}: ${refereeProfile.refereeName}.`);
        }
      } else {
        // Mercado no sensible al árbitro (ej. remates, córners, 1X2): solo informativo, nunca penaliza
        if (refereeProfile.favorsOvers === true) {
          advantages.push(`Árbitro ${refereeProfile.refereeName} registrado (impacto indirecto en ${market}).`);
        }
      }
    }

    const investigationStatus = mcpErrors.length > 0
      ? 'INVESTIGACION_INCOMPLETA'
      : (sourcesConsulted.length > 0 ? 'COMPLETA' : 'SOLO_CONTEXTO_LOCAL');

    // 6. Recomendación y confianza
    let recommendation = 'NEUTRAL';
    let confidence = 0.72;

    if (mcpErrors.length > 0) {
      recommendation = 'NEUTRAL';
      confidence = 0.50;
    } else if (contextRiskDetected) {
      recommendation = 'PRECAUCION';
      confidence = 0.80;
    } else if (advantages.length >= 2 && rotationRisks.length === 0) {
      recommendation = 'FAVORABLE';
      confidence = 0.90;
    } else if (advantages.length >= 1 && rotationRisks.length === 0 && (isConfirmedLineup || isTeamProp)) {
      recommendation = 'FAVORABLE';
      confidence = 0.85;
    } else if (rotationRisks.some(r => r.includes('no se cuenta con la planilla'))) {
      recommendation = 'NEUTRAL';
      confidence = 0.70;
    }

    const reasoning = mcpErrors.length > 0
      ? `Camila 2.0: investigación incompleta por error en StatsHub (${mcpErrors.map(e => e.tool).join(', ')}).`
      : `Camila 2.0 (${investigationStatus}): alineación ${lineupStatus}${refereeProfile ? `, árbitro ${refereeProfile.refereeName}` : ', árbitro no designado/no disponible'}${venue ? `, sede ${venue}` : ''}.`;

    const structuredSignals = {
      contextRiskDetected,
      riskSeverity,
      contextConfidence: Number(confidence.toFixed(2)),
      refereeProfile,
      refereeCoverage,
      lineupStatus,
      venue,
      kickoffUtc,
      affectedMarket: marketCode,
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
      matchId,
      match: candidate.match || null,
      investigationStatus,
      queriedAtUtc,
      sourcesConsulted,
      fromCacheCount: counters.fromCacheCount,
      mcpCallsCount: counters.mcpCallsCount,
      mcpErrors,
      contextSummary: `Contexto del partido ${candidate.match || ''}. Alineación: ${lineupStatus}. ${refereeProfile ? `Árbitro: ${refereeProfile.refereeName}.` : 'Árbitro pendiente de designación.'}`,
      confirmedAbsences,
      probableAbsences,
      rotationRisks,
      advantages,
      impactAnalysis: isConfirmedLineup ? 'Bajo riesgo de rotación.' : 'Riesgo moderado a la espera de confirmación de planilla.',
      sources: sourcesConsulted.length > 0 ? sourcesConsulted : ['Contexto local del candidato'],
      confidenceScore: Number(confidence.toFixed(2)),
      recommendation,
      structuredSignals
    };

    if (historyPath) {
      this._appendHistory({
        investigatedAtUtc: queriedAtUtc,
        candidateId: candidate.id || null,
        matchId,
        sourcesConsulted,
        investigationStatus,
        structuredSignals
      }, historyPath);
    }

    return report;
  }
}

module.exports = new MatchContextAnalyst();
module.exports.MatchContextAnalyst = MatchContextAnalyst;
