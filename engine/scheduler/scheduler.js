/**
 * AUTONOMOUS SCHEDULER & PIPELINE COORDINATOR
 * Fase 6: Orquesta el ciclo de vida continuo del Autonomous Sports Research Engine:
 * - 08:00 UTC: Escaneo matutino de Discovery + Deep Research + Prediction + AI Team
 * - T-60 / T-45: Monitoreo reactivo de alineaciones oficiales
 * - Post-Match: Liquidación automática de resultados y actualización del ROI
 */
const discoveryEngine = require('../discovery/discoveryEngine');
const deepResearchEngine = require('../research/deepResearchEngine');
const predictionEngine = require('../prediction/predictionEngine');
const agentOrchestrator = require('../agents/orchestrator');
const lineupWatcher = require('./lineupWatcher');
const settlementEngine = require('../settlement/settlementEngine');
const syncRadar = require('../data/syncRadar');
const storage = require('../data/storage');

class PipelineScheduler {
  constructor() {
    this.isRunning = false;
    this.intervals = [];
  }

  /**
   * Ejecuta el ciclo integral diario de investigación y modelado
   * @param {string} dateStr Fecha en formato YYYY-MM-DD
   * @returns {Promise<Object>} Resumen del ciclo completo
   */
  async runDailyPipeline(dateStr = null) {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    console.log(`\n========================================================`);
    console.log(`🚀 [Pipeline] INICIANDO CICLO DIARIO AUTÓNOMO: ${targetDate}`);
    console.log(`========================================================\n`);

    const startTime = Date.now();

    // 1. Fase 2: Discovery Engine
    console.log('--- 1. Discovery Engine ---');
    const discoveryResult = await discoveryEngine.runDiscovery({ targetDate, maxCandidates: 20 });
    const discoveredCandidates = discoveryResult.candidates || [];
    console.log(`[Discovery] ${discoveredCandidates.length} candidatos detectados.`);

    // 2. Fase 3: Deep Research Engine
    console.log('\n--- 2. Deep Research Engine ---');
    const allPending = storage.getCandidates().filter(c => c.status === 'DETECTADO' || c.status === 'INVESTIGADO');
    const todayPending = allPending.filter(c => 
      c.discoveredAt?.startsWith(targetDate) || 
      (c.matchTime && c.matchTime.includes(targetDate)) || 
      (c.rawSourceData && JSON.stringify(c.rawSourceData).includes(targetDate))
    );
    const candidatesToResearch = todayPending.length > 0 ? todayPending : allPending;
    const targetIds = candidatesToResearch.slice(0, 15).map(c => c.id);
    const researchedCandidates = await deepResearchEngine.runDeepResearch({ candidateIds: targetIds });
    console.log(`[DeepResearch] ${researchedCandidates.length} candidatos enriquecidos estadísticamente.`);

    // 3. Fase 3: Prediction Engine (Modelado Matemático)
    console.log('\n--- 3. Prediction Engine ---');
    const predictions = await predictionEngine.evaluateCandidates(researchedCandidates);
    console.log(`[Prediction] ${predictions.length} predicciones calculadas.`);

    // 4. Fase 4: AI Research Team & Risk Manager
    console.log('\n--- 4. AI Research Team (Comité de Agentes) ---');
    const aiEvaluations = await agentOrchestrator.processCandidates(predictions);
    const approvedPicks = aiEvaluations.filter(e => e.riskVerdict?.finalStatus === 'APROBADO');
    const rejectedPicks = aiEvaluations.filter(e => e.riskVerdict?.finalStatus === 'RECHAZADO');
    console.log(`[AITeam] Aprobados: ${approvedPicks.length} | Rechazados: ${rejectedPicks.length}`);

    // 5. Fase 5: Sincronización con el Radar Web
    console.log('\n--- 5. Sincronización con Radar Web ---');
    const syncedData = syncRadar.exportToPicksHoy(targetDate);
    console.log(`[SyncRadar] picks_hoy.json actualizado: ${syncedData.top_picks.length} picks activos.`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ [Pipeline] Ciclo diario finalizado exitosamente en ${duration}s.\n`);

    return {
      date: targetDate,
      durationSeconds: Number(duration),
      discoveryCount: discoveredCandidates.length,
      researchedCount: researchedCandidates.length,
      predictionsCount: predictions.length,
      approvedCount: approvedPicks.length,
      rejectedCount: rejectedPicks.length,
      topPicksActive: syncedData.top_picks.length
    };
  }

  /**
   * Ejecuta la verificación de alineaciones pre-partido
   */
  async runLineupVerification(options = {}) {
    return await lineupWatcher.checkPendingLineups(options);
  }

  /**
   * Ejecuta la liquidación de partidos completados
   */
  async runSettlement(options = {}) {
    return await settlementEngine.settlePendingPicks(options);
  }

  /**
   * Inicia el modo demonio/servicio con temporizadores
   */
  startDaemon(options = {}) {
    if (this.isRunning) {
      console.log('[Scheduler] El demonio ya está en ejecución.');
      return;
    }

    this.isRunning = true;
    console.log('🤖 [Scheduler] Modo Demonio Autónomo ACTIVADO');
    console.log('• Intervalo de Alineaciones: cada 15 min');
    console.log('• Intervalo de Liquidación: cada 30 min');

    // Intervalo de revisión de alineaciones (cada 15 minutos)
    const lineupInterval = setInterval(async () => {
      try {
        console.log('[Daemon] Ejecutando chequeo periódico de alineaciones...');
        await this.runLineupVerification();
      } catch (e) {
        console.error('[Daemon] Error en chequeo de alineaciones:', e.message);
      }
    }, options.lineupIntervalMs || 15 * 60 * 1000);

    // Intervalo de liquidación de resultados (cada 30 minutos)
    const settlementInterval = setInterval(async () => {
      try {
        console.log('[Daemon] Ejecutando chequeo periódico de liquidación...');
        await this.runSettlement();
      } catch (e) {
        console.error('[Daemon] Error en liquidación de resultados:', e.message);
      }
    }, options.settlementIntervalMs || 30 * 60 * 1000);

    this.intervals.push(lineupInterval, settlementInterval);
  }

  /**
   * Detiene el modo demonio
   */
  stopDaemon() {
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    this.isRunning = false;
    console.log('🛑 [Scheduler] Modo Demonio Autónomo DETENIDO');
  }
}

module.exports = new PipelineScheduler();
