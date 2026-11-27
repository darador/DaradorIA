const fs = require('fs');
const path = require('path');

const picksPath = path.join(__dirname, '../../picks_hoy.json');
const raw = JSON.parse(fs.readFileSync(picksPath, 'utf8'));

// Approved Picks for Today Friday 27 Nov 2026
// Match: Nottingham Forest vs Chelsea
// Kickoff: 2026-11-27T20:00:00Z (17:00 ART)

const newPicks = [
  {
    id: "cand_statshub_20261127_not_che_o25_goals",
    matchId: "nottingham-forest-v-chelsea.1f5zhne",
    league: "Premier League",
    league_badge: "⚽ Premier League",
    match: "Nottingham Forest vs Chelsea",
    time: "17:00 hs (ART)",
    date: "2026-11-27",
    eventDateLocal: "2026-11-27",
    eventDateUtc: "2026-11-27T20:00:00.000Z",
    kickoffTimeLocal: "17:00 hs (ART)",
    team: "Chelsea",
    opponent: "Nottingham Forest",
    market: "Total Goles",
    line: "Más de 2.5",
    odds: 1.81,
    bookmaker: "All British Casino / Bet365",
    shadow_mode: false,
    is_operative_recommendation: true,
    hit_rate_l5: "80%",
    hit_rate_l10: "70%",
    avg_per_game: 2.8,
    implied_prob: 55.25,
    real_prob: 65.15,
    edge_pct: 17.92,
    confidence: "65%",
    rationale: "Chelsea promedia 1.7 goles/partido y Over 2.5 en 7/10 juegos. Nottingham Forest concedió 14 goles en L10 con 16.9 tiros de volumen en casa. Aprobación unánime del Tribunal 6 agentes con EV +17.9%.",
    elena_decision: "APROBADO",
    operational_status: "APROBADO",
    sports_result: "PENDIENTE",
    status: "APROBADO",
    is_settled: false,
    is_finished: false,
    category: "operativos_hoy",
    proximity_badge: "HOY 17:00",
    fair_odds: 1.535,
    ev_pct: "+17.9%",
    uncertainty_index: 0.12,
    minutes_expected: 90,
    sample_size: 10,
    model_applied: "Poisson Ensamble V2.2 + Beta Posterior (9/14)",
    risk_verdict: {
      finalStatus: "APROBADO",
      finalReason: "Filtro anti-riesgo superado (cuota 1.81 en rango óptimo). Exposición controlada 1.0U flat."
    },
    agent_reports: {
      sofia: { vote: "APROBADO", comment: "Asimetría clara frente a la cuota justa de 1.54. EV +17.9% en Premier League." },
      elena: { vote: "APROBADO", comment: "Rango de cuota ideal (1.81), sin riesgo de trampa en línea principal." },
      camila: { vote: "APROBADO", comment: "7 de 10 cumplidos en Chelsea y Forest concede sistemáticamente en L10." },
      lucia: { vote: "APROBADO", comment: "Forest en casa ataca con bloque medio/alto, propiciando contras del Chelsea." },
      valentina: { vote: "APROBADO", comment: "Disciplina arbitral estándar, sin riesgo de cierre abrupto." },
      renata: { vote: "APROBADO", comment: "Selección principal de la jornada de viernes aprobada para Daily Board." }
    }
  },
  {
    id: "cand_statshub_20261127_not_che_dc_x2",
    matchId: "nottingham-forest-v-chelsea.1f5zhne",
    league: "Premier League",
    league_badge: "⚽ Premier League",
    match: "Nottingham Forest vs Chelsea",
    time: "17:00 hs (ART)",
    date: "2026-11-27",
    eventDateLocal: "2026-11-27",
    eventDateUtc: "2026-11-27T20:00:00.000Z",
    kickoffTimeLocal: "17:00 hs (ART)",
    team: "Chelsea",
    opponent: "Nottingham Forest",
    market: "Doble Oportunidad",
    line: "Empate o Chelsea (X2)",
    odds: 1.44,
    bookmaker: "Bet365",
    shadow_mode: false,
    is_operative_recommendation: true,
    hit_rate_l5: "80%",
    hit_rate_l10: "80%",
    avg_per_game: null,
    implied_prob: 69.44,
    real_prob: 70.36,
    edge_pct: 1.32,
    confidence: "70%",
    rationale: "Chelsea invicto en 8 de sus últimos 10 partidos de Premier League. Cobertura conservadora con alta fiabilidad empírica.",
    elena_decision: "APROBADO",
    operational_status: "APROBADO",
    sports_result: "PENDIENTE",
    status: "APROBADO",
    is_settled: false,
    is_finished: false,
    category: "operativos_hoy",
    proximity_badge: "HOY 17:00",
    fair_odds: 1.421,
    ev_pct: "+1.3%",
    uncertainty_index: 0.10,
    minutes_expected: 90,
    sample_size: 10,
    model_applied: "Beta-Binomial Posterior V2.2 (10/14)",
    risk_verdict: {
      finalStatus: "APROBADO",
      finalReason: "Opción de alta probabilidad (70%) para gestión conservadora de bankroll."
    },
    agent_reports: {
      sofia: { vote: "APROBADO", comment: "Cuota 1.44 con ligera ventaja matemática frente a cuota justa 1.42." },
      elena: { vote: "APROBADO", comment: "Riesgo mínimo de varianza. Chelsea competitivo fuera de casa." },
      camila: { vote: "APROBADO", comment: "80% de cumplimiento en L10 de Premier League." },
      lucia: { vote: "APROBADO", comment: "Nottingham Forest solo ganó 1 de 4 en casa en esta racha." },
      valentina: { vote: "APROBADO", comment: "Sin contingencias disciplinarias previstas." },
      renata: { vote: "APROBADO", comment: "Opción conservadora complementaria para el Daily Board." }
    }
  }
];

// Check if already exists, else prepend
for (const p of newPicks) {
  const existingIdx = raw.top_picks.findIndex(x => x.id === p.id);
  if (existingIdx >= 0) {
    raw.top_picks[existingIdx] = p;
  } else {
    raw.top_picks.unshift(p);
  }
}

raw.last_updated = new Date().toISOString();
fs.writeFileSync(picksPath, JSON.stringify(raw, null, 2), 'utf8');
console.log(`picks_hoy.json actualizado: ${raw.top_picks.length} picks totales.`);
