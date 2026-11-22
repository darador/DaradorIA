const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const indexPath = path.join(rootDir, 'index.html');
const dashboardPath = path.join(rootDir, 'dashboard.html');
const historyPath = path.join(rootDir, 'historial_picks.json');

const historyRaw = fs.readFileSync(historyPath, 'utf8');
const historyObj = JSON.parse(historyRaw);
const embeddedHistoryStr = 'window.EMBEDDED_HISTORY_DATA = ' + JSON.stringify(historyObj) + ';';

let html = fs.readFileSync(indexPath, 'utf8');

// 1. Asegurar window.EMBEDDED_HISTORY_DATA actualizado
const marker = 'window.EMBEDDED_HISTORY_DATA =';
const markerIdx = html.indexOf(marker);
if (markerIdx !== -1) {
  const lineEnd = html.indexOf('\n', markerIdx);
  const before = html.slice(0, markerIdx);
  const after = html.slice(lineEnd);
  html = before + embeddedHistoryStr + after;
}

// 2. Agregar Selector de Universo en controles de filtros de Desktop
const targetFilterBlock = `<div class="history-filter-item">
            <label class="control-label" for="filterHistoryPeriod">Período:</label>`;

const replacementFilterBlock = `<div class="history-filter-item">
            <label class="control-label" for="filterHistoryUniverse">Universo:</label>
            <select id="filterHistoryUniverse" class="select-control" onchange="syncHistoryFilterChange('universe', this.value)">
              <option value="all">Global Auditado (20 picks · 57.9% WR)</option>
              <option value="elena">Aprobados por Elena (19 picks · 61.1% WR)</option>
            </select>
          </div>

          <div class="history-filter-item">
            <label class="control-label" for="filterHistoryPeriod">Período:</label>`;

if (!html.includes('id="filterHistoryUniverse"') && html.includes(targetFilterBlock)) {
  html = html.replace(targetFilterBlock, replacementFilterBlock);
}

// 3. Agregar en mobile filter modal si existe
const targetMobileFilter = `<label class="m-filter-label" for="mFilterPeriod">Período</label>`;
const replacementMobileFilter = `<label class="m-filter-label" for="mFilterUniverse">Universo de Análisis</label>
        <select id="mFilterUniverse" class="select-control" onchange="syncHistoryFilterChange('universe', this.value)">
          <option value="all">Global Auditado (20 picks · 57.9% WR)</option>
          <option value="elena">Aprobados por Elena (19 picks · 61.1% WR)</option>
        </select>
        <div style="height: 0.75rem;"></div>

        <label class="m-filter-label" for="mFilterPeriod">Período</label>`;

if (!html.includes('id="mFilterUniverse"') && html.includes(targetMobileFilter)) {
  html = html.replace(targetMobileFilter, replacementMobileFilter);
}

// 4. Actualizar historyFilterState y sincronización
const oldFilterState = `    let historyFilterState = {
      period: 'all',
      market: 'all',
      status: 'all',
      search: ''
    };`;

const newFilterState = `    let historyFilterState = {
      universe: 'all',
      period: 'all',
      market: 'all',
      status: 'all',
      search: ''
    };`;

if (html.includes(oldFilterState)) {
  html = html.replace(oldFilterState, newFilterState);
}

// 5. Actualizar syncHistoryFilterChange
const oldSyncChange = `      // Sincronizar desktop y mobile
      if (key === 'period') {`;

const newSyncChange = `      // Sincronizar desktop y mobile
      if (key === 'universe') {
        const d = document.getElementById('filterHistoryUniverse');
        const m = document.getElementById('mFilterUniverse');
        if (d) d.value = value;
        if (m) m.value = value;
      } else if (key === 'period') {`;

if (html.includes(oldSyncChange) && !html.includes("if (key === 'universe') {")) {
  html = html.replace(oldSyncChange, newSyncChange);
}

// 6. Actualizar filtrado en applyHistoryFiltersAndRender
const oldFilterInside = `      const q = historyFilterState.search.toLowerCase().trim();
      const statusF = historyFilterState.status;
      const marketF = historyFilterState.market;
      const periodF = historyFilterState.period;

      const filtered = historyList.filter(item => {`;

const newFilterInside = `      const q = historyFilterState.search.toLowerCase().trim();
      const statusF = historyFilterState.status;
      const marketF = historyFilterState.market;
      const periodF = historyFilterState.period;
      const universeF = historyFilterState.universe || 'all';

      const filtered = historyList.filter(item => {
        // Filtrado por Universo
        if (universeF === 'elena' && item.id === 'cand_1795110774831_6rsb2k') return false;`;

if (html.includes(oldFilterInside) && !html.includes("const universeF = historyFilterState.universe")) {
  html = html.replace(oldFilterInside, newFilterInside);
}

// 7. Actualizar resetHistoryFilters
const oldResetFilters = `      historyFilterState = {
        period: 'all',
        market: 'all',
        status: 'all',
        search: ''
      };`;

const newResetFilters = `      historyFilterState = {
        universe: 'all',
        period: 'all',
        market: 'all',
        status: 'all',
        search: ''
      };
      const uD = document.getElementById('filterHistoryUniverse'); if (uD) uD.value = 'all';
      const uM = document.getElementById('mFilterUniverse'); if (uM) uM.value = 'all';`;

if (html.includes(oldResetFilters)) {
  html = html.replace(oldResetFilters, newResetFilters);
}

// 8. Robustecer loadHistoryData() para Vercel y Local con validación estricta de estado
const oldLoadHistorySearch = /async function loadHistoryData\(\) \{[\s\S]*?setupHistory\(globalHistoryData\);\s*\}\s*\}/;

const newLoadHistoryImplementation = `async function loadHistoryData() {
      let apiSucceeded = false;
      let loadedFrom = 'none';

      // 1. Intentar endpoint dinámico /api/metrics o estático /api/metrics.json (Vercel & Local)
      try {
        let apiRes = await fetch('./api/metrics?t=' + Date.now());
        if (!apiRes.ok) {
          apiRes = await fetch('./api/metrics.json?t=' + Date.now());
        }
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          if (apiData && apiData.status === 'ok' && apiData.summary && apiData.summary.total_bets >= 20) {
            globalHistoryData = {
              summary: apiData.summary,
              apiMetrics: apiData
            };
            apiSucceeded = true;
            loadedFrom = 'api';
          }
        }
      } catch (e) {
        console.warn('API /api/metrics no disponible directamente:', e.message);
      }

      // 2. Cargar historial_picks.json para la lista detallada
      try {
        const histRes = await fetch('./historial_picks.json?t=' + Date.now());
        if (histRes.ok) {
          const histData = await histRes.json();
          if (histData && (histData.picks || histData.history)) {
            if (!globalHistoryData) globalHistoryData = {};
            globalHistoryData.picks = histData.picks || histData.history;
            globalHistoryData.history = histData.picks || histData.history;
            if (!globalHistoryData.summary) globalHistoryData.summary = histData.summary;
            if (loadedFrom === 'none') loadedFrom = 'file';
          }
        }
      } catch (err) {
        console.warn('Fallo fetch historial_picks.json:', err.message);
      }

      // 3. Fallback embebido únicamente si la red falló completamente
      if (!globalHistoryData || !globalHistoryData.summary) {
        if (typeof window !== 'undefined' && window.EMBEDDED_HISTORY_DATA) {
          globalHistoryData = window.EMBEDDED_HISTORY_DATA;
          loadedFrom = 'embedded';
        }
      }

      // 4. Actualizar distintivo visual según la fuente real
      const liveEl = document.getElementById('statsLiveStatus');
      if (liveEl) {
        if (loadedFrom === 'api') {
          const timeStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
          liveEl.innerHTML = '🟢 API Sincronizada (' + timeStr + ')';
          liveEl.style.color = '#4ade80';
          liveEl.style.borderColor = 'rgba(74, 222, 128, 0.3)';
        } else if (loadedFrom === 'file') {
          liveEl.innerHTML = '🟡 Historial Local (Auditado)';
          liveEl.style.color = '#facc15';
          liveEl.style.borderColor = 'rgba(250, 204, 21, 0.3)';
        } else {
          liveEl.innerHTML = '⚪ Respaldo Offline (Embebido)';
          liveEl.style.color = '#94a3b8';
          liveEl.style.borderColor = 'rgba(148, 163, 184, 0.3)';
        }
      }

      setupHistory(globalHistoryData);
    }`;

html = html.replace(oldLoadHistorySearch, newLoadHistoryImplementation);

fs.writeFileSync(indexPath, html, 'utf8');
fs.writeFileSync(dashboardPath, html, 'utf8');
console.log('✅ index.html y dashboard.html actualizados con Universos y control de API de producción.');
