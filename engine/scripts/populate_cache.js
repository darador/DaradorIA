const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function genKey(toolName, args = {}) {
  const sortedArgs = Object.keys(args).sort().reduce((acc, key) => { acc[key] = args[key]; return acc; }, {});
  return crypto.createHash('md5').update(toolName + ':' + JSON.stringify(sortedArgs)).digest('hex');
}

const cacheDir = path.resolve(__dirname, '..', 'storage_data', 'cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

function writeCache(toolName, args, data) {
  const key = genKey(toolName, args);
  const filePath = path.join(cacheDir, `${key}.json`);
  const record = {
    toolName,
    args,
    cachedAt: new Date().toISOString(),
    expiresAt: Date.now() + 86400 * 1000 * 7, // 7 days
    data
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  console.log(`[Cache Written] ${toolName} -> ${key}.json`);
}

// 1. Fixtures
const fixturesRaw = {
  context: "Fixtures Fri 20 Nov 2026 · all competitions · 128 fixtures in 59 competitions",
  fixtureCount: 128,
  fixturesSummary: `LaLiga (Spain) [competitionId laliga-spain.1ddpw68]:\n- 20:00 Athletic Club v Espanyol (id athletic-club-v-espanyol.1nr7dwb)\nBundesliga (Germany) [competitionId bundesliga-germany.19a8rva]:\n- 19:30 FC Bayern München v 1. FC Köln (id fc-bayern-munchen-v-1-fc-koln.1jrqbda)\nLigue 1 (France) [competitionId ligue-1-france.13zyav8]:\n- 19:45 Troyes v Le Havre (id troyes-v-le-havre.1d1nhy2)\nLeague One (England) [competitionId league-one-england.11gsq3d]:\n- 20:00 Barnsley v Sheffield Wednesday (id barnsley-v-sheffield-wednesday.1l22e1h)\nSaudi Pro League (Saudi Arabia) [competitionId saudi-pro-league-saudi-arabia.0wi7vkt]:\n- 17:30 Al-Ahli v Al-Nassr (id al-ahli-v-al-nassr.0nf5zra)\nLaLiga 2 (Spain) [competitionId laliga-2-spain.16i000w]:\n- 19:30 FC Andorra v Leganés (id fc-andorra-v-leganes.1ogj9zl)\n2. Bundesliga (Germany) [competitionId bundesliga-germany.01t3c53]:\n- 17:30 Darmstadt 98 v 1. FC Heidenheim (id darmstadt-98-v-1-fc-heidenheim.0ujav4x)\nSerie B (Italy) [competitionId serie-b-italy.0hy1oe0]:\n- 19:30 Hellas Verona v Cesena (id hellas-verona-v-cesena.073tag2)`
};
writeCache('getFixturesByDate', { date: '2026-11-20' }, fixturesRaw);

// 2. Player Props
const ptxt = fs.readFileSync('C:/Users/ruben/.gemini/antigravity/brain/5096bdb1-d787-4c85-9b33-1f54923c5a86/.system_generated/steps/3688/output.txt', 'utf8').split('StatsHub page for this result')[0].trim();
const pdata = JSON.parse(ptxt);
writeCache('getPropScreener', {
  selectedDates: ['2026-11-20'],
  oddsFrom: 1.55,
  oddsTo: 2.45,
  hitRateFrom: 60,
  hitRateOption: 'L10',
  hitRateScope: 'all',
  type: 'over',
  lineupFilterType: 'predicted',
  pageSize: 30,
  statTypes: ['shots', 'shotsOnTarget', 'fouls', 'foulsWon', 'tackles', 'scoredOrAssisted']
}, pdata);

// 3. Team Props
const ttxt = fs.readFileSync('C:/Users/ruben/.gemini/antigravity/brain/5096bdb1-d787-4c85-9b33-1f54923c5a86/.system_generated/steps/3690/output.txt', 'utf8').split('StatsHub page for this result')[0].trim();
const tdata = JSON.parse(ttxt);
writeCache('getTeamPropScreener', {
  selectedDates: ['2026-11-20'],
  minOdds: 1.55,
  maxOdds: 2.45,
  minHitRateL10: 60,
  oddsType: 'over',
  limit: 25,
  statTypes: ['shots', 'shotsOnTarget', 'corners', 'cards', 'goals']
}, tdata);

// 4. Player Trends
const ytxt = fs.readFileSync('C:/Users/ruben/.gemini/antigravity/brain/5096bdb1-d787-4c85-9b33-1f54923c5a86/.system_generated/steps/3692/output.txt', 'utf8').split('StatsHub page for this result')[0].trim();
const ydata = JSON.parse(ytxt);
writeCache('getPlayerTrends', {
  oddsFrom: 1.55,
  oddsTo: 2.45,
  minHitRate: 60,
  type: 'over',
  pageSize: 25,
  lineup: 'predicted'
}, ydata);

// 5. Outliers
const otxt = fs.readFileSync('C:/Users/ruben/.gemini/antigravity/brain/5096bdb1-d787-4c85-9b33-1f54923c5a86/.system_generated/steps/3696/output.txt', 'utf8').split('StatsHub page for this result')[0].trim();
const odata = JSON.parse(otxt);
writeCache('getOutliers', {
  minOdds: 1.55,
  maxOdds: 2.45,
  limit: 20
}, odata);

console.log('Cache population completed successfully.');
