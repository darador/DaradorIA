const fs = require('fs');
const path = require('path');
const storage = require('./data/storage');
const syncRadar = require('./data/syncRadar');

const resultsPath = path.join(__dirname, 'storage_data', 'pick_results.json');
let existingResults = [];
if (fs.existsSync(resultsPath)) {
  try {
    existingResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch (e) {
    existingResults = [];
  }
}

const afternoonAndNightResults = [
  // Tarde - UEFA Women's Champions League
  {
    pickId: 'cand_1795110774831_05zbdy',
    date: '2026-11-19',
    match: 'Olympique Lyonnais vs Arsenal',
    player: 'Olympique Lyonnais (Equipo)',
    market: 'Remates al arco de equipo',
    line: 'Más de 5.5',
    odds: 1.72,
    targetLine: 5.5,
    actualStat: 8,
    matchScore: '0-2',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.72,
    settledAt: new Date().toISOString()
  },
  {
    pickId: 'cand_1795110774831_9pw61t',
    date: '2026-11-19',
    match: 'Arsenal vs Olympique Lyonnais',
    player: 'Arsenal (Equipo)',
    market: 'Córners de equipo',
    line: 'Más de 4.5',
    odds: 2.07,
    targetLine: 4.5,
    actualStat: 2,
    matchScore: '0-2',
    status: 'PERDIDA',
    stakedUnits: 1,
    profitUnits: -1.00,
    settledAt: new Date().toISOString()
  },
  {
    pickId: 'cand_1795110774831_56ms2b',
    date: '2026-11-19',
    match: 'Arsenal vs Olympique Lyonnais',
    player: 'Arsenal (Equipo)',
    market: 'Remates al arco de equipo',
    line: 'Más de 3.5',
    odds: 1.76,
    targetLine: 3.5,
    actualStat: 1,
    matchScore: '0-2',
    status: 'PERDIDA',
    stakedUnits: 1,
    profitUnits: -1.00,
    settledAt: new Date().toISOString()
  },
  {
    pickId: 'cand_1795110774831_uhvh6d',
    date: '2026-11-19',
    match: 'AS Roma vs Benfica',
    player: 'AS Roma (Equipo)',
    market: 'Goles de equipo',
    line: 'Más de 1.5',
    odds: 2.20,
    targetLine: 1.5,
    actualStat: 3,
    matchScore: '3-2',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 1.20,
    settledAt: new Date().toISOString()
  },

  // Tarde - Dinamarca 1st Division
  {
    pickId: 'cand_1795110774831_hmkyeq',
    date: '2026-11-19',
    match: 'Hillerød vs FC Fredericia',
    player: 'Hillerød (Equipo)',
    market: 'Goles de equipo',
    line: 'Más de 0.5',
    odds: 1.67,
    targetLine: 0.5,
    actualStat: 1,
    matchScore: '1-4',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.67,
    settledAt: new Date().toISOString()
  },

  // Tarde - Uruguay Primera División
  {
    pickId: 'cand_1795110774831_b9lame',
    date: '2026-11-19',
    match: 'Cerro Largo vs Peñarol',
    player: 'Cerro Largo (Equipo)',
    market: 'Córners de equipo',
    line: 'Más de 2.5',
    odds: 1.80,
    targetLine: 2.5,
    actualStat: 7,
    matchScore: '0-3',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.80,
    settledAt: new Date().toISOString()
  },
  {
    pickId: 'cand_1795110774831_3q13a7',
    date: '2026-11-19',
    match: 'Progreso vs Montevideo City Torque',
    player: 'Progreso (Equipo)',
    market: 'Córners de equipo',
    line: 'Más de 3.5',
    odds: 1.73,
    targetLine: 3.5,
    actualStat: 5,
    matchScore: '1-1',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.73,
    settledAt: new Date().toISOString()
  },

  // Tarde - Argelia Ligue 1
  {
    pickId: 'cand_1795110774831_fa98d7',
    date: '2026-11-19',
    match: 'USM Alger vs JS Kabylie',
    player: 'USM Alger (Equipo)',
    market: 'Goles de equipo',
    line: 'Más de 0.5',
    odds: 1.62,
    targetLine: 0.5,
    actualStat: 0,
    matchScore: '0-2',
    status: 'PERDIDA',
    stakedUnits: 1,
    profitUnits: -1.00,
    settledAt: new Date().toISOString()
  },

  // Noche adicional - Jugadores y Remates Brasileirão
  {
    pickId: 'cand_1795110774831_6k1oex',
    date: '2026-11-19',
    match: 'Internacional vs Vasco da Gama',
    player: 'Bruno Gomes',
    market: 'Remates totales',
    line: 'Más de 0.5',
    odds: 1.83,
    targetLine: 0.5,
    actualStat: 1,
    matchScore: '0-1',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.83,
    settledAt: new Date().toISOString()
  },
  {
    pickId: 'cand_1795110774831_0x1sao',
    date: '2026-11-19',
    match: 'Red Bull Bragantino vs Vitória',
    player: 'Gustavo Marques Alves dos Santos',
    market: 'Remates totales',
    line: 'Más de 0.5',
    odds: 1.80,
    targetLine: 0.5,
    actualStat: 1,
    matchScore: '0-2',
    status: 'GANADA',
    stakedUnits: 1,
    profitUnits: 0.80,
    settledAt: new Date().toISOString()
  },
  {
    pickId: 'cand_1795110774831_6rsb2k',
    date: '2026-11-19',
    match: 'Internacional vs Vasco da Gama',
    player: 'Internacional (Equipo)',
    market: 'Remates al arco de equipo',
    line: 'Más de 3.5',
    odds: 2.00,
    targetLine: 3.5,
    actualStat: 2,
    matchScore: '0-1',
    status: 'PERDIDA',
    stakedUnits: 1,
    profitUnits: -1.00,
    settledAt: new Date().toISOString()
  }
];

// Fusionar sin duplicar
for (const item of afternoonAndNightResults) {
  const existingIndex = existingResults.findIndex(r => r.pickId === item.pickId || (r.match === item.match && r.player === item.player && r.market === item.market && r.line === item.line));
  if (existingIndex >= 0) {
    existingResults[existingIndex] = { ...existingResults[existingIndex], ...item };
  } else {
    item.id = `res_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    existingResults.push(item);
  }
}

fs.writeFileSync(resultsPath, JSON.stringify(existingResults, null, 2), 'utf8');
console.log(`Guardados ${existingResults.length} resultados en pick_results.json.`);

// Ejecutar sincronización hacia historial_picks.json
const updatedHistorial = syncRadar.exportToHistorial();
console.log('Historial actualizado exitosamente:');
console.log(JSON.stringify(updatedHistorial.summary, null, 2));
