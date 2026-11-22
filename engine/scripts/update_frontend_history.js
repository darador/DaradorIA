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

// 1. Reemplazar window.EMBEDDED_HISTORY_DATA
const marker = 'window.EMBEDDED_HISTORY_DATA =';
const markerIdx = html.indexOf(marker);
if (markerIdx === -1) {
  console.error('Marker window.EMBEDDED_HISTORY_DATA not found');
  process.exit(1);
}
const lineEnd = html.indexOf('\n', markerIdx);
const before = html.slice(0, markerIdx);
const after = html.slice(lineEnd);
html = before + embeddedHistoryStr + after;

// 2. Agregar statsLiveStatus si no está presente
if (!html.includes('id="statsLiveStatus"')) {
  html = html.replace(
    '<span class="stats-sample-pill" id="statsHeaderSample">18 Apuestas Auditadas</span>',
    '<span class="stats-sample-pill" id="statsLiveStatus" style="font-size: 11px; color: #4ade80; border-color: rgba(74, 222, 128, 0.3);">🟢 En Línea</span>\n          <span class="stats-sample-pill" id="statsHeaderSample">20 Apuestas Auditadas</span>'
  );
}

// 3. Mejorar loadHistoryData() para consultar /api/metrics y manejar estado
const oldLoadHistory = `    async function loadHistoryData() {
      try {
        const response = await fetch('./historial_picks.json?t=' + Date.now());
        if (response.ok) {
          globalHistoryData = await response.json();
          setupHistory(globalHistoryData);
          return;
        }
      } catch (err) {
        console.warn('Fallo fetch de historial_picks.json (usando respaldo integrado):', err);
      }
      if (typeof window !== 'undefined' && window.EMBEDDED_HISTORY_DATA) {
        globalHistoryData = window.EMBEDDED_HISTORY_DATA;
        setupHistory(globalHistoryData);
      }
    }`;

const newLoadHistory = `    async function loadHistoryData() {
      try {
        const response = await fetch('./historial_picks.json?t=' + Date.now());
        if (response.ok) {
          globalHistoryData = await response.json();
          try {
            const apiRes = await fetch('./api/metrics?t=' + Date.now());
            if (apiRes.ok) {
              const apiData = await apiRes.json();
              if (apiData && apiData.summary) {
                globalHistoryData.apiMetrics = apiData;
                const liveEl = document.getElementById('statsLiveStatus');
                if (liveEl) {
                  const timeStr = new Date(apiData.updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                  liveEl.innerHTML = '🟢 API /api/metrics Sincronizada (' + timeStr + ')';
                }
              }
            }
          } catch (e) {
            const liveEl = document.getElementById('statsLiveStatus');
            if (liveEl) liveEl.innerHTML = '🟡 Historial Local';
          }
          setupHistory(globalHistoryData);
          return;
        }
      } catch (err) {
        console.warn('Fallo fetch de historial_picks.json (usando respaldo integrado):', err);
      }
      if (typeof window !== 'undefined' && window.EMBEDDED_HISTORY_DATA) {
        globalHistoryData = window.EMBEDDED_HISTORY_DATA;
        const liveEl = document.getElementById('statsLiveStatus');
        if (liveEl) liveEl.innerHTML = '⚪ Respaldo Offline';
        setupHistory(globalHistoryData);
      }
    }`;

if (html.includes(oldLoadHistory)) {
  html = html.replace(oldLoadHistory, newLoadHistory);
}

// 4. Asegurar soporte de ANULADA en el filtrado de historial
const oldFilterLogic = `        const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
        const isLost = b.status === 'PERDIDA' || b.status === 'FALLADA';

        if (isWon) {
          settled++;
          won++;
          staked += (b.stake || 1.0);
          profit += (b.profit || 0);
          byMarket[m].won++;
          byMarket[m].net_profit += (b.profit || 0);
        } else if (isLost) {
          settled++;
          lost++;
          staked += (b.stake || 1.0);
          profit += (b.profit || 0);
          byMarket[m].lost++;
          byMarket[m].net_profit += (b.profit || 0);
        } else {
          pending++;
        }`;

const newFilterLogic = `        const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
        const isLost = b.status === 'PERDIDA' || b.status === 'FALLADA';
        const isVoid = b.status === 'ANULADA' || b.status === 'VOID' || b.status === 'ANULADA_NO_TITULAR' || (b.status && b.status.startsWith('ANULADA'));

        if (isWon) {
          settled++;
          won++;
          staked += (b.stake || 1.0);
          profit += (b.profit || 0);
          byMarket[m].won++;
          byMarket[m].net_profit += (b.profit || 0);
        } else if (isLost) {
          settled++;
          lost++;
          staked += (b.stake || 1.0);
          profit += (b.profit || 0);
          byMarket[m].lost++;
          byMarket[m].net_profit += (b.profit || 0);
        } else if (isVoid) {
          // Anulada: stake devuelto, no incrementa riesgo ni cuenta como perdida/ganada
        } else {
          pending++;
        }`;

if (html.includes(oldFilterLogic)) {
  html = html.replace(oldFilterLogic, newFilterLogic);
}

fs.writeFileSync(indexPath, html, 'utf8');
fs.writeFileSync(dashboardPath, html, 'utf8');
console.log('✅ index.html y dashboard.html actualizados con éxito.');
