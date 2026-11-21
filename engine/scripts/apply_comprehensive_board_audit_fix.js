const fs = require('fs');

function applyComprehensiveFix(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Añadir botón desktop Limpiar en la barra de controles si no existe
  if (!content.includes('id="btnResetDesktop"')) {
    const targetGroup = '<button class="view-toggle-btn" id="btnViewCards" onclick="toggleViewMode(\'cards\')">🗂️ Tarjetas</button>';
    const clearBtnHtml = `<button class="view-toggle-btn" id="btnViewCards" onclick="toggleViewMode('cards')">🗂️ Tarjetas</button>
          <button class="btn-clear-filters" id="btnResetDesktop" onclick="resetPicksFilters()" title="Restablecer todos los filtros" style="padding: 0.45rem 0.85rem; font-size: 12px; background: rgba(255,255,255,0.06); border: 1px solid var(--border-terminal); border-radius: var(--radius-xs); color: var(--text-dim); cursor: pointer; transition: all 0.2s;">🔄 Limpiar</button>`;
    content = content.replace(targetGroup, clearBtnHtml);
  }

  // 2. Actualizar helper getPickDateKey para que sea estricto con la fecha local de evento
  content = content.replace(
    /function getPickDateKey\(p\)\s*\{[\s\S]*?return '2026-11-19';\s*\}/,
    `function getPickDateKey(p) {
      if (!p) return '2026-11-19';
      if (p.eventDateLocal && /^\\d{4}-\\d{2}-\\d{2}$/.test(p.eventDateLocal)) {
        return p.eventDateLocal;
      }
      if (p.date && /^\\d{4}-\\d{2}-\\d{2}$/.test(p.date)) {
        return p.date.slice(0, 10);
      }
      if (typeof p.time === 'string') {
        if (p.time.includes('20 Nov')) return '2026-11-20';
        if (p.time.includes('19 Nov')) return '2026-11-19';
      }
      if (p.eventDate) {
        return String(p.eventDate).slice(0, 10);
      }
      return '2026-11-19';
    }`
  );

  // 3. Actualizar onDateChange para sincronizar filtros dependientes
  content = content.replace(
    /function onDateChange\(\)\s*\{[\s\S]*?renderPicks\(\);\s*\}/,
    `function onDateChange() {
      const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const availablePicks = (!globalPicksData || !globalPicksData.top_picks) ? [] : globalPicksData.top_picks;

      let picksForDate = availablePicks;
      if (dateFilter === 'today') {
        picksForDate = availablePicks.filter(p => (p.eventDateLocal || getPickDateKey(p)) === '2026-11-20');
      } else if (dateFilter === 'yesterday') {
        picksForDate = availablePicks.filter(p => (p.eventDateLocal || getPickDateKey(p)) === '2026-11-19');
      }

      // Al cambiar fecha, reiniciar selección de liga y partido
      if (document.getElementById('filterLeague')) document.getElementById('filterLeague').value = 'all';
      if (document.getElementById('filterMatch')) document.getElementById('filterMatch').value = 'all';

      populatePicksFilters(picksForDate);
      renderPicks();
    }`
  );

  // 4. Implementar resetPicksFilters
  if (!content.includes('function resetPicksFilters(')) {
    const injectPoint = 'function resetMobileFilters() {';
    const resetFn = `function resetPicksFilters() {
      if (document.getElementById('filterDate')) document.getElementById('filterDate').value = 'today';
      if (document.getElementById('filterLeague')) document.getElementById('filterLeague').value = 'all';
      if (document.getElementById('filterMatch')) document.getElementById('filterMatch').value = 'all';
      if (document.getElementById('filterMarket')) document.getElementById('filterMarket').value = 'all';
      if (document.getElementById('filterMinHit')) document.getElementById('filterMinHit').value = '0';
      if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = 'all';
      if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
      if (typeof onDateChange === 'function') {
        onDateChange();
      } else {
        renderPicks();
      }
    }

    `;
    content = content.replace(injectPoint, resetFn + injectPoint);
  }

  // 5. Actualizar resetMobileFilters para delegar en resetPicksFilters
  content = content.replace(
    /function resetMobileFilters\(\)\s*\{[\s\S]*?applyMobileFilters\(\);\s*\}/,
    `function resetMobileFilters() {
      resetPicksFilters();
      applyMobileFilters();
    }`
  );

  // 6. Actualizar renderPicks: filtrado acumulativo exacto y actualización de métricas
  content = content.replace(
    /const dateFilter = document\.getElementById\('filterDate'\)\?\.value \|\| 'today';[\s\S]*?let filtered = globalPicksData\.top_picks\.filter\(pick => \{[\s\S]*?return true;\s*\}\);/,
    `const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const leagueFilter = document.getElementById('filterLeague')?.value || 'all';
      const matchFilter = document.getElementById('filterMatch')?.value || 'all';
      const marketFilter = document.getElementById('filterMarket')?.value || 'all';
      const minHitFilter = parseFloat(document.getElementById('filterMinHit')?.value || '0');
      const searchFilter = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
      const statusFilter = document.getElementById('filterStatus')?.value || 'all';

      let filtered = globalPicksData.top_picks.filter(pick => {
        // 1. FILTRADO ESTRICTO POR FECHA DE EVENTO (America/Argentina/Buenos_Aires)
        const pickDate = pick.eventDateLocal || getPickDateKey(pick);
        if (dateFilter === 'today' && pickDate !== '2026-11-20') return false;
        if (dateFilter === 'yesterday' && pickDate !== '2026-11-19') return false;

        // 2. FILTRADO POR COMPETICIÓN / LIGA
        if (leagueFilter !== 'all' && pick.league !== leagueFilter) return false;

        // 3. FILTRADO POR PARTIDO
        if (matchFilter !== 'all' && pick.match !== matchFilter) return false;

        // 4. FILTRADO POR MERCADO
        if (marketFilter !== 'all' && pick.market !== marketFilter) return false;

        // 5. FILTRADO POR ESTADO
        if (statusFilter !== 'all') {
          if (statusFilter === 'APROBADO' && pick.status !== 'APROBADO' && pick.status !== 'ACERTADA') return false;
          if (statusFilter === 'PENDIENTE') {
            const isStillPending = (pick.status === 'PENDIENTE' || pick.status === 'PENDIENTE_ALINEACION') && !pick.is_finished;
            if (!isStillPending) return false;
          }
          if (statusFilter === 'FINALIZADO') {
            const isDone = pick.is_finished || ['ACERTADA','FALLADA','FINALIZADO','ANULADA_NO_TITULAR'].includes(pick.status);
            if (!isDone) return false;
          }
        }

        // 6. FILTRADO POR EFECTIVIDAD L5
        let hitRateNum = 0;
        if (pick.hit_rate_l5) {
          const match = pick.hit_rate_l5.match(/(\\d+)%/);
          if (match) hitRateNum = parseFloat(match[1]);
        }
        if (hitRateNum < minHitFilter) return false;

        // 7. BÚSQUEDA DE TEXTO EN VIVO
        if (searchFilter) {
          const searchSpace = \`\${pick.player} \${pick.team} \${pick.opponent} \${pick.match} \${pick.market} \${pick.line} \${pick.league}\`.toLowerCase();
          if (!searchSpace.includes(searchFilter)) return false;
        }

        return true;
      });`
  );

  // 7. Actualizar los contadores superiores para que coincidan con filtered
  content = content.replace(
    /\/\/ Sincronizar métricas del tablero con la fecha activa[\s\S]*?setEl\('mTabPicksCount', filtered\.length\);/,
    `// Sincronizar métricas del tablero con los filtros activos
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      const activeApproved = filtered.filter(p => p.status === 'APROBADO' || p.status === 'ACERTADA').length;
      const activePending = filtered.filter(p => (p.status === 'PENDIENTE' || p.status === 'PENDIENTE_ALINEACION') && !p.is_finished).length;
      const activeEvs = filtered.map(p => parseFloat(p.edge_pct || p.ev_pct || 0)).filter(n => !isNaN(n));
      const activeAvgEv = activeEvs.length ? (activeEvs.reduce((a, b) => a + b, 0) / activeEvs.length).toFixed(1) : '0.0';

      setEl('chipCandidates', filtered.length);
      setEl('chipApproved', activeApproved);
      setEl('chipPending', activePending);
      setEl('chipAvgEv', '+' + activeAvgEv + '%');
      setEl('tabPicksCount', filtered.length);
      setEl('mTabPicksCount', filtered.length);`
  );

  // 8. Inyectar datos embebidos actualizados de picks_hoy.json
  const picksData = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
  const tag = 'window.EMBEDDED_PICKS_DATA = ';
  const start = content.indexOf(tag);
  if (start !== -1) {
    const end = content.indexOf(';\n', start);
    if (end !== -1) {
      content = content.slice(0, start + tag.length) + JSON.stringify(picksData) + content.slice(end);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[Success] Actualizado: ${filePath}`);
}

applyComprehensiveFix('dashboard.html');
applyComprehensiveFix('index.html');
