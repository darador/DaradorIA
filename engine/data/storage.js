/**
 * DATA STORAGE - MOTOR DE PERSISTENCIA Y TRAZABILIDAD
 * Gestiona el almacenamiento de investigaciones, predicciones,
 * candidatos y resultados según el esquema relacional requerido.
 * Soporta almacenamiento local estructurado y sincronización con Supabase.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

class StorageEngine {
  constructor() {
    this.storageDir = config.paths.storageDir;
    this._ensureDirs();
  }

  _ensureDirs() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  _getFilePath(collectionName) {
    return path.join(this.storageDir, `${collectionName}.json`);
  }

  _readCollection(collectionName) {
    const file = this._getFilePath(collectionName);
    if (!fs.existsSync(file)) return [];
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.warn(`[Storage] Error leyendo ${collectionName}, retornando []:`, e.message);
      return [];
    }
  }

  _writeCollection(collectionName, items) {
    const file = this._getFilePath(collectionName);
    try {
      fs.writeFileSync(file, JSON.stringify(items, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error(`[Storage] Error escribiendo ${collectionName}:`, e.message);
      return false;
    }
  }

  // --- RESEARCH RUNS ---
  saveRun(runData) {
    const runs = this._readCollection('research_runs');
    const newRun = {
      id: runData.id || `run_${Date.now()}`,
      timestamp: new Date().toISOString(),
      fixturesScanned: runData.fixturesScanned || 0,
      candidatesFound: runData.candidatesFound || 0,
      approvedCount: runData.approvedCount || 0,
      rejectedCount: runData.rejectedCount || 0,
      mcpCallsUsed: runData.mcpCallsUsed || 0,
      status: runData.status || 'COMPLETED',
      notes: runData.notes || ''
    };
    runs.unshift(newRun);
    this._writeCollection('research_runs', runs);
    return newRun;
  }

  // --- CANDIDATES ---
  saveCandidate(candidate) {
    const candidates = this._readCollection('research_candidates');
    const existingIndex = candidates.findIndex(c => 
      c.id === candidate.id || 
      (c.playerOrTeam && candidate.playerOrTeam &&
       c.match && candidate.match &&
       c.market && candidate.market &&
       c.playerOrTeam.toLowerCase().trim() === candidate.playerOrTeam.toLowerCase().trim() &&
       c.match.toLowerCase().trim() === candidate.match.toLowerCase().trim() &&
       c.market.toLowerCase().trim() === candidate.market.toLowerCase().trim() &&
       String(c.line || '') === String(candidate.line || ''))
    );

    const existingId = existingIndex >= 0 ? candidates[existingIndex].id : null;
    const updated = {
      ...candidate,
      id: candidate.id || existingId || `cand_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      candidates[existingIndex] = { ...candidates[existingIndex], ...updated };
    } else {
      updated.createdAt = new Date().toISOString();
      candidates.push(updated);
    }
    this._writeCollection('research_candidates', candidates);
    return updated;
  }

  getCandidates(filterFn = null) {
    const candidates = this._readCollection('research_candidates');
    return filterFn ? candidates.filter(filterFn) : candidates;
  }

  // --- PREDICTIONS ---
  savePrediction(prediction) {
    const predictions = this._readCollection('model_predictions');
    const newPred = {
      id: prediction.id || `pred_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      candidateId: prediction.candidateId,
      timestamp: new Date().toISOString(),
      market: prediction.market,
      line: prediction.line,
      bookmakerOdds: prediction.bookmakerOdds,
      pEmpirical: prediction.pEmpirical,
      pPoisson: prediction.pPoisson,
      pProjected: prediction.pProjected,
      fairOdds: prediction.fairOdds,
      evPercentage: prediction.evPercentage,
      sampleSize: prediction.sampleSize,
      confidenceScore: prediction.confidenceScore,
      modelDivergence: prediction.modelDivergence,
      featuresUsed: prediction.featuresUsed || {},
      status: prediction.status || 'PENDING'
    };
    predictions.push(newPred);
    this._writeCollection('model_predictions', predictions);
    return newPred;
  }

  // --- APPROVED PICKS ---
  saveApprovedPick(pick) {
    const approved = this._readCollection('approved_picks');
    const existingIndex = approved.findIndex(p => p.id === pick.id || (p.partido === pick.partido && p.seleccion === pick.seleccion && p.mercado === pick.mercado));
    
    const entry = {
      ...pick,
      id: pick.id || `pick_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      status: pick.status || 'APROBADO',
      approvedAt: pick.approvedAt || new Date().toISOString()
    };

    if (existingIndex >= 0) {
      approved[existingIndex] = entry;
    } else {
      approved.push(entry);
    }
    this._writeCollection('approved_picks', approved);
    return entry;
  }

  getApprovedPicks() {
    return this._readCollection('approved_picks');
  }

  // --- REJECTED PICKS ---
  saveRejectedPick(rejected) {
    const list = this._readCollection('rejected_picks');
    const entry = {
      ...rejected,
      id: rejected.id || `rej_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      rejectedAt: new Date().toISOString(),
      reason: rejected.reason || 'No cumplió criterios mínimos de EV o muestra'
    };
    list.push(entry);
    this._writeCollection('rejected_picks', list);
    return entry;
  }

  getRejectedPicks() {
    return this._readCollection('rejected_picks');
  }

  // --- AGENT REPORTS ---
  saveAgentReport(report) {
    const reports = this._readCollection('agent_reports');
    const entry = {
      ...report,
      id: report.id || `rep_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString()
    };
    reports.push(entry);
    this._writeCollection('agent_reports', reports);
    return entry;
  }

  getAgentReports(candidateId = null) {
    const reports = this._readCollection('agent_reports');
    return candidateId ? reports.filter(r => r.candidateId === candidateId) : reports;
  }

  // --- RESULTS & SETTLEMENT ---
  saveResult(result) {
    const results = this._readCollection('pick_results');
    const existingIndex = results.findIndex(r => r.pickId === result.pickId);
    const entry = {
      ...result,
      id: result.id || `res_${Date.now()}`,
      settledAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      results[existingIndex] = entry;
    } else {
      results.push(entry);
    }
    this._writeCollection('pick_results', results);
    return entry;
  }

  getResults() {
    return this._readCollection('pick_results');
  }
}

module.exports = new StorageEngine();
