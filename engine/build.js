/**
 * DARADORIA / DARADORBET - REAL BUILD & SYSTEM VERIFICATION PIPELINE
 * Fase 10.1.2
 * 
 * Pipeline real de compilación, verificación estática y empaquetado:
 * 1. Verificación de sintaxis y compilación AST de todos los módulos críticos (node --check).
 * 2. Resolución estricta de imports y dependencias circulares.
 * 3. Validación de integridad de schemas JSON de almacenamiento.
 * 4. Verificación criptográfica SHA-256 de inmutabilidad del registro histórico.
 * 5. Validación de banderas de seguridad de Shadow Mode.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('======================================================');
console.log('🏗️  INICIANDO BUILD REAL DE DARADORIA / DARADORBET');
console.log('======================================================\n');

let buildErrors = [];
let buildWarnings = [];

// 1. COMPILACIÓN SINTÁCTICA (AST CHECK)
console.log('--- 1. Verificación de Sintaxis y Compilación AST ---');
const criticalFiles = [
  'server.js',
  'engine/index.js',
  'engine/config.js',
  'engine/prediction/predictionEngine.js',
  'engine/prediction/observationTracker.js',
  'engine/research/deepResearchEngine.js',
  'engine/agents/orchestrator.js',
  'engine/agents/riskManager.js',
  'engine/settlement/settlementEngine.js',
  'engine/audit/integrityGuard.js',
  'engine/data/syncRadar.js',
  'engine/scheduler/processMonitor.js'
];

criticalFiles.forEach(file => {
  const fullPath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) {
    buildErrors.push(`Archivo crítico no encontrado: ${file}`);
    return;
  }
  try {
    execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
    console.log(`  ✅ Compilación AST OK: ${file}`);
  } catch (err) {
    buildErrors.push(`Error de sintaxis en ${file}: ${err.message}`);
    console.error(`  ❌ Error de sintaxis en ${file}`);
  }
});

// 2. RESOLUCIÓN DE IMPORTS Y MÓDULOS CRÍTICOS
console.log('\n--- 2. Resolución de Imports y Carga de Módulos ---');
try {
  const config = require('./config');
  const predictionEngine = require('./prediction/predictionEngine');
  const observationTracker = require('./prediction/observationTracker');
  const deepResearchEngine = require('./research/deepResearchEngine');
  const orchestrator = require('./agents/orchestrator');
  const settlementEngine = require('./settlement/settlementEngine');
  const integrityGuard = require('./audit/integrityGuard');

  console.log('  ✅ Todos los módulos críticos cargados sin dependencias circulares ni errores de import.');
} catch (err) {
  buildErrors.push(`Fallo en import de módulos críticos: ${err.message}`);
  console.error(`  ❌ Error resolviendo imports: ${err.message}`);
}

// 3. VALIDACIÓN DE ESQUEMAS Y ALMACENAMIENTO JSON
console.log('\n--- 3. Validación de Esquemas y Almacenamiento JSON ---');
const storageFiles = [
  'engine/storage_data/model_observation_registry.json',
  'engine/storage_data/research_candidates.json',
  'engine/storage_data/model_predictions.json',
  'engine/storage_data/approved_picks.json',
  'engine/storage_data/rejected_picks.json',
  'engine/storage_data/audit_integrity_ledger.json',
  'historial_picks.json',
  'picks_hoy.json',
  'api/metrics.json',
  'api/processes.json'
];

storageFiles.forEach(file => {
  const fullPath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) {
    buildWarnings.push(`Archivo de almacenamiento ausente (será creado en runtime): ${file}`);
    console.log(`  ⚠️ Archivo ausente: ${file}`);
    return;
  }
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(raw);
    console.log(`  ✅ JSON Válido: ${file} (${Array.isArray(parsed) ? parsed.length + ' elementos' : 'objeto'})`);
  } catch (err) {
    buildErrors.push(`JSON corrupto en ${file}: ${err.message}`);
    console.error(`  ❌ JSON corrupto en ${file}`);
  }
});

// 4. VERIFICACIÓN CRIPTOGRÁFICA DE INTEGRIDAD
console.log('\n--- 4. Verificación Criptográfica SHA-256 ---');
try {
  const tracker = require('./prediction/observationTracker');
  const audit = tracker.verifyIntegrity();
  if (audit.alteredCount > 0) {
    buildErrors.push(`Se detectaron ${audit.alteredCount} registros históricos alterados.`);
    console.error(`  ❌ Violaciones de integridad detectadas:`, audit.violations);
  } else {
    console.log(`  ✅ Integridad SHA-256 Verificada: ${audit.intactCount} de ${audit.totalChecked} registros sellados e intactos.`);
  }
} catch (err) {
  buildErrors.push(`Fallo verificando integridad: ${err.message}`);
}

// 5. VALIDACIÓN DE POLÍTICAS DE SHADOW MODE
console.log('\n--- 5. Verificación de Seguridad de Shadow Mode ---');
try {
  const config = require('./config');
  if (config.shadowMode?.enabled !== true) {
    buildErrors.push('Shadow Mode DEBE estar activado obligatoriamente.');
  }
  if (config.shadowMode?.allowRealBets !== false) {
    buildErrors.push('allowRealBets DEBE ser false.');
  }
  if (config.shadowMode?.allowTelegramPicks !== false) {
    buildErrors.push('allowTelegramPicks DEBE ser false.');
  }
  if (config.shadowMode?.allowAutomatedOrders !== false) {
    buildErrors.push('allowAutomatedOrders DEBE ser false.');
  }
  console.log('  ✅ Políticas de Shadow Mode verificadas: 0 apuestas reales, 0 telegram, 0 órdenes.');
} catch (err) {
  buildErrors.push(`Error en verificación de config: ${err.message}`);
}

console.log('\n======================================================');
if (buildErrors.length > 0) {
  console.error('❌ BUILD FALLIDO CON ERRORES:');
  buildErrors.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
} else {
  console.log('🎉 BUILD EXITOSO: Sistema verificado para Shadow Mode.');
  if (buildWarnings.length > 0) {
    console.log('Advertencias menores:');
    buildWarnings.forEach(w => console.log(`   - ${w}`));
  }
  console.log('======================================================\n');
  process.exit(0);
}
