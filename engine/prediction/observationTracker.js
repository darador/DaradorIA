/**
 * MODEL OBSERVATION TRACKER - REGISTRO CONGELADO PRE-MATCH Y EVALUACIÓN CONTRAFACTUAL
 * DaradorIA / DaradorBET - Fase 10.1
 * 
 * Gestiona el ciclo completo de observación controlada y trazabilidad contrafactual:
 * 1. Separación en 5 universos: Descubiertas, Investigadas, Elegibles, Aprobadas y Rechazadas.
 * 2. Registro independiente de probabilidades y EVs (Modelo B L10, Modelo C L15/L20 y Ensamble).
 * 3. Auditoría de correlación de eventos y agrupación por partido (N picks vs N partidos).
 * 4. Evaluación contrafactual de filtros de selección (EV y Veto de Elena).
 * 5. Generación de informes de seguimiento periódicos cada 25 observaciones confirmadas.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const integrityGuard = require('../audit/integrityGuard');

const REGISTRY_FILE = path.resolve(__dirname, '..', 'storage_data', 'model_observation_registry.json');
const EPSILON = 1e-15;

class ObservationTracker {
  constructor() {
    this.registryPath = REGISTRY_FILE;
    this._ensureFileExists();
  }

  _ensureFileExists() {
    if (!fs.existsSync(this.registryPath)) {
      fs.writeFileSync(this.registryPath, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  /**
   * Asigna de manera canónica y exhaustiva un valor de probabilidad [0.0, 1.0] a su intervalo.
   * Regla estándar: intervalos semi-abiertos [a, b), excepto el bin final que incluye 1.00.
   * @param {number} prob
   * @returns {string|null}
   */
  getBinForProbability(prob) {
    if (typeof prob !== 'number' || isNaN(prob)) return null;
    if (prob >= 0.00 && prob < 0.50) return '[0.00, 0.50)';
    if (prob >= 0.50 && prob < 0.60) return '[0.50, 0.60)';
    if (prob >= 0.60 && prob < 0.70) return '[0.60, 0.70)';
    if (prob >= 0.70 && prob < 0.80) return '[0.70, 0.80)';
    if (prob >= 0.80 && prob < 0.90) return '[0.80, 0.90)';
    if (prob >= 0.90 && prob <= 1.00) return '[0.90, 1.00]';
    return null;
  }

  /**
   * Verifica la integridad criptográfica de todas las observaciones contra el ledger SHA-256.
   * @returns {Object} Informe de verificación
   */
  verifyIntegrity() {
    return integrityGuard.verifyIntegrity(this._readRegistry());
  }

  /**
   * Sella las observaciones en el ledger criptográfico SHA-256 inmutable.
   * @returns {Object}
   */
  sealRegistry() {
    return integrityGuard.sealRecords(this._readRegistry());
  }

  _ensureRecordState(obs) {
    if (!obs) return obs;
    if (!obs.currentState) {
      if (obs.verificationStatus === 'RESULTADO_CONFIRMADO') {
        obs.currentState = 'SETTLED';
      } else if (obs.stage === 'APPROVED' || obs.elenaDecision === 'APROBADO') {
        obs.currentState = 'APPROVED_BY_ELENA';
      } else if (obs.stage === 'REJECTED' || obs.elenaDecision === 'RECHAZADO') {
        obs.currentState = 'REJECTED';
      } else if (obs.stage === 'ELIGIBLE') {
        obs.currentState = obs.elenaDecision === 'PENDIENTE' ? 'PENDING_LINEUP' : 'ELIGIBLE';
      } else if (obs.stage === 'INVESTIGATED') {
        obs.currentState = 'RESEARCHED';
      } else {
        obs.currentState = 'DISCOVERED';
      }
    }

    if (!Array.isArray(obs.stateHistory) || obs.stateHistory.length === 0) {
      const history = [
        {
          fromState: null,
          toState: 'DISCOVERED',
          timestamp: obs.investigatedAt || '2026-11-19T17:52:58.000Z',
          reason: 'Candidato detectado por Discovery Engine',
          source: 'DiscoveryEngine'
        }
      ];
      if (obs.stage === 'INVESTIGATED' || obs.stage === 'ELIGIBLE' || obs.stage === 'APPROVED' || obs.stage === 'REJECTED') {
        history.push({
          fromState: 'DISCOVERED',
          toState: 'RESEARCHED',
          timestamp: obs.investigatedAt || '2026-11-19T17:52:58.000Z',
          reason: 'Investigación cuantitativa completada con StatsHub MCP',
          source: 'DeepResearchEngine'
        });
      }
      if (obs.stage === 'ELIGIBLE' || obs.stage === 'APPROVED') {
        history.push({
          fromState: 'RESEARCHED',
          toState: 'ELIGIBLE',
          timestamp: obs.investigatedAt || '2026-11-19T17:52:58.000Z',
          reason: 'Filtro EV superado (EV >= +7.0%)',
          source: 'PredictionEngine'
        });
      }
      if (obs.stage === 'APPROVED') {
        history.push({
          fromState: 'ELIGIBLE',
          toState: 'APPROVED_BY_ELENA',
          timestamp: obs.investigatedAt || '2026-11-19T17:52:58.000Z',
          reason: obs.elenaVetoRule || 'Aprobación unánime del Comité de IA',
          source: 'RiskManager_Elena'
        });
      } else if (obs.stage === 'ELIGIBLE' && obs.elenaDecision === 'PENDIENTE') {
        history.push({
          fromState: 'ELIGIBLE',
          toState: 'PENDING_LINEUP',
          timestamp: obs.investigatedAt || '2026-11-19T17:52:58.000Z',
          reason: obs.elenaVetoRule || 'Aprobado cuantitativamente, supeditado a planilla oficial T-60',
          source: 'RiskManager_Elena'
        });
      } else if (obs.stage === 'REJECTED') {
        history.push({
          fromState: history[history.length - 1].toState,
          toState: 'REJECTED',
          timestamp: obs.investigatedAt || '2026-11-19T17:52:58.000Z',
          reason: obs.elenaVetoRule || 'Descarte por filtros de selección',
          source: obs.rejectionStage || 'RiskManager_Elena'
        });
      }
      if (obs.verificationStatus === 'RESULTADO_CONFIRMADO') {
        history.push({
          fromState: obs.stage === 'APPROVED' ? 'APPROVED_BY_ELENA' : (obs.stage === 'ELIGIBLE' ? 'PENDING_LINEUP' : obs.stage),
          toState: 'SETTLED',
          timestamp: obs.settledAt || '2026-11-20T00:36:03.000Z',
          reason: obs.verificationReason || `Liquidación oficial confirmada: ${obs.finalResultConfirmed}`,
          source: obs.verificationSource || 'StatsHub MCP Oficial FT'
        });
      }
      obs.stateHistory = history;
    }
    return obs;
  }

  _readRegistry() {
    try {
      this._ensureFileExists();
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.map(item => this._ensureRecordState(item)) : [];
    } catch (e) {
      console.warn('[ObservationTracker] Error leyendo registro:', e.message);
      return [];
    }
  }

  _writeRegistry(data) {
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('[ObservationTracker] Error guardando registro:', e.message);
      return false;
    }
  }

  /**
   * Normaliza un identificador canónico de evento a partir de los nombres de los equipos
   */
  _getCanonicalEventId(matchStr) {
    if (!matchStr) return 'unknown_event';
    const clean = matchStr.toLowerCase().replace(/\(equipo\)/g, '').trim();
    const parts = clean.split(/\s+vs\.?\s+/);
    if (parts.length >= 2) {
      const t1 = parts[0].trim();
      const t2 = parts[1].trim();
      if (t1 && t2) {
        return [t1, t2].sort().join('__');
      }
    }
    return clean;
  }

  /**
   * Congela una observación pre-partido con trazabilidad de universos y EVs independientes.
   * @param {Object} candidate - Datos del candidato
   * @param {Object} prediction - Predicción matemática
   * @param {Object} options - Metadatos (agentReports, riskVerdict, modelVersion)
   */
  freezeObservation(candidate, prediction = {}, options = {}) {
    if (!candidate) return null;
    const registry = this._readRegistry();

    const pickId = candidate.id || candidate.pickId;
    const existingIndex = registry.findIndex(o => o.pickId === pickId);

    const bookmakerOdds = Number(candidate.bookmakerOdds || candidate.odds || candidate.cuota || 0);
    const sampleSize = candidate.sampleSize 
      || candidate.researchData?.sampleSize 
      || candidate.researchData?.validMatches 
      || candidate.researchData?.playerData?.historicalValues?.length 
      || (candidate.rawSourceData?.hitRateL10 ? 10 : 0);

    // Probabilidades congeladas pre-partido
    const probModelB = prediction.models?.modelB?.pProjected 
      ?? (candidate.rawSourceData?.hitRateL10 ? Number((candidate.rawSourceData.hitRateL10 / 100).toFixed(4)) : (prediction.pProjected ?? null));

    const probModelC = prediction.models?.modelC?.pProjected 
      ?? (candidate.rawSourceData?.hitRateL15 ? Number((candidate.rawSourceData.hitRateL15 / 100).toFixed(4)) : null);

    const originalProb = prediction.pProjected ?? probModelB ?? null;

    // Cálculo independiente de Expected Value (EV) para cada modelo
    const evEnsemble = prediction.ev ?? (originalProb !== null ? Number(((originalProb * bookmakerOdds) - 1).toFixed(4)) : null);
    const evPercentageEnsemble = prediction.evPercentage ?? (evEnsemble !== null ? Number((evEnsemble * 100).toFixed(1)) : null);

    const evModelB = probModelB !== null ? Number(((probModelB * bookmakerOdds) - 1).toFixed(4)) : null;
    const evPercentageModelB = evModelB !== null ? Number((evModelB * 100).toFixed(1)) : null;

    const evModelC = probModelC !== null ? Number(((probModelC * bookmakerOdds) - 1).toFixed(4)) : null;
    const evPercentageModelC = evModelC !== null ? Number((evModelC * 100).toFixed(1)) : null;

    const windowUsedB = 'L10';
    const windowUsedC = prediction.models?.modelC?.window 
      || (sampleSize >= 20 ? 'L20' : (sampleSize >= 15 || candidate.rawSourceData?.hitRateL15 ? 'L15' : null));

    // Decisión de Elena y Tribunal de IA
    const riskVerdict = options.riskVerdict || candidate.riskVerdict || {};
    const agentReports = options.agentReports || candidate.agentReports || {};

    const elenaDecision = riskVerdict.finalStatus || candidate.status || 'PENDIENTE';
    const elenaVetoApplied = Boolean(riskVerdict.vetoApplied || elenaDecision === 'RECHAZADO');
    const elenaVetoReasons = riskVerdict.vetoReasons || (candidate.decisionReason ? [candidate.decisionReason] : []);
    const elenaVetoRule = elenaVetoReasons.join(' | ') || null;

    // Clasificación formal en los 5 Universos de Observación (Fase 10.1)
    let stage = 'DISCOVERED';
    let rejectionStage = null;
    let rejectionCategory = null;

    // Mínimo metodológico estricto: 8 para jugadores, 10 para equipos
    const minSampleMatches = (candidate.isTeamProp || (candidate.mercado && candidate.mercado.includes('equipo')) || (candidate.market && candidate.market.includes('equipo')))
      ? (config.sampling?.minTeamValidMatches || 10)
      : (config.sampling?.minPlayerValidMatches || 8);

    const isInvestigated = sampleSize >= minSampleMatches && (candidate.researchData?.qualityStatus === 'COMPLETA' || Boolean(candidate.rawSourceData));
    if (isInvestigated) {
      stage = 'INVESTIGATED';
      const isEligible = (evEnsemble !== null && evEnsemble >= 0.07);
      if (isEligible) {
        stage = 'ELIGIBLE';
        if (elenaDecision === 'APROBADO') {
          stage = 'APPROVED';
        } else if (elenaDecision === 'RECHAZADO') {
          stage = 'REJECTED';
          rejectionStage = 'ELENA_VETO';
          rejectionCategory = elenaVetoRule?.includes('EV insuficiente') ? 'LOW_EV'
            : (elenaVetoRule?.includes('MUESTRA INSUFICIENTE') ? 'INSUFFICIENT_SAMPLE'
            : (elenaVetoRule?.includes('PROBABILIDAD INFLADA') ? 'PROBABILITY_INFLATED'
            : (elenaVetoRule?.includes('DIVERGENCIA') ? 'MODEL_DIVERGENCE'
            : (elenaVetoRule?.includes('ALINEACIÓN') ? 'LINEUP_RISK' : 'TACTICAL_OPPOSITION'))));
        }
      } else {
        if (elenaDecision === 'RECHAZADO' || candidate.status === 'RECHAZADO') {
          stage = 'REJECTED';
          rejectionStage = 'PREDICTION_EV';
          rejectionCategory = 'LOW_EV';
        }
      }
    } else {
      if (candidate.researchData?.qualityStatus === 'INVESTIGACION_INCOMPLETA' || candidate.researchData?.qualityStatus === 'ERROR_DATOS') {
        stage = 'REJECTED';
        rejectionStage = 'DEEP_RESEARCH';
        rejectionCategory = 'INCOMPLETE_DATA';
      }
    }

    const eventName = candidate.match || candidate.partido || 'Evento Deportivo';
    const eventId = this._getCanonicalEventId(eventName);

    const agentDecisions = {
      playerAnalyst: agentReports.playerAnalyst?.recommendation || null,
      teamAnalyst: agentReports.teamAnalyst?.recommendation || null,
      matchContext: agentReports.matchContext?.recommendation || null,
      oddsAnalyst: agentReports.oddsAnalyst?.recommendation || null,
      matchIntel: agentReports.matchIntel?.recommendation || null
    };

    // Determinar currentState estandarizado (Fase 10.1.3)
    let currentState = 'DISCOVERED';
    if (stage === 'APPROVED') {
      currentState = 'APPROVED_BY_ELENA';
    } else if (stage === 'REJECTED') {
      currentState = 'REJECTED';
    } else if (stage === 'ELIGIBLE') {
      currentState = elenaDecision === 'PENDIENTE' ? 'PENDING_LINEUP' : 'ELIGIBLE';
    } else if (stage === 'INVESTIGATED') {
      currentState = 'RESEARCHED';
    } else if (candidate.researchData?.qualityStatus === 'INVESTIGACION_INCOMPLETA') {
      currentState = 'RESEARCH_INCOMPLETE';
    }

    const observation = {
      pickId,
      eventId,
      stage,
      currentState,
      rejectionStage,
      rejectionCategory,
      engineVersion: options.modelVersion || 'v2.0-shadow-mode',
      shadowMode: true,
      isOperativeRecommendation: false,
      isTestPick: pickId.startsWith('cand_test_') || pickId.startsWith('pick_test_'),
      event: eventName,
      date: candidate.date || new Date().toISOString().slice(0, 10),
      competition: candidate.competition || candidate.liga || 'Competición Oficial',
      playerOrTeam: candidate.playerOrTeam || candidate.player || candidate.seleccion,
      market: candidate.market || candidate.mercado,
      line: candidate.line || candidate.linea,
      odds: bookmakerOdds,
      // Probabilidades independientes congeladas
      originalProb,
      probModelB,
      probModelC,
      modelVersionB: 'Model-B-L10',
      modelVersionC: 'Model-C-L15-L20',
      windowUsedB,
      windowUsedC,
      // Expected Value (EV) independiente
      evEnsemble,
      evPercentageEnsemble,
      evModelB,
      evPercentageModelB,
      evModelC,
      evPercentageModelC,
      statisticalDataUsed: {
        sampleSize,
        actualMatchesAnalyzed: sampleSize,
        windows: candidate.researchData?.windows || null,
        avgStat: candidate.researchData?.playerData?.statPerGame || candidate.researchData?.teamData?.statPerGame || null,
        statPer90: candidate.researchData?.playerData?.statPer90 || null,
        projectedMinutes: candidate.researchData?.playerData?.projectedMinutes || null,
        isStarter: candidate.researchData?.lineupData?.isStarter ?? null
      },
      actualMatchesAnalyzed: sampleSize,
      dataQualityStatus: candidate.researchData?.qualityStatus || (sampleSize > 0 ? 'COMPLETA' : 'INVESTIGACION_INCOMPLETA'),
      investigatedAt: options.predictedAt || prediction.timestamp || candidate.createdAt || new Date().toISOString(),
      agentDecisions,
      elenaDecision,
      elenaVetoApplied,
      elenaVetoReasons,
      elenaVetoRule,
      // Liquidación Oficial
      verificationStatus: 'PENDIENTE',
      finalResultConfirmed: null,
      actualStat: null,
      profitUnits: null,
      settledAt: null,
      verificationSource: null,
      verificationReason: null,
      stateHistory: []
    };

    if (existingIndex >= 0) {
      const prev = registry[existingIndex];
      // Si la observación ya estaba congelada pre-partido, PROHIBIR sobreescritura de probabilidades
      if (prev.probModelB !== null && prev.probModelB !== undefined) {
        observation.probModelB = prev.probModelB;
        observation.probModelC = prev.probModelC;
        observation.originalProb = prev.originalProb;
        observation.odds = prev.odds;
        observation.evModelB = prev.evModelB;
        observation.evModelC = prev.evModelC;
        observation.evEnsemble = prev.evEnsemble;
        observation.investigatedAt = prev.investigatedAt;
      }
      observation.verificationStatus = prev.verificationStatus || 'PENDIENTE';
      observation.finalResultConfirmed = prev.finalResultConfirmed || null;
      observation.actualStat = prev.actualStat ?? null;
      observation.profitUnits = prev.profitUnits ?? null;
      observation.settledAt = prev.settledAt || null;
      observation.verificationSource = prev.verificationSource || null;
      observation.verificationReason = prev.verificationReason || null;
      observation.currentState = prev.finalResultConfirmed ? 'SETTLED' : currentState;

      const history = Array.isArray(prev.stateHistory) ? [...prev.stateHistory] : [];
      const lastState = history[history.length - 1]?.toState;
      if (lastState !== observation.currentState) {
        history.push({
          fromState: lastState || null,
          toState: observation.currentState,
          timestamp: new Date().toISOString(),
          reason: options.transitionReason || `Transición a ${observation.currentState}`,
          source: options.source || 'AgentOrchestrator'
        });
      }
      observation.stateHistory = history;
      registry[existingIndex] = observation;
    } else {
      observation.stateHistory = [
        {
          fromState: null,
          toState: 'DISCOVERED',
          timestamp: candidate.createdAt || new Date().toISOString(),
          reason: 'Candidato detectado por Discovery Engine',
          source: 'DiscoveryEngine'
        }
      ];
      if (currentState !== 'DISCOVERED') {
        observation.stateHistory.push({
          fromState: 'DISCOVERED',
          toState: currentState,
          timestamp: observation.investigatedAt,
          reason: `Evaluación cuantitativa y comité: ${currentState}`,
          source: 'AgentOrchestrator'
        });
      }
      registry.push(observation);
    }

    this._writeRegistry(registry);

    // Sellar automáticamente en el libro criptográfico SHA-256
    try {
      integrityGuard.sealRecords([observation]);
    } catch (sealErr) {
      console.warn('[ObservationTracker] Advertencia sellando observación:', sealErr.message);
    }

    return observation;
  }

  /**
   * Registra el settlement oficial sin alterar las variables predictivas congeladas
   * y añade la transición SETTLED al historial de estados.
   */
  recordSettlement(pickId, settlementResult) {
    const registry = this._readRegistry();
    const obs = registry.find(o => o.pickId === pickId);
    if (!obs) {
      console.warn(`[ObservationTracker] Pick ${pickId} no encontrado en registro para settlement.`);
      return false;
    }

    const previousState = obs.currentState || obs.stage;

    obs.verificationStatus = settlementResult.verificationStatus || 'RESULTADO_CONFIRMADO';
    obs.finalResultConfirmed = settlementResult.status; // 'GANADA' | 'PERDIDA' | 'NULA'
    obs.actualStat = settlementResult.actualStat;
    obs.profitUnits = settlementResult.profitUnits;
    obs.verificationSource = settlementResult.verificationSource || 'StatsHub MCP Oficial FT';
    obs.verificationReason = settlementResult.verificationReason || 'Liquidación oficial confirmada';
    obs.settledAt = settlementResult.settledAt || new Date().toISOString();
    obs.currentState = 'SETTLED';

    if (!Array.isArray(obs.stateHistory)) obs.stateHistory = [];
    obs.stateHistory.push({
      fromState: previousState,
      toState: 'SETTLED',
      timestamp: obs.settledAt,
      reason: obs.verificationReason,
      source: obs.verificationSource
    });

    this._writeRegistry(registry);

    // Sellar el resultado oficial en el libro criptográfico
    try {
      integrityGuard.sealRecords([obs]);
    } catch (sealErr) {
      console.warn('[ObservationTracker] Advertencia sellando settlement:', sealErr.message);
    }

    return true;
  }

  /**
   * Transiciona formalmente un candidato a un nuevo estado del ciclo de vida,
   * validando estrictamente las reglas de transición y preservando el historial completo en stateHistory.
   * Rechaza transiciones inválidas para evitar saltos inconsistentes de estado.
   *
   * Estados oficiales (8):
   * DISCOVERED, RESEARCHED, RESEARCH_INCOMPLETE, ELIGIBLE, APPROVED_BY_ELENA, PENDING_LINEUP, REJECTED, SETTLED
   */
  transitionCandidateState(pickId, nextState, { reason, source } = {}) {
    const ALLOWED_TRANSITIONS = {
      'DISCOVERED': ['RESEARCHED', 'RESEARCH_INCOMPLETE', 'REJECTED'],
      'RESEARCHED': ['ELIGIBLE', 'REJECTED'],
      'RESEARCH_INCOMPLETE': ['RESEARCHED', 'REJECTED'],
      'ELIGIBLE': ['APPROVED_BY_ELENA', 'PENDING_LINEUP', 'REJECTED'],
      'PENDING_LINEUP': ['APPROVED_BY_ELENA', 'REJECTED'],
      'APPROVED_BY_ELENA': ['SETTLED', 'REJECTED'],
      'REJECTED': [], // Estado terminal
      'SETTLED': []   // Estado terminal inmutable
    };

    const registry = this._readRegistry();
    const obs = registry.find(o => o.pickId === pickId);
    if (!obs) {
      throw new Error(`[ObservationTracker] Candidato ${pickId} no encontrado en el registro.`);
    }

    const currentState = obs.currentState || 'DISCOVERED';

    if (!ALLOWED_TRANSITIONS[currentState]) {
      throw new Error(`[ObservationTracker] Estado de origen desconocido: '${currentState}'.`);
    }

    if (!ALLOWED_TRANSITIONS[currentState].includes(nextState)) {
      throw new Error(`[ObservationTracker] Transición inválida: no se permite transicionar de '${currentState}' a '${nextState}'.`);
    }

    const timestamp = new Date().toISOString();
    obs.currentState = nextState;

    if (!Array.isArray(obs.stateHistory)) {
      obs.stateHistory = [];
    }

    obs.stateHistory.push({
      fromState: currentState,
      toState: nextState,
      timestamp,
      reason: reason || `Transición formal a ${nextState}`,
      source: source || 'ObservationTracker'
    });

    this._writeRegistry(registry);
    return obs;
  }

  getRegistry() {
    return this._readRegistry();
  }

  /**
   * Inicializa o actualiza el registro histórico con todos los atributos de Fase 10.1
   */
  initializeFromHistory(candidates = [], predictions = [], results = []) {
    const registry = [];
    const predMap = new Map();
    predictions.forEach(p => predMap.set(p.candidateId, p));

    const resMap = new Map();
    results.forEach(r => resMap.set(r.pickId, r));

    for (const cand of candidates) {
      const pred = predMap.get(cand.id);
      const res = resMap.get(cand.id);

      const isTestPick = cand.id.startsWith('cand_test_') || cand.id.startsWith('pick_test_');

      const sampleSize = cand.sampleSize 
        || cand.researchData?.sampleSize 
        || cand.researchData?.validMatches 
        || (cand.rawSourceData?.hitRateL10 ? 10 : 0);

      const probModelB = pred?.models?.modelB?.pProjected 
        ?? (cand.rawSourceData?.hitRateL10 ? Number((cand.rawSourceData.hitRateL10 / 100).toFixed(4)) : (pred?.pProjected ?? null));

      const probModelC = pred?.models?.modelC?.pProjected 
        ?? (cand.rawSourceData?.hitRateL15 ? Number((cand.rawSourceData.hitRateL15 / 100).toFixed(4)) : null);

      const originalProb = pred?.pProjected ?? probModelB ?? null;
      const odds = Number(cand.bookmakerOdds || 1.80);

      const evEnsemble = pred?.ev ?? (originalProb !== null ? Number(((originalProb * odds) - 1).toFixed(4)) : null);
      const evPercentageEnsemble = pred?.evPercentage ?? (evEnsemble !== null ? Number((evEnsemble * 100).toFixed(1)) : null);

      const evModelB = probModelB !== null ? Number(((probModelB * odds) - 1).toFixed(4)) : null;
      const evPercentageModelB = evModelB !== null ? Number((evModelB * 100).toFixed(1)) : null;

      const evModelC = probModelC !== null ? Number(((probModelC * odds) - 1).toFixed(4)) : null;
      const evPercentageModelC = evModelC !== null ? Number((evModelC * 100).toFixed(1)) : null;

      const windowUsedC = (sampleSize >= 20 ? 'L20' : (cand.rawSourceData?.hitRateL15 ? 'L15' : null));

      // Determinar universos
      let stage = 'DISCOVERED';
      let rejectionStage = null;
      let rejectionCategory = null;

      const isInvestigated = sampleSize >= 8 || Boolean(cand.rawSourceData);
      if (isInvestigated) {
        stage = 'INVESTIGATED';
        if (evEnsemble !== null && evEnsemble >= 0.07) {
          stage = 'ELIGIBLE';
          if (cand.status === 'APROBADO' || cand.riskVerdict?.finalStatus === 'APROBADO') {
            stage = 'APPROVED';
          } else if (cand.status === 'RECHAZADO' || cand.riskVerdict?.finalStatus === 'RECHAZADO') {
            stage = 'REJECTED';
            rejectionStage = 'ELENA_VETO';
            rejectionCategory = 'ELENA_DECISION';
          }
        } else {
          stage = 'REJECTED';
          rejectionStage = 'PREDICTION_EV';
          rejectionCategory = 'LOW_EV';
        }
      }

      // Normalizar nombre del partido a partir de res si existe
      const fullMatch = res?.match || cand.match || 'Evento';
      const eventId = this._getCanonicalEventId(fullMatch);

      const obs = {
        pickId: cand.id,
        eventId,
        stage,
        rejectionStage,
        rejectionCategory,
        engineVersion: 'v2.0-shadow-mode',
        shadowMode: true,
        isOperativeRecommendation: false,
        isTestPick,
        event: fullMatch,
        date: cand.date || res?.date || '2026-11-19',
        competition: cand.competition || 'Brasileirão Série A',
        playerOrTeam: cand.playerOrTeam || cand.player,
        market: cand.market,
        line: cand.line,
        odds,
        originalProb,
        probModelB,
        probModelC,
        modelVersionB: 'Model-B-L10',
        modelVersionC: 'Model-C-L15-L20',
        windowUsedB: 'L10',
        windowUsedC,
        evEnsemble,
        evPercentageEnsemble,
        evModelB,
        evPercentageModelB,
        evModelC,
        evPercentageModelC,
        statisticalDataUsed: {
          sampleSize,
          actualMatchesAnalyzed: sampleSize,
          rawSourceData: Boolean(cand.rawSourceData),
          lineupStatus: cand.researchData?.lineupData?.status || 'PROBABLE'
        },
        actualMatchesAnalyzed: sampleSize,
        dataQualityStatus: pred ? 'COMPLETA' : (sampleSize > 0 ? 'COMPLETA' : 'INVESTIGACION_INCOMPLETA'),
        investigatedAt: pred?.timestamp || cand.createdAt || '2026-11-19T17:52:58.000Z',
        agentDecisions: {
          playerAnalyst: cand.agentReports?.playerAnalyst?.recommendation || null,
          teamAnalyst: cand.agentReports?.teamAnalyst?.recommendation || null,
          matchContext: cand.agentReports?.matchContext?.recommendation || null,
          oddsAnalyst: cand.agentReports?.oddsAnalyst?.recommendation || null,
          matchIntel: cand.agentReports?.matchIntel?.recommendation || null
        },
        elenaDecision: cand.riskVerdict?.finalStatus || (cand.status === 'RECHAZADO' ? 'RECHAZADO' : (cand.status === 'APROBADO' ? 'APROBADO' : 'PENDIENTE')),
        elenaVetoApplied: cand.riskVerdict?.vetoApplied || cand.status === 'RECHAZADO',
        elenaVetoReasons: cand.riskVerdict?.vetoReasons || (cand.status === 'RECHAZADO' ? ['VETO_PREVIO'] : []),
        elenaVetoRule: cand.riskVerdict?.finalReason || null,
        verificationStatus: res ? (res.verificationStatus || 'RESULTADO_CONFIRMADO') : 'PENDIENTE',
        finalResultConfirmed: res ? res.status : null,
        actualStat: res ? res.actualStat : null,
        profitUnits: res ? res.profitUnits : null,
        settledAt: res ? (res.settledAt || '2026-11-20T00:36:03.000Z') : null,
        verificationSource: res?.verificationSource || 'StatsHub MCP Oficial FT',
        verificationReason: res?.verificationReason || 'Auditoría Fase 9'
      };

      registry.push(obs);
    }

    this._writeRegistry(registry);
    return registry;
  }

  /**
   * Auditoría de Correlación entre Selecciones y Agrupación por Partido
   */
  auditEventCorrelation(filterFn = null) {
    let registry = this._readRegistry().filter(o => !o.isTestPick && o.verificationStatus === 'RESULTADO_CONFIRMADO' && (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA'));
    if (typeof filterFn === 'function') {
      registry = registry.filter(filterFn);
    }

    const eventMap = new Map();

    for (const obs of registry) {
      const eId = obs.eventId || this._getCanonicalEventId(obs.event);
      if (!eventMap.has(eId)) {
        eventMap.set(eId, {
          eventId: eId,
          eventName: obs.event,
          competition: obs.competition,
          date: obs.date,
          picks: [],
          uniqueMarkets: new Set(),
          wins: 0,
          losses: 0,
          profitUnits: 0
        });
      }
      const evObj = eventMap.get(eId);
      evObj.picks.push(obs);
      evObj.uniqueMarkets.add(obs.market);
      if (obs.finalResultConfirmed === 'GANADA') {
        evObj.wins++;
      } else {
        evObj.losses++;
      }
      evObj.profitUnits += (obs.profitUnits !== null ? obs.profitUnits : (obs.finalResultConfirmed === 'GANADA' ? obs.odds - 1 : -1));
    }

    const eventGroups = Array.from(eventMap.values()).map(e => ({
      eventId: e.eventId,
      eventName: e.eventName,
      competition: e.competition,
      date: e.date,
      pickCount: e.picks.length,
      marketCount: e.uniqueMarkets.size,
      markets: Array.from(e.uniqueMarkets),
      picks: e.picks,
      wins: e.wins,
      losses: e.losses,
      profitUnits: Number(e.profitUnits.toFixed(2)),
      isMultiPick: e.picks.length >= 2,
      correlatedLosses: e.losses >= 2
    }));

    const totalPicks = registry.length;
    const uniqueEvents = eventGroups.length;
    const multiPickEvents = eventGroups.filter(e => e.isMultiPick);
    const sharedAdverseEvents = eventGroups.filter(e => e.correlatedLosses);

    // Selecciones altamente correlacionadas en el mismo evento (e.g. líneas simultáneas del mismo mercado)
    const highlyCorrelatedPairs = [];
    eventGroups.forEach(e => {
      const marketCounts = {};
      e.picks.forEach(p => {
        marketCounts[p.market] = (marketCounts[p.market] || 0) + 1;
      });
      Object.entries(marketCounts).forEach(([m, count]) => {
        if (count >= 2) {
          highlyCorrelatedPairs.push({
            eventId: e.eventId,
            eventName: e.eventName,
            market: m,
            correlatedPicksCount: count
          });
        }
      });
    });

    return {
      totalPicks,
      uniqueEvents,
      ratioPicksPerEvent: Number((totalPicks / (uniqueEvents || 1)).toFixed(2)),
      multiPickEventsCount: multiPickEvents.length,
      sharedAdverseEventsCount: sharedAdverseEvents.length,
      highlyCorrelatedClusters: highlyCorrelatedPairs,
      eventDetails: eventGroups
    };
  }

  /**
   * Evaluación Contrafactual de los Universos de Selección
   */
  evaluateCounterfactuals() {
    const registry = this._readRegistry().filter(o => !o.isTestPick && o.verificationStatus === 'RESULTADO_CONFIRMADO' && (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA'));

    const universes = {
      // 1. Todas las oportunidades descubiertas que pudieron investigarse
      investigatedDiscovered: registry.filter(o => typeof o.probModelB === 'number' || typeof o.probModelC === 'number'),
      // 2. Candidatos que superaron el filtro EV (+7.0%) en ensamble
      passedEV: registry.filter(o => o.evEnsemble !== null && o.evEnsemble >= 0.07),
      // 3. Candidatos aprobados explícitamente por Elena
      approvedByElena: registry.filter(o => o.elenaDecision === 'APROBADO'),
      // 4. Candidatos rechazados por Elena
      rejectedByElena: registry.filter(o => o.elenaDecision === 'RECHAZADO'),
      // 5. Candidatos descartados específicamente por bajo EV en Model C (< +7.0%)
      discardedByLowEV_ModelC: registry.filter(o => o.evModelC !== null && o.evModelC < 0.07),
      // 6. Candidatos elegibles bajo Model B pero inelegibles bajo Model C
      divergentEligibility_B_vs_C: registry.filter(o => o.evModelB !== null && o.evModelB >= 0.07 && (o.evModelC === null || o.evModelC < 0.07))
    };

    const calculateSubsetMetrics = (items, subsetName) => {
      const N = items.length;
      const eventIds = new Set(items.map(o => o.eventId || this._getCanonicalEventId(o.event)));
      const N_events = eventIds.size;

      if (N === 0) {
        return {
          subsetName,
          N: 0,
          N_events: 0,
          message: 'Sin observaciones confirmadas en este universo.'
        };
      }

      let hits = 0;
      let stakedUnits = 0;
      let profitUnits = 0;
      let sumBrierB = 0, sumBrierC = 0, sumBrierEns = 0;
      let sumLogLossB = 0, sumLogLossC = 0, sumLogLossEns = 0;
      let sumEvEns = 0;

      for (const obs of items) {
        const y = obs.finalResultConfirmed === 'GANADA' ? 1 : 0;
        const odds = obs.odds;
        const profit = obs.profitUnits !== null ? obs.profitUnits : (y === 1 ? odds - 1 : -1);

        if (y === 1) hits++;
        stakedUnits += 1.0;
        profitUnits += profit;

        // Brier y LogLoss para B
        if (typeof obs.probModelB === 'number') {
          const pB = Math.max(EPSILON, Math.min(1 - EPSILON, obs.probModelB));
          sumBrierB += Math.pow(pB - y, 2);
          sumLogLossB += -(y * Math.log(pB) + (1 - y) * Math.log(1 - pB));
        }

        // Brier y LogLoss para C
        if (typeof obs.probModelC === 'number') {
          const pC = Math.max(EPSILON, Math.min(1 - EPSILON, obs.probModelC));
          sumBrierC += Math.pow(pC - y, 2);
          sumLogLossC += -(y * Math.log(pC) + (1 - y) * Math.log(1 - pC));
        }

        // Brier y LogLoss para Ensamble
        const pEns = Math.max(EPSILON, Math.min(1 - EPSILON, obs.originalProb ?? obs.probModelB));
        sumBrierEns += Math.pow(pEns - y, 2);
        sumLogLossEns += -(y * Math.log(pEns) + (1 - y) * Math.log(1 - pEns));

        if (obs.evEnsemble !== null) {
          sumEvEns += obs.evEnsemble;
        }
      }

      return {
        subsetName,
        N,
        N_events,
        ratioPicksPerEvent: Number((N / (N_events || 1)).toFixed(2)),
        hits,
        losses: N - hits,
        winRatePct: Number(((hits / N) * 100).toFixed(1)),
        stakedUnits,
        profitUnits: Number(profitUnits.toFixed(2)),
        yieldPct: Number(((profitUnits / stakedUnits) * 100).toFixed(1)),
        brierScore_ModelB: Number((sumBrierB / N).toFixed(4)),
        brierScore_ModelC: Number((sumBrierC / N).toFixed(4)),
        brierScore_Ensemble: Number((sumBrierEns / N).toFixed(4)),
        logLoss_ModelB: Number((sumLogLossB / N).toFixed(4)),
        logLoss_ModelC: Number((sumLogLossC / N).toFixed(4)),
        logLoss_Ensemble: Number((sumLogLossEns / N).toFixed(4)),
        meanProjectedEV_Pct: Number(((sumEvEns / N) * 100).toFixed(1))
      };
    };

    const results = {};
    Object.entries(universes).forEach(([k, subset]) => {
      results[k] = calculateSubsetMetrics(subset, k);
    });

    return results;
  }

  /**
   * Genera el informe periódico de seguimiento (Checkpoints cada 25 observaciones)
   */
  generateCheckpointReport() {
    const rawRegistry = this._readRegistry().filter(o => !o.isTestPick);
    const correlation = this.auditEventCorrelation();
    const counterfactuals = this.evaluateCounterfactuals();
    const comp = this.compareModels();

    const counts = {
      discovered: rawRegistry.length,
      investigated: rawRegistry.filter(o => o.stage === 'INVESTIGATED' || o.stage === 'ELIGIBLE' || o.stage === 'APPROVED' || o.stage === 'REJECTED').length,
      eligible: rawRegistry.filter(o => o.stage === 'ELIGIBLE' || o.stage === 'APPROVED').length,
      approved: rawRegistry.filter(o => o.elenaDecision === 'APROBADO').length,
      rejected: rawRegistry.filter(o => o.elenaDecision === 'RECHAZADO' || o.stage === 'REJECTED').length,
      pendingSettlement: rawRegistry.filter(o => o.verificationStatus === 'PENDIENTE').length,
      confirmedSettled: correlation.totalPicks
    };

    // Desglose por mercado
    const marketBreakdown = {};
    rawRegistry.filter(o => o.verificationStatus === 'RESULTADO_CONFIRMADO' && (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA')).forEach(o => {
      const m = o.market || 'Otros';
      if (!marketBreakdown[m]) {
        marketBreakdown[m] = { market: m, N: 0, wins: 0, losses: 0, profit: 0 };
      }
      marketBreakdown[m].N++;
      if (o.finalResultConfirmed === 'GANADA') marketBreakdown[m].wins++;
      else marketBreakdown[m].losses++;
      marketBreakdown[m].profit += (o.profitUnits !== null ? o.profitUnits : (o.finalResultConfirmed === 'GANADA' ? o.odds - 1 : -1));
    });

    // Desglose por competición
    const compBreakdown = {};
    rawRegistry.filter(o => o.verificationStatus === 'RESULTADO_CONFIRMADO' && (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA')).forEach(o => {
      const c = o.competition || 'Otras';
      if (!compBreakdown[c]) {
        compBreakdown[c] = { competition: c, N: 0, wins: 0, losses: 0, profit: 0 };
      }
      compBreakdown[c].N++;
      if (o.finalResultConfirmed === 'GANADA') compBreakdown[c].wins++;
      else compBreakdown[c].losses++;
      compBreakdown[c].profit += (o.profitUnits !== null ? o.profitUnits : (o.finalResultConfirmed === 'GANADA' ? o.odds - 1 : -1));
    });

    const elenaAudit = {
      rejectionsCount: counts.rejected,
      rejectionCauses: {
        SAMPLE_INSUFFICIENT: rawRegistry.filter(o => o.rejectionCategory === 'SAMPLE_INSUFFICIENT' || (o.rejectionReason && o.rejectionReason.includes('muestra'))).length,
        LOW_EV: rawRegistry.filter(o => o.rejectionCategory === 'LOW_EV' || (o.rejectionReason && o.rejectionReason.includes('EV'))).length,
        DIVERGENCE_HIGH: rawRegistry.filter(o => o.rejectionCategory === 'DIVERGENCE_HIGH' || (o.rejectionReason && o.rejectionReason.includes('divergencia'))).length,
        SUBSTITUTE_CONFIRMED: rawRegistry.filter(o => o.rejectionCategory === 'SUBSTITUTE_CONFIRMED' || (o.rejectionReason && o.rejectionReason.includes('suplente'))).length,
        OTHER: rawRegistry.filter(o => o.stage === 'REJECTED' && !o.rejectionCategory).length
      }
    };

    const checkpointData = {
      confirmedCount: counts.confirmedSettled,
      targetObservations: config.shadowMode?.targetConfirmedObservations || 100,
      progressPct: Number(((counts.confirmedSettled / (config.shadowMode?.targetConfirmedObservations || 100)) * 100).toFixed(1))
    };

    return {
      generatedAt: new Date().toISOString(),
      checkpoint: checkpointData,
      checkpointSummary: checkpointData,
      elenaAudit,
      universesCount: counts,
      modelComparison: comp,
      counterfactualEvaluation: counterfactuals,
      eventCorrelationAudit: correlation,
      marketBreakdown: Object.values(marketBreakdown).map(m => ({
        ...m,
        winRatePct: Number(((m.wins / m.N) * 100).toFixed(1)),
        yieldPct: Number(((m.profit / m.N) * 100).toFixed(1)),
        profit: Number(m.profit.toFixed(2))
      })),
      competitionBreakdown: Object.values(compBreakdown).map(c => ({
        ...c,
        winRatePct: Number(((c.wins / c.N) * 100).toFixed(1)),
        yieldPct: Number(((c.profit / c.N) * 100).toFixed(1)),
        profit: Number(c.profit.toFixed(2))
      }))
    };
  }

  generateShadowReport() {
    return this.generateCheckpointReport();
  }

  /**
   * Comparación justa sobre subconjuntos comunes
   */
  compareModels(options = {}) {
    let registry = this._readRegistry().filter(o => !o.isTestPick);
    if (typeof options.filterFn === 'function') {
      registry = registry.filter(options.filterFn);
    }

    const settledObs = registry.filter(o => 
      o.verificationStatus === 'RESULTADO_CONFIRMADO' && 
      (o.finalResultConfirmed === 'GANADA' || o.finalResultConfirmed === 'PERDIDA')
    );

    const commonSubset = settledObs.filter(o => typeof o.probModelB === 'number' && typeof o.probModelC === 'number');
    const allModelB = settledObs.filter(o => typeof o.probModelB === 'number');
    const allModelC = settledObs.filter(o => typeof o.probModelC === 'number');

    const calculateMetricsForSet = (items, probGetter, modelName) => {
      const N = items.length;
      if (N === 0) return { modelName, N: 0, message: 'Sin observaciones para evaluar.' };

      let brierSum = 0;
      let logLossSum = 0;
      let hits = 0;
      let stakedUnits = 0;
      let profitUnits = 0;
      let sumProb = 0;
      let sumOdds = 0;

      const bins = [
        { name: '[0.00, 0.50)', min: 0.00, max: 0.50, count: 0, hits: 0, probSum: 0 },
        { name: '[0.50, 0.60)', min: 0.50, max: 0.60, count: 0, hits: 0, probSum: 0 },
        { name: '[0.60, 0.70)', min: 0.60, max: 0.70, count: 0, hits: 0, probSum: 0 },
        { name: '[0.70, 0.80)', min: 0.70, max: 0.80, count: 0, hits: 0, probSum: 0 },
        { name: '[0.80, 0.90)', min: 0.80, max: 0.90, count: 0, hits: 0, probSum: 0 },
        { name: '[0.90, 1.00]', min: 0.90, max: 1.01, count: 0, hits: 0, probSum: 0 }
      ];

      for (const obs of items) {
        const rawProb = probGetter(obs);
        const p = Math.max(EPSILON, Math.min(1 - EPSILON, rawProb));
        const y = obs.finalResultConfirmed === 'GANADA' ? 1 : 0;

        brierSum += Math.pow(p - y, 2);
        logLossSum += (y * Math.log(p) + (1 - y) * Math.log(1 - p));

        if (y === 1) hits++;
        stakedUnits += 1.0;
        profitUnits += (obs.profitUnits !== null ? obs.profitUnits : (y === 1 ? obs.odds - 1 : -1));
        sumProb += p;
        sumOdds += obs.odds;

        const binName = this.getBinForProbability(rawProb);
        const bin = bins.find(b => b.name === binName);
        if (bin) {
          bin.count++;
          bin.probSum += rawProb;
          if (y === 1) bin.hits++;
        }
      }

      const brierScore = Number((brierSum / N).toFixed(4));
      const logLoss = Number((-logLossSum / N).toFixed(4));
      const hitRatePct = Number(((hits / N) * 100).toFixed(1));
      const yieldPct = Number(((profitUnits / stakedUnits) * 100).toFixed(1));
      const meanProbPct = Number(((sumProb / N) * 100).toFixed(1));
      const meanOdds = Number((sumOdds / N).toFixed(2));

      const calibrationBins = bins.map(b => ({
        bin: b.name,
        sampleSize: b.count,
        meanPredictedProbPct: b.count > 0 ? Number(((b.probSum / b.count) * 100).toFixed(1)) : 0,
        actualHitRatePct: b.count > 0 ? Number(((b.hits / b.count) * 100).toFixed(1)) : 0,
        calibrationGapPct: b.count > 0 ? Number((((b.probSum / b.count) - (b.hits / b.count)) * 100).toFixed(1)) : 0
      }));

      return {
        modelName,
        N,
        hits,
        losses: N - hits,
        hitRatePct,
        brierScore,
        logLoss,
        meanProbPct,
        meanOdds,
        stakedUnits,
        profitUnits: Number(profitUnits.toFixed(2)),
        yieldPct,
        calibrationBins
      };
    };

    return {
      totalSettledAudited: settledObs.length,
      commonSubsetComparison: {
        N_common: commonSubset.length,
        modelB: calculateMetricsForSet(commonSubset, o => o.probModelB, 'Model-B-L10 (Subconjunto Común)'),
        modelC: calculateMetricsForSet(commonSubset, o => o.probModelC, 'Model-C-L15-L20 (Subconjunto Común)')
      },
      individualCompleteModels: {
        modelB_Full: calculateMetricsForSet(allModelB, o => o.probModelB, 'Model-B-L10 (Completo)'),
        modelC_Full: calculateMetricsForSet(allModelC, o => o.probModelC, 'Model-C-L15-L20 (Completo)')
      }
    };
  }
}

module.exports = new ObservationTracker();
