/**
 * Vercel Serverless Function - /api/metrics
 */
const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const rootDir = process.cwd();
    const historyPath = path.join(rootDir, 'historial_picks.json');
    const staticMetricsPath = path.join(rootDir, 'api/metrics.json');

    if (fs.existsSync(staticMetricsPath)) {
      const data = fs.readFileSync(staticMetricsPath, 'utf8');
      return res.status(200).send(data);
    }

    if (fs.existsSync(historyPath)) {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      return res.status(200).json({
        status: 'ok',
        updatedAt: history.updated_at || new Date().toISOString(),
        totalTrackedPicks: history.picks ? history.picks.length : 0,
        summary: history.summary || null
      });
    }

    res.status(200).json({ status: 'ok', message: 'No history found' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
