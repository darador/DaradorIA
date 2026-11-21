/**
 * CONFIGURACIÓN CENTRAL - AUTONOMOUS SPORTS RESEARCH ENGINE
 * DaradorIA - Enero/Noviembre 2026
 */
const path = require('path');

module.exports = {
  // Limites del MCP StatsHub
  mcp: {
    serverUrl: 'https://www.statshub.com/mcp',
    rateLimits: {
      maxPerMinute: 20,         // Margen seguro sobre el límite estricto de 30
      maxDailyCalls: 280,       // Margen seguro sobre el límite estricto de 300
      maxConcurrent: 2,         // Margen seguro sobre el límite estricto de 4
      minIntervalMs: 2500       // Intervalo mínimo entre llamadas (2.5s)
    },
    cacheTTL: {
      fixtures: 4 * 3600 * 1000,        // 4 horas
      screeners: 2 * 3600 * 1000,       // 2 horas
      trends: 2 * 3600 * 1000,          // 2 horas
      playerStats: 12 * 3600 * 1000,    // 12 horas
      teamStats: 12 * 3600 * 1000,      // 12 horas
      referee: 7 * 24 * 3600 * 1000,    // 7 días
      default: 2 * 3600 * 1000          // 2 horas por defecto
    }
  },

  // Criterios cuantitativos de predicción
  prediction: {
    minOdds: 1.60,
    maxOdds: 2.35,
    minEV: 0.07,                        // +7.0% EV mínimo
    minSampleMatches: 12,               // Muestra mínima de partidos reales válidos para aprobación
    minExpectedMinutes: 60,             // Minutos esperados de titular (>= 60 min)
    maxModelDivergence: 0.15,           // Divergencia máx Poisson vs Empírico
    defaultKellyFraction: 0.25          // Cuarto de Kelly para gestión de stake
  },

  // Estrategia y ventanas de muestreo estadístico
  sampling: {
    maxPlayerMatches: 20,               // Límite máximo de partidos para jugadores (getPlayerStats limit: 20)
    maxTeamMatches: 30,                 // Límite máximo de partidos para equipos (getTeamPerformance limit: 30)
    minPlayerValidMatches: 8,           // Mínimo de partidos reales con minutos para considerar válida la investigación
    minTeamValidMatches: 10,            // Mínimo de partidos reales para equipos
    minStarterMinutes: 45,              // Mínimo de minutos en una aparición para considerarla titularidad válida
    temporalDecayAlpha: 0.04,           // Factor de decaimiento exponencial temporal w_i = e^(-alpha * i)
    minutesFilterByMarket: {
      shots: 25,
      shotsOnTarget: 25,
      goals: 20,
      assists: 20,
      fouls: 15,
      foulsWon: 15,
      yellowCards: 15,
      tackles: 20,
      corners: 0,
      default: 25
    }
  },

  // Ligas y competiciones prioritarias
  targetCompetitions: [
    'Premier League',
    'LaLiga',
    'Serie A',
    'Bundesliga',
    'Ligue 1',
    'UEFA Champions League',
    'Copa del Rey',
    'Brasileirão Série A',
    'Liga Profesional'
  ],

  // Shadow Mode: Modo de observación controlada y validación de motor (Fase 10)
  shadowMode: {
    enabled: true,                       // Activo en Fase 10: investigación y evaluación sin ejecución real
    allowRealBets: false,                // Prohibido ejecutar apuestas reales
    allowTelegramPicks: false,           // Prohibido enviar picks a canales operativos de Telegram
    allowAutomatedOrders: false,         // Prohibido emitir órdenes automatizadas
    logCounterfactuals: true,            // Conservar candidatos aprobados y rechazados por Elena
    modelsTracked: ['Model-B-L10', 'Model-C-L15-L20'],
    targetConfirmedObservations: 100,    // Meta mínima de observaciones confirmadas y auditables
    reportingBatchSize: 25               // Frecuencia de generación de informes de seguimiento
  },

  // Rutas del sistema
  paths: {
    root: path.resolve(__dirname, '..'),
    storageDir: path.resolve(__dirname, 'storage_data'),
    cacheDir: path.resolve(__dirname, 'storage_data', 'cache'),
    logsDir: path.resolve(__dirname, 'logs'),
    picksHoy: path.resolve(__dirname, '..', 'picks_hoy.json'),
    historialPicks: path.resolve(__dirname, '..', 'historial_picks.json')
  },

  // Zona horaria oficial del sistema y visualización
  timezone: 'America/Argentina/Buenos_Aires',

  // Configuración de Supabase (detecta variables de entorno si existen)
  supabase: {
    url: process.env.SUPABASE_URL || null,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || null,
    enabled: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY))
  }
};
