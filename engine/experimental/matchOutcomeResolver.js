import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerMatchOutcome, loadOutcomesStore } from './liveProspectiveEvaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MatchOutcomeResolver
 * Strict resolver that verifies match results without approximate name matching.
 * 
 * Outcome format:
 * {
 *   matchId: string,
 *   market: string,
 *   selection: string,
 *   line: number | null,
 *   status: 'WON' | 'LOST' | 'PUSH' | 'VOID_NO_PARTICIPATION' | 'VOID_SUSPENDED',
 *   settledAt: string (ISO timestamp),
 *   source: string,
 *   actualScore: string | null,
 *   closingOdds: number | null
 * }
 */
export class MatchOutcomeResolver {
  constructor(options = {}) {
    this.outcomesStorePath = options.outcomesStorePath;
  }

  /**
   * Settles a match outcome with rigorous validation.
   */
  settleOutcome(outcomeData) {
    if (!outcomeData.matchId || typeof outcomeData.matchId !== 'string') {
      return { success: false, error: 'INVALID_OR_MISSING_MATCH_ID' };
    }
    if (!outcomeData.market || typeof outcomeData.market !== 'string') {
      return { success: false, error: 'INVALID_OR_MISSING_MARKET' };
    }
    if (!outcomeData.selection || typeof outcomeData.selection !== 'string') {
      return { success: false, error: 'INVALID_OR_MISSING_SELECTION' };
    }

    const validStatuses = ['WON', 'LOST', 'PUSH', 'VOID_NO_PARTICIPATION', 'VOID_SUSPENDED'];
    if (!validStatuses.includes(outcomeData.status)) {
      return { success: false, error: `INVALID_STATUS_${outcomeData.status}` };
    }

    if (!outcomeData.settledAt || isNaN(Date.parse(outcomeData.settledAt))) {
      return { success: false, error: 'INVALID_OR_MISSING_SETTLED_AT' };
    }

    const record = registerMatchOutcome(outcomeData, this.outcomesStorePath);
    return {
      success: true,
      action: 'SETTLED',
      record
    };
  }

  /**
   * Helper to evaluate a total goals market given the final match score.
   */
  evaluateTotalGoals(matchId, homeGoals, awayGoals, line, settledAt, closingOdds = null, source = 'MATCH_FEED') {
    const total = homeGoals + awayGoals;
    const isPush = total === line;
    const isOver = total > line;

    const overStatus = isPush ? 'PUSH' : (isOver ? 'WON' : 'LOST');
    const underStatus = isPush ? 'PUSH' : (!isOver ? 'WON' : 'LOST');

    const resOver = this.settleOutcome({
      matchId,
      market: 'TOTAL_GOALS',
      selection: 'OVER',
      line,
      status: overStatus,
      settledAt,
      source,
      actualScore: `${homeGoals}-${awayGoals}`,
      closingOdds
    });

    const resUnder = this.settleOutcome({
      matchId,
      market: 'TOTAL_GOALS',
      selection: 'UNDER',
      line,
      status: underStatus,
      settledAt,
      source,
      actualScore: `${homeGoals}-${awayGoals}`,
      closingOdds
    });

    return { resOver, resUnder };
  }

  /**
   * Helper to evaluate Double Chance given final match score.
   */
  evaluateDoubleChance(matchId, homeGoals, awayGoals, settledAt, closingOdds = null, source = 'MATCH_FEED') {
    const homeWin = homeGoals > awayGoals;
    const draw = homeGoals === awayGoals;
    const awayWin = awayGoals > homeGoals;

    // 1X: Home or Draw
    const dc1X = this.settleOutcome({
      matchId,
      market: 'DOUBLE_CHANCE',
      selection: 'HOME_OR_DRAW',
      line: 0.5,
      status: (homeWin || draw) ? 'WON' : 'LOST',
      settledAt,
      source,
      actualScore: `${homeGoals}-${awayGoals}`,
      closingOdds
    });

    // X2: Draw or Away
    const dcX2 = this.settleOutcome({
      matchId,
      market: 'DOUBLE_CHANCE',
      selection: 'DRAW_OR_AWAY',
      line: 0.5,
      status: (draw || awayWin) ? 'WON' : 'LOST',
      settledAt,
      source,
      actualScore: `${homeGoals}-${awayGoals}`,
      closingOdds
    });

    // 12: Home or Away
    const dc12 = this.settleOutcome({
      matchId,
      market: 'DOUBLE_CHANCE',
      selection: 'HOME_OR_AWAY',
      line: 0.5,
      status: (homeWin || awayWin) ? 'WON' : 'LOST',
      settledAt,
      source,
      actualScore: `${homeGoals}-${awayGoals}`,
      closingOdds
    });

    return { dc1X, dcX2, dc12 };
  }
}
