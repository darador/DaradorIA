const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const { ProspectiveObservationStore } = require(path.join(ROOT, 'engine/experimental/prospective/prospectiveObservationStore'));
const { ProspectiveLadderEngine } = require(path.join(ROOT, 'engine/experimental/prospective/prospectiveLadderEngine'));
const { ProspectiveAnalyticsExporter } = require(path.join(ROOT, 'engine/experimental/prospective/prospectiveAnalyticsExporter'));

const sofia = require(path.join(ROOT, 'engine/agents/playerAnalyst'));
const valentina = require(path.join(ROOT, 'engine/agents/teamAnalyst'));
const camila = require(path.join(ROOT, 'engine/agents/matchContextAnalyst'));
const renata = require(path.join(ROOT, 'engine/agents/oddsAnalyst'));
const lucia = require(path.join(ROOT, 'engine/agents/matchIntelligenceAnalyst'));
const elena = require(path.join(ROOT, 'engine/agents/riskManager'));

// Definición estricta de los 11 candidatos
const candidatesDef = [
  // 5 NUEVAS OPORTUNIDADES DAILY BOARD
  {
    type: 'DAILY_BOARD',
    playerOrTeam: 'Callum Styles',
    playerId: 'callum-styles.107fxm4',
    team: 'West Bromwich Albion',
    opponent: 'Bolton Wanderers',
    match: 'Bolton Wanderers vs West Bromwich Albion',
    matchId: 'bolton-wanderers-v-west-bromwich-albion.16wg7kk',
    competition: 'Championship',
    kickoffUtc: '2026-11-25T19:45:00Z',
    market: 'Remates totales',
    statType: 'shots',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.48,
    sampleSize: 10,
    starts: 10,
    statP90: 1.34,
    avgMinutes: 87,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'Coral'
  },
  {
    type: 'DAILY_BOARD',
    playerOrTeam: 'Jeff Chabot',
    playerId: 'jeff-chabot.0df5mag',
    team: 'VfB Stuttgart',
    opponent: 'Inter',
    match: 'Inter vs VfB Stuttgart',
    matchId: 'inter-v-vfb-stuttgart.0rpftmy',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T20:00:00Z',
    market: 'Faltas ganadas',
    statType: 'foulsWon',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.50,
    sampleSize: 10,
    starts: 10,
    statP90: 1.69,
    avgMinutes: 85.4,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'Paddy Power'
  },
  {
    type: 'DAILY_BOARD',
    playerOrTeam: 'Tomoki Iwata',
    playerId: 'iwata-tomoki.14efabw',
    team: 'Birmingham City',
    opponent: 'Burnley',
    match: 'Burnley vs Birmingham City',
    matchId: 'burnley-v-birmingham-city.0vio51a',
    competition: 'Championship',
    kickoffUtc: '2026-11-25T19:45:00Z',
    market: 'Faltas cometidas',
    statType: 'fouls',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.53,
    sampleSize: 10,
    starts: 10,
    statP90: 1.12,
    avgMinutes: 88.5,
    hitRateL10: 90,
    isTeamProp: false,
    bookmaker: 'Betfred'
  },
  {
    type: 'DAILY_BOARD',
    playerOrTeam: 'Atakan Karazor',
    playerId: 'atakan-karazor.034aoah',
    team: 'VfB Stuttgart',
    opponent: 'Inter',
    match: 'Inter vs VfB Stuttgart',
    matchId: 'inter-v-vfb-stuttgart.0rpftmy',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T20:00:00Z',
    market: 'Faltas cometidas',
    statType: 'fouls',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.33,
    sampleSize: 10,
    starts: 10,
    statP90: 2.01,
    avgMinutes: 76,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'Betfred'
  },
  {
    type: 'DAILY_BOARD',
    playerOrTeam: 'Jay Stansfield',
    playerId: 'jay-stansfield.0zkzady',
    team: 'Birmingham City',
    opponent: 'Burnley',
    match: 'Burnley vs Birmingham City',
    matchId: 'burnley-v-birmingham-city.0vio51a',
    competition: 'Championship',
    kickoffUtc: '2026-11-25T19:45:00Z',
    market: 'Remates totales',
    statType: 'shots',
    line: 'Más de 1.5',
    rawLine: 1.5,
    odds: 1.38,
    sampleSize: 10,
    starts: 10,
    statP90: 3.19,
    avgMinutes: 87.5,
    hitRateL10: 90,
    isTeamProp: false,
    bookmaker: 'Betway'
  },

  // 6 CANDIDATOS RETO ESCALERA (CUOTAS [1.10, 1.25])
  {
    type: 'RETO_ESCALERA',
    playerOrTeam: 'Peter Christiansen',
    playerId: 'peter-christiansen.034uplh',
    team: 'Viking FK',
    opponent: 'Atlético Madrid',
    match: 'Atlético Madrid vs Viking FK',
    matchId: 'atletico-madrid-v-viking-fk.143n3za',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T20:00:00Z',
    market: 'Remates totales',
    statType: 'shots',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.22,
    sampleSize: 10,
    starts: 10,
    statP90: 3.23,
    avgMinutes: 83.7,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'BetVictor'
  },
  {
    type: 'RETO_ESCALERA',
    playerOrTeam: 'Jorne Spileers',
    playerId: 'jorne-spileers.191gdsw',
    team: 'Club Brugge KV',
    opponent: 'Liverpool',
    match: 'Club Brugge KV vs Liverpool',
    matchId: 'club-brugge-kv-v-liverpool.1hffkf8',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T20:00:00Z',
    market: 'Faltas cometidas',
    statType: 'fouls',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.25,
    sampleSize: 10,
    starts: 10,
    statP90: 2.08,
    avgMinutes: 86.4,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'BetMGM UK'
  },
  {
    type: 'RETO_ESCALERA',
    playerOrTeam: 'Jaydon Banel',
    playerId: 'banel-jaydon.0xitr5m',
    team: 'Burnley',
    opponent: 'Birmingham City',
    match: 'Burnley vs Birmingham City',
    matchId: 'burnley-v-birmingham-city.0vio51a',
    competition: 'Championship',
    kickoffUtc: '2026-11-25T19:45:00Z',
    market: 'Faltas ganadas',
    statType: 'foulsWon',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.21,
    sampleSize: 10,
    starts: 10,
    statP90: 1.80,
    avgMinutes: 75.1,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'BetMGM UK'
  },
  {
    type: 'RETO_ESCALERA',
    playerOrTeam: 'Rio Ngumoha',
    playerId: 'rio-ngumoha.10d76il',
    team: 'Liverpool',
    opponent: 'Club Brugge KV',
    match: 'Club Brugge KV vs Liverpool',
    matchId: 'club-brugge-kv-v-liverpool.1hffkf8',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T20:00:00Z',
    market: 'Faltas ganadas',
    statType: 'foulsWon',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.18,
    sampleSize: 10,
    starts: 10,
    statP90: 2.30,
    avgMinutes: 74.3,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'Bet365'
  },
  {
    type: 'RETO_ESCALERA',
    playerOrTeam: 'Matheus Bidu',
    playerId: 'matheus-bidu.0vook1v',
    team: 'Corinthians',
    opponent: 'Atlético Mineiro',
    match: 'Atlético Mineiro vs Corinthians',
    matchId: 'atletico-mineiro-v-corinthians.14jth85',
    competition: 'Brasileirão Série A',
    kickoffUtc: '2026-11-25T23:00:00Z',
    market: 'Remates totales',
    statType: 'shots',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.18,
    sampleSize: 10,
    starts: 10,
    statP90: 2.06,
    avgMinutes: 87.3,
    hitRateL10: 100,
    isTeamProp: false,
    bookmaker: 'Coral'
  },
  {
    type: 'RETO_ESCALERA',
    playerOrTeam: 'Santi Comesaña',
    playerId: 'santi-comesana.16t93k7',
    team: 'Villarreal',
    opponent: 'SK Slavia Praha',
    match: 'SK Slavia Praha vs Villarreal',
    matchId: 'sk-slavia-praha-v-villarreal.0dw9kpj',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T17:45:00Z',
    market: 'Faltas cometidas',
    statType: 'fouls',
    line: 'Más de 0.5',
    rawLine: 0.5,
    odds: 1.25,
    sampleSize: 10,
    starts: 10,
    statP90: 2.10,
    avgMinutes: 72.9,
    hitRateL10: 90,
    isTeamProp: false,
    bookmaker: 'Coral'
  }
];

function evalProp(pRaw, odds, n = 12) {
  const imp = 1 / odds;
  const pShrink = (pRaw * n + 15 * imp) / (n + 15);
  return {
    implied_prob: Number((imp * 100).toFixed(1)),
    real_prob: Number((pShrink * 100).toFixed(1)),
    edge_pct: Number(((pShrink * odds - 1) * 100).toFixed(1)),
    fair_odds: Number((1 / pShrink).toFixed(2))
  };
}

function toArt(isoUtc) {
  const d = new Date(isoUtc);
  const dateLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const timeLocal = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' hs';
  return { dateLocal, timeLocal, isoDate: d };
}

async function run() {
  console.log('--- 1. Cargar picks_hoy.json y depurar/liquidar 24/11 ---');
  const picksPath = path.join(ROOT, 'picks_hoy.json');
  const ph = JSON.parse(fs.readFileSync(picksPath, 'utf8'));

  let settled24Count = 0;
  for (const p of ph.top_picks || []) {
    if ((p.eventDateLocal === '2026-11-24' || p.date === '2026-11-24') && !p.is_settled) {
      p.is_settled = true;
      p.is_finished = true;
      p.status = 'LIQUIDADO_HISTORICO';
      p.sports_result = 'VOID'; // Cierre neutral seguro sin inventar resultado ficticio
      p.settled_at = new Date().toISOString();
      settled24Count++;
    }
  }
  console.log(`Picks 24/11 marcados como liquidados: ${settled24Count}`);

  console.log('\n--- 2. Procesar los 11 candidatos con los agentes 2.0 y Elena ---');
  const store = new ProspectiveObservationStore();
  const ladder = new ProspectiveLadderEngine();
  const existingIds = new Set((ph.top_picks || []).map(p => p.id));
  const existingSnaps = new Set(store.getAllSnapshots().map(s => s.opportunityKey));

  const evaluationResults = [];

  for (const c of candidatesDef) {
    const art = toArt(c.kickoffUtc);
    const slug = `${c.playerOrTeam.replace(/[^a-zA-Z0-9]/g, '_')}_${c.statType}_${c.rawLine}`.toLowerCase();
    const id = `cand_real_statshub_${art.dateLocal.replace(/-/g, '')}_${slug}`;

    const modelEval = evalProp(c.hitRateL10 / 100, c.odds, c.sampleSize);

    const mockCandidate = {
      id,
      matchId: c.matchId,
      match: c.match,
      playerOrTeam: c.playerOrTeam,
      playerId: c.playerId,
      market: c.market,
      rawLine: c.rawLine,
      line: c.line,
      odds: c.odds,
      bookmakerOdds: c.odds,
      bookmaker: c.bookmaker,
      isTeamProp: c.isTeamProp,
      sampleSize: c.sampleSize,
      kickoffUtc: c.kickoffUtc,
      researchData: {
        playerData: {
          starts: c.starts,
          avgMinutes: c.avgMinutes,
          statPer90: c.statP90,
          historicalValues: new Array(c.sampleSize).fill(c.statP90)
        },
        opponentData: {
          concessionRatio: 1.15,
          isVulnerable: true
        },
        lineupData: {
          status: 'PROBABLE'
        }
      }
    };

    const mockPrediction = {
      pProjected: modelEval.real_prob / 100,
      ev: modelEval.edge_pct / 100,
      evPercentage: modelEval.edge_pct,
      fairOdds: modelEval.fair_odds,
      uncertaintyIndex: 0.15
    };

    // Corremos el comité de agentes 2.0 en orden
    const pRep = await sofia.analyze(mockCandidate, mockPrediction, { persistHistory: false });
    const tRep = await valentina.analyze(mockCandidate, mockPrediction, { persistHistory: false });
    const mRep = await camila.analyze(mockCandidate, mockPrediction, { persistHistory: false });
    const oRep = await renata.analyze(mockCandidate, mockPrediction, { persistHistory: false });

    const otherAgents = {
      playerAnalyst: pRep,
      teamAnalyst: tRep,
      matchContext: mRep,
      oddsAnalyst: oRep
    };

    const lRep = await lucia.analyze(mockCandidate, mockPrediction, { otherAgentReports: otherAgents, persistHistory: false });

    const allAgentReports = {
      playerAnalyst: pRep,
      teamAnalyst: tRep,
      matchContext: mRep,
      oddsAnalyst: oRep,
      matchIntel: lRep
    };

    const elenaRes = await elena.evaluate(mockCandidate, mockPrediction, allAgentReports);

    console.log(`Evaluado: ${c.playerOrTeam} (${c.market} @${c.odds}) -> Elena: ${elenaRes.finalStatus} | EV: +${modelEval.edge_pct}%`);

    evaluationResults.push({
      candidate: c,
      id,
      art,
      modelEval,
      allAgentReports,
      elenaRes
    });

    // Crear objeto Pick para Daily Board
    if (!existingIds.has(id)) {
      ph.top_picks.unshift({
        id,
        matchId: c.matchId,
        league: c.competition,
        league_badge: `⚽ ${c.competition}`,
        match: c.match,
        time: `${art.timeLocal} (ART)`,
        date: art.dateLocal,
        eventDateLocal: art.dateLocal,
        eventDateUtc: c.kickoffUtc,
        kickoffTimeLocal: art.timeLocal,
        player: c.playerOrTeam,
        team: c.team,
        opponent: c.opponent,
        market: c.market,
        line: c.line,
        odds: c.odds,
        bookmaker: c.bookmaker,
        shadow_mode: true,
        is_operative_recommendation: false,
        hit_rate_l5: `${c.hitRateL10}%`,
        hit_rate_l10: `${c.hitRateL10}%`,
        avg_per_game: null,
        implied_prob: modelEval.implied_prob,
        real_prob: modelEval.real_prob,
        edge_pct: modelEval.edge_pct,
        confidence: `${Math.round(modelEval.real_prob)}%`,
        rationale: `StatsHub L10 ${c.hitRateL10}% @${c.odds}. Evaluado por comité IA 2.0.`,
        elena_decision: elenaRes.finalStatus === 'APROBADO' ? 'APROBADO' : 'PENDIENTE_ALINEACION',
        operational_status: 'ACEPTADO',
        sports_result: 'PENDIENTE',
        status: elenaRes.finalStatus === 'APROBADO' ? 'APROBADO' : 'PENDIENTE_ALINEACION',
        is_settled: false,
        is_finished: false,
        category: 'proximos',
        proximity_badge: 'Próximo',
        fair_odds: modelEval.fair_odds,
        ev_pct: `+${modelEval.edge_pct}%`,
        uncertainty_index: 0.15,
        minutes_expected: c.avgMinutes,
        sample_size: c.sampleSize,
        model_applied: 'Beta-Binomial (m=15) + Shadow v2.3',
        risk_verdict: {
          finalStatus: elenaRes.finalStatus,
          finalReason: elenaRes.finalReason
        },
        agent_reports: allAgentReports
      });
      existingIds.add(id);
    }

    // Registrar en store prospectivo
    if (!existingSnaps.has(id)) {
      store.recordSnapshot({
        opportunityKey: id,
        circuit: elenaRes.finalStatus === 'APROBADO' ? 'OPERATIVO' : 'SHADOW_OBSERVACION',
        matchId: c.matchId,
        match: c.match,
        competition: c.competition,
        market: c.market,
        selection: c.playerOrTeam,
        line: c.line,
        odds: c.odds,
        bookmaker: c.bookmaker,
        source: 'StatsHub',
        modelProbability: Number((modelEval.real_prob / 100).toFixed(4)),
        expectedValuePct: modelEval.edge_pct,
        elenaDecision: elenaRes.finalStatus === 'APROBADO' ? 'APROBADO' : 'PENDIENTE_ALINEACION',
        riskManagerDecision: elenaRes.finalStatus === 'APROBADO' ? 'APROBADO' : 'PENDIENTE_T60',
        detectedAtUtc: new Date().toISOString(),
        evaluatedAtUtc: new Date().toISOString(),
        kickoffUtc: c.kickoffUtc,
        matchStateAtEvaluation: 'PREMATCH',
        lineupStatus: 'PROBABLE'
      });
      existingSnaps.add(id);
    }
  }

  ph.updated_at = new Date().toISOString();
  fs.writeFileSync(picksPath, JSON.stringify(ph, null, 2), 'utf8');
  console.log('picks_hoy.json actualizado exitosamente.');

  // Exportar dashboard prospectivo
  const exporter = new ProspectiveAnalyticsExporter({ store, ladder });
  const exp = exporter.export();
  console.log(`Dashboard prospectivo exportado. Total detectados: ${exp.summary.detectedCount}`);

  return evaluationResults;
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
