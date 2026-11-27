/**
 * SYNC EXPERIMENTAL PICKS TO DAILY BOARD (V2.4 INTEGRATION)
 * Publica los candidatos prospectivos de la jornada en picks_hoy.json respetando
 * estrictamente las reglas de publicación:
 * - Aprobados con EV >= +8%, cuota [1.45, 2.20], DQE VALID y Comité: EXPERIMENTAL_APPROVED
 * - Evaluaciones con DQE LIMITED o pendientes: UNDER_RESEARCH o SHADOW_PASSIVE
 * - Rechazados: REJECTED
 * - Cero publicación de los 67 históricos retrospectivos como nuevas oportunidades
 */

const fs = require('fs');
const path = require('path');

const PICKS_PATH = path.resolve(__dirname, '../../picks_hoy.json');
const raw = JSON.parse(fs.readFileSync(PICKS_PATH, 'utf8'));

const prospectiveV24 = [
  // 1. Brentford X2 (1.71) - Aprobado por el Tribunal con EV +18.85% (DQE VALID)
  {
    id: "cand_v24_20261128_mun_bre_dc_x2",
    matchId: "manchester-united-v-brentford.0ntpzlq",
    league: "Premier League",
    league_badge: "⚽ Premier League",
    match: "Manchester United vs Brentford",
    time: "12:00 hs (ART)",
    date: "2026-11-28",
    eventDateLocal: "2026-11-28",
    eventDateUtc: "2026-11-28T15:00:00.000Z",
    kickoffTimeLocal: "12:00 hs (ART)",
    team: "Brentford",
    opponent: "Manchester United",
    player: "Brentford (Equipo)",
    market: "Doble Oportunidad",
    line: "Empate o Brentford (X2)",
    odds: 1.71,
    bookmaker: "BetMGM UK",
    origin: "EXPERIMENTAL_V24",
    policy: "EXPERIMENTAL_ODDS_V24",
    shadow_mode: true,
    is_operative_recommendation: false,
    hit_rate_l5: "80%",
    hit_rate_l10: "80%",
    avg_per_game: null,
    implied_prob: 58.48,
    real_prob: 69.50,
    prob_v1: 71.43,
    prob_v22: 69.50,
    edge_pct: 18.85,
    ev_pct: "+18.9%",
    fair_odds: 1.439,
    dqe_status: "VALID",
    confidence: "70%",
    rationale: "Brentford invicto en 8 de sus últimos 10 partidos. Manchester United registra solo 1 victoria en L10. Aprobado por el Comité bajo protocolo V2.4.",
    elena_decision: "EXPERIMENTAL_APPROVED",
    operational_status: "EXPERIMENTAL_APPROVED",
    sports_result: "PENDIENTE",
    status: "EXPERIMENTAL_APPROVED",
    is_settled: false,
    is_finished: false,
    category: "operativos_manana",
    proximity_badge: "MAÑANA 12:00",
    sample_size: 10,
    model_applied: "Beta-Binomial V2.2 Live (8/10)",
    stake: null,
    risk_verdict: {
      finalStatus: "EXPERIMENTAL_APPROVED",
      finalReason: "Validación cuantitativa V2.4 superada (EV +18.9% a cuota 1.71). Selección experimental aislada de stake productivo."
    },
    agent_reports: {
      sofia: { vote: "APROBADO", comment: "Consistencia colectiva de Brentford óptima para cuota 1.71." },
      valentina: { vote: "APROBADO", comment: "Manchester United vulnerable en transiciones y con 1 sola victoria en L10." },
      camila: { vote: "APROBADO", comment: "Sin bajas críticas en Brentford que comprometan el bloque titular." },
      renata: { vote: "APROBADO", comment: "Cuota 1.71 en BetMGM UK ofrece un edge de +18.85% frente a cuota justa de 1.44." },
      lucia: { vote: "APROBADO", comment: "Presión táctica sobre el técnico de United favorece planteo de contragolpe visitante." },
      elena: { vote: "APROBADO", comment: "EXPERIMENTAL_APPROVED: Parámetros V2.4 superados en cuota [1.45, 2.20] y EV >= +8%." }
    }
  },

  // 2. Real Madrid vs Alavés Under 3.5 Goles (2.03) - Aprobado por el Tribunal con EV +18.15% (DQE VALID)
  {
    id: "cand_v24_20261128_rma_ala_u35_goals",
    matchId: "real-madrid-v-deportivo-alaves.0kuzzgl",
    league: "LaLiga",
    league_badge: "🇪🇸 LaLiga",
    match: "Real Madrid vs Deportivo Alavés",
    time: "17:00 hs (ART)",
    date: "2026-11-28",
    eventDateLocal: "2026-11-28",
    eventDateUtc: "2026-11-28T20:00:00.000Z",
    kickoffTimeLocal: "17:00 hs (ART)",
    team: "Real Madrid / Deportivo Alavés",
    opponent: "Deportivo Alavés",
    player: "Real Madrid / Alavés (Equipo)",
    market: "Total Goles",
    line: "Menos de 3.5",
    odds: 2.03,
    bookmaker: "Bet365",
    origin: "EXPERIMENTAL_V24",
    policy: "EXPERIMENTAL_ODDS_V24",
    shadow_mode: true,
    is_operative_recommendation: false,
    hit_rate_l5: "80%",
    hit_rate_l10: "60%",
    avg_per_game: 2.4,
    implied_prob: 49.26,
    real_prob: 58.20,
    prob_v1: 57.14,
    prob_v22: 58.20,
    edge_pct: 18.15,
    ev_pct: "+18.2%",
    fair_odds: 1.718,
    dqe_status: "VALID",
    confidence: "58%",
    rationale: "Alavés presenta bloque bajo compacto fuera de casa. Real Madrid gestiona cargas de calendario. Valor positivo significativo a cuota superior a par (@2.03).",
    elena_decision: "EXPERIMENTAL_APPROVED",
    operational_status: "EXPERIMENTAL_APPROVED",
    sports_result: "PENDIENTE",
    status: "EXPERIMENTAL_APPROVED",
    is_settled: false,
    is_finished: false,
    category: "operativos_manana",
    proximity_badge: "MAÑANA 17:00",
    sample_size: 10,
    model_applied: "Poisson Ensamble V2.2 (m=10)",
    stake: null,
    risk_verdict: {
      finalStatus: "EXPERIMENTAL_APPROVED",
      finalReason: "Validación cuantitativa V2.4 superada (EV +18.2% a cuota 2.03). Selección experimental aislada de stake productivo."
    },
    agent_reports: {
      sofia: { vote: "APROBADO", comment: "Volumen de remates concedidos por Alavés no suele traducirse en goleadas." },
      valentina: { vote: "APROBADO", comment: "Estructura defensiva 5-4-1 prevista en bloque bajo de Alavés." },
      camila: { vote: "APROBADO", comment: "Rotaciones ofensivas en Real Madrid tras jornada europea." },
      renata: { vote: "APROBADO", comment: "Cuota 2.03 generosa frente a línea justa de 1.72." },
      lucia: { vote: "APROBADO", comment: "Sin bajas críticas en retaguardia visitante." },
      elena: { vote: "APROBADO", comment: "EXPERIMENTAL_APPROVED: Línea conservadora de 3.5 con EV robusto." }
    }
  },

  // 3. Inter vs Genoa Under 3.5 Tarjetas (1.85) - DQE LIMITED (UNDER_RESEARCH)
  {
    id: "cand_v24_20261128_int_gen_u35_cards",
    matchId: "inter-v-genoa.0yo20h3",
    league: "Serie A",
    league_badge: "🇮🇹 Serie A",
    match: "Inter vs Genoa",
    time: "16:45 hs (ART)",
    date: "2026-11-28",
    eventDateLocal: "2026-11-28",
    eventDateUtc: "2026-11-28T19:45:00.000Z",
    kickoffTimeLocal: "16:45 hs (ART)",
    team: "Inter / Genoa",
    opponent: "Genoa",
    player: "Inter / Genoa (Equipo)",
    market: "Tarjetas",
    line: "Menos de 3.5",
    odds: 1.85,
    bookmaker: "10bet",
    origin: "EXPERIMENTAL_V24",
    policy: "EXPERIMENTAL_ODDS_V24",
    shadow_mode: true,
    is_operative_recommendation: false,
    hit_rate_l5: "80%",
    hit_rate_l10: "70%",
    avg_per_game: 2.9,
    implied_prob: 54.05,
    real_prob: 62.00,
    prob_v1: 64.29,
    prob_v22: 62.00,
    edge_pct: 14.70,
    ev_pct: "+14.7%",
    fair_odds: 1.613,
    dqe_status: "LIMITED",
    confidence: "62%",
    rationale: "Inter y Genoa promedian bajas faltas por encuentro. Requiere confirmación de árbitro oficial.",
    elena_decision: "UNDER_RESEARCH",
    operational_status: "UNDER_RESEARCH",
    sports_result: "PENDIENTE",
    status: "UNDER_RESEARCH",
    is_settled: false,
    is_finished: false,
    category: "operativos_manana",
    proximity_badge: "MAÑANA 16:45",
    sample_size: 10,
    model_applied: "Poisson V2.2 (m=10)",
    stake: null,
    risk_verdict: {
      finalStatus: "UNDER_RESEARCH",
      finalReason: "DQE LIMITED: designación arbitral pendiente de ratificación. No apto para aprobación hasta T-60."
    },
    agent_reports: {
      sofia: { vote: "NEUTRAL", comment: "Faltas proyectadas bajas pero árbitro pendiente." },
      valentina: { vote: "FAVORABLE", comment: "Ritmo fluido sin fricción excesiva." },
      camila: { vote: "NEUTRAL", comment: "Árbitro no ratificado." },
      renata: { vote: "FAVORABLE", comment: "Cuota 1.85 atractiva frente a justa 1.61." },
      lucia: { vote: "NEUTRAL", comment: "Sin novedades disciplinarias." },
      elena: { vote: "PENDIENTE", comment: "Retenido en UNDER_RESEARCH por DQE LIMITED." }
    }
  }
];

// Preservar picks existentes y actualizar/agregar
prospectiveV24.forEach(p => {
  const idx = raw.top_picks.findIndex(x => x.id === p.id);
  if (idx >= 0) raw.top_picks[idx] = p;
  else raw.top_picks.unshift(p);
});

// Asegurar que picks históricos tengan origin definido para el filtro
raw.top_picks.forEach(p => {
  if (!p.origin) {
    if (p.policy === 'EXPERIMENTAL_ODDS_V24') p.origin = 'EXPERIMENTAL_V24';
    else if (p.shadow_mode || p.status === 'SHADOW_PASSIVE') p.origin = 'SHADOW';
    else p.origin = 'PRODUCTION';
  }
});

raw.last_updated = new Date().toISOString();
fs.writeFileSync(PICKS_PATH, JSON.stringify(raw, null, 2), 'utf8');
console.log(`picks_hoy.json actualizado exitosamente con candidatos V2.4 (${raw.top_picks.length} totales).`);
