/**
 * DARADORBET — FASE 1 POST-AUDITORÍA: LIQUIDACIÓN CONTRAFACTUAL DE RECHAZOS Y DISCOVERY
 *
 * Reutiliza CounterfactualStore (append-only, SHA-256 chained, idempotente) en un ledger
 * dedicado sin modificar históricos originales ni convertir rechazos en picks operativos.
 *
 * Reglas innegociables:
 * - No inventa cuotas, probabilidades, estadísticas ni resultados.
 * - Si faltan datos verificables, registra explícitamente UNAVAILABLE y el motivo.
 * - Mantiene separación absoluta respecto a approved_picks, historial_picks y bankroll.
 */

const fs = require('fs');
const path = require('path');
const { CounterfactualStore } = require('./counterfactualStore');

const ROOT = path.join(__dirname, '..', '..', '..');
const SD = path.join(ROOT, 'engine', 'storage_data');
const LEDGER_PATH = path.join(SD, 'counterfactual_rejected_discovery_ledger.json');
const SETTLEMENT_PATH = path.join(SD, 'counterfactual_rejected_discovery_settlements.json');
const EXPORT_PATH = path.join(ROOT, 'api', 'counterfactual_rejected_discovery.json');
const EVALUATOR_VERSION = '1.0.0-post-audit-cf';

const TEST_PREFIXES = ['cand_test_', 'test_', 'pick_test_', 'pick_settle_', 'cand_autotest_', 'cand_starter_', 'cand_sub_', 'cand_incomp_'];

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function isTest(x) {
  if (!x) return true;
  if (x.isTest || x.is_test || x.isTestPick) return true;
  const id = String(x.id || x.candidateId || x.pickId || '');
  if (TEST_PREFIXES.some(p => id.startsWith(p))) return true;
  if (String(x.verificationSource || '').includes('Mock Provider')) return true;
  return false;
}

function makeDedupKey(r) {
  const match = String(r.match || r.partido || '').toLowerCase().trim();
  const market = String(r.market || r.mercado || '').toLowerCase().trim();
  const sel = String(r.player || r.playerOrTeam || r.seleccion || '').toLowerCase().trim();
  const line = String(r.line || r.linea || '').toLowerCase().trim();
  return `${match}|${market}|${sel}|${line}`;
}

function classifyOrigin(raw, rej, ph, cfE) {
  const reasonStr = String(
    rej?.reason || raw.decisionReason || raw.riskVerdict?.finalReason || ph?.risk_verdict?.finalReason || cfE?.decisionReasons?.join(' | ') || ''
  );
  const rawStatus = String(raw.status || ph?.status || '').toUpperCase();
  const elenaDec = String(ph?.elena_decision || raw.elena_decision || raw.riskVerdict?.finalStatus || cfE?.decision || '').toUpperCase();

  const isRejected =
    Boolean(rej) ||
    elenaDec === 'RECHAZADO' ||
    elenaDec === 'VETADO' ||
    elenaDec === 'COUNTERFACTUAL_REJECTED' ||
    rawStatus === 'RECHAZADO' ||
    rawStatus === 'VETADO';

  if (isRejected) {
    if (/EV insuficiente|VETO MATEMÁTICO/i.test(reasonStr)) return 'REJECTED_BY_EV';
    if (/CALIDAD DE DATOS|MUESTRA INSUFICIENTE|INVESTIGACION_INCOMPLETA|ERROR_DATOS|INTEGRIDAD DE FUENTE|INSUFFICIENT_DATA/i.test(reasonStr)) return 'REJECTED_BY_QUALITY';
    if (/SUPLENTE|ALINEACIÓN|ROTACIÓN|TÁCTICO|NOTICIAS|INCERTIDUMBRE|PROBABILIDAD INFLADA|DIVERGENCIA/i.test(reasonStr)) return 'REJECTED_BY_RISK_MANAGER';
    return 'REJECTED_BY_ELENA';
  }

  // Discovery sin decisión definitiva
  const hasOdds = Number.isFinite(Number(raw.bookmakerOdds ?? raw.odds ?? raw.cuota ?? ph?.odds)) && Number(raw.bookmakerOdds ?? raw.odds ?? raw.cuota ?? ph?.odds) > 1.01;
  const hasMatch = Boolean(raw.match || raw.partido || ph?.match);
  const hasMarket = Boolean(raw.market || raw.mercado || ph?.market);
  if (!hasOdds || !hasMatch || !hasMarket) return 'DISCOVERY_INSUFFICIENT_DATA';
  return 'DISCOVERY_NO_DECISION';
}

class RejectedDiscoveryCounterfactualRunner {
  constructor(options = {}) {
    this.store = options.store || new CounterfactualStore({
      ledgerPath: options.ledgerPath || LEDGER_PATH,
      settlementPath: options.settlementPath || SETTLEMENT_PATH
    });
    this.exportPath = options.exportPath || EXPORT_PATH;
  }

  run(options = {}) {
    const nowIso = options.nowIso || new Date().toISOString();
    const candidatesRaw = readJson(path.join(SD, 'research_candidates.json'), []);
    const rejectedRaw = readJson(path.join(SD, 'rejected_picks.json'), []);
    const approvedRaw = readJson(path.join(SD, 'approved_picks.json'), []);
    const resultsRaw = readJson(path.join(SD, 'pick_results.json'), []);
    const historial = readJson(path.join(ROOT, 'historial_picks.json'), { picks: [] });
    const picksHoy = readJson(path.join(ROOT, 'picks_hoy.json'), { top_picks: [] });
    const cfLedger = readJson(path.join(SD, 'counterfactual_elena_ledger.json'), { records: [] });

    const approvedIds = new Set([
      ...(Array.isArray(approvedRaw) ? approvedRaw : []).map(a => a.id || a.candidateId),
      ...(historial.picks || []).map(h => h.id)
    ]);
    const phMap = new Map((picksHoy.top_picks || []).map(p => [p.id, p]));
    const rejMap = new Map((Array.isArray(rejectedRaw) ? rejectedRaw : []).filter(r => !isTest(r)).map(r => [r.candidateId || r.id, r]));
    const resMap = new Map((Array.isArray(resultsRaw) ? resultsRaw : []).map(r => [r.pickId || r.candidateId || r.id, r]));
    const cfEvalMap = new Map((cfLedger.records || []).map(e => [e.originalPickId, e]));

    // Recopilar todos los rechazos + candidatos de Discovery no aprobados (deduplicados)
    const pool = new Map();
    const seenComposite = new Set();

    const tryAdd = (id, raw) => {
      if (!id || approvedIds.has(id) || pool.has(id)) return;
      const ph = phMap.get(id);
      const cfE = cfEvalMap.get(id);
      const st = String(raw.status || ph?.status || '').toUpperCase();
      const el = String(ph?.elena_decision || raw.elena_decision || cfE?.decision || '').toUpperCase();
      if (st === 'APROBADO' || el === 'APROBADO' || el === 'COUNTERFACTUAL_APPROVED' || st === 'ACERTADA' || st === 'FALLADA') return;

      const compKey = makeDedupKey(ph || raw);
      if (compKey !== '|||' && seenComposite.has(compKey)) return;
      if (compKey !== '|||') seenComposite.add(compKey);
      pool.set(id, { id, raw, rej: rejMap.get(id) || null, ph: ph || null, res: resMap.get(id) || null, cfE: cfE || null });
    };

    for (const r of (Array.isArray(rejectedRaw) ? rejectedRaw : []).filter(x => !isTest(x))) {
      tryAdd(r.candidateId || r.id, r);
    }
    for (const c of (Array.isArray(candidatesRaw) ? candidatesRaw : []).filter(x => !isTest(x))) {
      tryAdd(c.id, c);
    }
    for (const e of (cfLedger.records || [])) {
      if (e.decision === 'COUNTERFACTUAL_REJECTED') {
        tryAdd(e.originalPickId, phMap.get(e.originalPickId) || e);
      }
    }

    const existingEvals = new Set(this.store.getAllEvaluations().map(e => e.originalPickId));
    const byOrigin = {
      REJECTED_BY_ELENA: 0,
      REJECTED_BY_RISK_MANAGER: 0,
      REJECTED_BY_QUALITY: 0,
      REJECTED_BY_EV: 0,
      DISCOVERY_NO_DECISION: 0,
      DISCOVERY_INSUFFICIENT_DATA: 0
    };
    const byOutcome = { WON: 0, LOST: 0, VOID: 0, UNAVAILABLE: 0 };
    let appendedNew = 0;
    let skippedDuplicate = 0;

    for (const item of pool.values()) {
      const origin = classifyOrigin(item.raw, item.rej, item.ph, item.cfE);
      byOrigin[origin] = (byOrigin[origin] || 0) + 1;

      const oddsNum = Number(item.raw.bookmakerOdds ?? item.raw.odds ?? item.raw.cuota ?? item.ph?.odds ?? item.cfE?.odds ?? NaN);
      const odds = Number.isFinite(oddsNum) && oddsNum > 1.01 ? oddsNum : null;

      let prob = null;
      if (item.raw.prediction?.pProjected != null) prob = Number(item.raw.prediction.pProjected);
      else if (item.ph?.real_prob != null) prob = Number(item.ph.real_prob) / 100;
      else if (item.cfE?.elenaProbability != null) prob = Number(item.cfE.elenaProbability);
      if (prob !== null && (!Number.isFinite(prob) || prob <= 0 || prob >= 1)) prob = null;

      const evPct = (odds && prob) ? Number(((prob * odds - 1) * 100).toFixed(2)) : null;

      // Resultado oficial verificable (sin inventar datos)
      let outcome = 'UNAVAILABLE';
      let outcomeReason = 'Sin resultado oficial verificado en ledgers locales (requiere consulta histórica de estadísticas del partido).';
      const stList = [item.res?.status, item.ph?.sports_result].map(s => String(s || '').toUpperCase());
      if (stList.some(s => s === 'ACERTADA' || s === 'GANADA' || s === 'WON')) {
        outcome = 'WON';
        outcomeReason = 'Resultado oficial verificado en pick_results / picks_hoy.';
      } else if (stList.some(s => s === 'FALLADA' || s === 'PERDIDA' || s === 'LOST')) {
        outcome = 'LOST';
        outcomeReason = 'Resultado oficial verificado en pick_results / picks_hoy.';
      } else if (stList.some(s => s.includes('ANULADA') || s === 'VOID')) {
        outcome = 'VOID';
        outcomeReason = 'Anulada (no titular / 0 min) verificada oficialmente.';
      }

      byOutcome[outcome] = (byOutcome[outcome] || 0) + 1;

      if (existingEvals.has(item.id)) {
        skippedDuplicate++;
        continue;
      }

      const missingDataReasons = [];
      if (!odds) missingDataReasons.push('NO_VERIFIABLE_HISTORICAL_ODDS');
      if (!prob) missingDataReasons.push('NO_ORIGINAL_PROBABILITY');
      if (outcome === 'UNAVAILABLE') missingDataReasons.push('NO_OFFICIAL_SETTLEMENT_DATA');

      const rec = this.store.appendEvaluation({
        originalPickId: item.id,
        matchId: item.raw.matchId || item.ph?.matchId || null,
        match: item.raw.match || item.raw.partido || item.ph?.match || item.cfE?.match || null,
        league: item.raw.league || item.raw.competition || item.ph?.league || item.cfE?.league || null,
        market: item.raw.market || item.raw.mercado || item.ph?.market || item.cfE?.market || null,
        selection: item.raw.player || item.raw.playerOrTeam || item.raw.seleccion || item.ph?.player || item.cfE?.selection || null,
        line: item.raw.line || item.raw.linea || item.ph?.line || item.cfE?.line || null,
        evaluatedAtUtc: nowIso,
        kickoffUtc: item.raw.eventDateUtc || item.ph?.eventDateUtc || item.cfE?.kickoffUtc || null,
        matchStateAtEvaluation: 'RETROSPECTIVE_AUDIT',
        availableDataSnapshot: {
          originClass: origin,
          hasVerifiableOdds: odds !== null,
          hasOriginalProb: prob !== null,
          missingDataReasons
        },
        odds,
        oddsTimestampUtc: null,
        elenaProbability: prob,
        expectedValuePct: evPct,
        decision: origin,
        dataSufficiency: missingDataReasons.length === 0 ? 'SUFFICIENT' : 'INSUFFICIENT_DATA',
        decisionReasons: [item.rej?.reason || outcomeReason],
        settlementResult: outcome,
        modelVersion: item.raw.model_applied || 'historical',
        elenaVersion: EVALUATOR_VERSION
      });

      this.store.appendSettlement({
        evaluationId: rec.evaluationId,
        originalPickId: item.id,
        matchId: rec.matchId,
        match: rec.match,
        market: rec.market,
        league: rec.league,
        odds,
        elenaProbability: prob,
        stakeVirtual: odds ? 1.0 : 0,
        status: `COUNTERFACTUAL_${outcome}`,
        profitVirtual: (outcome === 'WON' && odds) ? Number((odds - 1).toFixed(4)) : (outcome === 'LOST' && odds ? -1.0 : 0),
        settledAtUtc: nowIso,
        source: 'local_verified_ledgers_only',
        reason: outcomeReason
      });

      appendedNew++;
    }

    const chain = this.store.verifyChain();
    const report = {
      generatedAtUtc: nowIso,
      circuit: 'COUNTERFACTUAL_REJECTED_AND_DISCOVERY',
      autoExecutionAllowed: false,
      operationalIsolation: true,
      evaluatorVersion: EVALUATOR_VERSION,
      integrity: chain,
      summary: {
        totalIdentified: pool.size,
        appendedNew,
        skippedDuplicate,
        byOrigin,
        byOutcome,
        roiCalculableCount: byOutcome.WON + byOutcome.LOST,
        limitationNote: 'Solo se liquidan registros con resultado oficial verificado localmente; nunca se inventan cuotas ni resultados históricos.'
      }
    };

    const dir = path.dirname(this.exportPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.exportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = { RejectedDiscoveryCounterfactualRunner, classifyOrigin };
