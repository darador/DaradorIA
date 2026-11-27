const fs = require('fs');
const path = require('path');

const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const historial = JSON.parse(fs.readFileSync('historial_picks.json', 'utf8'));

const files = ['dashboard.html', 'index.html'];

files.forEach(f => {
  if (!fs.existsSync(f)) return;
  let content = fs.readFileSync(f, 'utf8');

  // 1. Reemplazar window.EMBEDDED_PICKS_DATA
  const picksMarker = 'window.EMBEDDED_PICKS_DATA = ';
  const pIdx = content.indexOf(picksMarker);
  if (pIdx !== -1) {
    const pEnd = content.indexOf(';\n', pIdx) !== -1 ? content.indexOf(';\n', pIdx) : content.indexOf(';\r\n', pIdx);
    if (pEnd !== -1) {
      content = content.slice(0, pIdx + picksMarker.length) + JSON.stringify(picksHoy) + content.slice(pEnd);
      console.log(`[${f}] window.EMBEDDED_PICKS_DATA actualizado`);
    }
  }

  // 2. Reemplazar window.EMBEDDED_HISTORY_DATA si existe
  const histMarker = 'window.EMBEDDED_HISTORY_DATA = ';
  const hIdx = content.indexOf(histMarker);
  if (hIdx !== -1) {
    const hEnd = content.indexOf(';\n', hIdx) !== -1 ? content.indexOf(';\n', hIdx) : content.indexOf(';\r\n', hIdx);
    if (hEnd !== -1) {
      content = content.slice(0, hIdx + histMarker.length) + JSON.stringify(historial) + content.slice(hEnd);
      console.log(`[${f}] window.EMBEDDED_HISTORY_DATA actualizado`);
    }
  }

  fs.writeFileSync(f, content, 'utf8');
});

// 3. Actualizar api/metrics.json si existe
const metricsPath = 'api/metrics.json';
if (fs.existsSync(metricsPath)) {
  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  metrics.summary = historial.summary;
  metrics.totalTrackedPicks = (historial.picks || []).length;
  metrics.updatedAt = new Date().toISOString();
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');
  console.log('[api/metrics.json] Métricas actualizadas');
}
