/**
 * DARADORBET — FASE 3 POST-AUDITORÍA: RETO ESCALERA EN SIMULACIÓN CONTROLADA
 *
 * Módulo 100% aislado para simulación secuencial de interés compuesto (RETO ESCALERA).
 *
 * GARANTÍAS INNEGOCIABLES:
 * - simulationOnly: true, realCapitalAllowed: false, autoExecutionAllowed: false.
 * - Restringido exclusivamente a mercados calibrados:
 *     1) "Remates totales" (jugador, con titularidad confirmada / no void)
 *     2) "Córners de equipo"
 * - Excluye explícitamente "Remates al arco de equipo", "Goles de equipo" y "Remates de equipo".
 * - Reglas secuenciales:
 *     - 1 apuesta activa a la vez (orden cronológico).
 *     - WON -> capital *= odds, step += 1.
 *     - VOID -> capital preservado, step preservado.
 *     - LOST -> fin de ciclo, reinicio a step 1 con capital base simulado.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const LOG_PATH = path.join(ROOT, 'engine', 'storage_data', 'reto_escalera_simulation_log.json');
const EXPORT_PATH = path.join(ROOT, 'api', 'reto_escalera_simulation.json');

const ALLOWED_MARKETS = new Set(['Remates totales', 'Córners de equipo']);
const EXCLUDED_MARKETS = new Set(['Remates al arco de equipo', 'Goles de equipo', 'Remates de equipo']);

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

class LadderSimulationEngine {
  constructor(options = {}) {
    this.initialCapital = options.initialCapital ?? 50000;
    this.targetSteps = options.targetSteps ?? 5;
    this.allowedMarkets = options.allowedMarkets || ALLOWED_MARKETS;
    this.logPath = options.logPath || LOG_PATH;
    this.exportPath = options.exportPath || EXPORT_PATH;
  }

  isEligible(pick) {
    if (!pick) return false;
    const market = String(pick.market || '').trim();
    if (EXCLUDED_MARKETS.has(market)) return false;
    if (!this.allowedMarkets.has(market)) return false;
    const odds = Number(pick.odds);
    if (!Number.isFinite(odds) || odds <= 1.01) return false;
    return true;
  }

  simulate(picksList) {
    const eligible = (picksList || [])
      .filter(p => this.isEligible(p))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    let cycleId = 1;
    let step = 1;
    let capital = this.initialCapital;
    let totalInvested = this.initialCapital;
    let totalReturned = 0;
    let maxStepReached = 0;
    let cyclesCompleted = 0;
    let cyclesReset = 0;

    const history = [];

    for (const p of eligible) {
      const st = String(p.status || '').toUpperCase();
      const odds = Number(p.odds);
      const capBefore = Number(capital.toFixed(2));
      let capAfter = capBefore;
      let outcome = 'PENDING';

      if (st === 'ACERTADA' || st === 'GANADA' || st === 'WON') {
        outcome = 'WON';
        capAfter = Number((capBefore * odds).toFixed(2));
        if (step > maxStepReached) maxStepReached = step;
        history.push({ cycleId, step, id: p.id, date: p.date, match: p.match, player: p.player, market: p.market, odds, outcome, capBefore, capAfter });
        if (step >= this.targetSteps) {
          cyclesCompleted++;
          totalReturned += capAfter;
          cycleId++;
          step = 1;
          capital = this.initialCapital;
          totalInvested += this.initialCapital;
        } else {
          step++;
          capital = capAfter;
        }
      } else if (st.includes('ANULADA') || st === 'VOID') {
        outcome = 'VOID';
        history.push({ cycleId, step, id: p.id, date: p.date, match: p.match, player: p.player, market: p.market, odds, outcome, capBefore, capAfter: capBefore });
      } else if (st === 'FALLADA' || st === 'PERDIDA' || st === 'LOST') {
        outcome = 'LOST';
        capAfter = 0;
        history.push({ cycleId, step, id: p.id, date: p.date, match: p.match, player: p.player, market: p.market, odds, outcome, capBefore, capAfter });
        cyclesReset++;
        cycleId++;
        step = 1;
        capital = this.initialCapital;
        totalInvested += this.initialCapital;
      }
    }

    // Valor actual en curso del ciclo abierto
    const activeCapital = Number(capital.toFixed(2));
    const netSimulatedProfit = Number(((totalReturned + activeCapital) - totalInvested).toFixed(2));

    return {
      generatedAtUtc: new Date().toISOString(),
      mode: 'SIMULATION_ONLY',
      simulationOnly: true,
      realCapitalAllowed: false,
      autoExecutionAllowed: false,
      config: {
        initialCapital: this.initialCapital,
        targetSteps: this.targetSteps,
        allowedMarkets: Array.from(this.allowedMarkets),
        excludedMarkets: Array.from(EXCLUDED_MARKETS)
      },
      summary: {
        eligiblePicksReplayed: history.length,
        wonSteps: history.filter(h => h.outcome === 'WON').length,
        lostSteps: history.filter(h => h.outcome === 'LOST').length,
        voidSteps: history.filter(h => h.outcome === 'VOID').length,
        maxStepReached,
        cyclesCompleted,
        cyclesReset,
        currentCycle: cycleId,
        currentStep: step,
        currentSimulatedCapital: activeCapital,
        totalSimulatedInvested: totalInvested,
        totalSimulatedReturned: Number(totalReturned.toFixed(2)),
        netSimulatedProfit
      },
      history
    };
  }

  runFromHistorial() {
    const historial = readJson(path.join(ROOT, 'historial_picks.json'), { picks: [] });
    const result = this.simulate(historial.picks || []);

    for (const target of [this.logPath, this.exportPath]) {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, JSON.stringify(result, null, 2), 'utf8');
    }
    return result;
  }
}

module.exports = { LadderSimulationEngine, ALLOWED_MARKETS, EXCLUDED_MARKETS };
