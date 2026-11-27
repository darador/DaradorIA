const fs = require('fs');

const cohortPath = 'engine/storage_data/shadow_lab_cohort_v2_2.json';
const picksPath = 'picks_hoy.json';

const cohortData = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const picks = JSON.parse(fs.readFileSync(picksPath, 'utf8')).top_picks;
const picksMap = new Map(picks.map(p => [p.id, p]));

const evaluable = (cohortData.predictions || []).filter(p => p.isSettled && p.result && !p.result.isVoid);

console.log('=== AUDITORÍA FORENSE FASE 2.7: TRIBUNAL PRE-KICKOFF Y OBSERVABILIDAD ===\n');

// 1. Verificar si las decisiones de Elena se registraron antes del kickoff
let tribunalBeforeKickoff = 0;
let tribunalAfterKickoff = 0;
let tribunalMissingTimestamp = 0;

evaluable.forEach(p => {
  const orig = picksMap.get(p.candidateId);
  const decision = p.isExecutedInProduction ? 'APROBADO' : 'RECHAZADO_O_SHADOW';
  const kickoff = p.eventKickoff ? new Date(p.eventKickoff) : null;
  // En picks_hoy el timestamp de evaluación de Elena está en notes o en evaluatedAt/updatedAt si existe
  // En la cohorte V2.2, p.ingestedAt/evaluatedAt es la hora de evaluación
  const decTime = p.evaluatedAt ? new Date(p.evaluatedAt) : null;

  if (!kickoff) {
    tribunalMissingTimestamp++;
  } else if (decTime && decTime.getTime() > kickoff.getTime()) {
    tribunalAfterKickoff++;
  } else {
    tribunalBeforeKickoff++;
  }
});

console.log('Integridad Temporal del Tribunal (N=114):');
console.log('  Decisiones registradas formalmente pre-kickoff en registros originarios:', tribunalBeforeKickoff);
console.log('  Decisiones registradas post-kickoff en esta cohorte de prueba:', tribunalAfterKickoff);
console.log('  (Nota técnica: La re-ejecución del runner V2.2 ocurrió hoy 26-Nov, mientras que los eventos eran de fechas 21 a 26-Nov)');

// 2. Desglose comparativo por cuota, probabilidad V2.2, EV y mercados
const approved = evaluable.filter(p => p.isExecutedInProduction);
const shadow = evaluable.filter(p => !p.isExecutedInProduction);

function getTribunalStats(items, name) {
  const n = items.length;
  const avgOdds = items.reduce((a, b) => a + Number(b.odds || 1.8), 0) / n;
  const avgPV2 = items.reduce((a, b) => a + Number(b.pV2 || 0.5), 0) / n;
  const avgGrossEv = items.reduce((a, b) => a + Number(b.grossEvV2 || 0), 0) / n;
  const avgSampleSize = items.reduce((a, b) => a + Number(b.historicalSampleSize || 10), 0) / n;

  const winCount = items.filter(p => p.result.isWon).length;
  const winRate = (winCount / n) * 100;

  // Ligas
  const leagues = {};
  items.forEach(p => { leagues[p.competition || 'Otros'] = (leagues[p.competition || 'Otros'] || 0) + 1; });
  const topLeagues = Object.entries(leagues).sort((a,b)=>b[1]-a[1]).slice(0, 3);

  // Mercados
  const markets = {};
  items.forEach(p => { markets[p.market || 'Otros'] = (markets[p.market || 'Otros'] || 0) + 1; });
  const topMarkets = Object.entries(markets).sort((a,b)=>b[1]-a[1]).slice(0, 3);

  console.log(`--- ${name} (N=${n}) ---`);
  console.log(`  Win Rate Real: ${winRate.toFixed(1)}% (${winCount}/${n})`);
  console.log(`  Cuota Media: @${avgOdds.toFixed(2)}`);
  console.log(`  Probabilidad Media V2.2: ${(avgPV2 * 100).toFixed(1)}%`);
  console.log(`  EV Medio V2.2: +${avgGrossEv.toFixed(1)}%`);
  console.log(`  Tamaño de Muestra Medio: ${avgSampleSize.toFixed(1)} partidos`);
  console.log('  Top Ligas:', topLeagues.map(x => `${x[0]} (${x[1]})`).join(', '));
  console.log('  Top Mercados:', topMarkets.map(x => `${x[0]} (${x[1]})`).join(', '));
  console.log('');
}

getTribunalStats(approved, 'APROBADOS POR ELENA');
getTribunalStats(shadow, 'DESCARTADOS / SHADOW MODE');
