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

// AI Research Team
const playerAnalyst = require('./agents/playerAnalyst');
const teamAnalyst = require('./agents/teamAnalyst');
const matchContextAnalyst = require('./agents/matchContextAnalyst');
const oddsAnalyst = require('./agents/oddsAnalyst');
const matchIntelligenceAnalyst = require('./agents/matchIntelligenceAnalyst');
const riskManager = require('./agents/riskManager');
const orchestrator = require('./agents/orchestrator');

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
  predictionEngine,
  agents: {
    playerAnalyst,
    teamAnalyst,
    matchContextAnalyst,
    oddsAnalyst,
    matchIntelligenceAnalyst,
    riskManager,
    orchestrator
  }
};
