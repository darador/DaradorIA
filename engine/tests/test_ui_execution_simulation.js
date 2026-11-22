const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

console.log('🧪 Iniciando Test de Ejecución Real del Frontend (dashboard.html e index.html)...');

['dashboard.html', 'index.html'].forEach(filename => {
  console.log(`\n--- Probando ${filename} ---`);
  const html = fs.readFileSync(filename, 'utf8');

  // Extraer el bloque de script principal
  const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g);
  assert(scriptMatches && scriptMatches.length > 0, `${filename}: Bloque de script principal encontrado`);

  const els = {};
  const mockElement = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    value: (id === 'filterDate' ? 'today' : (id === 'filterMinHit' ? '0' : (id.includes('search') || id.includes('Search') ? '' : 'all'))),
    style: {},
    appendChild: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    querySelector: () => mockElement('child'),
    querySelectorAll: () => []
  });

  const domWindow = {
    location: { protocol: 'file:' },
    scrollTo: () => {},
    addEventListener: () => {},
    document: {
      addEventListener: () => {},
      getElementById: (id) => (els[id] || (els[id] = mockElement(id))),
      createElement: (tag) => mockElement(tag)
    }
  };

  const context = {
    window: domWindow,
    document: domWindow.document,
    console: console,
    setTimeout: (fn) => {},
    setInterval: (fn) => {},
    Intl, Date, Math, Number, parseFloat, parseInt, isNaN, Set, Array, Object, JSON
  };

  vm.createContext(context);
  const scriptContent = scriptMatches[scriptMatches.length - 1]
    .replace(/^<script>/, '')
    .replace(/<\/script>$/, '');

  // 1. Ejecutar script inicial (como el navegador al cargar)
  vm.runInContext(scriptContent, context);

  // 2. Comprobar que globalPicksData y globalHistoryData existen y tienen datos
  const picks = vm.runInContext('globalPicksData', context);
  assert(picks && picks.top_picks && picks.top_picks.length === 63, `${filename}: globalPicksData debe tener 63 picks`);

  const hist = vm.runInContext('globalHistoryData', context);
  assert(hist && hist.history && hist.history.length === 58, `${filename}: globalHistoryData debe tener 58 apuestas`);

  // 3. Comprobar renderPicks() con horizonte 'today'
  vm.runInContext('selectTimeHorizon("today");', context);
  const tableRows = (els['dailyBoardTableBody'].innerHTML.match(/<tr/g) || []).length;
  const mobileCards = (els['mobilePicksList'].innerHTML.match(/class="mob-pick-card"/g) || []).length;
  const gridCards = (els['picksGrid'].innerHTML.match(/class="pick-card"/g) || []).length;

  console.log(`  Daily Board (Tabla): ${tableRows} filas renderizadas`);
  console.log(`  Daily Board (Móvil): ${mobileCards} tarjetas renderizadas`);
  console.log(`  Daily Board (Grid): ${gridCards} tarjetas renderizadas`);
  assert(tableRows === 24, `${filename}: Se esperan exactamente 24 filas para hoy (actual: ${tableRows})`);
  assert(mobileCards === 24, `${filename}: Se esperan exactamente 24 tarjetas móviles para hoy (actual: ${mobileCards})`);

  // 4. Comprobar Estadísticas (renderHistory())
  vm.runInContext('renderHistory();', context);
  const histRows = (els['historyTableBody'].innerHTML.match(/<tr/g) || []).length;
  const histCards = (els['historyMobileList'].innerHTML.match(/class="history-mobile-card/g) || []).length;
  console.log(`  Estadísticas (Tabla): ${histRows} filas renderizadas`);
  console.log(`  Estadísticas (Móvil): ${histCards} tarjetas renderizadas`);
  assert(histRows === 58, `${filename}: Se esperan exactamente 58 filas de historial (actual: ${histRows})`);
  assert(histCards === 58, `${filename}: Se esperan exactamente 58 tarjetas de historial (actual: ${histCards})`);

  // 5. Comprobar filtros de Estadísticas (PENDIENTE)
  vm.runInContext('syncHistoryFilterChange("status", "PENDIENTE");', context);
  const pendingRows = (els['historyTableBody'].innerHTML.match(/<tr/g) || []).length;
  console.log(`  Estadísticas [Filtro PENDIENTE]: ${pendingRows} apuestas en juego`);
  assert(pendingRows === 7, `${filename}: Se esperan 7 apuestas en juego con filtro PENDIENTE (actual: ${pendingRows})`);

  // 6. Comprobar filtros de Estadísticas (ANULADA)
  vm.runInContext('syncHistoryFilterChange("status", "ANULADA");', context);
  const voidRows = (els['historyTableBody'].innerHTML.match(/<tr/g) || []).length;
  console.log(`  Estadísticas [Filtro ANULADA]: ${voidRows} apuestas anuladas`);
  assert(voidRows === 9, `${filename}: Se esperan 9 apuestas anuladas con filtro ANULADA (actual: ${voidRows})`);

  // 7. Comprobar filtros de Estadísticas (GANADA y PERDIDA)
  vm.runInContext('syncHistoryFilterChange("status", "GANADA");', context);
  const wonRows = (els['historyTableBody'].innerHTML.match(/<tr/g) || []).length;
  console.log(`  Estadísticas [Filtro GANADA]: ${wonRows} apuestas ganadas`);
  assert(wonRows === 28, `${filename}: Se esperan 28 apuestas ganadas con filtro GANADA (actual: ${wonRows})`);

  vm.runInContext('syncHistoryFilterChange("status", "PERDIDA");', context);
  const lostRows = (els['historyTableBody'].innerHTML.match(/<tr/g) || []).length;
  console.log(`  Estadísticas [Filtro PERDIDA]: ${lostRows} apuestas perdidas`);
  assert(lostRows === 14, `${filename}: Se esperan 14 apuestas perdidas con filtro PERDIDA (actual: ${lostRows})`);

  console.log(`✅ ${filename}: Todas las verificaciones de renderizado pasaron al 100%.`);
});

console.log('\n====================================================');
console.log('🎉 VERIFICACIÓN COMPLETA FRONTEND: 0 ERRORES, 100% VISIBILIDAD');
console.log('====================================================');
