const fs = require('fs');
const path = require('path');

function updateHtmlFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Agregar CSS para badge-date-pill si no existe
  if (!content.includes('.badge-date-pill')) {
    const cssTarget = '.status-pill {';
    const cssAddition = `
    .badge-date-pill {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      display: inline-block;
    }
    .badge-date-pill.pill-today {
      background: rgba(56, 189, 248, 0.18);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }
    .badge-date-pill.pill-yesterday {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.3);
    }
`;
    content = content.replace(cssTarget, cssAddition + '\n    ' + cssTarget);
  }

  // 2. Agregar el select #filterDate en la barra de controles
  if (!content.includes('id="filterDate"')) {
    const filterLeagueTarget = '<select id="filterLeague"';
    const dateSelectHtml = `<select id="filterDate" class="select-control" autocomplete="off" onchange="onDateChange()">
            <option value="today" selected>📅 Hoy (20 Nov)</option>
            <option value="yesterday">📅 Ayer (19 Nov)</option>
            <option value="all">📅 Todas las Fechas</option>
          </select>

          <select id="filterLeague"`;
    content = content.replace(filterLeagueTarget, dateSelectHtml);
  }

  // 3. Agregar helper getPickDateKey y onDateChange antes de populatePicksFilters
  if (!content.includes('function getPickDateKey(')) {
    const populateTarget = 'function populatePicksFilters(picks) {';
    const helpersHtml = `function getPickDateKey(p) {
      if (!p) return '2026-11-19';
      if (p.date && /^\\d{4}-\\d{2}-\\d{2}/.test(p.date)) return p.date.slice(0, 10);
      if (p.time) {
        if (p.time.includes('20 Nov')) return '2026-11-20';
        if (p.time.includes('19 Nov')) return '2026-11-19';
      }
      if (p.risk_verdict && p.risk_verdict.decidedAt) {
        return p.risk_verdict.decidedAt.slice(0, 10);
      }
      if (p.createdAt) {
        return p.createdAt.slice(0, 10);
      }
      return '2026-11-19';
    }

    function onDateChange() {
      const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const availablePicks = (!globalPicksData || !globalPicksData.top_picks) ? [] : globalPicksData.top_picks;

      let picksForDate = availablePicks;
      if (dateFilter === 'today') {
        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-20');
      } else if (dateFilter === 'yesterday') {
        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-19');
      }

      populatePicksFilters(picksForDate);
      renderPicks();
    }

    function populatePicksFilters(picks) {`;
    content = content.replace(populateTarget, helpersHtml);
  }

  // 4. Modificar onLeagueChange para considerar la fecha seleccionada
  const oldOnLeague = `    function onLeagueChange() {
      const leagueFilter = document.getElementById('filterLeague').value;
      const matchSelect = document.getElementById('filterMatch');
      const availablePicks = (!globalPicksData || !globalPicksData.top_picks) ? [] : globalPicksData.top_picks;

      const filteredByLeague = (leagueFilter === 'all') 
        ? availablePicks 
        : availablePicks.filter(p => p.league === leagueFilter);`;

  const newOnLeague = `    function onLeagueChange() {
      const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const leagueFilter = document.getElementById('filterLeague').value;
      const matchSelect = document.getElementById('filterMatch');
      const availablePicks = (!globalPicksData || !globalPicksData.top_picks) ? [] : globalPicksData.top_picks;

      let filtered = availablePicks;
      if (dateFilter === 'today') {
        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-20');
      } else if (dateFilter === 'yesterday') {
        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-19');
      }
      const filteredByLeague = (leagueFilter === 'all') 
        ? filtered 
        : filtered.filter(p => p.league === leagueFilter);`;

  if (content.includes(oldOnLeague)) {
    content = content.replace(oldOnLeague, newOnLeague);
  }

  // 5. Modificar renderPicks para filtrar por fecha y actualizar chips
  const oldFilterStart = `      const leagueFilter = document.getElementById('filterLeague').value;
      const matchFilter = document.getElementById('filterMatch').value;
      const marketFilter = document.getElementById('filterMarket').value;
      const minHitFilter = parseFloat(document.getElementById('filterMinHit').value);
      const searchFilter = document.getElementById('searchInput').value.toLowerCase().trim();
      const statusFilter = document.getElementById('filterStatus')?.value || 'all';

      let filtered = globalPicksData.top_picks.filter(pick => {
        if (leagueFilter !== 'all' && pick.league !== leagueFilter) return false;`;

  const newFilterStart = `      const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const leagueFilter = document.getElementById('filterLeague')?.value || 'all';
      const matchFilter = document.getElementById('filterMatch')?.value || 'all';
      const marketFilter = document.getElementById('filterMarket')?.value || 'all';
      const minHitFilter = parseFloat(document.getElementById('filterMinHit')?.value || '0');
      const searchFilter = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
      const statusFilter = document.getElementById('filterStatus')?.value || 'all';

      let filtered = globalPicksData.top_picks.filter(pick => {
        const pickDate = getPickDateKey(pick);
        if (dateFilter === 'today' && pickDate !== '2026-11-20') return false;
        if (dateFilter === 'yesterday' && pickDate !== '2026-11-19') return false;

        if (leagueFilter !== 'all' && pick.league !== leagueFilter) return false;`;

  if (content.includes(oldFilterStart)) {
    content = content.replace(oldFilterStart, newFilterStart);
  }

  // 6. Inyectar actualización de chips en renderPicks antes del ordenamiento
  const sortTarget = '      filtered.sort((a, b) => {';
  const chipSyncCode = `      // Sincronizar métricas del tablero con la fecha activa
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      const activeApproved = filtered.filter(p => p.status === 'APROBADO').length;
      const activePending = filtered.filter(p => p.status && p.status.includes('PENDIENTE')).length;
      const activeEvs = filtered.map(p => parseFloat(p.edge_pct || p.ev_pct || 0)).filter(n => !isNaN(n));
      const activeAvgEv = activeEvs.length ? (activeEvs.reduce((a, b) => a + b, 0) / activeEvs.length).toFixed(1) : '0.0';

      setEl('chipCandidates', filtered.length);
      setEl('chipApproved', activeApproved);
      setEl('chipPending', activePending);
      setEl('chipAvgEv', '+' + activeAvgEv + '%');
      setEl('tabPicksCount', filtered.length);
      setEl('mTabPicksCount', filtered.length);

      filtered.sort((a, b) => {`;

  if (!content.includes('activeAvgEv') && content.includes(sortTarget)) {
    content = content.replace(sortTarget, chipSyncCode);
  }

  // 7. Agregar badge de fecha en la celda de partido de la tabla
  const oldMatchCell = `              <td>
                <div class="board-match-cell">
                  <span class="board-match-league">\${flag} \${pick.league || 'Competición'}</span>
                  <span class="board-match-teams">\${pick.match}</span>
                </div>
              </td>`;

  const newMatchCell = `              <td>
                <div class="board-match-cell">
                  <div style="display:flex; align-items:center; gap: 6px;">
                    <span class="board-match-league">\${flag} \${pick.league || 'Competición'}</span>
                    <span class="badge-date-pill \${getPickDateKey(pick) === '2026-11-20' ? 'pill-today' : 'pill-yesterday'}">\${getPickDateKey(pick) === '2026-11-20' ? 'Hoy' : 'Ayer'}</span>
                  </div>
                  <span class="board-match-teams">\${pick.match}</span>
                </div>
              </td>`;

  if (content.includes(oldMatchCell)) {
    content = content.replace(oldMatchCell, newMatchCell);
  }

  // 8. Actualizar setupPicks para llamar a onDateChange
  const oldSetupPicks = `    function setupPicks(data) {
      if (!data) return;
      globalPicksData = data;
      updateTopMetrics(data);
      if (typeof populatePicksFilters === 'function') {
        populatePicksFilters(data.top_picks || []);
      }`;

  const newSetupPicks = `    function setupPicks(data) {
      if (!data) return;
      globalPicksData = data;
      if (typeof onDateChange === 'function') {
        onDateChange();
      } else {
        updateTopMetrics(data);
        if (typeof populatePicksFilters === 'function') {
          populatePicksFilters(data.top_picks || []);
        }
      }`;

  if (content.includes(oldSetupPicks)) {
    content = content.replace(oldSetupPicks, newSetupPicks);
  }

  // 9. Actualizar resetMobileFilters para preservar 'today'
  const oldReset = `    function resetMobileFilters() {
      if (document.getElementById('filterLeague')) document.getElementById('filterLeague').value = 'all';`;
  const newReset = `    function resetMobileFilters() {
      if (document.getElementById('filterDate')) document.getElementById('filterDate').value = 'today';
      if (document.getElementById('filterLeague')) document.getElementById('filterLeague').value = 'all';`;

  if (content.includes(oldReset) && !content.includes("document.getElementById('filterDate').value = 'today'")) {
    content = content.replace(oldReset, newReset);
  }

  // 10. Actualizar window.EMBEDDED_PICKS_DATA
  const picksData = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
  const embeddedTag = 'window.EMBEDDED_PICKS_DATA = ';
  const startIdx = content.indexOf(embeddedTag);
  if (startIdx !== -1) {
    const endIdx = content.indexOf(';\n', startIdx);
    if (endIdx !== -1) {
      content = content.slice(0, startIdx + embeddedTag.length) + JSON.stringify(picksData) + content.slice(endIdx);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[Success] Actualizado: ${filePath}`);
}

updateHtmlFile('dashboard.html');
updateHtmlFile('index.html');
