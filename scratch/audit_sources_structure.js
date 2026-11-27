const fs = require('fs');

const researchPath = 'engine/storage_data/research_candidates.json';
const picksPath = 'picks_hoy.json';

const researchData = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
const picksData = JSON.parse(fs.readFileSync(picksPath, 'utf8'));

console.log('=== AUDITORÍA ESTRUCTURAL DE FUENTES ===\n');
console.log('Total en research_candidates.json:', researchData.length);
console.log('Total en picks_hoy.json:', picksData.top_picks?.length);

// 1. Estructura de research_candidates
const rSample = researchData[0];
console.log('\n--- Estructura Candidate en research_candidates ---');
console.log('Claves principales:', Object.keys(rSample));
console.log('researchData keys:', Object.keys(rSample.researchData || {}));
if (rSample.researchData?.teamData) {
  console.log('teamData keys:', Object.keys(rSample.researchData.teamData));
}
if (rSample.researchData?.playerData) {
  console.log('playerData keys:', Object.keys(rSample.researchData.playerData));
}

// 2. Cobertura de historicalValues en research_candidates
let withTeamHist = 0;
let withPlayerHist = 0;
let withAnyHist = 0;

researchData.forEach(c => {
  const tHist = c.researchData?.teamData?.historicalValues;
  const pHist = c.researchData?.playerData?.historicalValues;
  const hasT = Array.isArray(tHist) && tHist.length > 0;
  const hasP = Array.isArray(pHist) && pHist.length > 0;
  if (hasT) withTeamHist++;
  if (hasP) withPlayerHist++;
  if (hasT || hasP) withAnyHist++;
});

console.log('\n--- Cobertura en research_candidates (189 total) ---');
console.log('Candidatos con teamData.historicalValues:', withTeamHist);
console.log('Candidatos con playerData.historicalValues:', withPlayerHist);
console.log('Candidatos con alguna serie histórica:', withAnyHist);

// 3. Estructura de picks_hoy.json
const pSample = picksData.top_picks[0];
console.log('\n--- Estructura Pick en picks_hoy.json ---');
console.log('Claves de pick:', Object.keys(pSample));
console.log('ID match format:', pSample.id);
console.log('hit_rate_l10 formato:', pSample.hit_rate_l10);
console.log('avg_per_game:', pSample.avg_per_game);

// 4. Intersección de IDs entre picks_hoy y research_candidates
const researchIds = new Set(researchData.map(c => c.id));
let matchedIds = 0;
picksData.top_picks.forEach(p => {
  if (researchIds.has(p.id)) matchedIds++;
});

console.log('\n--- Intersección de IDs ---');
console.log(`Picks de picks_hoy encontrados en research_candidates: ${matchedIds} de ${picksData.top_picks.length}`);
