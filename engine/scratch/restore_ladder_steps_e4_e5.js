/**
 * RESTORE LADDER STEPS E3, E4, E5
 * Reconcilia y restaura el estado canónico del Reto Escalera a Ciclo 1 · Escalón 6:
 * E1: SK Slavia Praha vs Villarreal ($50.000 -> $57.500 @1.15)
 * E2: Atlético Madrid vs Viking FK ($57.500 -> $64.975 @1.13)
 * E3: Atlético Mineiro vs Corinthians - Matheus Bidu ($64.975 -> $71.472,50 @1.10)
 * E4: Besiktas vs Hapoel Be'er Sheva - Besiktas ($71.472,50 -> $102.920,40 @1.44)
 * E5: Sao Paulo vs Remo - Sao Paulo ($102.920,40 -> $143.059,36 @1.39)
 * Estado actual: Escalón 6 | Capital: $143.059,36 ARS | Beneficio: +$93.059,36 ARS | Sin apuesta abierta
 */

const fs = require('fs');
const path = require('path');

const LADDER_FILE = path.resolve(__dirname, '..', 'storage_data', 'fase11_prospective_ladder.json');
const DASHBOARD_API_FILE = path.resolve(__dirname, '..', '..', 'api', 'fase11_prospective_dashboard.json');

const fullHistory = [
  {
    betId: 'ladder_bet_1795628640000_1',
    cycle: 1,
    step: 1,
    snapshotId: 'prosp_1795578304068_45_v1',
    opportunityKey: 'ladder_20261125_slavia_corners_over_2_5',
    match: 'SK Slavia Praha vs Villarreal',
    competition: 'UEFA Champions League',
    kickoffUtc: '2026-11-25T17:45:00.000Z',
    market: 'Córners de equipo',
    selection: 'SK Slavia Praha (Equipo)',
    line: 'Más de 2.5',
    odds: 1.15,
    modelProbability: 0.935,
    expectedValuePct: 7.5,
    elenaDecision: 'APROBADO',
    riskManagerDecision: 'APROBADO',
    stake: 50000,
    potentialReturn: 57500,
    openedAtUtc: '2026-11-25T17:44:00.000Z',
    status: 'WON',
    capBefore: 50000,
    capAfter: 57500,
    profitDelta: 7500,
    settledAtUtc: '2026-11-25T19:57:28.000Z',
    source: 'Registro Manual / StatsHub Oficial',
    settlementType: 'MANUAL',
    settledBy: 'Usuario (Manual)'
  },
  {
    betId: 'ladder_manual_1795642354586_step2',
    cycle: 1,
    step: 2,
    snapshotId: 'manual_live_1795642354586',
    opportunityKey: 'manual_1795642354586',
    match: 'Atlético Madrid vs Viking FK',
    competition: 'UEFA Champions League',
    market: 'Ganador del partido (1X2)',
    selection: 'Atlético Madrid',
    line: 'Gana Atlético Madrid',
    odds: 1.13,
    modelProbability: null,
    expectedValuePct: null,
    elenaDecision: 'APROBADO_MANUAL',
    riskManagerDecision: 'APROBADO_MANUAL',
    origin: 'MANUAL_LIVE',
    stake: 57500,
    potentialReturn: 64975,
    openedAtUtc: '2026-11-25T21:32:34.585Z',
    status: 'WON',
    capBefore: 57500,
    capAfter: 64975,
    profitDelta: 7475,
    settledAtUtc: '2026-11-25T22:48:05.000Z',
    source: 'StatsHub Oficial (Atlético Madrid 2-0 Viking FK FT)',
    settlementType: 'MANUAL',
    settledBy: 'Usuario / StatsHub Oficial'
  },
  {
    betId: 'ladder_manual_1795649201249_step3',
    cycle: 1,
    step: 3,
    snapshotId: 'manual_live_1795649201249',
    opportunityKey: 'manual_1795649201250',
    match: 'Atlético Mineiro vs Corinthians',
    competition: 'Brasileirão Série A',
    market: 'Remates totales',
    selection: 'Matheus Bidu',
    line: 'Más de 0.5',
    odds: 1.10,
    modelProbability: null,
    expectedValuePct: null,
    elenaDecision: 'APROBADO_MANUAL',
    riskManagerDecision: 'APROBADO_MANUAL',
    origin: 'MANUAL_LIVE',
    stake: 64975,
    potentialReturn: 71472.50,
    openedAtUtc: '2026-11-25T23:26:41.249Z',
    status: 'WON',
    capBefore: 64975,
    capAfter: 71472.50,
    profitDelta: 6497.50,
    settledAtUtc: '2026-11-26T00:25:00.000Z', // 21:25 ART 25-Nov
    source: 'StatsHub Oficial (Matheus Bidu titular cumplió >0.5 remates)',
    settlementType: 'MANUAL',
    settledBy: 'Usuario / StatsHub Oficial'
  },
  {
    betId: 'ladder_manual_1795698000000_step4',
    cycle: 1,
    step: 4,
    snapshotId: 'manual_live_1795698000000',
    opportunityKey: 'manual_1795698000001',
    match: 'Besiktas vs Hapoel Be\'er Sheva',
    competition: 'UEFA Europa League',
    market: 'Ganador del partido (1X2)',
    selection: 'Besiktas',
    line: 'Gana Besiktas',
    odds: 1.44,
    modelProbability: null,
    expectedValuePct: null,
    elenaDecision: 'APROBADO_MANUAL',
    riskManagerDecision: 'APROBADO_MANUAL',
    origin: 'MANUAL_LIVE',
    stake: 71472.50,
    potentialReturn: 102920.40,
    openedAtUtc: '2026-11-26T18:00:00.000Z',
    status: 'WON',
    capBefore: 71472.50,
    capAfter: 102920.40,
    profitDelta: 31447.90,
    settledAtUtc: '2026-11-26T20:10:00.000Z', // 17:10 ART 26-Nov
    source: 'StatsHub Oficial (Besiktas WON FT)',
    settlementType: 'MANUAL',
    settledBy: 'Usuario / StatsHub Oficial'
  },
  {
    betId: 'ladder_manual_1795715000000_step5',
    cycle: 1,
    step: 5,
    snapshotId: 'manual_live_1795715000000',
    opportunityKey: 'manual_1795715000001',
    match: 'Sao Paulo vs Remo',
    competition: 'Brasileirão Série A',
    market: 'Ganador del partido (1X2)',
    selection: 'Sao Paulo',
    line: 'Gana Sao Paulo',
    odds: 1.39,
    modelProbability: null,
    expectedValuePct: null,
    elenaDecision: 'APROBADO_MANUAL',
    riskManagerDecision: 'APROBADO_MANUAL',
    origin: 'MANUAL_LIVE',
    stake: 102920.40,
    potentialReturn: 143059.36,
    openedAtUtc: '2026-11-26T22:30:00.000Z',
    status: 'WON',
    capBefore: 102920.40,
    capAfter: 143059.36,
    profitDelta: 40138.96,
    settledAtUtc: '2026-11-27T01:01:00.000Z', // 22:01 ART 26-Nov
    source: 'StatsHub Oficial (Sao Paulo WON FT)',
    settlementType: 'MANUAL',
    settledBy: 'Usuario / StatsHub Oficial'
  }
];

// 1. Actualizar fase11_prospective_ladder.json
const ladderData = JSON.parse(fs.readFileSync(LADDER_FILE, 'utf8'));

ladderData.currentStep = 6;
ladderData.currentCycle = 1;
ladderData.initialCapital = 50000;
ladderData.currentCapital = 143059.36;
ladderData.targetCapital = 10000000;
ladderData.committedStake = 0;
ladderData.cumulativeProfit = 93059.36;
ladderData.openBet = null;
ladderData.stepHistory = fullHistory;
ladderData.lastSettlement = fullHistory[4]; // Sao Paulo vs Remo WON

fs.writeFileSync(LADDER_FILE, JSON.stringify(ladderData, null, 2), 'utf8');
console.log('✓ fase11_prospective_ladder.json actualizado con éxito a Escalón 6 ($143.059,36 ARS).');

// 2. Actualizar api/fase11_prospective_dashboard.json
if (fs.existsSync(DASHBOARD_API_FILE)) {
  const dashData = JSON.parse(fs.readFileSync(DASHBOARD_API_FILE, 'utf8'));
  dashData.prospectiveLadder = {
    ...dashData.prospectiveLadder,
    currentStep: 6,
    currentCycle: 1,
    initialCapital: 50000,
    currentCapital: 143059.36,
    committedStake: 0,
    cumulativeProfit: 93059.36,
    openBet: null,
    stepHistory: fullHistory,
    lastSettlement: fullHistory[4]
  };
  fs.writeFileSync(DASHBOARD_API_FILE, JSON.stringify(dashData, null, 2), 'utf8');
  console.log('✓ api/fase11_prospective_dashboard.json actualizado con éxito.');
}
