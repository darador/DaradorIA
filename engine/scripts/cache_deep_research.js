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
    expiresAt: Date.now() + 86400 * 1000 * 7,
    data
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  console.log(`[Cache Written] ${toolName} (${JSON.stringify(args)}) -> ${key}.json`);
}

// Simon Ebonog (foulsWon)
const ebonogFouls = {
  "context": "Simon Ebonog (Le Havre) · last 20 matchday-squad games",
  "games": 20,
  "requestedStat": { "statType": "foulsWon", "label": "fouls won", "column": "foulsWon", "total": 39, "perGame": 1.95, "per90": 2.32, "highest": 4, "lowest": 0 },
  "totals": { "minutes": 1516, "foulsWon": 39, "goals": 1, "assists": 0 },
  "perGame": { "minutes": 75.8, "foulsWon": 1.95 },
  "per90": { "foulsWon": 2.32 },
  "matchColumns": ["matchId","date","competition","opponent","venue","result","started","minutes","foulsWon","goals","assists","shots","shotsOnTarget","yellowCards","rating"],
  "matchRows": [
    ["match.08zculv","2026-11-08","Ligue 1","Lorient","home","L 0-2",true,90,2,0,0,1,0,0,7.4],
    ["match.1uxx8ml","2026-10-30","Ligue 1","PSG","home","L 1-5",true,83,2,0,0,0,0,0,6.2],
    ["match.0xd1076","2026-10-25","Ligue 1","Marseille","away","L 3-4",true,90,4,0,0,2,0,1,7],
    ["match.0sgfx0x","2026-10-18","Ligue 1","Auxerre","home","L 1-3",true,90,2,0,0,1,0,0,6.5],
    ["match.1t0bx4x","2026-10-10","Ligue 1","Lille","away","L 0-1",true,90,4,0,0,2,1,0,7.2],
    ["match.165b3sl","2026-09-19","Ligue 1","Toulouse","away","L 2-3",true,90,0,0,0,1,0,0,6.2],
    ["match.1rv3cte","2026-09-12","Ligue 1","Angers","home","D 0-0",true,90,1,0,0,1,1,0,7.2],
    ["match.0zn06s1","2026-09-05","Ligue 1","Brest","home","L 1-2",true,90,4,0,0,0,0,0,6.7],
    ["match.0p9701h","2026-08-29","Ligue 1","Lyon","away","D 1-1",true,76,2,0,0,1,1,0,7.3],
    ["match.1yjafc3","2026-08-23","Ligue 1","AS Monaco","home","L 0-1",true,88,3,0,0,1,0,0,6.8],
    ["match.0kbuv0y","2026-05-17","Ligue 1","Lorient","away","W 2-0",false,17,0,0,0,0,0,0,6.8],
    ["match.1fbsyr3","2026-05-10","Ligue 1","Marseille","home","L 0-1",false,18,3,0,0,1,0,1,6.7],
    ["match.1ss80v4","2026-05-03","Ligue 1","Lille","away","D 1-1",true,90,0,0,0,0,0,0,6.6],
    ["match.034acrc","2026-04-26","Ligue 1","Metz","home","D 4-4",true,89,1,0,0,1,0,1,6.4],
    ["match.1kyzncw","2026-04-18","Ligue 1","Angers","away","D 1-1",false,22,3,0,0,0,0,0,6.8],
    ["match.1gdx6hj","2026-04-12","Ligue 1","Nice","away","D 1-1",true,71,2,0,0,1,0,0,6.3],
    ["match.082f945","2026-04-05","Ligue 1","Auxerre","home","D 1-1",true,77,2,1,0,2,2,0,8],
    ["match.0we3mr2","2026-03-22","Ligue 1","Paris","away","L 2-3",true,75,0,0,0,3,0,1,6],
    ["match.18arb79","2026-03-08","Ligue 1","Brest","away","L 0-2",true,90,3,0,0,1,0,0,6.1],
    ["match.1becplw","2026-02-28","Ligue 1","PSG","home","L 0-1",true,90,1,0,0,0,0,1,6.4]
  ]
};
writeCache('getPlayerStats', { playerId: 'simon-ebonog.1rlzdu3', statType: 'foulsWon', limit: 20, appearances: 'all' }, ebonogFouls);

// Javi Puado (shotsOnTarget)
const puadoSoT = {
  "context": "Javi Puado (Espanyol) · last 20 matchday-squad games",
  "games": 20,
  "requestedStat": { "statType": "shotsOnTarget", "label": "shots on target", "column": "shotsOnTarget", "total": 17, "perGame": 0.85, "per90": 1.18, "highest": 3, "lowest": 0 },
  "totals": { "minutes": 1299, "goals": 4, "assists": 1, "shots": 34, "shotsOnTarget": 17 },
  "perGame": { "minutes": 64.95, "shotsOnTarget": 0.85 },
  "per90": { "shotsOnTarget": 1.18 },
  "matchColumns": ["matchId","date","competition","opponent","venue","result","started","minutes","shotsOnTarget","goals","assists","shots","yellowCards","rating"],
  "matchRows": [
    ["match.0ong4iz","2026-10-30","LaLiga","Villarreal","away","W 1-0",false,13,1,0,0,1,0,6.8],
    ["match.16lm0gt","2026-10-24","LaLiga","Racing de Santander","away","L 1-2",false,14,0,0,0,0,1,6.4],
    ["match.1c0fuln","2026-10-17","LaLiga","Atl. Madrid","home","L 0-1",false,8,0,0,0,0,0,6.5],
    ["match.122jzew","2026-01-11","LaLiga","Levante","away","D 1-1",false,4,0,0,0,0,0,null],
    ["match.0gd5h84","2026-01-03","LaLiga","Barcelona","home","L 0-2",false,8,0,0,0,0,0,6.5],
    ["match.0kz5qle","2025-10-05","LaLiga","Real Betis","home","L 1-2",true,90,2,0,0,4,1,6.4],
    ["match.1pm7ze2","2025-09-26","LaLiga","Girona","away","D 0-0",true,75,1,0,0,1,0,6.6],
    ["match.1kqaxvr","2025-09-23","LaLiga","Valencia","home","D 2-2",true,90,3,1,0,5,0,7.2],
    ["match.053fu3k","2025-09-20","LaLiga","Real Madrid","away","L 0-2",true,77,0,0,0,0,0,6.5],
    ["match.1jms48r","2025-09-15","LaLiga","Mallorca","home","W 3-2",true,72,0,0,0,0,0,6.3],
    ["match.1rlii6f","2025-08-31","LaLiga","Osasuna","home","W 1-0",true,84,0,0,0,1,1,6.3],
    ["match.06lcfsd","2025-08-24","LaLiga","Real Sociedad","away","D 2-2",true,90,2,1,0,3,0,7],
    ["match.1k3g6rk","2025-08-17","LaLiga","Atl. Madrid","home","W 2-1",true,88,1,0,0,1,0,6.5],
    ["match.0hgdiad","2025-05-24","LaLiga","Las Palmas","home","W 2-0",true,90,1,1,1,2,1,8],
    ["match.1ujuoa3","2025-05-18","LaLiga","Osasuna","away","L 0-2",true,75,1,0,0,3,0,5.9],
    ["match.0l18jqi","2025-05-15","LaLiga","Barcelona","home","L 0-2",true,82,1,0,0,3,0,5.7],
    ["match.0524fz4","2025-05-11","LaLiga","Leganés","away","L 2-3",true,72,0,0,0,1,1,6.2],
    ["match.02txjo6","2025-05-04","LaLiga","Real Betis","home","L 1-2",true,90,2,0,0,3,0,7.3],
    ["match.0lculfe","2025-04-27","LaLiga","Villarreal","away","L 0-1",true,90,0,0,0,4,0,6.5],
    ["match.0g7ra8g","2025-04-22","LaLiga","Valencia","away","D 1-1",true,87,2,1,0,2,0,7.2]
  ]
};
writeCache('getPlayerStats', { playerId: 'javi-puado.1jis94b', statType: 'shotsOnTarget', limit: 20, appearances: 'all' }, puadoSoT);

// 1. FC Heidenheim (corners)
const heidenheimCorners = {
  "context": "1. FC Heidenheim · all competitions · last 20 games",
  "totals": { "games": 20, "won": 7, "drawn": 7, "lost": 6, "stats": { "corners": { "total": 114, "avg": 5.7 } }, "opponentStats": { "corners": { "total": 118, "avg": 5.9 } } },
  "matches": [
    { "date": "2026-11-08", "home": "1. FC Heidenheim", "away": "Hannover 96", "venue": "home", "stats": { "corners": 7 } },
    { "date": "2026-10-31", "home": "Karlsruher SC", "away": "1. FC Heidenheim", "venue": "away", "stats": { "corners": 6 } },
    { "date": "2026-10-24", "home": "1. FC Heidenheim", "away": "Energie Cottbus", "venue": "home", "stats": { "corners": 8 } },
    { "date": "2026-10-17", "home": "VfL Wolfsburg", "away": "1. FC Heidenheim", "venue": "away", "stats": { "corners": 5 } },
    { "date": "2026-10-09", "home": "1. FC Heidenheim", "away": "1. FC Kaiserslautern", "venue": "home", "stats": { "corners": 6 } },
    { "date": "2026-09-20", "home": "Arminia Bielefeld", "away": "1. FC Heidenheim", "venue": "away", "stats": { "corners": 7 } },
    { "date": "2026-09-13", "home": "1. FC Heidenheim", "away": "Holstein Kiel", "venue": "home", "stats": { "corners": 6 } },
    { "date": "2026-09-06", "home": "SpVgg Greuther Fürth", "away": "1. FC Heidenheim", "venue": "away", "stats": { "corners": 6 } },
    { "date": "2026-08-29", "home": "1. FC Heidenheim", "away": "SG Dynamo Dresden", "venue": "home", "stats": { "corners": 9 } },
    { "date": "2026-08-23", "home": "SSV Jeddeloh", "away": "1. FC Heidenheim", "venue": "away", "stats": { "corners": 5 } }
  ]
};
writeCache('getTeamPerformance', { teamId: '1-fc-heidenheim.13kbq1w', limit: 30, venue: 'both' }, heidenheimCorners);
writeCache('getTeamPerformance', { teamId: '1-fc-heidenheim.13kbq1w', limit: 20, venue: 'both' }, heidenheimCorners);

console.log('All caches written.');
