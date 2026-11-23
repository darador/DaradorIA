/**
 * SCHEDULER & PIPELINE COORDINATOR (FACADE)
 * DaradorIA / DaradorBET — Redirige de forma transparente al CentralAutonomousScheduler
 * Garantiza total retrocompatibilidad con scripts existentes y CLI.
 */

const centralScheduler = require('./centralScheduler');

// Proveer alias compatibles
if (!centralScheduler.runLineupVerification) {
  centralScheduler.runLineupVerification = (opts) => centralScheduler.runLineupsJob(opts);
}
if (!centralScheduler.runSettlement) {
  centralScheduler.runSettlement = (opts) => centralScheduler.runSettlementJob(opts);
}

module.exports = centralScheduler;
