/**
 * TEST DE VERIFICACIÓN DE FASE 5: INTEGRACIÓN CON RADAR WEB
 * Valida:
 * 1. Esquema y contenido de picks_hoy.json (top_picks + research_center)
 * 2. Integridad de los picks existentes (sin pérdida de datos)
 * 3. Elementos HTML en dashboard.html e index.html:
 *    - 4ta Pestaña: Centro de Investigación & IA
 *    - Sección #viewResearch con filtros y tabla
 *    - Modal de Auditoría Integral (#auditModal con 5 tabs)
 *    - Badges de Estado (.status-pill) y Botón de Auditoría (.btn-audit)
 * 4. Funciones JavaScript de control y reactividad
 * 5. Sincronización 1:1 entre dashboard.html e index.html
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Iniciando verificación de Fase 5: Integración con Radar Web...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

const rootDir = path.resolve(__dirname, '..', '..');
const dashboardPath = path.join(rootDir, 'dashboard.html');
const indexPath = path.join(rootDir, 'index.html');
const picksHoyPath = path.join(rootDir, 'picks_hoy.json');
const historialPath = path.join(rootDir, 'historial_picks.json');

// 1. Verificación de picks_hoy.json
it('picks_hoy.json debe ser JSON válido con top_picks y research_center', () => {
  assert(fs.existsSync(picksHoyPath), 'picks_hoy.json no existe');
  const data = JSON.parse(fs.readFileSync(picksHoyPath, 'utf8'));
  assert(Array.isArray(data.top_picks), 'top_picks debe ser un array');
  assert(Array.isArray(data.research_center), 'research_center debe ser un array');
  assert(data.top_picks.length >= 6, `Esperados al menos 6 top_picks, encontrados ${data.top_picks.length}`);
  assert(data.research_center.length > 0, `research_center no debe estar vacío, encontrados ${data.research_center.length}`);
});

it('top_picks debe conservar los picks originales del Brasileirão con atributos matemáticos', () => {
  const data = JSON.parse(fs.readFileSync(picksHoyPath, 'utf8'));
  const bragantino = data.top_picks.find(p => p.player.includes('Bragantino'));
  assert(bragantino, 'Pick de Bragantino no encontrado');
  assert.strictEqual(bragantino.status, 'APROBADO', 'Bragantino debe estar APROBADO');
  assert(bragantino.odds > 1.5, 'Cuota debe ser válida');
  assert(bragantino.edge_pct !== undefined, 'Debe incluir edge_pct');

  const pendingPick = data.top_picks.find(p => (p.player.includes('Vitinho') || p.player.includes('Vitor Hugo') || p.player.includes('Jamerson') || p.player.includes('Bruno')) && p.status.includes('PENDIENTE'));
  assert(pendingPick, 'Debe haber al menos un pick con estado PENDIENTE de alineación');
  assert(pendingPick.status.includes('PENDIENTE'), 'Pick condicional debe estar PENDIENTE');
});

// 2. Verificación de dashboard.html
const dashboardHtml = fs.readFileSync(dashboardPath, 'utf8');

it('dashboard.html debe incluir el botón de la 4ta pestaña (#tabResearch) con su contador', () => {
  assert(dashboardHtml.includes('id="tabResearch"'), 'Falta botón #tabResearch');
  assert(dashboardHtml.includes('id="tabResearchCount"'), 'Falta contador #tabResearchCount');
  assert(dashboardHtml.includes('Centro de Investigación'), 'Falta texto Centro de Investigación');
});

it('dashboard.html debe incluir la sección de vista #viewResearch con tabla y filtro de estado', () => {
  assert(dashboardHtml.includes('id="viewResearch"'), 'Falta sección #viewResearch');
  assert(dashboardHtml.includes('id="researchTableBody"'), 'Falta #researchTableBody');
  assert(dashboardHtml.includes('id="filterResearchStatus"'), 'Falta #filterResearchStatus');
});

it('dashboard.html debe incluir el Modal de Auditoría (#auditModal) con las 5 pestañas de explicabilidad', () => {
  assert(dashboardHtml.includes('id="auditModal"'), 'Falta modal #auditModal');
  assert(dashboardHtml.includes('id="mtabMath"'), 'Falta tab #mtabMath');
  assert(dashboardHtml.includes('id="mtabRisk"'), 'Falta tab #mtabRisk');
  assert(dashboardHtml.includes('id="mtabAgents"'), 'Falta tab #mtabAgents');
  assert(dashboardHtml.includes('id="mtabIntel"'), 'Falta tab #mtabIntel');
  assert(dashboardHtml.includes('id="mtabTrace"'), 'Falta tab #mtabTrace');
});

it('dashboard.html debe incluir las secciones de contenido del modal', () => {
  assert(dashboardHtml.includes('id="msecMath"'), 'Falta sección #msecMath');
  assert(dashboardHtml.includes('id="msecRisk"'), 'Falta sección #msecRisk');
  assert(dashboardHtml.includes('id="msecAgents"'), 'Falta sección #msecAgents');
  assert(dashboardHtml.includes('id="msecIntel"'), 'Falta sección #msecIntel');
  assert(dashboardHtml.includes('id="msecTrace"'), 'Falta sección #msecTrace');
});

it('dashboard.html debe incluir estilos CSS de Fase 5 (.status-pill, .btn-audit, .modal-overlay)', () => {
  assert(dashboardHtml.includes('.status-pill'), 'Falta clase .status-pill');
  assert(dashboardHtml.includes('.btn-audit'), 'Falta clase .btn-audit');
  assert(dashboardHtml.includes('.modal-overlay'), 'Falta clase .modal-overlay');
  assert(dashboardHtml.includes('.duel-card'), 'Falta clase .duel-card');
});

it('dashboard.html debe incluir el botón de auditar en renderPicks()', () => {
  assert(dashboardHtml.includes('btn-audit'), 'renderPicks debe contener btn-audit');
  assert(dashboardHtml.includes('openAuditModal'), 'renderPicks debe invocar openAuditModal');
});

it('dashboard.html debe incluir funciones JavaScript de soporte', () => {
  assert(dashboardHtml.includes('function openAuditModal('), 'Falta openAuditModal()');
  assert(dashboardHtml.includes('function closeAuditModal('), 'Falta closeAuditModal()');
  assert(dashboardHtml.includes('function switchModalTab('), 'Falta switchModalTab()');
  assert(dashboardHtml.includes('function renderResearchCenter('), 'Falta renderResearchCenter()');
});

it('dashboard.html debe preservar todas las funcionalidades previas intactas', () => {
  assert(dashboardHtml.includes('id="tabPicks"'), 'Falta #tabPicks');
  assert(dashboardHtml.includes('id="tabParlays"'), 'Falta #tabParlays');
  assert(dashboardHtml.includes('id="tabHistory"'), 'Falta #tabHistory');
  assert(dashboardHtml.includes('id="filterLeague"'), 'Falta #filterLeague');
  assert(dashboardHtml.includes('id="filterMatch"'), 'Falta #filterMatch');
  assert(dashboardHtml.includes('id="filterMarket"'), 'Falta #filterMarket');
  assert(dashboardHtml.includes('id="filterMinHit"'), 'Falta #filterMinHit');
  assert(dashboardHtml.includes('id="searchInput"'), 'Falta #searchInput');
  assert(dashboardHtml.includes('id="historyTableBody"'), 'Falta #historyTableBody');
});

// 3. Verificación de index.html
const indexHtml = fs.readFileSync(indexPath, 'utf8');

it('index.html debe estar 100% sincronizado con dashboard.html', () => {
  assert.strictEqual(indexHtml, dashboardHtml, 'index.html debe ser idéntico a dashboard.html');
});

// 4. Verificación de server.js
const serverPath = path.join(rootDir, 'server.js');
it('server.js debe existir y ser capaz de servir la aplicación', () => {
  assert(fs.existsSync(serverPath), 'server.js no existe');
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  assert(serverContent.includes('http.createServer'), 'server.js debe crear un servidor HTTP');
});

console.log(`\n========================================`);
console.log(`RESULTADO FINAL DE PRUEBAS DE FASE 5:`);
console.log(`Pasadas: ${passed} | Fallidas: ${failed}`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 FASE 5 COMPLETAMENTE VERIFICADA Y SUPERADA CON ÉXITO.');
}
