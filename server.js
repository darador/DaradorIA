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
  console.log(`======================================================\n`);
});
