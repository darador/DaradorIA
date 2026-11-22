/**
 * PROVENANCE GUARD - GUARDIA DE PROCEDENCIA Y AISLAMIENTO DE DATOS
 * DARADORIA / DARADORBET — FASE 11.3.4
 * 
 * Garantiza la separación estricta entre PRODUCCIÓN, HISTORIA, SIMULATION y TEST.
 * Valida que ningún candidato ficticio, mock o con jugador/club inválido
 * ingrese al Daily Board operativo, al Observation Tracker o a métricas actuales.
 * 
 * Clasificación basada en evidencia empírica:
 * - VERIFIED_PROVENANCE (alias REAL_VERIFIED): Partido y entidad comprobados con trazabilidad.
 * - UNKNOWN_PROVENANCE (alias UNVERIFIED): Fixture o sujeto no verificado concluyentemente.
 * - REAL_INVALID_PLAYER_TEAM: Fixture real pero jugador en club incorrecto.
 * - SYNTHETIC_UI_TEMPLATE (alias MOCK): Plantilla visual generada sin investigación real.
 * - TEST: Entorno de pruebas y pruebas de regresión.
 * - SIMULATION: Simulación cuantitativa / Monte Carlo.
 */

const PROVENANCE_TYPES = {
  VERIFIED_PROVENANCE: 'VERIFIED_PROVENANCE',
  REAL_VERIFIED: 'VERIFIED_PROVENANCE', // Alias de compatibilidad hacia atrás
  UNKNOWN_PROVENANCE: 'UNKNOWN_PROVENANCE',
  UNVERIFIED: 'UNKNOWN_PROVENANCE',     // Alias de compatibilidad hacia atrás
  REAL_INVALID_PLAYER_TEAM: 'REAL_INVALID_PLAYER_TEAM',
  SYNTHETIC_UI_TEMPLATE: 'SYNTHETIC_UI_TEMPLATE',
  MOCK: 'SYNTHETIC_UI_TEMPLATE',        // Alias de compatibilidad hacia atrás
  TEST: 'TEST',
  SIMULATION: 'SIMULATION'
};

// Registro de entidades con demostración positiva de inconsistencia club-jugador
const KNOWN_INVALID_PLAYER_TEAM_IDS = new Set([
  'cand_20261121_banzuzi_tackles', // E. Banzuzi pertenece a OH Leuven, no a Leipzig
  'cand_20261121_archer_sot',      // C. Archer pertenece a Southampton, no a Auxerre
  'cand_20261121_hojlund_sot'      // R. Hojlund pertenece a Manchester United, no a Napoli
]);

// Registro de candidatos recuperados con fixture y estadísticas empíricamente verificadas
const KNOWN_VERIFIED_RECOVERED_IDS = new Set([
  'cand_20261121_fulham_sot',
  'cand_20261121_leeds_corners',
  'cand_20261121_ruibal_fouls',
  'cand_20261121_abde_sot',
  'cand_20261121_neto_sot',
  'cand_20261121_nuamah_shots',
  'cand_20261121_castaneda_shots',
  'cand_20261121_romano_shots'
]);

class ProvenanceGuard {
  constructor() {
    this.validTypes = Object.values(PROVENANCE_TYPES);
  }

  /**
   * Clasifica un candidato según su origen, metadatos y trazabilidad
   * Idempotente: múltiples ejecuciones devuelven idéntica clasificación.
   * @param {Object} candidate
   * @returns {string} Provenance type
   */
  classifyCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      return PROVENANCE_TYPES.UNKNOWN_PROVENANCE;
    }

    const id = String(candidate.id || '');
    
    // 1. Detección de identificadores de Test
    if (
      id.includes('test') ||
      candidate.isTestPick === true ||
      candidate.sourceTool === 'test_harness' ||
      candidate.environment === 'TEST'
    ) {
      return PROVENANCE_TYPES.TEST;
    }

    // 2. Detección de datos de simulación explícita
    if (
      candidate.isSimulation === true ||
      candidate.simulationId ||
      candidate.environment === 'SIMULATION'
    ) {
      return PROVENANCE_TYPES.SIMULATION;
    }

    // 3. Demostración de club/jugador incorrecto
    if (
      KNOWN_INVALID_PLAYER_TEAM_IDS.has(id) ||
      candidate.invalidPlayerTeam === true ||
      candidate.classification === PROVENANCE_TYPES.REAL_INVALID_PLAYER_TEAM
    ) {
      return PROVENANCE_TYPES.REAL_INVALID_PLAYER_TEAM;
    }

    // 4. Plantillas sintéticas demostradas (sin investigación de agentes ni deliberación)
    if (
      id.startsWith('cand_fase11_') ||
      id.startsWith('cand_mock_') ||
      candidate.isMock === true ||
      candidate.is_synthetic_template === true ||
      candidate.classification === PROVENANCE_TYPES.SYNTHETIC_UI_TEMPLATE
    ) {
      return PROVENANCE_TYPES.SYNTHETIC_UI_TEMPLATE;
    }

    // 5. Candidatos históricos auditados del ledger original (19 y 20 Nov)
    if (id.startsWith('cand_1795110774831_') || id.startsWith('cand_1795187331561_')) {
      return PROVENANCE_TYPES.VERIFIED_PROVENANCE;
    }

    // 6. Candidatos reales recuperados e investigados de la jornada 21 Nov
    if (KNOWN_VERIFIED_RECOVERED_IDS.has(id) || candidate.is_historical_recovery === true) {
      return PROVENANCE_TYPES.VERIFIED_PROVENANCE;
    }

    // 7. Candidatos con ID oficial StatsHub comprobado
    const prov = candidate.provenance;
    if (
      prov &&
      (prov.type === PROVENANCE_TYPES.VERIFIED_PROVENANCE || prov.type === 'REAL_VERIFIED') &&
      prov.officialMatchId &&
      (prov.officialPlayerId || candidate.isTeamProp || prov.isTeamProp) &&
      prov.sourceTool
    ) {
      return PROVENANCE_TYPES.VERIFIED_PROVENANCE;
    }

    // 8. Trazabilidad alternativa: fixture comprobable + sujeto comprobable
    if (
      candidate.match &&
      typeof candidate.match === 'string' &&
      candidate.match.trim() !== '' &&
      !candidate.match.includes('undefined') &&
      (candidate.playerOrTeam || candidate.player || candidate.team) &&
      (candidate.alternativeSource || (candidate.agent_reports && candidate.risk_verdict))
    ) {
      return PROVENANCE_TYPES.VERIFIED_PROVENANCE;
    }

    // 9. Ausencia de evidencia concluyente -> UNKNOWN_PROVENANCE (nunca asumir mock)
    return PROVENANCE_TYPES.UNKNOWN_PROVENANCE;
  }

  /**
   * Valida si un candidato es apto para publicación en el Daily Board
   * @param {Object} candidate
   * @returns {{ isValid: boolean, reason?: string, classification: string }}
   */
  validateForDailyBoard(candidate) {
    const classification = this.classifyCandidate(candidate);

    if (classification !== PROVENANCE_TYPES.VERIFIED_PROVENANCE) {
      return {
        isValid: false,
        classification,
        reason: `BLOQUEADO_POR_PROVENANCE: Candidato clasificado como ${classification}. Solo se admiten registros VERIFIED_PROVENANCE en el Daily Board.`
      };
    }

    // Excluir registros de recuperación histórica del Daily Board activo
    if (candidate.is_historical_recovery === true || candidate.is_operative_recommendation === false) {
      return {
        isValid: false,
        classification,
        reason: 'BLOQUEADO_POR_ESTADO_HISTORICO: Los registros de recuperación histórica no ingresan al Daily Board operativo.'
      };
    }

    // Validación de consistencia mínima de fixture
    if (!candidate.match || candidate.match.trim() === '' || candidate.match.includes('undefined')) {
      return {
        isValid: false,
        classification,
        reason: 'BLOQUEADO_POR_FIXTURE_INVALIDO: Nombre de partido inválido o ausente.'
      };
    }

    // Validación de jugador/equipo
    if (!candidate.playerOrTeam && !candidate.player && !candidate.team) {
      return {
        isValid: false,
        classification,
        reason: 'BLOQUEADO_POR_ENTIDAD_INVALIDA: Jugador o equipo ausente.'
      };
    }

    return {
      isValid: true,
      classification
    };
  }

  /**
   * Valida si un candidato puede ingresar al Observation Tracker de la muestra real
   * @param {Object} candidate
   * @returns {{ allowed: boolean, reason?: string }}
   */
  validateForObservationTracker(candidate) {
    const classification = this.classifyCandidate(candidate);
    if (
      classification === PROVENANCE_TYPES.TEST ||
      classification === PROVENANCE_TYPES.SIMULATION ||
      classification === PROVENANCE_TYPES.SYNTHETIC_UI_TEMPLATE ||
      classification === PROVENANCE_TYPES.REAL_INVALID_PLAYER_TEAM ||
      classification === PROVENANCE_TYPES.UNKNOWN_PROVENANCE
    ) {
      return {
        allowed: false,
        reason: `AISLAMIENTO_ESTRICTO: Registros de tipo ${classification} tienen prohibido el ingreso al Observation Tracker real.`
      };
    }
    return { allowed: true };
  }

  /**
   * Añade el sello de procedencia a un candidato verificado
   */
  stampProvenance(candidate, { officialMatchId, officialPlayerId, sourceTool, verifiedBy = 'StatsHub MCP' }) {
    candidate.provenance = {
      type: PROVENANCE_TYPES.VERIFIED_PROVENANCE,
      officialMatchId,
      officialPlayerId: officialPlayerId || null,
      sourceTool,
      verifiedBy,
      verifiedAt: new Date().toISOString()
    };
    return candidate;
  }
}

module.exports = {
  ProvenanceGuard,
  PROVENANCE_TYPES,
  provenanceGuard: new ProvenanceGuard()
};
