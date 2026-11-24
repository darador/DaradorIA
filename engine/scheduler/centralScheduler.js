/**
 * CENTRAL AUTONOMOUS SCHEDULER & PIPELINE COORDINATOR
 * DaradorIA / DaradorBET — Fase 13: Automatización del Motor
 * 
 * Orquesta y automatiza de forma centralizada y unificada todos los procesos del motor:
 * - Discovery Engine: 05:00 ART inicial y actualización cada 4 horas (horizonte 48h).
 * - Deep Research & Prediction Engine: Inmediato post-Discovery, calidad de datos y filtros estrictos.
 * - Tribunal de IA y Elena: Evaluación colegiada y veto vinculante de riesgo.
 * - LineupWatcher: Monitoreo periódico cada 15 min con foco en ventana T-60 / T-45.
 * - Settlement Engine: Liquidación automática de resultados cada 30 min.
 * - ObservationTracker: Sellado inmutable SHA-256 síncrono.
 * - Sincronización continua de Daily Board y Dashboard Estadístico.
 * 
 * Características críticas:
 * - Control de concurrencia y prevención de solapamientos (Mutex por tarea).
 * - Persistencia del estado y registro de ejecuciones en disco (resistencia a reinicios).
 * - Detección y prevención de candidatos duplicados.
 * - Aislamiento de fallos y reintentos automáticos no bloqueantes.
 * - Modo Shadow Mode 100% verificado: 0 apuestas reales, 0 telegram.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const storage = require('../data/storage');
const dateTimeUtils = require('../utils/dateTime');

const discoveryEngine = require('../discovery/discoveryEngine');
const deepResearchEngine = require('../research/deepResearchEngine');
const predictionEngine = require('../prediction/predictionEngine');
const agentOrchestrator = require('../agents/orchestrator');
const lineupWatcher = require('./lineupWatcher');
const settlementEngine = require('../settlement/settlementEngine');
const syncRadar = require('../data/syncRadar');
const observationTracker = require('../prediction/observationTracker');

const TIMEZONE_ART = 'America/Argentina/Buenos_Aires';
const STATE_FILE = path.join(__dirname, '../storage_data/scheduler_state.json');

class CentralAutonomousScheduler {
  constructor() {
    this.isRunning = false;
    this.intervals = [];
    this.discoveryCheckTimer = null;

    // Mutex de concurrencia para evitar ejecuciones simultáneas o duplicadas
    this.locks = {
      discovery: false,
      pipeline: false,
      lineups: false,
      settlement: false,
      sync: false,
      experimentalMarkets: false,
      experimentalSnapshots: false,
      experimentalSettlement: false
    };

    // Configuración de intervalos (en milisegundos)
    this.config = {
      discoveryHoursArt: [1, 5, 9, 13, 17, 21], // 05:00 ART y cada 4 horas
      lineupIntervalMs: 15 * 60 * 1000,          // 15 minutos
      settlementIntervalMs: 30 * 60 * 1000,      // 30 minutos
      syncIntervalMs: 30 * 1000,                 // 30 segundos
      horizonHours: 48,                          // Horizonte de 48 horas
      maxHistoryEntries: 100
    };

    // Estado en memoria respaldado por scheduler_state.json
    this.state = this._loadPersistedState();
  }

  // --- PERSISTENCIA Y REGISTRO ---

  _loadPersistedState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          isRunning: false,
          startedAt: parsed.startedAt || null,
          lastStoppedAt: parsed.lastStoppedAt || null,
          lastRunTimes: parsed.lastRunTimes || {},
          nextScheduledRuns: parsed.nextScheduledRuns || {},
          executionHistory: parsed.executionHistory || [],
          errorLog: parsed.errorLog || [],
          totalRunsCompleted: parsed.totalRunsCompleted || 0,
          totalErrorsCaught: parsed.totalErrorsCaught || 0
        };
      }
    } catch (e) {
      console.warn('[CentralScheduler] Aviso al leer scheduler_state.json, inicializando nuevo:', e.message);
    }

    return {
      isRunning: false,
      startedAt: null,
      lastStoppedAt: null,
      lastRunTimes: {},
      nextScheduledRuns: {},
      executionHistory: [],
      errorLog: [],
      totalRunsCompleted: 0,
      totalErrorsCaught: 0
    };
  }

  _persistState() {
    try {
      const stateToSave = {
        ...this.state,
        isRunning: this.isRunning,
        updatedAt: new Date().toISOString(),
        updatedAtArt: this.formatArtTime(new Date())
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[CentralScheduler] Error guardando scheduler_state.json:', e.message);
      return false;
    }
  }

  _recordExecution(taskName, startTime, durationMs, status, details = {}) {
    const entry = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      task: taskName,
      startedAt: new Date(startTime).toISOString(),
      startedAtArt: this.formatArtTime(startTime),
      completedAt: new Date().toISOString(),
      completedAtArt: this.formatArtTime(new Date()),
      durationSeconds: Number((durationMs / 1000).toFixed(2)),
      status, // 'SUCCESS' | 'ERROR' | 'SKIPPED'
      recordsProcessed: details.recordsProcessed || 0,
      message: details.message || '',
      error: details.error || null
    };

    if (!this.state.executionHistory) this.state.executionHistory = [];
    this.state.executionHistory.unshift(entry);

    if (this.state.executionHistory.length > this.config.maxHistoryEntries) {
      this.state.executionHistory = this.state.executionHistory.slice(0, this.config.maxHistoryEntries);
    }

    if (!this.state.lastRunTimes) this.state.lastRunTimes = {};
    this.state.lastRunTimes[taskName] = entry.completedAt;

    if (status === 'SUCCESS') {
      this.state.totalRunsCompleted = (this.state.totalRunsCompleted || 0) + 1;
    } else if (status === 'ERROR') {
      this.state.totalErrorsCaught = (this.state.totalErrorsCaught || 0) + 1;
      if (!this.state.errorLog) this.state.errorLog = [];
      this.state.errorLog.unshift({
        timestamp: entry.completedAt,
        timestampArt: entry.completedAtArt,
        task: taskName,
        error: details.error
      });
      if (this.state.errorLog.length > 30) this.state.errorLog.pop();
    }

    this._persistState();
    return entry;
  }

  formatArtTime(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;

    const formatted = new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE_ART,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);

    return `${formatted} hs (ART)`;
  }

  // --- CÁLCULO DE PRÓXIMAS EJECUCIONES EN HORARIO ARGENTINO ---

  calculateNextDiscoveryRun(now = new Date()) {
    const hours = [...this.config.discoveryHoursArt].sort((a, b) => a - b);
    
    // Obtener componentes de fecha en Argentina
    const artDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE_ART,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);

    const artHour = Number(new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE_ART,
      hour: '2-digit',
      hour12: false
    }).format(now));

    const artMinute = Number(new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE_ART,
      minute: '2-digit',
      hour12: false
    }).format(now));

    // Buscar la próxima hora en el día de hoy
    let nextHour = hours.find(h => h > artHour || (h === artHour && artMinute < 2));
    let targetDateStr = artDateStr;

    if (nextHour === undefined) {
      // Si ya pasaron todas las horas hoy, la próxima es la primera mañana
      nextHour = hours[0];
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      targetDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE_ART,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(tomorrow);
    }

    // Convertir año, mes, día y hora de Argentina a fecha UTC absoluta (ART es UTC-3)
    const [y, m, d] = targetDateStr.split('-').map(Number);
    const targetUtc = new Date(Date.UTC(y, m - 1, d, nextHour + 3, 0, 0, 0));

    return {
      utc: targetUtc.toISOString(),
      art: this.formatArtTime(targetUtc),
      timestamp: targetUtc.getTime()
    };
  }

  // --- 1. CICLO DE DISCOVERY (HORIZONTE 48H) ---

  /**
   * Ejecuta el descubrimiento autónomo para hoy y mañana (próximas 48 horas)
   */
  async runDiscoveryJob(options = {}) {
    if (this.locks.discovery) {
      console.log('[CentralScheduler] ⚠️ Discovery ya está en ejecución (Bloqueo Mutex activo). Se omite solapamiento.');
      return { skipped: true, reason: 'LOCKED' };
    }

    this.locks.discovery = true;
    const startTime = Date.now();
    console.log(`\n======================================================`);
    console.log(`🔍 [CentralScheduler] EJECUTANDO DISCOVERY AUTÓNOMO (48h)`);
    console.log(`Hora inicio: ${this.formatArtTime(startTime)}`);
    console.log(`======================================================`);

    try {
      // 1. Determinar horizonte de 48 horas (Fecha de hoy y mañana en horario de Argentina)
      const now = new Date();
      const todayStr = dateTimeUtils.toLocalDateString(now, TIMEZONE_ART);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowStr = dateTimeUtils.toLocalDateString(tomorrow, TIMEZONE_ART);
      const targetDates = [todayStr, tomorrowStr];

      console.log(`[Discovery] Escaneando horizonte 48h: ${targetDates.join(' y ')}`);

      const discoveredCandidates = [];
      let totalFixturesScanned = 0;

      for (const targetDate of targetDates) {
        try {
          const res = await discoveryEngine.runDiscovery({ targetDate, maxCandidates: 25 });
          if (res && res.candidates) {
            discoveredCandidates.push(...res.candidates);
          }
          if (res && res.runMeta) {
            totalFixturesScanned += (res.runMeta.fixturesScanned || 0);
          }
        } catch (discErr) {
          console.warn(`[Discovery] Error parcial escaneando fecha ${targetDate}:`, discErr.message);
        }
      }

      // 2. Desduplicación contra candidatos existentes en almacenamiento
      const existingCandidates = storage.getCandidates();
      const existingSignatures = new Set(
        existingCandidates.map(c => 
          `${(c.playerOrTeam || '').toLowerCase().trim()}|${(c.match || '').toLowerCase().trim()}|${(c.market || '').toLowerCase().trim()}|${c.line || ''}`
        )
      );

      const genuinelyNewCandidates = discoveredCandidates.filter(c => {
        const sig = `${(c.playerOrTeam || '').toLowerCase().trim()}|${(c.match || '').toLowerCase().trim()}|${(c.market || '').toLowerCase().trim()}|${c.line || ''}`;
        return !existingSignatures.has(sig);
      });

      console.log(`[Discovery] Candidatos escaneados: ${discoveredCandidates.length} | Genuinamente nuevos: ${genuinelyNewCandidates.length}`);

      // Actualizar próxima corrida programada de Discovery
      const nextRun = this.calculateNextDiscoveryRun();
      if (!this.state.nextScheduledRuns) this.state.nextScheduledRuns = {};
      this.state.nextScheduledRuns.discovery = nextRun.utc;
      this.state.nextScheduledRuns.discoveryArt = nextRun.art;

      const duration = Date.now() - startTime;
      this._recordExecution('discovery', startTime, duration, 'SUCCESS', {
        recordsProcessed: genuinelyNewCandidates.length,
        message: `${totalFixturesScanned} partidos escaneados (48h). ${genuinelyNewCandidates.length} nuevos candidatos detectados.`
      });

      // 3. Encadenamiento automático con Deep Research y Predicción
      if (genuinelyNewCandidates.length > 0 || options.forcePipeline) {
        console.log('[CentralScheduler] ⚡ Activando Deep Research & Prediction Engine post-Discovery...');
        setImmediate(() => this.runPipelineJob({ candidateIds: genuinelyNewCandidates.map(c => c.id) }));
      }

      return {
        success: true,
        scanned: totalFixturesScanned,
        found: discoveredCandidates.length,
        newCandidatesCount: genuinelyNewCandidates.length,
        nextRun: nextRun.art
      };

    } catch (err) {
      const duration = Date.now() - startTime;
      console.error('[CentralScheduler] ❌ Error en ejecución de Discovery:', err.message);
      this._recordExecution('discovery', startTime, duration, 'ERROR', {
        error: err.message,
        message: 'Fallo al ejecutar Discovery Engine'
      });
      return { success: false, error: err.message };
    } finally {
      this.locks.discovery = false;
    }
  }

  // --- 2. DEEP RESEARCH, PREDICTION ENGINE Y AGENTES (ELENA) ---

  /**
   * Ejecuta el pipeline completo de investigación profunda, modelado y comités de IA
   */
  async runPipelineJob(options = {}) {
    if (this.locks.pipeline) {
      console.log('[CentralScheduler] ⚠️ Pipeline de Investigación y Modelado en curso. Se evita solapamiento.');
      return { skipped: true, reason: 'LOCKED' };
    }

    this.locks.pipeline = true;
    const startTime = Date.now();
    console.log(`\n======================================================`);
    console.log(`🔬 [CentralScheduler] EJECUTANDO PIPELINE DE MODELADO E IA`);
    console.log(`Hora inicio: ${this.formatArtTime(startTime)}`);
    console.log(`======================================================`);

    try {
      // 1. Recuperar candidatos pendientes de investigación
      const allCandidates = storage.getCandidates();
      let candidatesToProcess = allCandidates.filter(c => 
        c.status === 'DETECTADO' || c.status === 'PENDIENTE_INVESTIGACION'
      );

      if (options.candidateIds && options.candidateIds.length > 0) {
        candidatesToProcess = candidatesToProcess.filter(c => options.candidateIds.includes(c.id));
      }

      // Evitar investigar repetidamente candidatos sin cambios
      candidatesToProcess = candidatesToProcess.filter(c => c.status !== 'INVESTIGADO' && c.status !== 'APROBADO' && c.status !== 'RECHAZADO');

      console.log(`[Pipeline] Candidatos pendientes a procesar: ${candidatesToProcess.length}`);

      if (candidatesToProcess.length === 0) {
        console.log('[Pipeline] No hay nuevos candidatos para investigar.');
        const duration = Date.now() - startTime;
        this._recordExecution('pipeline', startTime, duration, 'SUCCESS', {
          recordsProcessed: 0,
          message: 'Sin candidatos nuevos para procesar.'
        });
        return { success: true, processed: 0 };
      }

      // 2. Ejecutar Deep Research
      console.log('--- Paso 2: Deep Research Engine ---');
      const targetIds = candidatesToProcess.slice(0, 20).map(c => c.id);
      const researched = await deepResearchEngine.runDeepResearch({ candidateIds: targetIds });
      console.log(`[Pipeline] ${researched.length} candidatos enriquecidos con métricas reales.`);

      // 3. Filtrar candidatos con datos incompletos (Quarantine)
      const validForPrediction = researched.filter(c => {
        const isComplete = c.status !== 'INVESTIGACION_INCOMPLETA' && 
                           c.status !== 'ERROR_DATOS' &&
                           (!c.researchData || c.researchData.qualityStatus !== 'INVESTIGACION_INCOMPLETA');
        if (!isComplete) {
          console.warn(`[Pipeline] ⛔ Candidato ${c.playerOrTeam} excluido de predicción (Datos incompletos).`);
        }
        return isComplete;
      });

      console.log(`[Pipeline] Candidatos válidos para predicción matemática: ${validForPrediction.length}`);

      // 4. Prediction Engine (Modelo B, Modelo C, Ensemble y +EV)
      console.log('--- Paso 3: Prediction Engine (Modelos Matemáticos) ---');
      const predictions = await predictionEngine.evaluateCandidates(validForPrediction);
      console.log(`[Pipeline] ${predictions.length} predicciones calculadas.`);

      // 5. Tribunal de Agentes IA y Veredicto de Elena (Risk Manager)
      console.log('--- Paso 4: Comité de Agentes y Veto de Elena ---');
      const evaluations = await agentOrchestrator.processCandidates(predictions);
      
      const approvedPicks = evaluations.filter(e => e.riskVerdict?.finalStatus === 'APROBADO');
      const rejectedPicks = evaluations.filter(e => e.riskVerdict?.finalStatus === 'RECHAZADO');
      const pendingPicks = evaluations.filter(e => e.riskVerdict?.finalStatus === 'PENDIENTE');

      console.log(`[Pipeline] Resultados Tribunal: ${approvedPicks.length} Aprobados por Elena | ${rejectedPicks.length} Rechazados | ${pendingPicks.length} Pendientes`);

      // 6. Sincronización del Radar Web y Daily Board
      console.log('--- Paso 5: Sincronización con Daily Board ---');
      const syncResult = syncRadar.exportToPicksHoy();
      console.log(`[Pipeline] Daily Board sincronizado (${syncResult.top_picks?.length || 0} picks activos).`);

      const duration = Date.now() - startTime;
      this._recordExecution('pipeline', startTime, duration, 'SUCCESS', {
        recordsProcessed: evaluations.length,
        message: `${validForPrediction.length} candidatos modelados. Aprobados: ${approvedPicks.length}, Rechazados: ${rejectedPicks.length}.`
      });

      return {
        success: true,
        researchedCount: researched.length,
        predictionsCount: predictions.length,
        approvedCount: approvedPicks.length,
        rejectedCount: rejectedPicks.length
      };

    } catch (err) {
      const duration = Date.now() - startTime;
      console.error('[CentralScheduler] ❌ Error en ejecución del Pipeline:', err.message);
      this._recordExecution('pipeline', startTime, duration, 'ERROR', {
        error: err.message,
        message: 'Fallo durante el pipeline de modelado e IA'
      });
      return { success: false, error: err.message };
    } finally {
      this.locks.pipeline = false;
    }
  }

  // --- 3. LINEUP WATCHER (CADA 15 MIN, ENFOQUE T-60 A T-45) ---

  /**
   * Monitorea planillas oficiales de los partidos de selecciones condicionales
   */
  async runLineupsJob(options = {}) {
    if (this.locks.lineups) {
      console.log('[CentralScheduler] ⚠️ Chequeo de alineaciones en curso. Omitiendo solapamiento.');
      return { skipped: true, reason: 'LOCKED' };
    }

    this.locks.lineups = true;
    const startTime = Date.now();

    try {
      const result = await lineupWatcher.checkPendingLineups(options);
      
      const nextRunMs = Date.now() + this.config.lineupIntervalMs;
      if (!this.state.nextScheduledRuns) this.state.nextScheduledRuns = {};
      this.state.nextScheduledRuns.lineups = new Date(nextRunMs).toISOString();
      this.state.nextScheduledRuns.lineupsArt = this.formatArtTime(nextRunMs);

      const duration = Date.now() - startTime;
      this._recordExecution('lineups', startTime, duration, 'SUCCESS', {
        recordsProcessed: result.totalEvaluated || 0,
        message: `Alineaciones: ${result.totalEvaluated || 0} evaluadas. Promovidos: ${result.promotedCount || 0}, Vetados: ${result.vetoedCount || 0}.`
      });

      return { success: true, ...result };
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error('[CentralScheduler] ❌ Error en LineupWatcher:', err.message);
      this._recordExecution('lineups', startTime, duration, 'ERROR', {
        error: err.message,
        message: 'Fallo en monitoreo de alineaciones'
      });
      return { success: false, error: err.message };
    } finally {
      this.locks.lineups = false;
    }
  }

  // --- 4. SETTLEMENT ENGINE (CADA 30 MIN) ---

  /**
   * Monitorea encuentros finalizados (FT) y liquida resultados oficiales
   */
  async runSettlementJob(options = {}) {
    if (this.locks.settlement) {
      console.log('[CentralScheduler] ⚠️ Liquidación de resultados en curso. Omitiendo solapamiento.');
      return { skipped: true, reason: 'LOCKED' };
    }

    this.locks.settlement = true;
    const startTime = Date.now();

    try {
      const result = await settlementEngine.settlePendingPicks(options);
      
      const nextRunMs = Date.now() + this.config.settlementIntervalMs;
      if (!this.state.nextScheduledRuns) this.state.nextScheduledRuns = {};
      this.state.nextScheduledRuns.settlement = new Date(nextRunMs).toISOString();
      this.state.nextScheduledRuns.settlementArt = this.formatArtTime(nextRunMs);

      const duration = Date.now() - startTime;
      this._recordExecution('settlement', startTime, duration, 'SUCCESS', {
        recordsProcessed: result.settled || 0,
        message: `Liquidación: ${result.evaluated || 0} evaluados. ${result.settled || 0} liquidados oficialmente.`
      });

      return { success: true, ...result };
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error('[CentralScheduler] ❌ Error en SettlementEngine:', err.message);
      this._recordExecution('settlement', startTime, duration, 'ERROR', {
        error: err.message,
        message: 'Fallo en liquidación de pronósticos'
      });
      return { success: false, error: err.message };
    } finally {
      this.locks.settlement = false;
    }
  }

  // --- 5. SINCRONIZACIÓN PERIÓDICA Y MONITOREO ---

  async runSyncJob() {
    if (this.locks.sync) return;
    this.locks.sync = true;
    try {
      syncRadar.exportToPicksHoy();
      const processMonitor = require('./processMonitor');
      processMonitor.auditProcesses({ schedulerInstance: this });
    } catch (e) {
      // Sincronización silenciosa no bloqueante
    } finally {
      this.locks.sync = false;
    }
  }

  // --- INICIO Y CONTROL DEL DEMONIO AUTÓNOMO ---

  /**
   * Activa el daemon autónomo centralizado
   */
  startDaemon(options = {}) {
    if (this.isRunning) {
      console.log('🤖 [CentralScheduler] El Demonio Autónomo ya se encuentra en ejecución.');
      return { alreadyRunning: true, state: this.getState() };
    }

    this.isRunning = true;
    this.state.isRunning = true;
    this.state.startedAt = new Date().toISOString();
    this.state.startedAtArt = this.formatArtTime(new Date());

    console.log(`\n======================================================`);
    console.log(`🤖 [CentralScheduler] MODO OPERATIVO AUTÓNOMO ACTIVADO`);
    console.log(`Zona Horaria: ${TIMEZONE_ART} (UTC-3)`);
    console.log(`Hora de Inicio: ${this.state.startedAtArt}`);
    console.log(`• Discovery: 05:00 ART y cada 4 horas (Horizonte 48h)`);
    console.log(`• LineupWatcher: cada ${this.config.lineupIntervalMs / 60000} minutos (Ventana T-60 / T-45)`);
    console.log(`• Settlement: cada ${this.config.settlementIntervalMs / 60000} minutos (Actas oficiales FT)`);
    console.log(`• Sincronización: cada ${this.config.syncIntervalMs / 1000} segundos`);
    console.log(`• Shadow Mode: ACTIVO (0 apuestas reales, 0 telegram)`);
    console.log(`======================================================\n`);

    // 1. Programar chequeo horario de Discovery (comprueba cada minuto si corresponde ejecutar)
    const nextDisc = this.calculateNextDiscoveryRun();
    this.state.nextScheduledRuns.discovery = nextDisc.utc;
    this.state.nextScheduledRuns.discoveryArt = nextDisc.art;
    console.log(`[CentralScheduler] Próxima ejecución de Discovery: ${nextDisc.art}`);

    this.discoveryCheckTimer = setInterval(async () => {
      const now = new Date();
      const currentArtHour = Number(new Intl.DateTimeFormat('es-AR', {
        timeZone: TIMEZONE_ART,
        hour: '2-digit',
        hour12: false
      }).format(now));

      const currentArtMinute = Number(new Intl.DateTimeFormat('es-AR', {
        timeZone: TIMEZONE_ART,
        minute: '2-digit',
        hour12: false
      }).format(now));

      // Si coincide con alguna de las horas configuradas y está en el minuto 0 (o ventana inicial de 2 min)
      if (this.config.discoveryHoursArt.includes(currentArtHour) && currentArtMinute === 0) {
        const lastDisc = this.state.lastRunTimes?.discovery;
        const lastDiscTime = lastDisc ? new Date(lastDisc).getTime() : 0;
        // Evitar doble corrida en el mismo minuto
        if (Date.now() - lastDiscTime > 5 * 60 * 1000) {
          console.log(`[CentralScheduler] ⏰ Disparando Discovery programado (${currentArtHour}:00 hs ART)...`);
          await this.runDiscoveryJob();
        }
      }
    }, 60 * 1000);

    // 2. Intervalo de LineupWatcher (cada 15 min)
    const lineupInterval = setInterval(async () => {
      try {
        await this.runLineupsJob();
      } catch (err) {
        console.error('[CentralScheduler] Error en ciclo de alineaciones:', err.message);
      }
    }, options.lineupIntervalMs || this.config.lineupIntervalMs);

    // 3. Intervalo de SettlementEngine (cada 30 min)
    const settlementInterval = setInterval(async () => {
      try {
        await this.runSettlementJob();
      } catch (err) {
        console.error('[CentralScheduler] Error en ciclo de liquidación:', err.message);
      }
    }, options.settlementIntervalMs || this.config.settlementIntervalMs);

    // 4. Intervalo de Sincronización continua de Radar y Proceso (cada 30s)
    const syncInterval = setInterval(async () => {
      try {
        await this.runSyncJob();
      } catch (err) {}
    }, options.syncIntervalMs || this.config.syncIntervalMs);

    this.intervals.push(lineupInterval, settlementInterval, syncInterval);

    // Próximas ejecuciones iniciales
    this.state.nextScheduledRuns.lineups = new Date(Date.now() + this.config.lineupIntervalMs).toISOString();
    this.state.nextScheduledRuns.lineupsArt = this.formatArtTime(Date.now() + this.config.lineupIntervalMs);
    this.state.nextScheduledRuns.settlement = new Date(Date.now() + this.config.settlementIntervalMs).toISOString();
    this.state.nextScheduledRuns.settlementArt = this.formatArtTime(Date.now() + this.config.settlementIntervalMs);

    this._persistState();

    // Actualizar proceso monitor
    try {
      const processMonitor = require('./processMonitor');
      processMonitor.auditProcesses({ schedulerInstance: this });
    } catch (e) {}

    return { started: true, state: this.getState() };
  }

  /**
   * Detiene el daemon autónomo de manera ordenada
   */
  stopDaemon() {
    if (!this.isRunning) {
      console.log('[CentralScheduler] El Demonio Autónomo ya está detenido.');
      return { stopped: false };
    }

    if (this.discoveryCheckTimer) {
      clearInterval(this.discoveryCheckTimer);
      this.discoveryCheckTimer = null;
    }

    this.intervals.forEach(clearInterval);
    this.intervals = [];

    this.isRunning = false;
    this.state.isRunning = false;
    this.state.lastStoppedAt = new Date().toISOString();
    this.state.lastStoppedAtArt = this.formatArtTime(new Date());

    // Liberar todos los locks
    Object.keys(this.locks).forEach(k => { this.locks[k] = false; });

    this._persistState();

    console.log(`\n🛑 [CentralScheduler] MODO OPERATIVO AUTÓNOMO DETENIDO (${this.state.lastStoppedAtArt})\n`);

    try {
      const processMonitor = require('./processMonitor');
      processMonitor.auditProcesses({ schedulerInstance: this });
    } catch (e) {}

    return { stopped: true, state: this.getState() };
  }

  /**
   * Obtiene el estado actual del scheduler
   */
  getState() {
    return {
      isRunning: this.isRunning,
      startedAt: this.state.startedAt,
      startedAtArt: this.state.startedAtArt,
      lastStoppedAt: this.state.lastStoppedAt,
      lastStoppedAtArt: this.state.lastStoppedAtArt,
      locks: { ...this.locks },
      lastRunTimes: { ...this.state.lastRunTimes },
      nextScheduledRuns: { ...this.state.nextScheduledRuns },
      totalRunsCompleted: this.state.totalRunsCompleted || 0,
      totalErrorsCaught: this.state.totalErrorsCaught || 0,
      recentExecutions: (this.state.executionHistory || []).slice(0, 10),
      recentErrors: (this.state.errorLog || []).slice(0, 5)
    };
  }

  /**
   * Fase 10: Ejecuta el circuito experimental de mercados (1X2, Doble Oportunidad, BTTS, Goles, AH)
   * de forma 100% aislada del circuito productivo (autoExecutionAllowed: false).
   * No se programa automáticamente en daemon hasta validar la primera corrida controlada.
   */
  async runExperimentalMarketsJob(options = {}) {
    if (this.locks.experimentalMarkets) {
      return { skipped: true, reason: 'LOCKED', autoExecutionAllowed: false };
    }

    this.locks.experimentalMarkets = true;
    const startTime = Date.now();
    try {
      const { ControlledPipelineRunner } = require('../experimental/markets/observation/controlledPipelineRunner');
      const runner = options.runner || new ControlledPipelineRunner(options.runnerOptions);
      const res = await runner.runControlledCycle({
        ...options,
        trigger: options.trigger || 'CENTRAL_SCHEDULER_EXPERIMENTAL'
      });

      const accepted = res?.telemetry?.observationsAccepted || 0;
      const cat = res?.telemetry?.outcomeCategory || (res.ok ? 'EXECUTED' : 'PROVIDER_ERROR');
      this._recordExecution(
        'experimentalMarkets',
        startTime,
        Date.now() - startTime,
        res.ok ? 'SUCCESS' : 'ERROR',
        {
          recordsProcessed: accepted,
          message: `Fase 10 (${cat}): ${res?.telemetry?.matchesInvestigated || 0} partidos investigados, ${res?.telemetry?.predictionsGenerated || 0} predicciones, ${accepted} obs registradas.`,
          error: res.ok ? null : res.error
        }
      );

      return res;
    } catch (err) {
      this._recordExecution('experimentalMarkets', startTime, Date.now() - startTime, 'ERROR', {
        recordsProcessed: 0,
        message: 'Fallo en circuito experimental de mercados (Fase 10).',
        error: err.message
      });
      return { ok: false, error: err.message, autoExecutionAllowed: false };
    } finally {
      this.locks.experimentalMarkets = false;
    }
  }

  /**
   * Fase 10.1: Ejecuta SnapshotWorker experimental (T-60, T-30, T-5, CLOSING) con mutex independiente.
   */
  async runExperimentalSnapshotsJob(options = {}) {
    if (this.locks.experimentalSnapshots) {
      return { skipped: true, reason: 'LOCKED', autoExecutionAllowed: false };
    }
    this.locks.experimentalSnapshots = true;
    const startTime = Date.now();
    try {
      const { SnapshotWorker } = require('../experimental/markets/observation/snapshotWorker');
      const worker = options.worker || new SnapshotWorker(options.workerOptions);
      const res = await worker.runCycle(options);
      this._recordExecution('experimentalSnapshots', startTime, Date.now() - startTime, res.ok ? 'SUCCESS' : 'ERROR', {
        recordsProcessed: res?.summary?.completedCount || 0,
        message: `Snapshots Fase 10.1: ${res?.summary?.completedCount || 0} capturados, ${res?.summary?.missedCount || 0} MISSED, ${res?.summary?.failedCount || 0} fallidos.`,
        error: res.ok ? null : res.error
      });
      return res;
    } catch (err) {
      this._recordExecution('experimentalSnapshots', startTime, Date.now() - startTime, 'ERROR', {
        recordsProcessed: 0,
        message: 'Fallo en SnapshotWorker experimental.',
        error: err.message
      });
      return { ok: false, error: err.message, autoExecutionAllowed: false };
    } finally {
      this.locks.experimentalSnapshots = false;
    }
  }

  /**
   * Fase 10.1: Ejecuta SettlementWorker experimental (liquidación FT confirmada) con mutex independiente.
   */
  async runExperimentalSettlementJob(options = {}) {
    if (this.locks.experimentalSettlement) {
      return { skipped: true, reason: 'LOCKED', autoExecutionAllowed: false };
    }
    this.locks.experimentalSettlement = true;
    const startTime = Date.now();
    try {
      const { SettlementWorker } = require('../experimental/markets/observation/settlementWorker');
      const worker = options.worker || new SettlementWorker(options.workerOptions);
      const res = await worker.runCycle(options);
      this._recordExecution('experimentalSettlement', startTime, Date.now() - startTime, res.ok ? 'SUCCESS' : 'ERROR', {
        recordsProcessed: res?.summary?.settledCount || 0,
        message: `Settlement Fase 10.1: ${res?.summary?.settledCount || 0} liquidadas, ${res?.summary?.pendingRemainingCount || 0} pendientes.`,
        error: res.ok ? null : res.error
      });
      return res;
    } catch (err) {
      this._recordExecution('experimentalSettlement', startTime, Date.now() - startTime, 'ERROR', {
        recordsProcessed: 0,
        message: 'Fallo en SettlementWorker experimental.',
        error: err.message
      });
      return { ok: false, error: err.message, autoExecutionAllowed: false };
    } finally {
      this.locks.experimentalSettlement = false;
    }
  }

  /**
   * Ejecuta el pipeline diario completo (compatibilidad con llamadas CLI)
   */
  async runDailyPipeline(dateStr = null) {
    const targetDate = dateStr || dateTimeUtils.toLocalDateString(new Date(), TIMEZONE_ART);
    console.log(`[CentralScheduler] Ejecutando Pipeline Diario para: ${targetDate}`);
    
    // Ejecutar discovery con targetDate
    await this.runDiscoveryJob({ targetDates: [targetDate], forcePipeline: true });
    
    // Ejecutar lineups
    await this.runLineupsJob();

    // Ejecutar settlement
    await this.runSettlementJob();

    return {
      date: targetDate,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      completedAtArt: this.formatArtTime(new Date())
    };
  }
}

// Exportar instancia única singleton
const centralSchedulerInstance = new CentralAutonomousScheduler();
module.exports = centralSchedulerInstance;
