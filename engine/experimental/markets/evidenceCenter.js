/**
 * CENTRO DE EVIDENCIA MULTI-DIMENSIONAL (FASE 8 — EXPERIMENTAL)
 *
 * Estructura analítica para evaluar rendimiento estadístico real por:
 *   - Liga, Deporte, Mercado, Familia de Mercado, Selección, Modelo, Versión, Período y Calidad de Datos.
 *
 * Incluye indicadores obligatorios de muestra insuficiente (N < 30 / N < 100) para
 * evitar conclusiones prematuras o promoción indebida de modelos a producción.
 */

'use strict';

const EPS = 1e-6;

function round(v, d = 4) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function clampProb(p) {
  return Math.min(1 - EPS, Math.max(EPS, Number(p)));
}

const VALID_DIMENSIONS = Object.freeze([
  'league',
  'sport',
  'marketFamily',
  'market',
  'selection',
  'modelName',
  'modelVersion',
  'period',
  'dataQualityTier'
]);

function extractDimensionValue(record, dimension) {
  const snap = record.preMatchSnapshot || record;
  switch (dimension) {
    case 'league': return snap.league || 'Desconocida';
    case 'sport': return snap.sport || 'football';
    case 'marketFamily': return snap.marketFamily || 'unknown';
    case 'market': return snap.market || snap.marketFamily || 'unknown';
    case 'selection': return snap.selection || 'unknown';
    case 'modelName': return snap.modelName || 'unknown';
    case 'modelVersion': return snap.modelVersion || 'unknown';
    case 'period': {
      const ts = snap.kickoffUtc || snap.observedAtUtc || '';
      return typeof ts === 'string' && ts.length >= 7 ? ts.slice(0, 7) : 'unknown';
    }
    case 'dataQualityTier': return snap.dataQuality?.tier || 'DESCONOCIDA';
    default: return 'unknown';
  }
}

/**
 * Agrupa registros del Shadow Lab por una o más dimensiones y calcula métricas con
 * advertencia explícita de suficiencia estadística.
 */
function buildEvidenceReport(records = [], groupBy = ['marketFamily'], filters = {}) {
  const dims = (Array.isArray(groupBy) ? groupBy : [groupBy]).filter(d => VALID_DIMENSIONS.includes(d));
  if (dims.length === 0) dims.push('marketFamily');

  const filtered = records.filter(r => {
    for (const [k, v] of Object.entries(filters || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (String(extractDimensionValue(r, k)).toLowerCase() !== String(v).toLowerCase()) {
        return false;
      }
    }
    return true;
  });

  const buckets = new Map();
  for (const r of filtered) {
    const keyParts = dims.map(d => `${d}=${extractDimensionValue(r, d)}`);
    const bucketKey = keyParts.join(' | ');
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        dimensions: Object.fromEntries(dims.map(d => [d, extractDimensionValue(r, d)])),
        records: []
      });
    }
    buckets.get(bucketKey).records.push(r);
  }

  const slices = [];
  for (const [bucketKey, bucket] of buckets.entries()) {
    const list = bucket.records;
    const settled = list.filter(r => r.settlement?.status === 'WON' || r.settlement?.status === 'LOST');
    const wins = settled.filter(r => r.settlement.status === 'WON').length;
    const profit = settled.reduce((acc, r) => acc + (Number(r.settlement?.profitUnits) || 0), 0);
    const clvVals = list.map(r => r.closing?.clvPct).filter(Number.isFinite);

    let brierSum = 0;
    let logLossSum = 0;
    for (const r of settled) {
      const p = clampProb(r.preMatchSnapshot?.modelProb ?? 0.5);
      const y = r.settlement.status === 'WON' ? 1 : 0;
      brierSum += Math.pow(p - y, 2);
      logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }

    const n = settled.length;
    const sampleStatus = n < 30 ? 'INSUFFICIENT_SAMPLE' : (n < 100 ? 'PRELIMINARY_SAMPLE' : 'STATISTICALLY_VALID');

    slices.push({
      bucketKey,
      dimensions: bucket.dimensions,
      totalCount: list.length,
      settledCount: n,
      sampleStatus,
      sampleWarning: n < 30
        ? `Muestra insuficiente (N=${n} < 30): no extraer conclusiones ni habilitar en producción.`
        : (n < 100 ? `Muestra preliminar (N=${n} < 100): continuar observación en Shadow Mode.` : null),
      hitRatePct: n > 0 ? round((wins / n) * 100, 2) : null,
      profitUnits: round(profit, 4),
      roiPct: n > 0 ? round((profit / n) * 100, 2) : null,
      yieldPct: n > 0 ? round((profit / n) * 100, 2) : null,
      brierScore: n > 0 ? round(brierSum / n, 5) : null,
      logLoss: n > 0 ? round(logLossSum / n, 5) : null,
      avgClvPct: clvVals.length > 0 ? round(clvVals.reduce((a, b) => a + b, 0) / clvVals.length, 3) : null,
      clvSampleCount: clvVals.length
    });
  }

  slices.sort((a, b) => b.settledCount - a.settledCount);

  return {
    generatedAt: new Date().toISOString(),
    groupBy: dims,
    filtersApplied: filters,
    totalRecordsMatched: filtered.length,
    slicesCount: slices.length,
    slices
  };
}

module.exports = {
  VALID_DIMENSIONS,
  buildEvidenceReport
};
