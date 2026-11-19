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
    const discoveryResult = await discoveryEngine.run({ date: targetDate });
    console.log(`[Discovery] ${discoveryResult.candidatesCount} candidatos detectados.`);

    // 2. Fase 3: Deep Research Engine
    console.log('\n--- 2. Deep Research Engine ---');
    const candidatesToResearch = storage.getCandidates().filter(c => c.status === 'DETECTADO' || c.status === 'INVESTIGADO');
    const researchedCandidates = await deepResearchEngine.runResearch(candidatesToResearch.slice(0, 8));
    console.log(`[DeepResearch] ${researchedCandidates.length} candidatos enriquecidos estadísticamente.`);

    // 3. Fase 3: Prediction Engine (Modelado Matemático)
    console.log('\n--- 3. Prediction Engine ---');
    const predictions = await predictionEngine.runEvaluation(researchedCandidates);
    console.log(`[Prediction] ${predictions.length} predicciones calculadas.`);

    // 4. Fase 4: AI Research Team & Risk Manager
    console.log('\n--- 4. AI Research Team (Comité de Agentes) ---');
    const aiResult = await agentOrchestrator.evaluateCandidates(researchedCandidates);
    console.log(`[AITeam] Aprobados: ${aiResult.approved.length} | Rechazados: ${aiResult.rejected.length}`);

    // 5. Fase 5: Sincronización con el Radar Web
    console.log('\n--- 5. Sincronización con Radar Web ---');
    const syncedData = syncRadar.exportToPicksHoy(targetDate);
    console.log(`[SyncRadar] picks_hoy.json actualizado: ${syncedData.top_picks.length} picks activos.`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ [Pipeline] Ciclo diario finalizado exitosamente en ${duration}s.\n`);

    return {
      date: targetDate,
      durationSeconds: Number(duration),
      discoveryCount: discoveryResult.candidatesCount,
      researchedCount: researchedCandidates.length,
      predictionsCount: predictions.length,
      approvedCount: aiResult.approved.length,
      rejectedCount: aiResult.rejected.length,
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
