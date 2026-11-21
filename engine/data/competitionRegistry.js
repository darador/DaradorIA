/**
 * COMPETITION REGISTRY - REGISTRO DINÁMICO DE COMPETICIONES
 * Fase 11: Permite descubrir y gestionar competiciones dinámicamente sin modificar código.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const CONFIG_PATH = path.resolve(__dirname, '..', 'storage_data', 'competitions_config.json');

class CompetitionRegistry {
  constructor() {
    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        this.data = JSON.parse(raw);
      } else {
        this.data = { version: '1.0.0', competitions: [] };
      }
    } catch (e) {
      console.warn('[CompetitionRegistry] Error leyendo competitions_config.json:', e.message);
      this.data = { version: '1.0.0', competitions: [] };
    }
  }

  _saveConfig() {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[CompetitionRegistry] Error guardando competitions_config.json:', e.message);
    }
  }

  /**
   * Obtiene la lista de competiciones activas (ENABLED o TRIAL)
   */
  getActiveCompetitions() {
    this._loadConfig();
    const active = this.data.competitions.filter(c => c.status === 'ENABLED' || c.status === 'TRIAL');
    if (active.length === 0 && Array.isArray(config.targetCompetitions)) {
      return config.targetCompetitions.map(name => ({ name, status: 'ENABLED' }));
    }
    return active;
  }

  /**
   * Obtiene todas las competiciones registradas
   */
  getAllCompetitions() {
    this._loadConfig();
    return this.data.competitions;
  }

  /**
   * Busca una competición por nombre, competitionId o stageId
   */
  findCompetition(query) {
    if (!query) return null;
    this._loadConfig();
    const q = String(query).toLowerCase().trim();
    return this.data.competitions.find(c => 
      c.name.toLowerCase() === q ||
      c.id.toLowerCase() === q ||
      (c.competitionId && c.competitionId.toLowerCase() === q) ||
      (c.stageId && c.stageId.toLowerCase() === q) ||
      c.name.toLowerCase().includes(q)
    ) || null;
  }

  /**
   * Verifica si una competición está habilitada o en fase de prueba (TRIAL)
   */
  isCompetitionActive(query) {
    const comp = this.findCompetition(query);
    if (!comp) {
      // Fallback a config.targetCompetitions para preservar retrocompatibilidad
      return (config.targetCompetitions || []).some(t => 
        String(t).toLowerCase() === String(query).toLowerCase() ||
        String(query).toLowerCase().includes(String(t).toLowerCase())
      );
    }
    return comp.status === 'ENABLED' || comp.status === 'TRIAL';
  }

  /**
   * Actualiza el estado de una competición (ENABLED, TRIAL, DISABLED, CATALOG_DISCOVERED)
   */
  setCompetitionStatus(idOrName, status) {
    this._loadConfig();
    const comp = this.findCompetition(idOrName);
    if (!comp) {
      throw new Error(`Competición '${idOrName}' no encontrada en el registro.`);
    }
    const validStatuses = ['ENABLED', 'TRIAL', 'DISABLED', 'CATALOG_DISCOVERED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Estado '${status}' inválido. Válidos: ${validStatuses.join(', ')}`);
    }
    comp.status = status;
    comp.updatedAt = new Date().toISOString();
    this._saveConfig();
    return comp;
  }
}

module.exports = new CompetitionRegistry();
