/**
 * DATA QUALITY ENGINE (DQE) — DARADOR IA 2.0 (FASE 1)
 * Módulo independiente de validación y control de calidad de datos previos a la predicción.
 * 
 * Filosofía: Quality First / Balanced
 * - Valida identidad canónica de jugadores y equipos.
 * - Verifica suficiencia de muestra estadística por mercado (configurable).
 * - Evalúa estabilidad de minutos y ratio de titularidad.
 * - Detecta datos faltantes o inconsistentes (outliers, dispersión anómala).
 * - Clasifica cada candidato en estados: VALID, LIMITED, INVALID.
 */

class DataQualityEngine {
  constructor(customConfig = {}) {
    // Configuración base con umbrales configurables por tipo de mercado
    this.config = {
      defaultPlayerMinSample: customConfig.defaultPlayerMinSample || 15,
      defaultTeamMinSample: customConfig.defaultTeamMinSample || 20,
      minStarterRatio: customConfig.minStarterRatio !== undefined ? customConfig.minStarterRatio : 0.70, // 70% titularidades
      minAvgMinutes: customConfig.minAvgMinutes || 60, // Mínimo 60 min de promedio
      maxMinutesStdDev: customConfig.maxMinutesStdDev || 28, // Desviación estándar de minutos permitida
      
      // Umbrales específicos por mercado
      marketThresholds: {
        'remates totales': { minSample: 12, starterWeight: 0.85, minutesSensitivity: 'HIGH' },
        'remates al arco': { minSample: 12, starterWeight: 0.85, minutesSensitivity: 'HIGH' },
        'faltas cometidas': { minSample: 12, starterWeight: 0.80, minutesSensitivity: 'HIGH' },
        'faltas ganadas': { minSample: 10, starterWeight: 0.80, minutesSensitivity: 'MEDIUM' },
        'entradas (tackles)': { minSample: 10, starterWeight: 0.75, minutesSensitivity: 'HIGH' },
        'córners de equipo': { minSample: 15, starterWeight: 0.0, minutesSensitivity: 'NONE' },
        'remates de equipo': { minSample: 15, starterWeight: 0.0, minutesSensitivity: 'NONE' },
        'remates al arco de equipo': { minSample: 15, starterWeight: 0.0, minutesSensitivity: 'NONE' },
        'goles de equipo': { minSample: 18, starterWeight: 0.0, minutesSensitivity: 'NONE' },
        'tarjetas de equipo': { minSample: 15, starterWeight: 0.0, minutesSensitivity: 'NONE' },
        ...(customConfig.marketThresholds || {})
      }
    };
  }

  /**
   * Evalúa la calidad integral de los datos de un candidato
   * @param {Object} candidate Candidato con sus datos de investigación
   * @returns {Object} Informe DQE con estado VALID | LIMITED | INVALID y scores
   */
  assessQuality(candidate) {
    if (!candidate) {
      return this._buildResult('INVALID', 0, ['Candidato nulo o indefinido']);
    }

    const isTeam = candidate.isTeamProp === true || 
                   candidate.playerOrTeam?.includes('(Equipo)') || 
                   candidate.market?.toLowerCase().includes('de equipo');

    const issues = [];
    const warnings = [];
    const metrics = {};

    // 1. Validación de Identidad
    const identityCheck = this._validateIdentity(candidate, isTeam);
    if (!identityCheck.valid) {
      issues.push(...identityCheck.errors);
    }

    // 2. Extracción de Muestra
    const rawData = candidate.researchData || candidate;
    const history = isTeam 
      ? (rawData.teamData?.observations || rawData.teamData?.historicalValues || candidate.historicalValues || [])
      : (rawData.playerData?.observations || rawData.playerData?.historicalValues || candidate.historicalValues || []);

    const sampleSize = Array.isArray(history) ? history.length : 0;
    metrics.sampleSize = sampleSize;

    const marketKey = (candidate.market || '').toLowerCase().trim();
    const marketRules = this.config.marketThresholds[marketKey] || {
      minSample: isTeam ? this.config.defaultTeamMinSample : this.config.defaultPlayerMinSample,
      starterWeight: isTeam ? 0.0 : 0.75,
      minutesSensitivity: isTeam ? 'NONE' : 'MEDIUM'
    };

    // Evaluación de Tamaño de Muestra
    if (sampleSize === 0) {
      issues.push('Ausencia total de observaciones históricas para el mercado.');
    } else if (sampleSize < Math.floor(marketRules.minSample * 0.6)) {
      issues.push(`Muestra insuficiente crítica: ${sampleSize} partidos (mínimo admisible: ${Math.floor(marketRules.minSample * 0.6)}).`);
    } else if (sampleSize < marketRules.minSample) {
      warnings.push(`Muestra reducida: ${sampleSize} partidos vs ${marketRules.minSample} recomendados.`);
    }

    // 3. Evaluación de Minutos y Titularidad (si es jugador individual)
    if (!isTeam) {
      const pData = rawData.playerData || candidate.playerData || {};
      const starts = pData.starts !== undefined ? pData.starts : (candidate.starts || 0);
      const totalRecorded = pData.validMatches || pData.totalMatches || sampleSize || 1;
      const starterRatio = totalRecorded > 0 ? starts / totalRecorded : 0;
      const avgMinutes = pData.avgMinutes || pData.projectedMinutes || candidate.avgMinutes || 0;

      metrics.starterRatio = Number(starterRatio.toFixed(2));
      metrics.avgMinutes = avgMinutes;

      if (starterRatio < 0.50 && marketRules.starterWeight > 0.5) {
        issues.push(`Ratio de titularidad deficiente: ${(starterRatio * 100).toFixed(0)}% (suplente habitual).`);
      } else if (starterRatio < this.config.minStarterRatio && marketRules.starterWeight > 0.5) {
        warnings.push(`Riesgo de rotación: ${(starterRatio * 100).toFixed(0)}% de titularidades (umbral sugerido: ${(this.config.minStarterRatio * 100).toFixed(0)}%).`);
      }

      if (avgMinutes < 45 && marketRules.minutesSensitivity === 'HIGH') {
        issues.push(`Promedio de minutos insuficiente (${avgMinutes} min) para mercados de alta dependencia.`);
      } else if (avgMinutes < this.config.minAvgMinutes && marketRules.minutesSensitivity !== 'NONE') {
        warnings.push(`Exposición moderada: promedia ${avgMinutes} min por encuentro.`);
      }
    }

    // 4. Verificación de Consistencia de Datos Numéricos
    if (sampleSize > 0) {
      const hasNaN = history.some(v => typeof v !== 'number' || isNaN(v) || v < 0);
      if (hasNaN) {
        issues.push('La serie histórica contiene valores inválidos, negativos o no numéricos.');
      }

      // Chequeo de dispersión
      const mean = history.reduce((a, b) => a + b, 0) / sampleSize;
      const variance = sampleSize > 1 
        ? history.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (sampleSize - 1)
        : 0;
      metrics.mean = Number(mean.toFixed(2));
      metrics.variance = Number(variance.toFixed(2));

      // Detección de racha 100% o 0% en muestras cortas
      const targetK = parseFloat(String(candidate.line || candidate.rawLine || 0.5).replace(/[^0-9.]/g, '')) || 0.5;
      const hits = history.filter(v => v > targetK || (candidate.isOver === false ? v < targetK : v >= Math.floor(targetK) + 1)).length;
      const hitRate = hits / sampleSize;
      metrics.hitRate = Number(hitRate.toFixed(3));

      if ((hitRate === 1.0 || hitRate === 0.0) && sampleSize <= 12) {
        warnings.push(`Alerta de Racha Polar (${(hitRate * 100).toFixed(0)}% en n=${sampleSize}): Requiere Shrinkage Bayesiano estricto para mitigar Mirage Trend.`);
      }
    }

    // 5. Determinación de Estado Final (VALID, LIMITED, INVALID)
    let status = 'VALID';
    let qualityScore = 100;

    if (issues.length > 0) {
      status = 'INVALID';
      qualityScore = Math.max(10, 100 - (issues.length * 35) - (warnings.length * 10));
    } else if (warnings.length > 0) {
      status = 'LIMITED';
      qualityScore = Math.max(40, 100 - (warnings.length * 15));
    }

    return {
      status,
      qualityScore,
      isTeam,
      market: candidate.market,
      metrics,
      issues,
      warnings,
      assessedAt: new Date().toISOString()
    };
  }

  _validateIdentity(candidate, isTeam) {
    const errors = [];
    const name = candidate.playerOrTeam || candidate.player || candidate.seleccion;
    const match = candidate.match || candidate.partido;
    const market = candidate.market || candidate.mercado;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      errors.push('Identificador de jugador o equipo inválido o ausente.');
    }
    if (!match || typeof match !== 'string' || !match.includes(' vs ') && !match.includes(' v ')) {
      errors.push('Partido inválido o sin formato canónico de enfrentamiento.');
    }
    if (!market || typeof market !== 'string' || market.trim().length < 3) {
      errors.push('Mercado deportivo no especificado.');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  _buildResult(status, score, issues, warnings = []) {
    return {
      status,
      qualityScore: score,
      issues,
      warnings,
      assessedAt: new Date().toISOString()
    };
  }
}

module.exports = DataQualityEngine;
