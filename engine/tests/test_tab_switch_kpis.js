const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

['dashboard.html', 'index.html'].forEach(filename => {
  console.log(`\n🧪 Probando simulación completa de navegación para ${filename}...`);
  const html = fs.readFileSync(filename, 'utf8');
  const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g);
  const scriptContent = scriptMatches[0].replace(/^<script>/, '').replace(/<\/script>$/, '');

  const els = {};
  const mockElement = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    value: (id === 'filterDate' ? 'today' : (id === 'filterMinHit' ? '0' : 'all')),
    style: {},
    appendChild: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    querySelector: () => mockElement('child'),
    querySelectorAll: () => []
  });

  const domWindow = {
    location: { protocol: 'http:' },
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
    setTimeout: () => {},
    setInterval: () => {},
    Intl, Date, Math, Number, parseFloat, parseInt, isNaN, Set, Array, Object, JSON
  };

  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // 1. Simular carga inicial (initDashboard)
  vm.runInContext('initDashboard();', context);

  // 2. Simular que el usuario hace clic en la pestaña "Estadísticas"
  console.log('  -> Usuario hace clic en pestaña Estadísticas (switchView("history"))...');
  vm.runInContext('switchView("history");', context);

  // 3. Verificar los valores de las 4 tarjetas KPI principales
  const winRateVal = els['statsWinRate'].textContent;
  const winRateSub = els['statsWinRateSub'].textContent;
  const roiVal = els['statsRoiVal'].textContent;
  const profitVal = els['statsProfitVal'].textContent;
  const wonCount = els['statsWonCount'].textContent;
  const lostCount = els['statsLostCount'].textContent;
  const pendingSub = els['statsPendingSub'].textContent;

  console.log(`  Tarjetas KPI en UI:`);
  console.log(`    • Win Rate: ${winRateVal} (${winRateSub})`);
  console.log(`    • ROI / Yield: ${roiVal}`);
  console.log(`    • Beneficio Neto: ${profitVal}`);
  console.log(`    • Aciertos / Fallos: ${wonCount} Acertadas / ${lostCount} Falladas`);
  console.log(`    • Subtítulo Estado: ${pendingSub}`);

  assert(winRateVal === '66.7%', `${filename}: Win Rate esperado 66.7%, obtenido: ${winRateVal}`);
  assert(Number(wonCount) === 28, `${filename}: Acertadas esperadas 28, obtenido: ${wonCount}`);
  assert(Number(lostCount) === 14, `${filename}: Falladas esperadas 14, obtenido: ${lostCount}`);
  assert(roiVal === '+17.7%', `${filename}: ROI esperado +17.7%, obtenido: ${roiVal}`);
  assert(profitVal === '+7.42 U', `${filename}: Beneficio esperado +7.42 U, obtenido: ${profitVal}`);

  console.log(`✅ ${filename}: Todas las tarjetas de Estadísticas muestran datos exactos y actualizados.`);
});
