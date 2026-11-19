/**
 * DARADOR IA - AUTONOMOUS SPORTS RESEARCH ENGINE
 * Punto de entrada principal para exportar los módulos del sistema
 */
const config = require('./config');
const mcpClient = require('./mcp/mcpClient');
const rateGovernor = require('./mcp/rateGovernor');
const cache = require('./mcp/cache');
const storage = require('./data/storage');
const radarSync = require('./data/syncRadar');
const supabaseClient = require('./data/supabaseClient');
const discoveryEngine = require('./discovery/discoveryEngine');
const deepResearchEngine = require('./research/deepResearchEngine');
const predictionEngine = require('./prediction/predictionEngine');

module.exports = {
  config,
  mcpClient,
  rateGovernor,
  cache,
  storage,
  radarSync,
  supabaseClient,
  discoveryEngine,
  deepResearchEngine,
  predictionEngine
};
