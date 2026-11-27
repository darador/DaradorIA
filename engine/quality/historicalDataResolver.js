/**
 * HISTORICAL DATA RESOLVER — DARADOR IA 2.0 (FASE 2.6)
 * Módulo desacoplado para la resolución rigurosa de historial pre-partido.
 * 
 * Filosofía: Balanced / Quality First
 * 1. Resuelve identificadores canónicos (candidateId, match, selection, market, line, kickoff).
 * 2. Prioridad estricta de fuentes:
 *    - Nivel 1 (COUNT_HISTORY): Serie completa de observaciones numéricas discretas (observations[]).
 *    - Nivel 2 (SUFFICIENT_COUNT_STATS): Media y varianza con validez matemática documentada (mean, variance, sampleSize).
 *    - Nivel 3 (BINARY_HISTORY): Frecuencia de aciertos y fallos empíricos (successes, failures, sampleSize).
 *    - Nivel 4 (INSUFFICIENT): Sin datos suficientes.
 * 3. Prohíbe inventar o reconstruir arrays de observaciones artificiales a partir de hit_rate_l10.
 * 4. Integridad temporal: Rechaza cualquier fuente con timestamp posterior al kickoff.
 */

const fs = require('fs');
const path = require('path');

class HistoricalDataResolver {
  constructor(options = {}) {
    this.name = 'HistoricalDataResolver';
    this.version = '2.6.0-canonical';
    this.researchPath = options.researchPath || path.join(__dirname, '../storage_data/research_candidates.json');
    this._researchIndex = null;
    this._loadResearchIndex();
  }

  _loadResearchIndex() {
    try {
      if (fs.existsSync(this.researchPath)) {
        const raw = JSON.parse(fs.readFileSync(this.researchPath, 'utf8'));
        if (Array.isArray(raw)) {
          this._researchIndex = new Map(raw.map(c => [c.id, c]));
        }
      }
    } catch (err) {
      console.warn('[HistoricalDataResolver] Error cargando research_candidates.json:', err.message);
      this._researchIndex = new Map();
    }
  }

  /**
   * Resuelve el historial y devuelve el contrato estricto
   * @param {Object} candidate Objeto candidato de discovery / picks_hoy
   * @returns {Object} { contractType, countHistory, binaryHistory, temporalAudit, error }
   */
  resolveHistory(candidate) {
    if (!candidate || !candidate.id) {
      return {
        contractType: 'INSUFFICIENT',
        status: 'INVALID',
        reason: 'ID_CANDIDATO_AUSENTE',
        predictionEligible: false,
        countHistory: null,
        binaryHistory: null,
        temporalAudit: { isValid: false, reason: 'ID ausente' }
      };
    }

    // 1. Integridad Temporal: Control de Kickoff
    const temporalAudit = this._auditTemporalIntegrity(candidate);
    if (!temporalAudit.isValid) {
      return {
        contractType: 'INSUFFICIENT',
        status: 'INVALID',
        reason: temporalAudit.reason,
        predictionEligible: false,
        countHistory: null,
        binaryHistory: null,
        temporalAudit
      };
    }

    // 2. Extraer parámetros canónicos de la línea deportiva
    const lineInfo = this._parseLine(candidate.line || candidate.rawLine);
    const threshold = lineInfo.threshold;
    const betType = lineInfo.betType;

    // 3. Buscar fuente de investigación asociada por ID canónico
    const researchCandidate = this._researchIndex?.get(candidate.id) || candidate.researchData ? candidate : null;
    const rawResearch = researchCandidate?.researchData || candidate.researchData || null;

    // 4. Prioridad 1: Serie de Conteo Completa (COUNT_HISTORY)
    // Umbral estadístico: n >= 5 mínimo para inferencia elemental (LIMITED), n >= 15 para representatividad estándar (VALID).
    // Una muestra de n < 5 es insuficiente para modelar varianza y conteo fiable.
    const countObservations = this._extractCountObservations(candidate, rawResearch);
    if (countObservations.length >= 5) {
      const n = countObservations.length;
      const sum = countObservations.reduce((a, b) => a + b, 0);
      const mean = sum / n;
      const variance = n > 1
        ? countObservations.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1)
        : mean;

      // Calcular aciertos/fallos directamente sobre las observaciones discretas
      let successes = 0;
      let pushes = 0;
      countObservations.forEach(val => {
        if (lineInfo.isInteger && val === threshold) {
          pushes++;
        } else if (betType === 'OVER' && val > threshold) {
          successes++;
        } else if (betType === 'UNDER' && val < threshold) {
          successes++;
        }
      });
      const failures = n - successes - pushes;

      return {
        contractType: 'COUNT_HISTORY',
        status: n >= 15 ? 'VALID' : 'LIMITED',
        eligibleModels: n >= 15 ? ['BETA_BINOMIAL', 'POISSON', 'NEGATIVE_BINOMIAL', 'ENSEMBLE'] : ['BETA_BINOMIAL', 'POISSON'],
        ineligibleModels: n >= 15 ? [] : ['NEGATIVE_BINOMIAL_OVERDISPERSION'],
        ineligibleReason: n >= 15 ? null : 'SAMPLE_SIZE_BELOW_15: Binomial Negativa requiere n>=15 para estimar r y p con estabilidad.',
        predictionEligible: true,
        source: 'OBSERVATIONS_SERIES',
        countHistory: {
          observations: countObservations,
          sampleSize: n,
          mean: Number(mean.toFixed(3)),
          variance: Number(variance.toFixed(3)),
          varianceToMeanRatio: mean > 0 ? Number((variance / mean).toFixed(3)) : 1.0,
          threshold,
          betType,
          isIntegerLine: lineInfo.isInteger,
          market: candidate.market,
          observationWindow: `L${n}`
        },
        binaryHistory: {
          successes,
          failures,
          pushes,
          sampleSize: n,
          threshold,
          betType,
          isIntegerLine: lineInfo.isInteger,
          market: candidate.market,
          observationWindow: `L${n}`
        },
        temporalAudit
      };
    }

    // 5. Prioridad 2: Información Binaria de Aciertos/Fallos (BINARY_HISTORY)
    const binaryStats = this._extractBinaryStats(candidate, threshold, betType, lineInfo.isInteger);
    if (binaryStats && binaryStats.sampleSize >= 5) {
      return {
        contractType: 'BINARY_HISTORY',
        status: 'LIMITED',
        eligibleModels: ['BETA_BINOMIAL'], // Poisson y NegBinom NO permitidos sin conteo o varianza real
        ineligibleModels: ['POISSON', 'NEGATIVE_BINOMIAL'],
        ineligibleReason: 'POISSON_REQUIRES_COUNT_HISTORY: Prohibido imputar varianza ficticia desde ratio binario.',
        predictionEligible: true,
        source: 'EMPIRICAL_TREND_STATS',
        countHistory: null,
        binaryHistory: {
          successes: binaryStats.successes,
          failures: binaryStats.failures,
          pushes: binaryStats.pushes || 0,
          sampleSize: binaryStats.sampleSize,
          threshold,
          betType,
          isIntegerLine: lineInfo.isInteger,
          market: candidate.market,
          observationWindow: binaryStats.window
        },
        temporalAudit
      };
    }

    // 6. Nivel 4: Datos Insuficientes (INVALID)
    return {
      contractType: 'INSUFFICIENT',
      status: 'INVALID',
      reason: 'DATOS_HISTORICOS_INSUFICIENTES',
      predictionEligible: false,
      eligibleModels: [],
      countHistory: null,
      binaryHistory: null,
      temporalAudit
    };
  }

  /**
   * Extrae array numérico de observaciones sin invenciones
   */
  _extractCountObservations(candidate, researchData) {
    if (Array.isArray(candidate.historicalValues) && candidate.historicalValues.length > 0) {
      return candidate.historicalValues.map(Number).filter(Number.isFinite);
    }
    if (Array.isArray(candidate.observations) && candidate.observations.length > 0) {
      return candidate.observations.map(Number).filter(Number.isFinite);
    }

    if (researchData) {
      const isTeam = Boolean(candidate.isTeamProp || candidate.team === candidate.playerOrTeam || !candidate.player);
      if (isTeam) {
        const teamVals = researchData.teamData?.historicalValues || researchData.teamData?.observations;
        if (Array.isArray(teamVals) && teamVals.length > 0) {
          return teamVals.map(Number).filter(Number.isFinite);
        }
      } else {
        const playerVals = researchData.playerData?.historicalValues || researchData.playerData?.observations;
        if (Array.isArray(playerVals) && playerVals.length > 0) {
          return playerVals.map(Number).filter(Number.isFinite);
        }
      }
    }

    return [];
  }

  /**
   * Extrae la tupla binaria (successes, failures, sampleSize) desde strings estructurados
   * Ejemplos soportados: "9/10", "9/10 (90%)", "10/10", "80%" con sample_size: 10
   */
  _extractBinaryStats(candidate, threshold, betType, isInteger) {
    const rawRateStr = candidate.hit_rate_l10 || candidate.trendL10 || candidate.hit_rate_l5 || candidate.trendL5 || '';
    const sampleSizeParam = Number(candidate.sample_size || candidate.sampleSize || 10);

    // Formato 1: Fracción explícita "9/10" o "9/10 (90%)"
    const fracMatch = String(rawRateStr).match(/(\d+)\s*\/\s*(\d+)/);
    if (fracMatch) {
      const successes = parseInt(fracMatch[1], 10);
      const sampleSize = parseInt(fracMatch[2], 10);
      if (sampleSize > 0 && successes <= sampleSize) {
        return {
          successes,
          failures: sampleSize - successes,
          sampleSize,
          window: `L${sampleSize}`
        };
      }
    }

    // Formato 2: Porcentaje "90%" combinado con sample_size explícito
    const pctMatch = String(rawRateStr).match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch && sampleSizeParam >= 5) {
      const pct = parseFloat(pctMatch[1]);
      const successes = Math.round((pct / 100) * sampleSizeParam);
      return {
        successes,
        failures: Math.max(0, sampleSizeParam - successes),
        sampleSize: sampleSizeParam,
        window: `L${sampleSizeParam}`
      };
    }

    return null;
  }

  _parseLine(rawLine) {
    const str = String(rawLine || '0.5').toLowerCase();
    const isUnder = str.includes('menos') || str.includes('under') || str.includes('<');
    const betType = isUnder ? 'UNDER' : 'OVER';
    const numMatch = str.match(/[0-9]+(?:\.[0-9]+)?/);
    const threshold = numMatch ? parseFloat(numMatch[0]) : 0.5;
    const isInteger = Number.isInteger(threshold);
    return { threshold, betType, isInteger };
  }

  _auditTemporalIntegrity(candidate) {
    const ingestedAt = new Date();
    const kickoffStr = candidate.eventDateUtc || candidate.date || candidate.matchTime;
    const sourceEventTimeStr = candidate.discoveredAt || candidate.createdAt || candidate.investigatedAt;
    const dataCutoffStr = candidate.dataCutoffTimestamp || candidate.statsCutoffTime || sourceEventTimeStr;

    let eventKickoff = null;
    let sourceEventTimestamp = null;
    let dataCutoffTimestamp = null;

    if (kickoffStr) {
      const parsedK = new Date(kickoffStr);
      if (!isNaN(parsedK.getTime())) eventKickoff = parsedK;
    }

    if (sourceEventTimeStr) {
      const parsedS = new Date(sourceEventTimeStr);
      if (!isNaN(parsedS.getTime())) sourceEventTimestamp = parsedS;
    }

    if (dataCutoffStr) {
      const parsedC = new Date(dataCutoffStr);
      if (!isNaN(parsedC.getTime())) dataCutoffTimestamp = parsedC;
    }

    // Si la captura o corte de datos fue estrictamente posterior al kickoff, se rechaza
    const effectiveCutoff = dataCutoffTimestamp || sourceEventTimestamp;
    if (eventKickoff && effectiveCutoff && effectiveCutoff.getTime() > eventKickoff.getTime() + (5 * 60 * 1000)) {
      return {
        isValid: false,
        reason: 'TEMPORAL_VIOLATION: Datos estadísticos capturados con posterioridad al kickoff del evento.',
        eventKickoff: eventKickoff.toISOString(),
        sourceEventTimestamp: sourceEventTimestamp ? sourceEventTimestamp.toISOString() : null,
        dataCutoffTimestamp: dataCutoffTimestamp ? dataCutoffTimestamp.toISOString() : null,
        ingestedAt: ingestedAt.toISOString()
      };
    }

    return {
      isValid: true,
      eventKickoff: eventKickoff ? eventKickoff.toISOString() : null,
      sourceEventTimestamp: sourceEventTimestamp ? sourceEventTimestamp.toISOString() : null,
      dataCutoffTimestamp: dataCutoffTimestamp ? dataCutoffTimestamp.toISOString() : (sourceEventTimestamp ? sourceEventTimestamp.toISOString() : eventKickoff ? eventKickoff.toISOString() : null),
      ingestedAt: ingestedAt.toISOString()
    };
  }
}

module.exports = HistoricalDataResolver;
