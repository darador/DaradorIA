/**
 * POPULATE EXPERIMENTAL COHORT V2.4 (OPTIMIZADO CON CACHÉ LOCAL DE AGENTES)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXPERIMENTAL_ODDS_POLICY_V24, evaluateExperimentalMath, getPolicyConfigHash } = require('./experimentalOddsPolicyV24');
const ExperimentalStore = require('./experimentalStore');

async function runFastPopulation() {
  console.log('=== [POBLANDO COHORTE EXPERIMENTAL V2.4 (1.45 - 2.20, EV >= +8%)] ===');
  const store = new ExperimentalStore();
  const configHash = getPolicyConfigHash();

  const picksData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../picks_hoy.json'), 'utf8')).top_picks;

  const seenKeys = new Set();
  const eligibleBatch = [];

  picksData.forEach(p => {
    const odds = Number(p.odds || p.bookmakerOdds || 0);
    if (!Number.isFinite(odds) || odds <= 1) return;

    const key = `${p.match}::${p.player || p.team}::${p.market}::${p.line}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    if (odds >= 1.40 && odds <= 2.30) {
      eligibleBatch.push(p);
    }
  });

  console.log(`Candidatos identificados para escrutinio experimental: ${eligibleBatch.length}`);

  for (const raw of eligibleBatch) {
    const odds = Number(raw.odds || raw.bookmakerOdds);
    const prob = Number(raw.real_prob ? raw.real_prob / 100 : (raw.probabilityV22 || 0.70));
    const dqeStatus = raw.dqeStatus || 'VALID';
    const sampleSize = raw.sample_size || 10;

    const mathEval = evaluateExperimentalMath({ odds, prob, dqeStatus, sampleSize });

    // Estado institucional de Elena para el candidato
    const rawElena = String(raw.elena_decision || raw.status || '').toUpperCase();
    const isVetoed = rawElena.includes('RECHAZ') || rawElena.includes('VETO');
    const isExpired = rawElena.includes('EXPIR') || raw.is_finished;

    let finalState;
    let statusLabel;

    if (!mathEval.pass) {
      finalState = EXPERIMENTAL_ODDS_POLICY_V24.STATES.REJECTED;
      statusLabel = 'RECHAZADO_MATEMÁTICO';
    } else if (isVetoed) {
      finalState = EXPERIMENTAL_ODDS_POLICY_V24.STATES.EXPERIMENTAL_REJECTED_BY_RISK_MANAGER;
      statusLabel = 'VETADO_POR_RISK_MANAGER';
    } else if (isExpired) {
      finalState = EXPERIMENTAL_ODDS_POLICY_V24.STATES.EXPIRED;
      statusLabel = 'EXPIRADO';
    } else {
      finalState = EXPERIMENTAL_ODDS_POLICY_V24.STATES.EXPERIMENTAL_APPROVED;
      statusLabel = 'APROBADO_EXPERIMENTAL_V24';
    }

    const payload = {
      candidateId: raw.id || `exp_${Math.random().toString(36).substr(2, 6)}`,
      matchId: raw.matchId || raw.match,
      match: raw.match,
      league: raw.league || raw.competition,
      eventKickoff: raw.eventKickoff || raw.eventDateUtc || raw.date,
      market: raw.market,
      selection: raw.player || raw.team || raw.selection,
      line: raw.line,
      odds,
      bookmaker: raw.bookmaker || 'Bet365',
      probabilityV1: prob,
      probabilityV22: prob,
      fairOdds: mathEval.fairOdds,
      ev: mathEval.ev,
      evPercentage: mathEval.evPercentage,
      dqeStatus,
      policy: EXPERIMENTAL_ODDS_POLICY_V24.policyId,
      configHash,
      evaluatedAt: new Date().toISOString(),
      finalState,
      statusLabel,
      isOperativeRecommendation: false,
      shadowMode: true,
      agentReports: raw.agent_reports || null,
      riskVerdict: raw.risk_verdict || { finalStatus: finalState, finalReason: mathEval.reason }
    };

    payload.sha256 = crypto.createHash('sha256').update(JSON.stringify({
      candidateId: payload.candidateId,
      matchId: payload.matchId,
      odds: payload.odds,
      ev: payload.ev,
      finalState: payload.finalState
    })).digest('hex');

    store.saveRecord(payload);
  }

  const finalStore = store.loadStore();
  console.log('Población completada.');
  console.log('Resumen:', JSON.stringify(finalStore.summary, null, 2));
}

if (require.main === module) {
  runFastPopulation().catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}

module.exports = { runFastPopulation };
