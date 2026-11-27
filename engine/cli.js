#!/usr/bin/env node
/**
 * CLI DE CONTROL - AUTONOMOUS SPORTS RESEARCH ENGINE
 * Permite ejecutar y controlar manualmente o mediante cron los procesos del motor:
 * Uso:
 *   node engine/cli.js --daily [YYYY-MM-DD]
 *   node engine/cli.js --lineups
 *   node engine/cli.js --settle
 *   node engine/cli.js --status
 *   node engine/cli.js --daemon
 */
const scheduler = require('./scheduler/scheduler');
// DISCOVERY ENGINE 3.0 (Conmutado como motor operativo único)
const { discoveryEngine3: discoveryEngine } = require('./discovery/discoveryEngine3');
const rateGovernor = require('./mcp/rateGovernor');
const storage = require('./data/storage');
const syncRadar = require('./data/syncRadar');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '--status';

  console.log('⚡ DARADOR IA — AUTONOMOUS SPORTS RESEARCH ENGINE (CLI)');
  console.log(`Comando: ${command}\n`);

  try {
    switch (command) {
      case '--daily':
      case '-d': {
        const dateArg = args[1] || new Date().toISOString().slice(0, 10);
        console.log(`Ejecutando ciclo diario completo para: ${dateArg}`);
        const summary = await scheduler.runDailyPipeline(dateArg);
        console.log('\n📊 Resumen de Ejecución:');
        console.table(summary);
        break;
      }

      case '--discovery': {
        const dateArg = args[1] || new Date().toISOString().slice(0, 10);
        console.log(`Ejecutando Discovery Engine para: ${dateArg}`);
        const result = await discoveryEngine.runDiscovery({ targetDate: dateArg });
        const count = result.candidates ? result.candidates.length : 0;
        console.log(`\nCandidatos detectados: ${count}`);
        break;
      }

      case '--lineups':
      case '-l': {
        console.log('Ejecutando verificación de alineaciones pre-partido...');
        const result = await scheduler.runLineupVerification();
        console.log(`\nEvaluados: ${result.totalEvaluated} | Promovidos: ${result.promotedCount} | Vetados: ${result.vetoedCount}`);
        break;
      }

      case '--settle':
      case '-s': {
        console.log('Ejecutando liquidación de pronósticos finalizados...');
        const result = await scheduler.runSettlement();
        console.log(`\nPicks evaluados: ${result.evaluated} | Liquidados: ${result.settled}`);
        if (result.historialSummary) {
          console.log(`ROI Actual: ${result.historialSummary.summary.roi_pct}% | Balance: ${result.historialSummary.summary.net_profit_units} unidades`);
        }
        break;
      }

      case '--status': {
        const rateStats = rateGovernor.getStatus();
        const candidates = storage.getCandidates();
        const approved = storage.getApprovedPicks();
        const results = storage.getResults();

        console.log('📈 ESTADO DEL SISTEMA Y RECURSOS:');
        console.log(`• Consumo Diario MCP: ${rateStats.dailyCallsUsed} llamadas (Restantes: ${rateStats.dailyCallsRemaining})`);
        console.log(`• Llamadas en el último minuto: ${rateStats.callsLastMinute} / ${rateStats.maxPerMinute}`);
        console.log(`• Solicitudes Activas: ${rateStats.activeRequests}`);
        console.log(`• Candidatos en Base de Datos: ${candidates.length}`);
        console.log(`• Picks Aprobados en Radar: ${approved.length}`);
        console.log(`• Apuestas Liquidadas en Historial: ${results.length}`);
        break;
      }

      case '--monitor':
      case '--processes':
      case '-m': {
        const processMonitor = require('./scheduler/processMonitor');
        const report = processMonitor.auditProcesses();
        console.log('📡 AUDITORÍA OPERATIVA DE PROCESOS — DARADORBET');
        console.log(`Hora Sistema (Argentina): ${report.systemTimeArt}`);
        console.log(`Zona Horaria: ${report.timeZone}`);
        console.log(`Modo Demonio: ${report.daemonRunning ? 'ACTIVO' : 'DETENIDO / MANUAL'}`);
        console.log(`\nResumen: ${report.summary.active} Activos | ${report.summary.manual} Ejecución Manual | ${report.summary.inactive} Inactivos\n`);
        console.table(report.processes.map(p => ({
          Proceso: p.name,
          Frecuencia: p.configuredFrequency,
          Estado: p.status,
          'Última Ejecución (ART)': p.lastRunArt || 'Sin registro',
          'Próxima Ejecución': p.nextRunArt || 'No programada',
          Duración: `${p.durationSeconds}s`
        })));
        break;
      }

      case '--daemon': {
        scheduler.startDaemon();
        console.log('Presione Ctrl+C para detener el servicio...');
        // Mantener el proceso activo
        process.on('SIGINT', () => {
          scheduler.stopDaemon();
          process.exit(0);
        });
        break;
      }

      case '--help':
      case '-h':
      default:
        console.log('Opciones disponibles:');
        console.log('  --daily [fecha]     Ejecuta el pipeline completo de Discovery, Investigación, Predicción y Agentes');
        console.log('  --discovery [fecha] Ejecuta únicamente el escaneo de Discovery Engine');
        console.log('  --lineups           Revisa alineaciones oficiales para picks condicionales');
        console.log('  --settle            Liquida partidos finalizados y actualiza el ROI');
        console.log('  --status            Muestra métricas operativas y consumo de API MCP');
        console.log('  --monitor           Audita los 9 procesos del motor, frecuencias y estado en horario AR');
        console.log('  --daemon            Inicia el scheduler en segundo plano con intervalos automáticos');
        break;
    }
  } catch (error) {
    console.error('\n❌ Error durante la ejecución del comando:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
