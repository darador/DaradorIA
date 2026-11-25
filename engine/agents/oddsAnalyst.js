/**
 * AGENT 4: ODDS ANALYST (RENATA 2.0)
 * Analiza el mercado de apuestas real mediante StatsHub MCP:
 * - getMatchOdds(matchId, markets, line): mejor cuota, promedio, cantidad de casas (books), frescura (ageMinutes) y priced.
 * - getMatchOdds(matchId, movement: true, ...): movimiento de apertura vs actual (CLV / steam).
 * - getOutliers(matchId, market, line): discrepancia real entre casas (sin confundir discrepancia con valor del modelo).
 * - Cálculo de consenso sin margen (no-vig) cuando hay cuotas de todos los resultados del mercado.
 *
 * No altera probabilidades del modelo ni el umbral EV >= +7%. Mantiene compatibilidad total con formato legado.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min para cuotas
const STALE_ODDS_MINUTES = 120; // > 2h sin actualizar se marca como cuota potencialmente desactualizada
const DEFAULT_HISTORY_PATH = path.join(__dirname, '..', 'storage_data', 'renata_odds_history.json');

const VALID_SEVERITIES = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
const VALID_RECOMMENDATIONS = new Set(['FAVORABLE', 'NEUTRAL', 'PRECAUCION', 'DESFAVORABLE']);

function computeNoVigProbabilities(oddsArray) {
  const valid = (oddsArray || []).map(Number).filter(o => Number.isFinite(o) && o > 1.0);
  if (valid.length < 2) return null;
  const rawProbs = valid.map(o => 1 / o);
  const sum = rawProbs.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return {
    overroundPct: Number(((sum - 1) * 100).toFixed(2)),
    noVigProbs: rawProbs.map(p => Number((p / sum).toFixed(4)))
  };
}

class OddsAnalyst {
  constructor() {
    this.name = 'Odds Analyst';
    this.alias = 'Renata';
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
      throw new Error('Renata 2.0: structuredSignals debe ser un objeto');
    }
    if (typeof signals.oddsRiskDetected !== 'boolean') {
      throw new Error('Renata 2.0: oddsRiskDetected debe ser booleano');
    }
    if (!VALID_SEVERITIES.has(signals.riskSeverity)) {
      throw new Error(`Renata 2.0: riskSeverity inválido (${signals.riskSeverity})`);
    }
    if (typeof signals.marketConfidence !== 'number' || signals.marketConfidence < 0 || signals.marketConfidence > 1) {
      throw new Error(`Renata 2.0: marketConfidence fuera de [0, 1] (${signals.marketConfidence})`);
    }
    if (!VALID_RECOMMENDATIONS.has(signals.recommendation)) {
      throw new Error(`Renata 2.0: recommendation inválida (${signals.recommendation})`);
    }
    if (!Array.isArray(signals.evidence)) {
      throw new Error('Renata 2.0: evidence debe ser un array');
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
   * Evalúa cuotas, consenso no-vig, frescura, liquidez y movimiento CLV.
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
    const bookmakerOdds = Number(candidate.bookmakerOdds || candidate.odds || 1.75);
    const fairOdds = Number(prediction?.fairOdds || (1 / (prediction?.pProjected || 0.60)));
    const evPercentage = Number(prediction?.evPercentage ?? 0);
    const legacyOutlier = candidate.rawSourceData?.edge ? candidate.rawSourceData : null;

    const observedDiscrepancies = [];
    const risks = [];
    const advantages = [];
    const evidence = [];
    const sourcesConsulted = [];
    const mcpErrors = [];
    const counters = { fromCacheCount: 0, mcpCallsCount: 0 };

    let bestOdds = bookmakerOdds;
    let averageOdds = null;
    let booksCount = null;
    let ageMinutes = null;
    let isPriced = true;
    let noVigConsensus = null;
    let clvMovement = null;
    let outlierEdgePct = null;

    // 1. Consulta real a StatsHub: getMatchOdds
    if (mcpClient && matchId) {
      const oddsArgs = { matchId: String(matchId) };
      if (candidate.market) oddsArgs.markets = [String(candidate.market)];
      if (Number.isFinite(Number(candidate.line))) oddsArgs.line = Number(candidate.line);

      const res = await this._callMcp(
        mcpClient,
        'getMatchOdds',
        oddsArgs,
        `matchOdds:${matchId}:${candidate.market || 'all'}:${candidate.line || ''}`,
        nowMs,
        ttlMs,
        counters
      );
      if (res.ok && res.data) {
        sourcesConsulted.push('statshub:getMatchOdds');
        const d = res.data;
        if (d.priced === false) {
          isPriced = false;
          risks.push('Mercado aún no cotizado por las casas (priced: false).');
          evidence.push({ source: 'statshub:getMatchOdds', classification: 'SIN_INFORMACION', summary: 'Mercado sin cotización abierta aún (priced: false).' });
        } else {
          if (d.best && Number.isFinite(Number(d.best.odds))) {
            bestOdds = Number(d.best.odds);
            if (Number.isFinite(Number(d.best.ageMinutes))) ageMinutes = Number(d.best.ageMinutes);
          }
          if (Number.isFinite(Number(d.average))) averageOdds = Number(d.average);
          if (Number.isFinite(Number(d.books))) booksCount = Number(d.books);

          if (Array.isArray(d.marketOutcomesOdds) && d.marketOutcomesOdds.length >= 2) {
            noVigConsensus = computeNoVigProbabilities(d.marketOutcomesOdds);
          }

          evidence.push({
            source: 'statshub:getMatchOdds',
            classification: 'CONFIRMADO',
            summary: `Mejor cuota @${bestOdds.toFixed(2)} (promedio ${averageOdds ? '@' + averageOdds.toFixed(2) : 'N/D'}, ${booksCount ?? 'N/D'} casas, antigüedad ${ageMinutes ?? 'N/D'} min).`
          });
        }
      } else if (res.error) {
        mcpErrors.push({ tool: 'getMatchOdds', error: res.error });
      }

      // 2. Movimiento de cuota (CLV / steam) si está disponible
      if (isPriced && typeof mcpClient.getMatchOdds === 'function' && candidate.movementMarket) {
        const movRes = await this._callMcp(
          mcpClient,
          'getMatchOdds',
          { matchId: String(matchId), movement: true, movementMarket: candidate.movementMarket, selection: candidate.selectionSide || 'over' },
          `matchOddsMov:${matchId}:${candidate.movementMarket}:${candidate.selectionSide || 'over'}`,
          nowMs,
          ttlMs,
          counters
        );
        if (movRes.ok && movRes.data && Number.isFinite(Number(movRes.data.openingOdds)) && Number.isFinite(Number(movRes.data.currentOdds))) {
          sourcesConsulted.push('statshub:getMatchOdds(movement)');
          const opening = Number(movRes.data.openingOdds);
          const current = Number(movRes.data.currentOdds);
          const deltaPct = Number((((current - opening) / opening) * 100).toFixed(2));
          clvMovement = {
            openingOdds: opening,
            currentOdds: current,
            deltaPct,
            direction: current < opening ? 'STEAM_FAVORABLE' : (current > opening ? 'DRIFT_ADVERSO' : 'ESTABLE')
          };
          evidence.push({
            source: 'statshub:getMatchOdds(movement)',
            classification: 'CONFIRMADO',
            summary: `Movimiento de cuota: apertura @${opening.toFixed(2)} → actual @${current.toFixed(2)} (${clvMovement.direction}).`
          });
        } else if (movRes.error) {
          mcpErrors.push({ tool: 'getMatchOdds(movement)', error: movRes.error });
        }
      }

      // 3. Discrepancias entre casas: getOutliers (solo discrepancia de precio, no valor de modelo)
      if (isPriced && typeof mcpClient.getOutliers === 'function') {
        const outRes = await this._callMcp(
          mcpClient,
          'getOutliers',
          { matchId: String(matchId) },
          `outliers:${matchId}`,
          nowMs,
          ttlMs,
          counters
        );
        if (outRes.ok && Array.isArray(outRes.data?.rows) && outRes.data.rows.length > 0) {
          sourcesConsulted.push('statshub:getOutliers');
          const row = outRes.data.rows[0];
          if (Number.isFinite(Number(row.edge))) {
            outlierEdgePct = Number((Number(row.edge) * 100).toFixed(1));
            observedDiscrepancies.push(`Discrepancia entre casas (no valor de modelo): @${row.bestOdds} vs promedio @${row.averageOdds} (+${outlierEdgePct}%).`);
          }
        } else if (outRes.error) {
          mcpErrors.push({ tool: 'getOutliers', error: outRes.error });
        }
      }
    }

    // 4. Análisis de Cuota Justa vs Cuota de Mercado
    if (bookmakerOdds > fairOdds) {
      advantages.push(`Cuota disponible (${bookmakerOdds}) supera la cuota justa estimada (${fairOdds.toFixed(2)}), generando un EV positivo del +${evPercentage}%.`);
    } else {
      risks.push(`Cuota insuficiente: la cuota (${bookmakerOdds}) no cubre la probabilidad real proyectada (cuota justa: ${fairOdds.toFixed(2)}).`);
    }

    // 5. Discrepancia legada si no vino de MCP
    if (legacyOutlier && observedDiscrepancies.length === 0) {
      const avgOdds = legacyOutlier.averageOdds || bookmakerOdds;
      const edge = legacyOutlier.edge ? (legacyOutlier.edge * 100).toFixed(1) : '0';
      observedDiscrepancies.push(`Discrepancia de mercado detectada: precio de ${bookmakerOdds} vs promedio de otras casas (${avgOdds}) [Divergencia: +${edge}%].`);
    }

    // 6. Controles de calidad de cuota (frescura, liquidez, drift)
    let oddsRiskDetected = false;
    let riskSeverity = 'NONE';

    if (!isPriced) {
      oddsRiskDetected = true;
      riskSeverity = 'HIGH';
    }
    if (ageMinutes != null && ageMinutes > STALE_ODDS_MINUTES) {
      risks.push(`Cuota potencialmente desactualizada (${ageMinutes} min sin refrescar).`);
      oddsRiskDetected = true;
      if (riskSeverity === 'NONE') riskSeverity = 'MEDIUM';
    }
    if (booksCount != null && booksCount < 2) {
      risks.push(`Liquidez baja: solo ${booksCount} casa cotizando el mercado.`);
      oddsRiskDetected = true;
      if (riskSeverity === 'NONE') riskSeverity = 'LOW';
    }
    if (clvMovement && clvMovement.direction === 'DRIFT_ADVERSO' && clvMovement.deltaPct >= 8) {
      risks.push(`Drift adverso de mercado (+${clvMovement.deltaPct}% desde apertura).`);
      oddsRiskDetected = true;
      if (riskSeverity === 'NONE') riskSeverity = 'MEDIUM';
    } else if (clvMovement && clvMovement.direction === 'STEAM_FAVORABLE') {
      advantages.push(`Steam favorable detectado (cuota bajó de @${clvMovement.openingOdds.toFixed(2)} a @${clvMovement.currentOdds.toFixed(2)}).`);
    }

    // 7. Rango operativo (preservando compatibilidad con pruebas legadas)
    if (bookmakerOdds >= 1.65 && bookmakerOdds <= 2.20) {
      advantages.push(`Cuota en rango óptimo de balance rentabilidad/varianza (${bookmakerOdds}).`);
    } else if (bookmakerOdds > 2.25) {
      risks.push(`Cuota elevada (${bookmakerOdds}), mayor exposición a varianza a corto plazo.`);
    }

    // 8. Potencial de CLV
    let clvPotential = 'MODERADO';
    if (clvMovement && clvMovement.direction === 'STEAM_FAVORABLE') {
      clvPotential = 'ALTO: steam favorable confirmado desde apertura.';
    } else if (evPercentage >= 15 && (legacyOutlier || outlierEdgePct != null)) {
      clvPotential = 'ALTO: la cuota actual ofrece valor prematuro antes del ajuste de mercado.';
    } else if (evPercentage < 8) {
      clvPotential = 'BAJO: margen muy ajustado respecto a la línea de cierre probable.';
    }

    const investigationStatus = mcpErrors.length > 0
      ? 'INVESTIGACION_INCOMPLETA'
      : (sourcesConsulted.length > 0 ? 'COMPLETA' : 'SOLO_CONTEXTO_LOCAL');

    // 9. Recomendación y confianza
    let recommendation = 'NEUTRAL';
    let confidence = 0.80;

    if (mcpErrors.length > 0) {
      recommendation = 'NEUTRAL';
      confidence = 0.50;
    } else if (!isPriced) {
      recommendation = 'DESFAVORABLE';
      confidence = 0.85;
    } else if (risks.length >= 1) {
      recommendation = (bookmakerOdds <= fairOdds) ? 'DESFAVORABLE' : 'PRECAUCION';
      confidence = 0.70;
    } else if (advantages.length >= 2 && risks.length === 0) {
      recommendation = 'FAVORABLE';
      confidence = 0.90;
    } else if (advantages.length >= 1 && risks.length === 0) {
      recommendation = 'FAVORABLE';
      confidence = 0.84;
    }

    const reasoning = mcpErrors.length > 0
      ? `Renata 2.0: investigación incompleta por error en StatsHub (${mcpErrors.map(e => e.tool).join(', ')}).`
      : `Renata 2.0 (${investigationStatus}): cuota @${bookmakerOdds.toFixed(2)} vs justa @${fairOdds.toFixed(2)} (EV +${evPercentage}%).${noVigConsensus ? ` Overround ${noVigConsensus.overroundPct}%.` : ''}`;

    const structuredSignals = {
      oddsRiskDetected,
      riskSeverity,
      marketConfidence: Number(confidence.toFixed(2)),
      isPriced,
      bestOdds: Number(bestOdds.toFixed(2)),
      averageOdds: averageOdds != null ? Number(averageOdds.toFixed(2)) : null,
      booksCount,
      ageMinutes,
      noVigConsensus,
      clvMovement,
      outlierEdgePct,
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
      investigationStatus,
      queriedAtUtc,
      sourcesConsulted,
      fromCacheCount: counters.fromCacheCount,
      mcpCallsCount: counters.mcpCallsCount,
      mcpErrors,
      marketAnalysis: `Análisis de mercado para ${candidate.market || ''} @ ${bookmakerOdds} (${candidate.bookmaker || 'bet365'}). Cuota justa: ${fairOdds.toFixed(2)}. EV: +${evPercentage}%.`,
      referenceOdds: bookmakerOdds,
      bestOdds: Number(bestOdds.toFixed(2)),
      fairOdds: Number(fairOdds.toFixed(2)),
      observedDiscrepancies,
      risks,
      clvAssessment: clvPotential,
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

module.exports = new OddsAnalyst();
module.exports.OddsAnalyst = OddsAnalyst;
module.exports.computeNoVigProbabilities = computeNoVigProbabilities;
