/**
 * SHADOW LAB MULTI-FAMILIA (FASE 5 — EXPERIMENTAL / SHADOW MODE ONLY)
 *
 * Registra y evalúa predicciones de 1X2, Doble Oportunidad y mercados derivados
 * de forma estrictamente separada por familia de mercado (nunca mezcla 1X2 con props).
 *
 * Garantías:
 *  - Almacenamiento aislado (por defecto engine/storage_data/shadow_lab_markets.json)
 *  - Sello criptográfico SHA-256 inmutable sobre el bloque pre-partido (preMatchHash)
 *  - Guarda temporal anti-leakage: observedAtUtc < kickoffUtc
 *  - Deduplicación por eventKey e idempotencia en liquidación
 *  - Métricas 1X2: Log Loss multiclase, Brier Score multiclase, calibración 1/X/2, Hit Rate, ROI, Yield, CLV
 *  - Métricas Doble Oportunidad: Brier binario, Log Loss binario, calibración, Hit Rate, ROI, Yield, CLV
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MARKETS_LEDGER = path.resolve(__dirname, '..', '..', 'storage_data', 'shadow_lab_markets.json');
const EPS = 1e-6;

function clampProb(p) {
  return Math.min(1 - EPS, Math.max(EPS, Number(p)));
}

function round(v, d = 4) {
  if (!Number.isFinite(v)) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Resuelve el resultado oficial de una selección 1X2 o Doble Oportunidad a partir del marcador 90 min.
 */
function resolveMarketOutcome(marketFamily, selection, homeGoals, awayGoals) {
  const hg = Number(homeGoals);
  const ag = Number(awayGoals);
  if (!Number.isFinite(hg) || !Number.isFinite(ag)) return null;

  const actual1X2 = hg > ag ? '1' : (hg === ag ? 'X' : '2');
  const sel = String(selection || '').toUpperCase().trim();

  if (marketFamily === 'match_1x2') {
    return { actual1X2, won: sel === actual1X2, status: sel === actual1X2 ? 'WON' : 'LOST' };
  }

  if (marketFamily === 'double_chance') {
    const winMap = {
      '1X': actual1X2 === '1' || actual1X2 === 'X',
      'X2': actual1X2 === 'X' || actual1X2 === '2',
      '12': actual1X2 === '1' || actual1X2 === '2'
    };
    const won = Boolean(winMap[sel]);
    return { actual1X2, won, status: won ? 'WON' : 'LOST' };
  }

  return null;
}

/**
 * Calcula CLV (Closing Line Value) porcentual: (takenOdds / closingOdds - 1) * 100
 * Positivo indica que tomamos mejor cuota que el cierre de mercado.
 */
function computeCLV(takenOdds, closingOdds) {
  const t = Number(takenOdds);
  const c = Number(closingOdds);
  if (!Number.isFinite(t) || !Number.isFinite(c) || t <= 1 || c <= 1) return null;
  return round(((t / c) - 1) * 100, 3);
}

class ShadowLabMarkets {
  constructor(ledgerPath = DEFAULT_MARKETS_LEDGER) {
    this.ledgerPath = ledgerPath;
    this.schemaVersion = 'shadow-lab-markets-v1.0';
  }

  _readAll() {
    if (!fs.existsSync(this.ledgerPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.ledgerPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  _writeAll(records) {
    const dir = path.dirname(this.ledgerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.ledgerPath, JSON.stringify(records, null, 2), 'utf8');
  }

  buildEventKey(payload) {
    const m = String(payload.matchId || payload.match || '').trim().toLowerCase();
    const fam = String(payload.marketFamily || '').trim().toLowerCase();
    const sel = String(payload.selection || '').trim().toLowerCase();
    const ver = String(payload.modelVersion || 'v1').trim().toLowerCase();
    return `${m}__${fam}__${sel}__${ver}`;
  }

  /**
   * Registra una predicción pre-partido con sello SHA-256 y guarda anti-leakage.
   */
  recordPrediction(payload) {
    const observedAtUtc = payload.observedAtUtc || new Date().toISOString();
    const kickoffUtc = payload.kickoffUtc || null;

    if (!kickoffUtc) {
      return { recorded: false, reason: 'MISSING_KICKOFF_UTC' };
    }
    const obsMs = Date.parse(observedAtUtc);
    const koMs = Date.parse(kickoffUtc);
    if (!Number.isFinite(obsMs) || !Number.isFinite(koMs) || obsMs >= koMs) {
      return { recorded: false, reason: 'TEMPORAL_LEAKAGE_BLOCKED' };
    }

    if (!payload.marketFamily || !payload.selection) {
      return { recorded: false, reason: 'MISSING_MARKET_OR_SELECTION' };
    }

    const records = this._readAll();
    const eventKey = this.buildEventKey(payload);
    const existing = records.find(r => r.eventKey === eventKey);
    if (existing) {
      return { recorded: false, reason: 'DUPLICATE_PREVENTED', predictionId: existing.predictionId };
    }

    const preMatchSnapshot = {
      schemaVersion: this.schemaVersion,
      eventKey,
      matchId: payload.matchId || null,
      match: payload.match || '',
      league: payload.league || 'Desconocida',
      sport: payload.sport || 'football',
      marketFamily: payload.marketFamily,
      market: payload.market || payload.marketFamily,
      selection: String(payload.selection).toUpperCase(),
      modelName: payload.modelName || 'MatchOutcomeDC',
      modelVersion: payload.modelVersion || 'match-outcome-dc-v1.0-experimental',
      observedAtUtc,
      kickoffUtc,
      bookmakerOdds: Number(payload.bookmakerOdds),
      impliedProb: Number(payload.impliedProb ?? (payload.bookmakerOdds > 1 ? 1 / payload.bookmakerOdds : null)),
      noVigProb: payload.noVigProb ?? null,
      modelProb: Number(payload.modelProb),
      evPct: payload.evPct ?? null,
      probabilities1X2: payload.probabilities1X2 || null,
      probabilitiesDC: payload.probabilitiesDC || null,
      dataQuality: payload.dataQuality || { tier: 'DESCONOCIDA', score: null },
      featuresUsed: payload.parameters || payload.featuresUsed || null
    };

    const preMatchHash = sha256(preMatchSnapshot);
    const record = {
      predictionId: `slm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      eventKey,
      preMatchHash,
      preMatchSnapshot,
      closing: {
        closingOdds: null,
        capturedAtUtc: null,
        clvPct: null
      },
      settlement: {
        status: 'PENDING',
        homeGoals: null,
        awayGoals: null,
        actual1X2: null,
        profitUnits: null,
        settledAtUtc: null
      }
    };

    records.push(record);
    this._writeAll(records);

    return { recorded: true, predictionId: record.predictionId, preMatchHash };
  }

  /**
   * Registra la cuota de cierre (T-5 o última lectura limpia) y calcula CLV sin alterar preMatchSnapshot.
   */
  recordClosingOdds(predictionId, closingOdds, capturedAtUtc = new Date().toISOString()) {
    const records = this._readAll();
    const rec = records.find(r => r.predictionId === predictionId);
    if (!rec) return { updated: false, reason: 'NOT_FOUND' };

    const clvPct = computeCLV(rec.preMatchSnapshot.bookmakerOdds, closingOdds);
    if (clvPct === null) return { updated: false, reason: 'INVALID_CLOSING_ODDS' };

    rec.closing = {
      closingOdds: Number(closingOdds),
      capturedAtUtc,
      clvPct
    };
    this._writeAll(records);
    return { updated: true, predictionId, clvPct };
  }

  /**
   * Liquida una predicción de forma idempotente (nunca modifica preMatchSnapshot ni preMatchHash).
   */
  settlePrediction(predictionId, { homeGoals, awayGoals, statusOverride = null, settledAtUtc = new Date().toISOString() }) {
    const records = this._readAll();
    const rec = records.find(r => r.predictionId === predictionId);
    if (!rec) return { settled: false, reason: 'NOT_FOUND' };

    if (rec.settlement.status !== 'PENDING') {
      return { settled: false, idempotent: true, reason: 'ALREADY_SETTLED', status: rec.settlement.status };
    }

    if (statusOverride === 'VOID') {
      rec.settlement = {
        status: 'VOID',
        homeGoals: homeGoals ?? null,
        awayGoals: awayGoals ?? null,
        actual1X2: null,
        profitUnits: 0,
        settledAtUtc
      };
      this._writeAll(records);
      return { settled: true, status: 'VOID', profitUnits: 0 };
    }

    const res = resolveMarketOutcome(
      rec.preMatchSnapshot.marketFamily,
      rec.preMatchSnapshot.selection,
      homeGoals,
      awayGoals
    );
    if (!res) return { settled: false, reason: 'UNSUPPORTED_OUTCOME_RESOLUTION' };

    const odds = rec.preMatchSnapshot.bookmakerOdds;
    const profitUnits = res.won ? round(odds - 1, 4) : -1;

    rec.settlement = {
      status: res.status,
      homeGoals: Number(homeGoals),
      awayGoals: Number(awayGoals),
      actual1X2: res.actual1X2,
      profitUnits,
      settledAtUtc
    };
    this._writeAll(records);
    return { settled: true, status: res.status, actual1X2: res.actual1X2, profitUnits };
  }

  /**
   * Verifica la integridad criptográfica SHA-256 de todos los registros almacenados.
   */
  verifyIntegrity() {
    const records = this._readAll();
    let intact = 0;
    const corrupted = [];
    for (const r of records) {
      const recomputed = sha256(r.preMatchSnapshot);
      if (recomputed === r.preMatchHash) intact++;
      else corrupted.push(r.predictionId);
    }
    return {
      total: records.length,
      intact,
      corruptedCount: corrupted.length,
      corruptedIds: corrupted,
      ok: corrupted.length === 0
    };
  }

  /**
   * Evalúa métricas separadas por familia de mercado (nunca mezcla 1X2 con Doble Oportunidad ni props).
   */
  evaluateByMarketFamily(recordsOverride = null) {
    const all = recordsOverride || this._readAll();
    const groups = {};
    for (const r of all) {
      const fam = r.preMatchSnapshot?.marketFamily || 'unknown';
      if (!groups[fam]) groups[fam] = [];
      groups[fam].push(r);
    }

    const report = {};
    for (const [fam, list] of Object.entries(groups)) {
      const settled = list.filter(r => r.settlement?.status === 'WON' || r.settlement?.status === 'LOST');
      const voids = list.filter(r => r.settlement?.status === 'VOID').length;
      const pending = list.filter(r => r.settlement?.status === 'PENDING').length;

      const wins = settled.filter(r => r.settlement.status === 'WON').length;
      const totalProfit = settled.reduce((acc, r) => acc + (Number(r.settlement.profitUnits) || 0), 0);
      const clvList = list.map(r => r.closing?.clvPct).filter(Number.isFinite);

      const sampleStatus = settled.length < 30
        ? 'INSUFFICIENT_SAMPLE'
        : (settled.length < 100 ? 'PRELIMINARY_SAMPLE' : 'STATISTICALLY_VALID');

      const baseMetrics = {
        marketFamily: fam,
        totalRecorded: list.length,
        settledCount: settled.length,
        pendingCount: pending,
        voidCount: voids,
        sampleStatus,
        promotionBlocked: settled.length < 100,
        hitRatePct: settled.length > 0 ? round((wins / settled.length) * 100, 2) : null,
        profitUnits: round(totalProfit, 4),
        roiPct: settled.length > 0 ? round((totalProfit / settled.length) * 100, 2) : null,
        yieldPct: settled.length > 0 ? round((totalProfit / settled.length) * 100, 2) : null,
        avgClvPct: clvList.length > 0 ? round(clvList.reduce((a, b) => a + b, 0) / clvList.length, 3) : null,
        clvSampleCount: clvList.length
      };

      if (fam === 'match_1x2') {
        // Métricas multiclase 3-way (Local / Empate / Visitante)
        let logLossSum = 0;
        let brierSum = 0;
        let validMulticlass = 0;
        const bySelection = { '1': [], 'X': [], '2': [] };
        const cal = {
          '1': { predSum: 0, obsSum: 0, n: 0 },
          'X': { predSum: 0, obsSum: 0, n: 0 },
          '2': { predSum: 0, obsSum: 0, n: 0 }
        };

        for (const r of settled) {
          const sel = r.preMatchSnapshot.selection;
          if (bySelection[sel]) bySelection[sel].push(r);

          const p1x2 = r.preMatchSnapshot.probabilities1X2;
          const actual = r.settlement.actual1X2;
          if (p1x2 && actual) {
            const pMap = {
              '1': clampProb(p1x2.home),
              'X': clampProb(p1x2.draw),
              '2': clampProb(p1x2.away)
            };
            logLossSum += -Math.log(pMap[actual]);
            brierSum += ['1', 'X', '2'].reduce((acc, k) => {
              const y = actual === k ? 1 : 0;
              return acc + Math.pow(pMap[k] - y, 2);
            }, 0);
            validMulticlass++;

            for (const k of ['1', 'X', '2']) {
              cal[k].predSum += pMap[k];
              cal[k].obsSum += actual === k ? 1 : 0;
              cal[k].n++;
            }
          }
        }

        const hitRateBySelection = {};
        for (const k of ['1', 'X', '2']) {
          const arr = bySelection[k];
          const w = arr.filter(x => x.settlement.status === 'WON').length;
          hitRateBySelection[k] = {
            count: arr.length,
            hitRatePct: arr.length > 0 ? round((w / arr.length) * 100, 2) : null
          };
        }

        const calibration = {};
        for (const k of ['1', 'X', '2']) {
          calibration[k] = cal[k].n > 0
            ? {
                sample: cal[k].n,
                predictedAvg: round(cal[k].predSum / cal[k].n, 4),
                observedRate: round(cal[k].obsSum / cal[k].n, 4),
                calibrationError: round((cal[k].predSum - cal[k].obsSum) / cal[k].n, 4)
              }
            : null;
        }

        report[fam] = {
          ...baseMetrics,
          multiclassLogLoss: validMulticlass > 0 ? round(logLossSum / validMulticlass, 5) : null,
          multiclassBrierScore: validMulticlass > 0 ? round(brierSum / validMulticlass, 5) : null,
          calibrationByOutcome: calibration,
          hitRateBySelection
        };
      } else {
        // Métricas binarias (Doble Oportunidad, BTTS, O/U, etc.)
        let logLossSum = 0;
        let brierSum = 0;
        let predSum = 0;
        let obsSum = 0;

        for (const r of settled) {
          const p = clampProb(r.preMatchSnapshot.modelProb);
          const y = r.settlement.status === 'WON' ? 1 : 0;
          logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
          brierSum += Math.pow(p - y, 2);
          predSum += p;
          obsSum += y;
        }

        report[fam] = {
          ...baseMetrics,
          binaryLogLoss: settled.length > 0 ? round(logLossSum / settled.length, 5) : null,
          binaryBrierScore: settled.length > 0 ? round(brierSum / settled.length, 5) : null,
          calibration: settled.length > 0
            ? {
                predictedAvg: round(predSum / settled.length, 4),
                observedRate: round(obsSum / settled.length, 4),
                calibrationError: round((predSum - obsSum) / settled.length, 4)
              }
            : null
        };
      }
    }

    return report;
  }
}

module.exports = {
  ShadowLabMarkets,
  resolveMarketOutcome,
  computeCLV
};
