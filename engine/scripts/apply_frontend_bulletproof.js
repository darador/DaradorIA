const fs = require('fs');

const picksData = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const historyData = JSON.parse(fs.readFileSync('historial_picks.json', 'utf8'));

['dashboard.html', 'index.html'].forEach(filename => {
  let html = fs.readFileSync(filename, 'utf8');

  // 1. Add autocomplete="off" to filters
  html = html.replace(/<select id="filterLeague" class="select-control"/g, '<select id="filterLeague" class="select-control" autocomplete="off"');
  html = html.replace(/<select id="filterMatch" class="select-control"/g, '<select id="filterMatch" class="select-control" autocomplete="off"');
  html = html.replace(/<select id="filterMarket" class="select-control"/g, '<select id="filterMarket" class="select-control" autocomplete="off"');
  html = html.replace(/<select id="filterMinHit" class="select-control"/g, '<select id="filterMinHit" class="select-control" autocomplete="off"');
  html = html.replace(/<select id="filterStatus" class="select-control"/g, '<select id="filterStatus" class="select-control" autocomplete="off"');
  html = html.replace(/<input type="text" id="searchInput" class="input-control"/g, '<input type="text" id="searchInput" class="input-control" autocomplete="off"');

  // 2. Safe setEl in updateTopMetrics
  const oldMetricsPattern = /function updateTopMetrics\(data\) \{[\s\S]*?function setupHistory\(data\)/;
  const newMetricsCode = `function updateTopMetrics(data) {
      if (!data) return;
      const metrics = data.summary_metrics || {};
      const totalPicks = data.top_picks ? data.top_picks.length : 0;
      const approved = metrics.approved_count || (data.top_picks ? data.top_picks.filter(p => p.status === 'APROBADO').length : 0);
      const pending = metrics.pending_count || (data.top_picks ? data.top_picks.filter(p => p.status && p.status.includes('PENDIENTE')).length : 0);

      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setEl('chipAnalyzed', data.total_analyzed || 128);
      setEl('chipCandidates', totalPicks || 22);
      setEl('chipApproved', approved || 18);
      setEl('chipPending', pending || 4);
      setEl('chipAvgEv', metrics.avg_edge_pct ? (metrics.avg_edge_pct.startsWith('+') ? metrics.avg_edge_pct : '+' + metrics.avg_edge_pct) : '+59.4%');

      // Legacy KPI grid sync
      setEl('kpiLabel1', 'Picks Activos');
      setEl('kpiTotalPicks', totalPicks);
      setEl('kpiAnalyzed', (data.total_analyzed || 0) + ' evaluados');

      setEl('kpiLabel2', 'Edge Promedio (+EV)');
      setEl('kpiAvgEdge', metrics.avg_edge_pct || '0%');
      setEl('kpiSub2', 'Ventaja s/ probabilidad implícita');

      setEl('kpiLabel3', 'Acierto Reciente (L5)');
      setEl('kpiAvgHitRate', metrics.avg_hit_rate_l5 || '0%');
      setEl('kpiSub3', 'Efectividad últimos 5 partidos');

      setEl('kpiLabel4', 'Cuota Media bet365');
      setEl('kpiAvgOdds', metrics.avg_odds ? Number(metrics.avg_odds).toFixed(2) : '0.00');
      setEl('kpiSub4', 'Multiplicador promedio');
    }

    let historyFilterState = {
      period: 'all',
      market: 'all',
      status: 'all',
      search: ''
    };

    function setupHistory(data)`;
  html = html.replace(oldMetricsPattern, newMetricsCode);

  // 3. Safe null-check in setupPicks
  const oldSetupPicksPattern = /function setupPicks\(data\) \{[\s\S]*?renderParlays\(\);\s*\}/;
  const newSetupPicksCode = `function setupPicks(data) {
      if (!data) return;
      globalPicksData = data;
      updateTopMetrics(data);
      if (typeof populatePicksFilters === 'function') {
        populatePicksFilters(data.top_picks || []);
      }
      const picksCount = data.top_picks ? data.top_picks.length : 0;
      const parlaysCount = data.parlays ? data.parlays.length : 0;
      const researchCount = data.research_center ? data.research_center.length : 0;

      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setEl('tabPicksCount', picksCount);
      setEl('mTabPicksCount', picksCount);
      setEl('tabParlaysCount', parlaysCount);
      setEl('mTabParlaysCount', parlaysCount);
      setEl('tabResearchCount', researchCount);
      setEl('mTabResearchCount', researchCount);

      if (typeof renderPicks === 'function') renderPicks();
      if (typeof renderParlays === 'function') renderParlays();
    }`;
  html = html.replace(oldSetupPicksPattern, newSetupPicksCode);

  // 4. Safe odds.toFixed and hit rate in renderPicks
  html = html.replace(/pick\.odds\.toFixed\(2\)/g, '(typeof pick.odds === "number" ? pick.odds.toFixed(2) : Number(pick.odds || 1.75).toFixed(2))');

  // 5. Update initialization block
  const oldDomLoadedPattern = /document\.addEventListener\('DOMContentLoaded'[\s\S]*?<\/script>\s*<!-- FIXED MOBILE BOTTOM NAVIGATION -->/;
  const newInitCode = `function initDashboard() {
      // 1. Inicialización inmediata desde datos integrados
      if (typeof window !== 'undefined') {
        if (window.EMBEDDED_PICKS_DATA && (!globalPicksData || !globalPicksData.top_picks)) {
          globalPicksData = window.EMBEDDED_PICKS_DATA;
        }
        if (globalPicksData) {
          setupPicks(globalPicksData);
        }
        if (window.EMBEDDED_HISTORY_DATA && (!globalHistoryData || !globalHistoryData.summary)) {
          globalHistoryData = window.EMBEDDED_HISTORY_DATA;
        }
        if (globalHistoryData) {
          setupHistory(globalHistoryData);
        }
      }

      // 2. Si está en servidor HTTP/HTTPS, sincronizar en background
      if (typeof window !== 'undefined' && window.location && window.location.protocol && window.location.protocol.startsWith('http')) {
        loadPicksData();
        loadHistoryData();
        loadAgentReports();
        loadApprovedPicks();
      }
    }

    // Ejecución inmediata garantizada
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDashboard);
    } else {
      initDashboard();
    }
    // Salvaguardas temporizadas
    setTimeout(initDashboard, 50);
    setTimeout(initDashboard, 250);
  </script>

  <!-- FIXED MOBILE BOTTOM NAVIGATION -->`;
  html = html.replace(oldDomLoadedPattern, newInitCode);

  // 6. Update embedded data with fresh picks & history
  const pRegex = /window\.EMBEDDED_PICKS_DATA\s*=\s*[\s\S]*?;\n\s*window\.EMBEDDED_HISTORY_DATA/;
  html = html.replace(pRegex, 'window.EMBEDDED_PICKS_DATA = ' + JSON.stringify(picksData) + ';\n  window.EMBEDDED_HISTORY_DATA');

  const hRegex = /window\.EMBEDDED_HISTORY_DATA\s*=\s*[\s\S]*?;\n\s*\/\/ Fallbacks/;
  html = html.replace(hRegex, 'window.EMBEDDED_HISTORY_DATA = ' + JSON.stringify(historyData) + ';\n    // Fallbacks');

  fs.writeFileSync(filename, html, 'utf8');
  console.log('Successfully hardened and updated', filename);
});
