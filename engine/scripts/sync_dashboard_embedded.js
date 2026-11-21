const fs = require('fs');

const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const picksHoyStr = JSON.stringify(picksHoy);

['dashboard.html', 'index.html'].forEach(filename => {
  let content = fs.readFileSync(filename, 'utf8');

  // 1. Replace window.EMBEDDED_PICKS_DATA
  const startPicks = content.indexOf('window.EMBEDDED_PICKS_DATA = ');
  if (startPicks !== -1) {
    let endPicks = content.indexOf(';\n  window.EMBEDDED_HISTORY_DATA', startPicks);
    if (endPicks === -1) {
      endPicks = content.indexOf(';\r\n  window.EMBEDDED_HISTORY_DATA', startPicks);
    }
    
    if (endPicks !== -1) {
      content = content.slice(0, startPicks + 'window.EMBEDDED_PICKS_DATA = '.length) + 
                picksHoyStr + 
                content.slice(endPicks);
      console.log(filename + ': EMBEDDED_PICKS_DATA updated successfully.');
    } else {
      console.error(filename + ': could not find end of EMBEDDED_PICKS_DATA');
    }
  }

  // 2. Ensure getPickDateKey checks eventDateLocal first
  if (content.includes('function getPickDateKey(p) {') && !content.includes('if (p.eventDateLocal) return p.eventDateLocal;')) {
    content = content.replace(
      /function getPickDateKey\(p\) \{\r?\n\s*if \(!p\) return '2026-11-19';/,
      "function getPickDateKey(p) {\n      if (!p) return '2026-11-19';\n      if (p.eventDateLocal) return p.eventDateLocal;"
    );
    console.log(filename + ': getPickDateKey updated to check eventDateLocal first.');
  }

  // 3. Ensure btnResetDesktop button exists next to btnViewCards
  if (!content.includes('id="btnResetDesktop"')) {
    content = content.replace(
      '<button class="view-toggle-btn" id="btnViewCards" onclick="toggleViewMode(\'cards\')">🗂️ Tarjetas</button>',
      '<button class="view-toggle-btn" id="btnViewCards" onclick="toggleViewMode(\'cards\')">🗂️ Tarjetas</button>\n          <button class="btn-clear-filters" id="btnResetDesktop" onclick="resetPicksFilters()" title="Restablecer todos los filtros" style="padding: 0.45rem 0.85rem; font-size: 12px; background: rgba(255,255,255,0.06); border: 1px solid var(--border-terminal); border-radius: var(--radius-xs); color: var(--text-dim); cursor: pointer; transition: all 0.2s;">🔄 Limpiar</button>'
    );
    console.log(filename + ': btnResetDesktop added.');
  }

  // 4. Ensure resetPicksFilters is defined
  if (!content.includes('function resetPicksFilters()')) {
    content = content.replace(
      'function resetMobileFilters() {',
      "function resetPicksFilters() {\n      if (document.getElementById('filterDate')) document.getElementById('filterDate').value = 'today';\n      if (document.getElementById('filterLeague')) document.getElementById('filterLeague').value = 'all';\n      if (document.getElementById('filterMatch')) document.getElementById('filterMatch').value = 'all';\n      if (document.getElementById('filterMarket')) document.getElementById('filterMarket').value = 'all';\n      if (document.getElementById('filterMinHit')) document.getElementById('filterMinHit').value = '0';\n      if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = 'all';\n      if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';\n      if (typeof onDateChange === 'function') {\n        onDateChange();\n      } else {\n        renderPicks();\n      }\n    }\n\n    function resetMobileFilters() {\n      resetPicksFilters();"
    );
    console.log(filename + ': resetPicksFilters defined.');
  }

  fs.writeFileSync(filename, content, 'utf8');
});
