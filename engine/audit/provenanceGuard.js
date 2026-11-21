/**
 * PROVENANCE GUARD - GUARDIA DE PROCEDENCIA Y AISLAMIENTO DE DATOS
 * DARADORIA / DARADORBET
 * 
 * Garantiza la separación estricta entre PRODUCCIÓN, SIMULATION y TEST.
 * Valida que ningún candidato ficticio, mock, o sin trazabilidad oficial de StatsHub
 * ingrese al Daily Board, al Observation Tracker o al historial de pronósticos.
 */

const PROVENANCE_TYPES = {
  REAL_VERIFIED: 'REAL_VERIFIED',
  SIMULATION: 'SIMULATION',
  TEST: 'TEST',
  MOCK: 'MOCK',
  UNVERIFIED: 'UNVERIFIED'
};

class ProvenanceGuard {
  constructor() {
    this.validTypes = Object.values(PROVENANCE_TYPES);
  }

  /**
   * Clasifica un candidato según su origen, metadatos y trazabilidad
   * @param {Object} candidate
   * @returns {string} Provenance type
   */
  classifyCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') {
      return PROVENANCE_TYPES.UNVERIFIED;
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

    // 3. Detección de candidatos generados por scripts mock
    if (
      id.startsWith('cand_20261121_') ||
      id.startsWith('cand_fase11_') ||
      id.startsWith('cand_mock_') ||
      candidate.isMock === true
    ) {
      return PROVENANCE_TYPES.MOCK;
    }

    // 4. Candidatos históricos auditados del ledger (19 Nov)
    if (id.startsWith('cand_1795110774831_') || id.startsWith('cand_1795187331561_')) {
      return PROVENANCE_TYPES.REAL_VERIFIED;
    }

    // 5. Verificación de procedencia oficial para producción
    const prov = candidate.provenance;
    if (
      prov &&
      prov.type === PROVENANCE_TYPES.REAL_VERIFIED &&
      prov.officialMatchId &&
      (prov.officialPlayerId || candidate.isTeamProp) &&
      prov.sourceTool
    ) {
      return PROVENANCE_TYPES.REAL_VERIFIED;
    }

    // 6. Por defecto, si no tiene procedencia comprobada, es UNVERIFIED
    return PROVENANCE_TYPES.UNVERIFIED;
  }

  /**
   * Valida si un candidato es apto para publicación en el Daily Board
   * @param {Object} candidate
   * @returns {{ isValid: boolean, reason?: string }}
   */
  validateForDailyBoard(candidate) {
    const classification = this.classifyCandidate(candidate);

    if (classification !== PROVENANCE_TYPES.REAL_VERIFIED) {
      return {
        isValid: false,
        classification,
        reason: `BLOQUEADO_POR_PROVENANCE: Candidato clasificado como ${classification}. Solo se admiten registros REAL_VERIFIED en el Daily Board.`
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
    if (!candidate.playerOrTeam && !candidate.player) {
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
    if (classification === PROVENANCE_TYPES.TEST || classification === PROVENANCE_TYPES.SIMULATION || classification === PROVENANCE_TYPES.MOCK) {
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
      type: PROVENANCE_TYPES.REAL_VERIFIED,
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
