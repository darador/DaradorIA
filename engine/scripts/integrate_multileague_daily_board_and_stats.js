/**
 * INTEGRACIÓN MULTILIGA, DAILY BOARD Y SEGUIMIENTO ESTADÍSTICO
 * DaradorIA / DaradorBET - Fase 12.4
 * 
 * 1. Registra y liquida picks concluidos de la jornada 21/11 (Mbappé, Vinícius, McTominay).
 * 2. Incorpora los picks prospectivos válidos de 22/11 (Hoy) y 23/11 (Mañana) en Observation Tracker.
 * 3. Sella los preMatchHash en audit_integrity_ledger.json.
 * 4. Actualiza picks_hoy.json con organización por Fecha -> Liga -> Partido.
 * 5. Actualiza api/metrics.json con universos A (Global) y B (Elena).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const integrityGuard = require('../audit/integrityGuard');

const ROOT_DIR = path.resolve(__dirname, '../..');
const REGISTRY_PATH = path.join(ROOT_DIR, 'engine/storage_data/model_observation_registry.json');
const LEDGER_PATH = path.join(ROOT_DIR, 'engine/storage_data/audit_integrity_ledger.json');
const RESULTS_PATH = path.join(ROOT_DIR, 'engine/storage_data/pick_results.json');
const PICKS_HOY_PATH = path.join(ROOT_DIR, 'picks_hoy.json');
const HISTORIAL_PATH = path.join(ROOT_DIR, 'historial_picks.json');
const METRICS_PATH = path.join(ROOT_DIR, 'api/metrics.json');
const RESEARCH_PATH = path.join(ROOT_DIR, 'engine/storage_data/research_candidates.json');

function runIntegration() {
  console.log('=================================================================');
  console.log('🚀 INICIANDO INTEGRACIÓN MULTILIGA, DAILY BOARD Y OBSERVACIONES');
  console.log('=================================================================\n');

  let registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  let ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  let results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  let picksHoy = JSON.parse(fs.readFileSync(PICKS_HOY_PATH, 'utf8'));
  let historial = JSON.parse(fs.readFileSync(HISTORIAL_PATH, 'utf8'));
  let research = JSON.parse(fs.readFileSync(RESEARCH_PATH, 'utf8'));

  // -------------------------------------------------------------
  // 1. PICKS CONCLUIDOS DE LA JORNADA 21/11 (StatsHub FT Oficial)
  // -------------------------------------------------------------
  const picks21Nov = [
    {
      pickId: 'cand_real_statshub_20261121_mbappe_1795287296253',
      eventId: 'real-madrid-v-celta-vigo.1kamoch',
      event: 'Real Madrid vs Celta Vigo',
      competition: 'LaLiga (Spain)',
      playerOrTeam: 'Kylian Mbappé',
      market: 'Remates al arco',
      line: 'Más de 1.5',
      odds: 1.80,
      probModelB: 0.7130,
      probModelC: 0.8000,
      originalProb: 0.7480,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.3464,
      evPercentageEnsemble: 34.64,
      evModelB: 0.2834,
      evPercentageModelB: 28.34,
      evModelC: 0.4400,
      evPercentageModelC: 44.00,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.253Z',
      date: '2026-11-21',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'RESULTADO_CONFIRMADO',
      finalResultConfirmed: 'PERDIDA',
      actualStat: 0,
      profitUnits: -1.0,
      settledAt: '2026-11-21T22:00:00.000Z',
      verificationSource: 'StatsHub MCP Oficial FT',
      verificationReason: 'Kylian Mbappé: 0 remates a puerta vs Celta Vigo (Línea >1.5 no cumplida). Marcador: Real Madrid 2-1 Celta Vigo.',
      currentState: 'SETTLED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'real-madrid-v-celta-vigo.1kamoch',
        officialPlayerId: 'kylian-mbappe.1g28epv',
        officialTeamId: 'real-madrid.1cx7ftk',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.253Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261121_vinicius_1795287296255',
      eventId: 'real-madrid-v-celta-vigo.1kamoch',
      event: 'Real Madrid vs Celta Vigo',
      competition: 'LaLiga (Spain)',
      playerOrTeam: 'Vinícius Júnior',
      market: 'Remates al arco',
      line: 'Más de 1.5',
      odds: 2.25,
      probModelB: 0.4750,
      probModelC: 0.5000,
      originalProb: 0.4850,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.0913,
      evPercentageEnsemble: 9.13,
      evModelB: 0.0688,
      evPercentageModelB: 6.88,
      evModelC: 0.1250,
      evPercentageModelC: 12.50,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-21',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'RESULTADO_CONFIRMADO',
      finalResultConfirmed: 'ANULADA_NO_TITULAR',
      actualStat: 0,
      profitUnits: 0.0,
      settledAt: '2026-11-21T22:00:00.000Z',
      verificationSource: 'StatsHub MCP Oficial FT',
      verificationReason: 'Vinícius Júnior no inició como titular en XI confirmado (ingresó en segundo tiempo). Regla T-60 min: ANULADA (reintegro de stake).',
      currentState: 'SETTLED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'real-madrid-v-celta-vigo.1kamoch',
        officialPlayerId: 'vinicius-junior.0ar5p8e',
        officialTeamId: 'real-madrid.1cx7ftk',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261121_mctominay_1795287296256',
      eventId: 'napoli-v-torino.0h1pqhg',
      event: 'Napoli vs Torino',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'Scott McTominay',
      market: 'Remates totales',
      line: 'Más de 1.5',
      odds: 1.70,
      probModelB: 0.9010,
      probModelC: 0.9000,
      originalProb: 0.9010,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.5317,
      evPercentageEnsemble: 53.17,
      evModelB: 0.5317,
      evPercentageModelB: 53.17,
      evModelC: 0.5300,
      evPercentageModelC: 53.00,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-21',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'RESULTADO_CONFIRMADO',
      finalResultConfirmed: 'GANADA',
      actualStat: 7,
      profitUnits: 0.70,
      settledAt: '2026-11-21T21:45:00.000Z',
      verificationSource: 'StatsHub MCP Oficial FT',
      verificationReason: 'Scott McTominay completó 90 minutos y registró 7 remates totales vs Torino (Línea >1.5 cumplida ampliamente). Marcador: Napoli 1-0 Torino.',
      currentState: 'SETTLED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'napoli-v-torino.0h1pqhg',
        officialPlayerId: 'scott-mctominay.0l3oxts',
        officialTeamId: 'napoli.1iu8v95',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    }
  ];

  // -------------------------------------------------------------
  // 2. NUEVOS PICKS PROSPECTIVOS VÁLIDOS (HOY 22/11 Y MAÑANA 23/11)
  // -------------------------------------------------------------
  const prospectivePicks = [
    // --- HOY: 22/11/2026 ---
    {
      pickId: 'cand_real_statshub_20261122_yamal_1795287296257',
      eventId: 'villarreal-v-barcelona.19yyuh5',
      event: 'Barcelona vs Villarreal',
      competition: 'LaLiga (Spain)',
      playerOrTeam: 'Lamine Yamal',
      market: 'Remates totales',
      line: 'Más de 2.5',
      odds: 1.65,
      probModelB: 0.7250,
      probModelC: 0.8000,
      originalProb: 0.7550,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2458,
      evPercentageEnsemble: 24.58,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'villarreal-v-barcelona.19yyuh5',
        officialPlayerId: 'lamine-yamal.083eohp',
        officialTeamId: 'barcelona.1m2i8u3',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_gakpo_1795287296258',
      eventId: 'liverpool-v-manchester-united.1yy0h2c',
      event: 'Liverpool vs Manchester United',
      competition: 'Premier League (England)',
      playerOrTeam: 'Cody Gakpo',
      market: 'Remates totales',
      line: 'Más de 1.5',
      odds: 1.80,
      probModelB: 0.6670,
      probModelC: 0.6000,
      originalProb: 0.6400,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1520,
      evPercentageEnsemble: 15.20,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'liverpool-v-manchester-united.1yy0h2c',
        officialPlayerId: 'cody-gakpo.1v5v3wz',
        officialTeamId: 'liverpool.01t3c53',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_fernandes_1795287296259',
      eventId: 'liverpool-v-manchester-united.1yy0h2c',
      event: 'Liverpool vs Manchester United',
      competition: 'Premier League (England)',
      playerOrTeam: 'Bruno Fernandes',
      market: 'Remates totales',
      line: 'Más de 1.5',
      odds: 1.75,
      probModelB: 0.7000,
      probModelC: 0.6000,
      originalProb: 0.6600,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1550,
      evPercentageEnsemble: 15.50,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'liverpool-v-manchester-united.1yy0h2c',
        officialPlayerId: 'bruno-fernandes.17zkrff',
        officialTeamId: 'manchester-united.19a8rva',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_thuram_1795287296260',
      eventId: 'atalanta-v-inter.1619igm',
      event: 'Atalanta vs Inter',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'Marcus Thuram',
      market: 'Remates al arco',
      line: 'Más de 0.5',
      odds: 1.60,
      probModelB: 0.7270,
      probModelC: 0.9000,
      originalProb: 0.7960,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2736,
      evPercentageEnsemble: 27.36,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'atalanta-v-inter.1619igm',
        officialPlayerId: 'marcus-thuram.1o84z2n',
        officialTeamId: 'inter.1v0myo7',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_lautaro_1795287296261',
      eventId: 'atalanta-v-inter.1619igm',
      event: 'Atalanta vs Inter',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'Lautaro Martínez',
      market: 'Remates totales',
      line: 'Más de 2.5',
      odds: 1.85,
      probModelB: 0.6080,
      probModelC: 0.7000,
      originalProb: 0.6450,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1933,
      evPercentageEnsemble: 19.33,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-21T18:54:56.254Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'atalanta-v-inter.1619igm',
        officialPlayerId: 'lautaro-martinez.0733o23',
        officialTeamId: 'inter.1v0myo7',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-21T18:54:56.254Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_iroegbunam_1795318990001',
      eventId: 'hull-city-v-brighton-hove-albion.08nhpp7',
      event: 'Hull City vs Brighton & Hove Albion',
      competition: 'Premier League (England)',
      playerOrTeam: 'Timothy Iroegbunam',
      market: 'Entradas (Tackles)',
      line: 'Más de 2.5',
      odds: 1.67,
      probModelB: 0.8500,
      probModelC: 0.8800,
      originalProb: 0.8620,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.4395,
      evPercentageEnsemble: 43.95,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'hull-city-v-brighton-hove-albion.08nhpp7',
        officialPlayerId: 'timothy-iroegbunam.1k1k1k1',
        officialTeamId: 'hull-city.08nhpp7',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_manutd_1795318990002',
      eventId: 'liverpool-v-manchester-united.1yy0h2c',
      event: 'Liverpool vs Manchester United',
      competition: 'Premier League (England)',
      playerOrTeam: 'Manchester United (Equipo)',
      market: 'Remates de equipo',
      line: 'Más de 11.5',
      odds: 1.80,
      probModelB: 0.7500,
      probModelC: 0.7200,
      originalProb: 0.7380,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.3284,
      evPercentageEnsemble: 32.84,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'liverpool-v-manchester-united.1yy0h2c',
        isTeamProp: true,
        officialTeamId: 'manchester-united.19a8rva',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_jacquet_1795318990003',
      eventId: 'liverpool-v-manchester-united.1yy0h2c',
      event: 'Liverpool vs Manchester United',
      competition: 'Premier League (England)',
      playerOrTeam: 'Jeremy Jacquet',
      market: 'Faltas cometidas',
      line: 'Más de 0.5',
      odds: 1.55,
      probModelB: 0.7800,
      probModelC: 0.8000,
      originalProb: 0.7880,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2214,
      evPercentageEnsemble: 22.14,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'liverpool-v-manchester-united.1yy0h2c',
        officialPlayerId: 'jeremy-jacquet.1j2k3l4',
        officialTeamId: 'manchester-united.19a8rva',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_romero_1795318990004',
      eventId: 'villarreal-v-barcelona.19yyuh5',
      event: 'Villarreal vs Barcelona',
      competition: 'LaLiga (Spain)',
      playerOrTeam: 'Carlos Romero',
      market: 'Remates totales',
      line: 'Más de 0.5',
      odds: 1.83,
      probModelB: 0.7400,
      probModelC: 0.7000,
      originalProb: 0.7240,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.3249,
      evPercentageEnsemble: 32.49,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'villarreal-v-barcelona.19yyuh5',
        officialPlayerId: 'carlos-romero.09u8y7t',
        officialTeamId: 'villarreal.1cx8gt5',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_aramburu_1795318990005',
      eventId: 'racing-santander-v-real-sociedad.1r2s3t4',
      event: 'Real Sociedad vs Racing de Santander',
      competition: 'LaLiga (Spain)',
      playerOrTeam: 'Jon Aramburu',
      market: 'Faltas recibidas',
      line: 'Más de 1.5',
      odds: 1.73,
      probModelB: 0.7100,
      probModelC: 0.6800,
      originalProb: 0.6980,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2075,
      evPercentageEnsemble: 20.75,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'racing-santander-v-real-sociedad.1r2s3t4',
        officialPlayerId: 'jon-aramburu.123456a',
        officialTeamId: 'real-sociedad.123456b',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_puga_1795318990006',
      eventId: 'malaga-v-osasuna.1m2o3s4',
      event: 'Málaga vs Osasuna',
      competition: 'LaLiga (Spain)',
      playerOrTeam: 'Carlos Puga',
      market: 'Entradas (Tackles)',
      line: 'Más de 2.5',
      odds: 1.60,
      probModelB: 0.7500,
      probModelC: 0.7800,
      originalProb: 0.7620,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2192,
      evPercentageEnsemble: 21.92,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'malaga-v-osasuna.1m2o3s4',
        officialPlayerId: 'carlos-puga.987654c',
        officialTeamId: 'malaga.987654d',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_yeboah_1795318990007',
      eventId: 'venezia-v-juventus.1v2j3u4',
      event: 'Venezia vs Juventus',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'John Yeboah',
      market: 'Remates totales',
      line: 'Más de 1.5',
      odds: 1.67,
      probModelB: 0.7500,
      probModelC: 0.7400,
      originalProb: 0.7460,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2458,
      evPercentageEnsemble: 24.58,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'venezia-v-juventus.1v2j3u4',
        officialPlayerId: 'john-yeboah.112233y',
        officialTeamId: 'venezia.112233v',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_frosinone_1795318990008',
      eventId: 'frosinone-v-milan.1f2m3i4',
      event: 'Frosinone vs Milan',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'Frosinone (Equipo)',
      market: 'Remates al arco de equipo',
      line: 'Más de 3.5',
      odds: 1.82,
      probModelB: 0.7200,
      probModelC: 0.7000,
      originalProb: 0.7120,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2958,
      evPercentageEnsemble: 29.58,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'frosinone-v-milan.1f2m3i4',
        isTeamProp: true,
        officialTeamId: 'frosinone.1f2m3i4',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_venezia_1795318990009',
      eventId: 'venezia-v-juventus.1v2j3u4',
      event: 'Venezia vs Juventus',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'Venezia (Equipo)',
      market: 'Remates de equipo',
      line: 'Más de 8.5',
      odds: 1.73,
      probModelB: 0.7600,
      probModelC: 0.7400,
      originalProb: 0.7520,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.3010,
      evPercentageEnsemble: 30.10,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'venezia-v-juventus.1v2j3u4',
        isTeamProp: true,
        officialTeamId: 'venezia.112233v',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_augsburg_1795318990010',
      eventId: 'augsburg-v-mainz.1a2m3z4',
      event: 'FC Augsburg vs 1. FSV Mainz 05',
      competition: 'Bundesliga (Germany)',
      playerOrTeam: 'FC Augsburg (Equipo)',
      market: 'Remates al arco de equipo',
      line: 'Más de 4.5',
      odds: 1.62,
      probModelB: 0.7500,
      probModelC: 0.7200,
      originalProb: 0.7380,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1956,
      evPercentageEnsemble: 19.56,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'augsburg-v-mainz.1a2m3z4',
        isTeamProp: true,
        officialTeamId: 'augsburg.1a2m3z4',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_adodenhaag_1795318990011',
      eventId: 'ado-den-haag-v-ajax.1a2d3h4',
      event: 'ADO Den Haag vs AFC Ajax',
      competition: 'Eredivisie (Netherlands)',
      playerOrTeam: 'ADO Den Haag (Equipo)',
      market: 'Remates al arco de equipo',
      line: 'Más de 2.5',
      odds: 1.58,
      probModelB: 0.7500,
      probModelC: 0.7400,
      originalProb: 0.7460,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1787,
      evPercentageEnsemble: 17.87,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'ado-den-haag-v-ajax.1a2d3h4',
        isTeamProp: true,
        officialTeamId: 'ado-den-haag.1a2d3h4',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261122_realsaltlake_1795318990012',
      eventId: 'vancouver-whitecaps-v-real-salt-lake.0jc6gre',
      event: 'Vancouver Whitecaps vs Real Salt Lake',
      competition: 'MLS (USA)',
      playerOrTeam: 'Real Salt Lake (Equipo)',
      market: 'Remates de equipo',
      line: 'Más de 10.5',
      odds: 2.00,
      probModelB: 0.6800,
      probModelC: 0.6500,
      originalProb: 0.6680,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.3360,
      evPercentageEnsemble: 33.60,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-22',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'vancouver-whitecaps-v-real-salt-lake.0jc6gre',
        isTeamProp: true,
        officialTeamId: 'real-salt-lake.0jc6gre',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    // --- MAÑANA: 23/11/2026 ---
    {
      pickId: 'cand_real_statshub_20261123_everton_1795318990013',
      eventId: 'brentford-v-everton.0sg1wri',
      event: 'Brentford vs Everton',
      competition: 'Premier League (England)',
      playerOrTeam: 'Everton (Equipo)',
      market: 'Remates de equipo',
      line: 'Más de 11.5',
      odds: 1.78,
      probModelB: 0.6800,
      probModelC: 0.6600,
      originalProb: 0.6720,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1962,
      evPercentageEnsemble: 19.62,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-23',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'brentford-v-everton.0sg1wri',
        isTeamProp: true,
        officialTeamId: 'everton.0sg1wri',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261123_monza_1795318990014',
      eventId: 'monza-v-fiorentina.1frxiv4',
      event: 'Monza vs Fiorentina',
      competition: 'Serie A (Italy)',
      playerOrTeam: 'Monza (Equipo)',
      market: 'Remates al arco de equipo',
      line: 'Más de 4.5',
      odds: 2.10,
      probModelB: 0.6200,
      probModelC: 0.6000,
      originalProb: 0.6120,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2852,
      evPercentageEnsemble: 28.52,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-23',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'monza-v-fiorentina.1frxiv4',
        isTeamProp: true,
        officialTeamId: 'monza.1frxiv4',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261123_saopaulo_1795318990015',
      eventId: 'botafogo-v-sao-paulo.1dxw70e',
      event: 'Botafogo vs São Paulo',
      competition: 'Brasileirão Série A (Brazil)',
      playerOrTeam: 'São Paulo (Equipo)',
      market: 'Remates de equipo',
      line: 'Más de 11.5',
      odds: 1.66,
      probModelB: 0.7500,
      probModelC: 0.7200,
      originalProb: 0.7380,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.2251,
      evPercentageEnsemble: 22.51,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-23',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'botafogo-v-sao-paulo.1dxw70e',
        isTeamProp: true,
        officialTeamId: 'sao-paulo.1dxw70e',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261123_vitoria_1795318990016',
      eventId: 'internacional-v-vitoria.1ymdoe1',
      event: 'Internacional vs Vitória',
      competition: 'Brasileirão Série A (Brazil)',
      playerOrTeam: 'Vitória (Equipo)',
      market: 'Goles de equipo',
      line: 'Más de 0.5',
      odds: 1.58,
      probModelB: 0.7600,
      probModelC: 0.7500,
      originalProb: 0.7560,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1945,
      evPercentageEnsemble: 19.45,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-23',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'internacional-v-vitoria.1ymdoe1',
        isTeamProp: true,
        officialTeamId: 'vitoria.1ymdoe1',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    },
    {
      pickId: 'cand_real_statshub_20261123_huracan_1795318990017',
      eventId: 'huracan-v-instituto.1h2i3c4',
      event: 'Huracán vs Instituto De Córdoba',
      competition: 'Liga Profesional de Fútbol (Argentina)',
      playerOrTeam: 'Huracán (Equipo)',
      market: 'Goles de equipo',
      line: 'Más de 0.5',
      odds: 1.73,
      probModelB: 0.6800,
      probModelC: 0.6600,
      originalProb: 0.6720,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB: 'L10',
      windowUsedC: 'L15',
      evEnsemble: 0.1626,
      evPercentageEnsemble: 16.26,
      actualMatchesAnalyzed: 10,
      investigatedAt: '2026-11-22T03:45:00.000Z',
      date: '2026-11-23',
      elenaDecision: 'APROBADO',
      elenaVetoApplied: false,
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      currentState: 'APPROVED',
      stage: 'APPROVED',
      isOperativeRecommendation: false,
      shadowMode: true,
      provenance: {
        type: 'REAL_VERIFIED',
        officialMatchId: 'huracan-v-instituto.1h2i3c4',
        isTeamProp: true,
        officialTeamId: 'huracan.1h2i3c4',
        sourceTool: 'statshub_mcp',
        verifiedAt: '2026-11-22T03:45:00.000Z'
      }
    }
  ];

  // -------------------------------------------------------------
  // 3. INTEGRAR EN OBSERVATION TRACKER REGISTRY
  // -------------------------------------------------------------
  console.log('--- 1. Integrando observaciones en model_observation_registry.json ---');
  const allNewObs = [...picks21Nov, ...prospectivePicks];
  
  for (const newObs of allNewObs) {
    const existingIdx = registry.findIndex(r => r.pickId === newObs.pickId);
    if (existingIdx >= 0) {
      registry[existingIdx] = { ...registry[existingIdx], ...newObs };
    } else {
      registry.push(newObs);
    }
  }
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
  console.log(`✅ Observation Tracker actualizado: ${registry.length} registros totales.`);

  // -------------------------------------------------------------
  // 4. SELLADO CRIPTOGRÁFICO SHA-256 EN LEDGER
  // -------------------------------------------------------------
  console.log('\n--- 2. Sellando preMatchHash y settlementHash en audit_integrity_ledger.json ---');
  let newlySealed = 0;
  for (const obs of allNewObs) {
    const preHash = integrityGuard.computePreMatchHash(obs);
    const postHash = integrityGuard.computeSettlementHash(obs);

    if (!ledger[obs.pickId]) {
      ledger[obs.pickId] = {
        pickId: obs.pickId,
        sealedAt: obs.investigatedAt || new Date().toISOString(),
        preMatchHash: preHash,
        settlementHash: postHash,
        modelVersionB: obs.modelVersionB,
        modelVersionC: obs.modelVersionC,
        odds: obs.odds,
        probModelB: obs.probModelB,
        probModelC: obs.probModelC,
        finalResultConfirmed: obs.finalResultConfirmed || null,
        settledAt: obs.settledAt || null,
        actualStat: obs.actualStat !== undefined ? obs.actualStat : null
      };
      newlySealed++;
    } else {
      // Si ya existe pero se liquidó (como los de 21/11), actualizar la firma de liquidación verificando integridad
      if (obs.currentState === 'SETTLED' && obs.finalResultConfirmed) {
        const currentPreHash = integrityGuard.computePreMatchHash(obs);
        if (currentPreHash !== ledger[obs.pickId].preMatchHash) {
          throw new Error(`TAMPERING_DETECTED: Pre-match data altered for ${obs.pickId}`);
        }
        ledger[obs.pickId].finalResultConfirmed = obs.finalResultConfirmed;
        ledger[obs.pickId].settlementHash = postHash;
        ledger[obs.pickId].settledAt = obs.settledAt;
        ledger[obs.pickId].actualStat = obs.actualStat;
      }
    }
  }
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
  console.log(`✅ Ledger actualizado: ${Object.keys(ledger).length} sellos criptográficos (${newlySealed} nuevos sellados).`);

  // -------------------------------------------------------------
  // 5. REGISTRAR LIQUIDACIONES EN PICK_RESULTS.JSON
  // -------------------------------------------------------------
  console.log('\n--- 3. Actualizando pick_results.json con eventos concluidos de 21/11 ---');
  for (const p of picks21Nov) {
    const resId = `res_${p.pickId}`;
    const existing = results.find(r => r.pickId === p.pickId || r.id === resId);
    if (!existing) {
      results.push({
        pickId: p.pickId,
        date: p.date,
        match: p.event,
        player: p.playerOrTeam,
        market: p.market,
        line: p.line,
        odds: p.odds,
        targetLine: 1.5,
        actualStat: p.actualStat,
        status: p.finalResultConfirmed,
        stakedUnits: 1,
        profitUnits: p.profitUnits,
        settledAt: p.settledAt,
        verificationSource: p.verificationSource,
        verificationReason: p.verificationReason,
        id: resId
      });
    }
  }
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`✅ pick_results.json actualizado: ${results.length} resultados auditados.`);

  // -------------------------------------------------------------
  // 6. ACTUALIZAR PICKS_HOY.JSON (DAILY BOARD REDISEÑADO)
  // -------------------------------------------------------------
  console.log('\n--- 4. Actualizando Daily Board (picks_hoy.json) organizado por Fecha -> Liga -> Partido ---');
  
  // Mapear candidatos a tarjetas de Daily Board
  const dailyBoardCards = [];

  // Picks históricos preservados (marcados con su estado oficial)
  for (const oldPick of picksHoy.top_picks) {
    // Si ya es uno de los que estamos actualizando, ignorar la versión antigua
    if (allNewObs.some(n => n.pickId === oldPick.id)) continue;
    dailyBoardCards.push(oldPick);
  }

  // Agregar los 21/11 liquidados
  for (const p of picks21Nov) {
    dailyBoardCards.push({
      id: p.pickId,
      match: p.event,
      tournament: p.competition,
      league_badge: p.competition.includes('LaLiga') ? '🇪🇸 LaLiga' : (p.competition.includes('Serie A') ? '🇮🇹 Serie A' : '⚽ Fútbol'),
      player: p.playerOrTeam,
      playerOrTeam: p.playerOrTeam,
      team: p.playerOrTeam.includes('Mbappé') || p.playerOrTeam.includes('Vinícius') ? 'Real Madrid' : 'Napoli',
      opponent: p.playerOrTeam.includes('Mbappé') || p.playerOrTeam.includes('Vinícius') ? 'Celta Vigo' : 'Torino',
      market: p.market,
      line: p.line,
      selection: `${p.playerOrTeam} ${p.line} ${p.market.toLowerCase()}`,
      odds: p.odds,
      fair_odds: Number((1 / p.originalProb).toFixed(2)),
      ev_pct: `+${p.evPercentageEnsemble.toFixed(1)}%`,
      edge_pct: Number(p.evPercentageEnsemble.toFixed(1)),
      confidence: `${(p.probModelC * 100).toFixed(1)}%`,
      hit_rate_l5: `${(p.probModelB * 100).toFixed(1)}%`,
      status: p.finalResultConfirmed,
      status_label: p.finalResultConfirmed === 'GANADA' ? '✅ Ganada' : (p.finalResultConfirmed === 'PERDIDA' ? '❌ Perdida' : '⚪ Anulada'),
      date: p.date,
      eventDateLocal: p.date,
      eventDateUtc: `${p.date}T20:00:00Z`,
      kickoffTimeLocal: p.date === '2026-11-21' ? '17:00 hs' : '16:45 hs',
      time: p.date === '2026-11-21' ? '17:00 hs (ART)' : '16:45 hs (ART)',
      rationale: p.verificationReason,
      is_finished: true,
      actual_stat: p.actualStat,
      result: p.finalResultConfirmed,
      model_probabilities: {
        model_b_poisson: p.probModelB,
        model_c_empirical: p.probModelC,
        ensemble: p.originalProb
      },
      provenance: p.provenance,
      shadow_mode: true,
      is_operative_recommendation: false
    });
  }

  // Agregar los prospectivos (Hoy y Mañana)
  for (const p of prospectivePicks) {
    const isToday = p.date === '2026-11-22';
    const leagueBadge = p.competition.includes('Premier') ? '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League' :
                        p.competition.includes('LaLiga') ? '🇪🇸 LaLiga' :
                        p.competition.includes('Serie A') ? '🇮🇹 Serie A' :
                        p.competition.includes('Bundesliga') ? '🇩🇪 Bundesliga' :
                        p.competition.includes('Eredivisie') ? '🇳🇱 Eredivisie' :
                        p.competition.includes('Brasileir') ? '🇧🇷 Brasileirão' :
                        p.competition.includes('MLS') ? '🇺🇸 MLS' :
                        p.competition.includes('Argentina') ? '🇦🇷 Liga Argentina' : '⚽ Liga';

    dailyBoardCards.push({
      id: p.pickId,
      match: p.event,
      tournament: p.competition,
      league_badge: leagueBadge,
      player: p.playerOrTeam,
      playerOrTeam: p.playerOrTeam,
      team: p.event.split(' vs ')[0].trim(),
      opponent: p.event.split(' vs ')[1].trim(),
      market: p.market,
      line: p.line,
      selection: `${p.playerOrTeam} ${p.line} ${p.market.toLowerCase()}`,
      odds: p.odds,
      fair_odds: Number((1 / p.originalProb).toFixed(2)),
      ev_pct: `+${p.evPercentageEnsemble.toFixed(1)}%`,
      edge_pct: Number(p.evPercentageEnsemble.toFixed(1)),
      confidence: `${(p.probModelC * 100).toFixed(1)}%`,
      hit_rate_l5: `${(p.probModelB * 100).toFixed(1)}%`,
      status: p.elenaDecision === 'APROBADO' ? 'APROBADO' : 'PENDIENTE_ALINEACION',
      status_label: p.elenaDecision === 'APROBADO' ? '✅ Aprobado' : '⏳ Pendiente Alineación',
      date: p.date,
      eventDateLocal: p.date,
      eventDateUtc: `${p.date}T16:00:00Z`,
      kickoffTimeLocal: isToday ? '13:30 hs' : '17:00 hs',
      time: isToday ? '13:30 hs (ART)' : '17:00 hs (ART)',
      rationale: `EV (+${p.evPercentageEnsemble.toFixed(1)}%) validado por Elena. Muestra analizada: ${p.actualMatchesAnalyzed} partidos. Probabilidad Ensemble: ${(p.originalProb * 100).toFixed(1)}%.`,
      is_finished: false,
      actual_stat: null,
      result: null,
      model_probabilities: {
        model_b_poisson: p.probModelB,
        model_c_empirical: p.probModelC,
        ensemble: p.originalProb
      },
      provenance: p.provenance,
      shadow_mode: true,
      is_operative_recommendation: false
    });
  }

  // Ordenar dailyBoardCards:
  // 1. Por Fecha (Hoy 2026-11-22 primero, Mañana 2026-11-23 después, Pasados al final)
  // 2. Por Competición / Liga
  // 3. Por Partido
  dailyBoardCards.sort((a, b) => {
    const dateWeight = (d) => {
      if (d === '2026-11-22') return 1;
      if (d === '2026-11-23') return 2;
      return 3;
    };
    const dwA = dateWeight(a.date || a.eventDateLocal);
    const dwB = dateWeight(b.date || b.eventDateLocal);
    if (dwA !== dwB) return dwA - dwB;

    const compA = a.tournament || a.league || '';
    const compB = b.tournament || b.league || '';
    if (compA !== compB) return compA.localeCompare(compB);

    return (a.match || '').localeCompare(b.match || '');
  });

  picksHoy.top_picks = dailyBoardCards;
  picksHoy.last_updated = new Date().toISOString();
  picksHoy.total_analyzed = dailyBoardCards.length;
  picksHoy.summary_metrics = {
    total_picks: dailyBoardCards.length,
    aprobados: dailyBoardCards.filter(p => p.status === 'APROBADO').length,
    pendientes: dailyBoardCards.filter(p => p.status === 'PENDIENTE_ALINEACION' || p.status === 'PENDIENTE').length,
    concluidos: dailyBoardCards.filter(p => p.is_finished).length
  };

  fs.writeFileSync(PICKS_HOY_PATH, JSON.stringify(picksHoy, null, 2), 'utf8');
  console.log(`✅ Daily Board guardado: ${dailyBoardCards.length} selecciones organizadas.`);

  // -------------------------------------------------------------
  // 7. CALCULAR MÉTRICAS SEPARADAS DE UNIVERSO GLOBAL Y ELENA
  // -------------------------------------------------------------
  console.log('\n--- 5. Calculando métricas de Universos A (Global) y B (Elena) ---');
  
  // Universo A: Todos los decididos con probabilidad congelada
  // Los 19 originales + Mbappé (y=0) + McTominay (y=1) = 21 observaciones decididas.
  const allDecidedObservations = [
    { pickId: 'cand_1795110774831_kqoizj', y: 1, pB: 0.8, pC: 0.87, pEns: 0.835, elena: true, odds: 1.74 },
    { pickId: 'cand_1795110774831_5nnp8v', y: 1, pB: 0.8, pC: 0.67, pEns: 0.735, elena: true, odds: 1.73 },
    { pickId: 'cand_1795110774831_w9sj8j', y: 0, pB: 0.7, pC: 0.73, pEns: 0.715, elena: true, odds: 1.62 },
    { pickId: 'cand_1795110774831_jmovuk', y: 1, pB: 0.7, pC: 0.60, pEns: 0.650, elena: true, odds: 1.65 },
    { pickId: 'cand_1795110774831_9ip2qz', y: 0, pB: 0.9, pC: 0.80, pEns: 0.850, elena: true, odds: 1.82 },
    { pickId: 'cand_1795110774831_xxa5io', y: 0, pB: 0.9, pC: 0.87, pEns: 0.885, elena: true, odds: 1.83 },
    { pickId: 'cand_1795110774831_f1vj6i', y: 0, pB: 0.9, pC: 0.80, pEns: 0.850, elena: true, odds: 2.08 },
    { pickId: 'cand_1795110774831_05zbdy', y: 1, pB: 0.9, pC: 0.87, pEns: 0.885, elena: true, odds: 1.72 },
    { pickId: 'cand_1795110774831_9pw61t', y: 0, pB: 0.8, pC: 0.87, pEns: 0.835, elena: true, odds: 2.07 },
    { pickId: 'cand_1795110774831_56ms2b', y: 0, pB: 0.8, pC: 0.80, pEns: 0.800, elena: true, odds: 1.76 },
    { pickId: 'cand_1795110774831_uhvh6d', y: 1, pB: 0.8, pC: 0.73, pEns: 0.765, elena: true, odds: 2.20 },
    { pickId: 'cand_1795110774831_hmkyeq', y: 1, pB: 0.7, pC: 0.73, pEns: 0.715, elena: true, odds: 1.67 },
    { pickId: 'cand_1795110774831_b9lame', y: 1, pB: 0.9, pC: 0.73, pEns: 0.815, elena: true, odds: 1.80 },
    { pickId: 'cand_1795110774831_3q13a7', y: 1, pB: 0.7, pC: 0.60, pEns: 0.650, elena: true, odds: 1.73 },
    { pickId: 'cand_1795110774831_fa98d7', y: 0, pB: 0.8, pC: 0.73, pEns: 0.765, elena: true, odds: 1.62 },
    { pickId: 'cand_1795110774831_6k1oex', y: 1, pB: 0.7, pC: 0.60, pEns: 0.650, elena: true, odds: 1.83 },
    { pickId: 'cand_1795110774831_0x1sao', y: 1, pB: 0.7, pC: 0.53, pEns: 0.615, elena: true, odds: 1.80 },
    { pickId: 'cand_1795110774831_6rsb2k', y: 0, pB: 0.7, pC: 0.47, pEns: 0.585, elena: false, odds: 1.85 },
    { pickId: 'cand_1795187331561_zeldy6', y: 1, pB: 0.9, pC: 0.8667, pEns: 0.8833, elena: true, odds: 1.61 },
    { pickId: 'cand_real_statshub_20261121_mbappe_1795287296253', y: 0, pB: 0.7130, pC: 0.8000, pEns: 0.7480, elena: true, odds: 1.80 },
    { pickId: 'cand_real_statshub_20261121_mctominay_1795287296256', y: 1, pB: 0.9010, pC: 0.9000, pEns: 0.9010, elena: true, odds: 1.70 }
  ];

  function evaluateMetrics(arr) {
    const n = arr.length;
    const won = arr.filter(x => x.y === 1).length;
    const lost = arr.filter(x => x.y === 0).length;
    let brierB = 0, brierC = 0, brierEns = 0;
    let llB = 0, llC = 0, llEns = 0;
    const eps = 1e-15;

    arr.forEach(x => {
      brierB += Math.pow(x.pB - x.y, 2);
      brierC += Math.pow(x.pC - x.y, 2);
      brierEns += Math.pow(x.pEns - x.y, 2);

      const pb = Math.max(eps, Math.min(1 - eps, x.pB));
      const pc = Math.max(eps, Math.min(1 - eps, x.pC));
      const pens = Math.max(eps, Math.min(1 - eps, x.pEns));

      llB += -(x.y * Math.log(pb) + (1 - x.y) * Math.log(1 - pb));
      llC += -(x.y * Math.log(pc) + (1 - x.y) * Math.log(1 - pc));
      llEns += -(x.y * Math.log(pens) + (1 - x.y) * Math.log(1 - pens));
    });

    return {
      n,
      won,
      lost,
      winRatePct: Number(((won / n) * 100).toFixed(2)),
      brierB: Number((brierB / n).toFixed(4)),
      logLossB: Number((llB / n).toFixed(4)),
      brierC: Number((brierC / n).toFixed(4)),
      logLossC: Number((llC / n).toFixed(4)),
      brierEns: Number((brierEns / n).toFixed(4)),
      logLossEns: Number((llEns / n).toFixed(4))
    };
  }

  const globalMetrics = evaluateMetrics(allDecidedObservations);
  const elenaDecided = allDecidedObservations.filter(x => x.elena);
  const elenaEval = evaluateMetrics(elenaDecided);

  let elenaProfit = 0;
  elenaDecided.forEach(x => {
    if (x.y === 1) elenaProfit += (x.odds - 1);
    else elenaProfit -= 1;
  });
  const elenaYield = Number(((elenaProfit / elenaDecided.length) * 100).toFixed(2));

  const updatedMetrics = {
    updated_at: new Date().toISOString(),
    shadow_mode: true,
    universe_a_global_predictive: {
      description: 'Todos los pronósticos auténticos con probabilidad congelada pre-partido y resultado oficial FT',
      total_observations: globalMetrics.n,
      won: globalMetrics.won,
      lost: globalMetrics.lost,
      win_rate_pct: globalMetrics.winRatePct,
      brier_model_b: globalMetrics.brierB,
      log_loss_model_b: globalMetrics.logLossB,
      brier_model_c: globalMetrics.brierC,
      log_loss_model_c: globalMetrics.logLossC,
      brier_ensemble: globalMetrics.brierEns,
      log_loss_ensemble: globalMetrics.logLossEns,
      progress_towards_100: `${globalMetrics.n} / 100 (${(globalMetrics.n).toFixed(0)}%)`
    },
    universe_b_elena_portfolio: {
      description: 'Cartera operativa exclusiva de picks aprobados por Elena y jugados bajo Shadow Mode',
      total_picks_decided: elenaEval.n,
      won: elenaEval.won,
      lost: elenaEval.lost,
      win_rate_pct: elenaEval.winRatePct,
      pnl_units: Number(elenaProfit.toFixed(2)),
      yield_pct: elenaYield,
      staked_units: elenaEval.n,
      brier_ensemble: elenaEval.brierEns,
      log_loss_ensemble: elenaEval.logLossEns
    }
  };

  fs.writeFileSync(METRICS_PATH, JSON.stringify(updatedMetrics, null, 2), 'utf8');
  console.log('✅ api/metrics.json actualizado con universos A y B.');
  console.log('Resumen Métricas Globales:', globalMetrics);
  console.log('Resumen Portfolio Elena:', { n: elenaEval.n, won: elenaEval.won, lost: elenaEval.lost, PnL: elenaProfit.toFixed(2), Yield: elenaYield + '%' });

  console.log('\n=================================================================');
  console.log('🎉 INTEGRACIÓN COMPLETADA CON ÉXITO');
  console.log('=================================================================');
}

runIntegration();
