const { execSync } = require('child_process');

const raw = execSync('git show 7e25ece:picks_hoy.json', { maxBuffer: 15 * 1024 * 1024 }).toString('utf8');
const data = JSON.parse(raw);
const topPicks = data.top_picks || [];

console.log('Total top_picks at 11:55 (7e25ece):', topPicks.length);

const nov21_22 = topPicks.filter(p => p.date === '2026-11-21' || p.date === '2026-11-22' || p.eventDateLocal === '2026-11-21' || p.eventDateLocal === '2026-11-22');
console.log('Total for 21-Nov and 22-Nov at 11:55:', nov21_22.length);

nov21_22.forEach((p, idx) => {
  console.log(`${idx + 1}. [${p.id}] ${p.player || p.selection} | ${p.match} | Date: ${p.date || p.eventDateLocal} | Status: ${p.status} | Elena: ${p.risk_verdict ? p.risk_verdict.finalStatus : 'N/A'}`);
});
