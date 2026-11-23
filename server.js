const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];

  // API de salud rápida
  if (reqPath === '/api/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache'
    });
    let picksCount = 0;
    try {
      const picks = JSON.parse(fs.readFileSync(path.join(__dirname, 'picks_hoy.json'), 'utf8'));
      picksCount = picks.top_picks ? picks.top_picks.length : 0;
    } catch (e) {}
    res.end(JSON.stringify({ status: 'ok', serverTime: new Date().toISOString(), activePicks: picksCount }));
    return;
  }

  // API de Scheduler Central (Fase 13: Automatización del Motor)
  if (reqPath.startsWith('/api/scheduler/')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });

    try {
      const centralScheduler = require('./engine/scheduler/centralScheduler');
      const action = reqPath.replace('/api/scheduler/', '');

      if (action === 'status') {
        res.end(JSON.stringify({ status: 'ok', data: centralScheduler.getState() }, null, 2));
      } else if (action === 'start') {
        const result = centralScheduler.startDaemon();
        res.end(JSON.stringify({ status: 'ok', action: 'start', result }, null, 2));
      } else if (action === 'stop') {
        const result = centralScheduler.stopDaemon();
        res.end(JSON.stringify({ status: 'ok', action: 'stop', result }, null, 2));
      } else if (action === 'trigger') {
        const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
        const task = urlParams.get('task') || 'pipeline';
        if (task === 'discovery') {
          centralScheduler.runDiscoveryJob().then(r => console.log('[API Trigger] Discovery completado:', r));
        } else if (task === 'pipeline') {
          centralScheduler.runPipelineJob().then(r => console.log('[API Trigger] Pipeline completado:', r));
        } else if (task === 'lineups') {
          centralScheduler.runLineupsJob().then(r => console.log('[API Trigger] Lineups completado:', r));
        } else if (task === 'settlement') {
          centralScheduler.runSettlementJob().then(r => console.log('[API Trigger] Settlement completado:', r));
        }
        res.end(JSON.stringify({ status: 'ok', message: `Tarea '${task}' iniciada en segundo plano.` }));
      } else {
        res.end(JSON.stringify({ status: 'ok', data: centralScheduler.getState() }, null, 2));
      }
    } catch (schedErr) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: schedErr.message }));
    }
    return;
  }

  // API de monitoreo operativo de procesos y frecuencias
  if (reqPath === '/api/system/processes' || reqPath === '/api/processes' || reqPath === '/api/processes.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    try {
      const processMonitor = require('./engine/scheduler/processMonitor');
      const report = processMonitor.auditProcesses();
      res.end(JSON.stringify(report, null, 2));
    } catch (err) {
      const fallbackFile = path.join(__dirname, 'api/processes.json');
      if (fs.existsSync(fallbackFile)) {
        res.end(fs.readFileSync(fallbackFile, 'utf8'));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    }
    return;
  }

  // API de métricas dinámicas y evaluación
  if (reqPath === '/api/metrics' || reqPath === '/api/metrics.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    try {
      const staticMetricsPath = path.join(__dirname, 'api/metrics.json');
      if (fs.existsSync(staticMetricsPath)) {
        const staticData = fs.readFileSync(staticMetricsPath, 'utf8');
        res.end(staticData);
        return;
      }

      const evaluator = require('./engine/evaluation/evaluator');
      const evalMetrics = evaluator.evaluatePerformance();
      let historySummary = null;
      let totalPicksInHistory = 0;
      try {
        const histRaw = fs.readFileSync(path.join(__dirname, 'historial_picks.json'), 'utf8');
        const history = JSON.parse(histRaw);
        historySummary = history.summary || null;
        totalPicksInHistory = history.picks ? history.picks.length : (history.history ? history.history.length : 0);
      } catch (e) {}

      res.end(JSON.stringify({
        status: 'ok',
        updatedAt: new Date().toISOString(),
        totalTrackedPicks: totalPicksInHistory,
        summary: historySummary,
        evaluation: evalMetrics
      }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  if (reqPath === '/' || reqPath === '') reqPath = '/dashboard.html';

  const filePath = path.join(__dirname, reqPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Archivo no encontrado: ' + reqPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(data);
  });
});

server.on('error', (e) => {
  console.error('[Server Error]', e.message);
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ Servidor DaradorIA / DaradorBET Activo`);
  console.log(`🌐 Acceso local: http://localhost:${PORT}/dashboard.html`);
  console.log(`🌐 Acceso IP:    http://127.0.0.1:${PORT}/dashboard.html`);
  console.log(`📡 Salud API:    http://localhost:${PORT}/api/health`);
  console.log(`📡 Scheduler:    http://localhost:${PORT}/api/scheduler/status`);
  console.log(`======================================================\n`);

  if (process.env.AUTO_START_DAEMON !== 'false') {
    try {
      const centralScheduler = require('./engine/scheduler/centralScheduler');
      centralScheduler.startDaemon();
    } catch (e) {
      console.warn('[Server] No se pudo iniciar el scheduler automáticamente:', e.message);
    }
  }
});
