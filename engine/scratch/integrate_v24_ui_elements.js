const fs = require('fs');

['index.html', 'dashboard.html'].forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');
  const isCrlf = content.includes('\r\n');
  let text = content.replace(/\r\n/g, '\n');

  // 1. Inyectar Selector de Origen en el panel colapsable de filtros avanzados
  const targetFilter = `<div class="filter-item">
                <label class="filter-label">Competición</label>`;
  
  const originFilterHtml = `<div class="filter-item">
                <label class="filter-label" for="filterOrigin">Origen de Selección</label>
                <select id="filterOrigin" class="select-control" autocomplete="off" onchange="updateActiveFilterBadge(); renderPicks()">
                  <option value="all">Todos los Orígenes</option>
                  <option value="PRODUCTION">Producción</option>
                  <option value="EXPERIMENTAL_V24">🧪 Experimental V2.4</option>
                  <option value="SHADOW">🔭 Shadow Mode</option>
                </select>
              </div>
              <div class="filter-item">
                <label class="filter-label">Competición</label>`;

  if (text.includes(targetFilter) && !text.includes('id="filterOrigin"')) {
    text = text.replace(targetFilter, originFilterHtml);
    console.log('Filtro de origen inyectado en', filePath);
  }

  // 2. Inyectar Ticker Comparativo de Origen (Producción vs V2.4)
  const targetTicker = `<div class="kpis-ticker-inline">`;
  const tickerHtml = `<div class="kpis-ticker-inline">
          <div class="kpi-inline-item" data-tooltip="Picks de Producción aprobados" title="Picks de Producción">
            <span>🛡️</span>
            <strong id="chipProdCount">0</strong>
            <span>Prod</span>
          </div>
          <div class="kpi-inline-item" data-tooltip="Picks de Experimental V2.4 (EV >= +8%)" title="Picks Experimental V2.4">
            <span>🧪</span>
            <strong id="chipV24Count" style="color: #c084fc;">0</strong>
            <span>V2.4</span>
          </div>
          <div class="kpi-inline-item" data-tooltip="Picks en observación Shadow Mode" title="Picks Shadow Mode">
            <span>🔭</span>
            <strong id="chipShadowCount" style="color: #38bdf8;">0</strong>
            <span>Shadow</span>
          </div>`;

  if (text.includes(targetTicker) && !text.includes('id="chipV24Count"')) {
    text = text.replace(targetTicker, tickerHtml);
    console.log('Ticker comparativo de origen inyectado en', filePath);
  }

  // 3. Soporte en updateActiveFilterBadge
  const targetBadgeCode = `const searchFilter = document.getElementById('searchInput')?.value.trim() || '';`;
  const badgeCodeAdd = `const searchFilter = document.getElementById('searchInput')?.value.trim() || '';
      const originFilter = document.getElementById('filterOrigin')?.value || 'all';
      if (originFilter !== 'all') count++;`;

  if (text.includes(targetBadgeCode) && !text.includes('originFilter !== \'all\'')) {
    text = text.replace(targetBadgeCode, badgeCodeAdd);
    console.log('Badge logic actualizada en', filePath);
  }

  // 4. Soporte en filtered = validTopPicks.filter(...)
  const targetFilterLoop = `if (currentTimeHorizon === 'custom' && customSelectedDate && pickDate !== customSelectedDate) return false;`;
  const filterLoopAdd = `if (currentTimeHorizon === 'custom' && customSelectedDate && pickDate !== customSelectedDate) return false;

        const originFilter = document.getElementById('filterOrigin')?.value || 'all';
        if (originFilter !== 'all') {
          const pickOrigin = pick.origin || (pick.policy === 'EXPERIMENTAL_ODDS_V24' ? 'EXPERIMENTAL_V24' : ((pick.shadow_mode || pick.status === 'SHADOW_PASSIVE') ? 'SHADOW' : 'PRODUCTION'));
          if (pickOrigin !== originFilter) return false;
        }`;

  if (text.includes(targetFilterLoop) && !text.includes('pickOrigin !== originFilter')) {
    text = text.replace(targetFilterLoop, filterLoopAdd);
    console.log('Filtro de bucle actualizado en', filePath);
  }

  // 5. Soporte en chips / métricas de origen
  const targetChipUpdate = `setEl('chipAnalyzed', uniqueMatches);`;
  const chipUpdateAdd = `const prodPicks = filtered.filter(p => (p.origin === 'PRODUCTION' || (!p.policy && !p.shadow_mode && p.status !== 'SHADOW_PASSIVE')));
      const v24Picks = filtered.filter(p => (p.origin === 'EXPERIMENTAL_V24' || p.policy === 'EXPERIMENTAL_ODDS_V24'));
      const shadowPicks = filtered.filter(p => (p.origin === 'SHADOW' || p.shadow_mode || p.status === 'SHADOW_PASSIVE') && p.origin !== 'EXPERIMENTAL_V24');

      setEl('chipProdCount', prodPicks.length);
      setEl('chipV24Count', v24Picks.length);
      setEl('chipShadowCount', shadowPicks.length);

      setEl('chipAnalyzed', uniqueMatches);`;

  if (text.includes(targetChipUpdate) && !text.includes('setEl(\'chipV24Count\'')) {
    text = text.replace(targetChipUpdate, chipUpdateAdd);
    console.log('Cálculo de métricas segmentadas actualizado en', filePath);
  }

  // 6. Insignia en renderSingleRow
  const targetMarketBadge = `<span class="board-market-title">\${pick.market}</span>`;
  const marketBadgeAdd = `<span class="board-market-title">\${pick.market}</span>
                  \${(pick.origin === 'EXPERIMENTAL_V24' || pick.policy === 'EXPERIMENTAL_ODDS_V24') ? '<span class="sem-badge sem-purple" style="display:inline-block;margin-top:2px;font-size:0.65rem;" title="Oportunidad experimental evaluada bajo política V2.4">🧪 EXP V2.4</span>' : ''}`;

  if (text.includes(targetMarketBadge) && !text.includes('🧪 EXP V2.4')) {
    text = text.replace(targetMarketBadge, marketBadgeAdd);
    console.log('Insignia visual V2.4 inyectada en fila de', filePath);
  }

  // Guardar archivo
  fs.writeFileSync(filePath, isCrlf ? text.replace(/\n/g, '\r\n') : text, 'utf8');
});
console.log('Integración visual V2.4 completada en plantillas.');
