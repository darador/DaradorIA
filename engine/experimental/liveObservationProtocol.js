import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LiveProspectiveEvaluator } from './liveProspectiveEvaluator.js';
import { loadProspectiveStore } from './liveProspectiveCapturer.js';
import { loadOutcomesStore } from './liveProspectiveEvaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTOCOL_AUDIT_LOG_PATH = path.resolve(__dirname, '../storage_data/shadow_lab_protocol_audit_log.json');

/**
 * Initializes the protocol audit log store if missing.
 */
function initProtocolAuditLog() {
  const dir = path.dirname(PROTOCOL_AUDIT_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(PROTOCOL_AUDIT_LOG_PATH)) {
    const initial = {
      cohortId: 'SHADOW_V2.2_LIVE_PROSPECTIVE',
      protocolStartedAt: new Date().toISOString(),
      lastReportAt: new Date().toISOString(),
      milestonesConfig: [
        { matches: 10, name: 'AUDITORIA_OPERATIVA_10', status: 'PENDING' },
        { matches: 25, name: 'AUDITORIA_SNAPSHOTS_RESULTADOS_25', status: 'PENDING' },
        { matches: 50, name: 'REVISION_INTEGRIDAD_CALIDAD_50', status: 'PENDING' },
        { matches: 100, name: 'EVALUACION_ESTADISTICA_FORMAL_100', status: 'PENDING' },
        { matches: 200, name: 'ANALISIS_POR_MERCADOS_200', status: 'PENDING' },
        { matches: 300, name: 'EVALUACION_ESTABILIDAD_300', status: 'PENDING' },
        { matches: 500, name: 'EVALUACION_ESTABILIDAD_500', status: 'PENDING' }
      ],
      checkpoints: []
    };
    fs.writeFileSync(PROTOCOL_AUDIT_LOG_PATH, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

/**
 * Generates an operational summary separating observed empirical facts from interpretations.
 */
export function generateObservationProtocolReport(policy = 'LAST_VALID_PRE_KICKOFF') {
  initProtocolAuditLog();
  const evaluator = new LiveProspectiveEvaluator();
  const audit = evaluator.auditSnapshotIntegrity();
  const metrics = evaluator.computeComparativeMetrics(policy);
  const candidates = evaluator.resolveEvaluations(policy);

  // Group by matchId for unique match count
  const matchesMap = new Map();
  candidates.forEach(c => {
    if (!matchesMap.has(c.matchId)) matchesMap.set(c.matchId, []);
    matchesMap.get(c.matchId).push(c);
  });
  const uniqueMatchesCount = matchesMap.size;

  // VOID breakdown by reason
  const voidReasonCounts = {};
  candidates.forEach(c => {
    if (c.status.startsWith('VOID')) {
      voidReasonCounts[c.status] = (voidReasonCounts[c.status] || 0) + 1;
    }
  });

  // Market Breakdown
  const marketBreakdown = {};
  candidates.forEach(c => {
    const m = c.market || 'UNKNOWN';
    if (!marketBreakdown[m]) {
      marketBreakdown[m] = {
        total: 0,
        pending: 0,
        won: 0,
        lost: 0,
        push: 0,
        void: 0,
        avgOdds: 0,
        oddsSum: 0
      };
    }
    marketBreakdown[m].total++;
    marketBreakdown[m].oddsSum += Number(c.odds);
    if (c.status === 'PENDING') marketBreakdown[m].pending++;
    else if (c.status === 'WON') marketBreakdown[m].won++;
    else if (c.status === 'LOST') marketBreakdown[m].lost++;
    else if (c.status === 'PUSH') marketBreakdown[m].push++;
    else if (c.status.startsWith('VOID')) marketBreakdown[m].void++;
  });

  Object.keys(marketBreakdown).forEach(m => {
    marketBreakdown[m].avgOdds = Number((marketBreakdown[m].oddsSum / marketBreakdown[m].total).toFixed(3));
  });

  // Check Milestone Trigger
  const auditLogRaw = JSON.parse(fs.readFileSync(PROTOCOL_AUDIT_LOG_PATH, 'utf-8'));
  let triggeredMilestone = null;
  auditLogRaw.milestonesConfig.forEach(ms => {
    if (uniqueMatchesCount >= ms.matches && ms.status === 'PENDING') {
      ms.status = 'REACHED';
      ms.reachedAt = new Date().toISOString();
      triggeredMilestone = ms.name;
    }
  });

  const reportPayload = {
    timestamp: new Date().toISOString(),
    policy,
    observedFacts: {
      uniqueMatchesCount,
      uniqueCandidateCount: audit.uniqueCandidateCount,
      totalSnapshotsCount: audit.totalRecords,
      supersededSnapshotsCount: audit.supersededCount,
      temporalViolationsCount: audit.violationsCount,
      tamperedHashCount: audit.tamperedRecords.length,
      settledCount: metrics.evaluableCount,
      pendingCount: metrics.pendingCount,
      pushCount: metrics.pushCount,
      voidCounts: voidReasonCounts,
      marketBreakdown,
      clvObserved: metrics.clv,
      financialsObserved: {
        v1: metrics.v1 ? { bets: metrics.v1.betsCount, wins: metrics.v1.winsCount, profit: metrics.v1.profitUnits, yield: metrics.v1.yieldPercent } : null,
        v22: metrics.v22 ? { bets: metrics.v22.betsCount, wins: metrics.v22.winsCount, profit: metrics.v22.profitUnits, yield: metrics.v22.yieldPercent } : null
      },
      brierObserved: {
        v1: metrics.v1 ? metrics.v1.brierScore : null,
        v22: metrics.v22 ? metrics.v22.brierScore : null,
        delta: metrics.diff ? metrics.diff.deltaBrier : null
      },
      logLossObserved: {
        v1: metrics.v1 ? metrics.v1.logLoss : null,
        v22: metrics.v22 ? metrics.v22.logLoss : null,
        delta: metrics.diff ? metrics.diff.deltaLogLoss : null
      },
      eceObserved: {
        v1: metrics.v1 ? metrics.v1.ece : null,
        v22: metrics.v22 ? metrics.v22.ece : null
      }
    },
    statisticalInterpretation: {
      isSampleSufficient: metrics.isSampleSufficient,
      warning: metrics.warning || 'Ninguna anomalía detectada.',
      conclusion: uniqueMatchesCount < 10 
        ? 'FASE INICIAL DE ACUMULACIÓN: Datos insuficientes para inferencia o comparación de desempeño. Se mantiene modo estrictamente observacional.'
        : 'Observación en curso.'
    },
    milestoneEvent: triggeredMilestone
  };

  // Log checkpoint
  auditLogRaw.checkpoints.push({
    timestamp: reportPayload.timestamp,
    uniqueMatchesCount,
    uniqueCandidateCount: audit.uniqueCandidateCount,
    settledCount: metrics.evaluableCount,
    pendingCount: metrics.pendingCount
  });
  auditLogRaw.lastReportAt = reportPayload.timestamp;
  fs.writeFileSync(PROTOCOL_AUDIT_LOG_PATH, JSON.stringify(auditLogRaw, null, 2), 'utf-8');

  return reportPayload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rep = generateObservationProtocolReport();
  console.log('========================================================================================');
  console.log('          DARADOR IA 2.0 — REPORTE OPERATIVO: OBSERVACIÓN PASIVA V2.2 LIVE              ');
  console.log('========================================================================================');
  console.log(`Fecha de Emisión: ${rep.timestamp}`);
  console.log('\n--- 1. DATOS EMPÍRICOS OBSERVADOS (FACTS) ---');
  console.log(`* Partidos independientes capturados: ${rep.observedFacts.uniqueMatchesCount}`);
  console.log(`* Candidatos únicos (pre-kickoff):     ${rep.observedFacts.uniqueCandidateCount}`);
  console.log(`* Snapshots totales en disco:         ${rep.observedFacts.totalSnapshotsCount}`);
  console.log(`* Snapshots reemplazados (cuotas):    ${rep.observedFacts.supersededSnapshotsCount}`);
  console.log(`* Violaciones temporales registradas: ${rep.observedFacts.temporalViolationsCount}`);
  console.log(`* Hashes SHA-256 alterados:           ${rep.observedFacts.tamperedHashCount}`);
  console.log(`* Resultados liquidados (Won/Lost):   ${rep.observedFacts.settledCount}`);
  console.log(`* Resultados pendientes:              ${rep.observedFacts.pendingCount}`);
  console.log(`* Resultados en PUSH:                 ${rep.observedFacts.pushCount}`);
  console.log(`* Resultados en VOID:                 ${JSON.stringify(rep.observedFacts.voidCounts)}`);
  console.log('\n* Desglose por Mercado:');
  Object.entries(rep.observedFacts.marketBreakdown).forEach(([mkt, data]) => {
    console.log(`  - ${mkt}: ${data.total} candidatos (Cuota prom: ${data.avgOdds}, Pendientes: ${data.pending})`);
  });
  console.log('\n--- 2. INTERPRETACIÓN ESTADÍSTICA Y CONTROL ---');
  console.log(`* Suficiencia de Muestra: ${rep.statisticalInterpretation.isSampleSufficient ? 'SÍ' : 'NO'}`);
  console.log(`* Dictamen:              ${rep.statisticalInterpretation.warning}`);
  console.log(`* Conclusión:            ${rep.statisticalInterpretation.conclusion}`);
  console.log('========================================================================================\n');
}
