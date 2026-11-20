const fs = require('fs');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Asegurar que getPickDateKey esté presente
  if (!content.includes('function getPickDateKey(')) {
    const injectPoint = 'function populatePicksFilters(picks) {';
    const helperCode = `function getPickDateKey(p) {
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
    content = content.replace(injectPoint, helperCode);
  }

  // Corregir onLeagueChange para respetar la fecha activa
  content = content.replace(
    /function onLeagueChange\(\)\s*\{[\s\S]*?renderPicks\(\);\s*\}/,
    `function onLeagueChange() {
      const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const leagueFilter = document.getElementById('filterLeague')?.value || 'all';
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
        : filtered.filter(p => p.league === leagueFilter);

      const matches = [...new Set(filteredByLeague.map(p => p.match))].filter(Boolean);
      matchSelect.innerHTML = '<option value="all">Todos los Partidos</option>';
      matches.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        matchSelect.appendChild(opt);
      });

      renderPicks();
    }`
  );

  // Corregir el bloque de filtrado de renderPicks
  content = content.replace(
    /const leagueFilter = document\.getElementById\('filterLeague'\)\.value;[\s\S]*?let filtered = globalPicksData\.top_picks\.filter\(pick => \{[\s\S]*?return true;\s*\}\);/,
    `const dateFilter = document.getElementById('filterDate')?.value || 'today';
      const leagueFilter = document.getElementById('filterLeague')?.value || 'all';
      const matchFilter = document.getElementById('filterMatch')?.value || 'all';
      const marketFilter = document.getElementById('filterMarket')?.value || 'all';
      const minHitFilter = parseFloat(document.getElementById('filterMinHit')?.value || '0');
      const searchFilter = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
      const statusFilter = document.getElementById('filterStatus')?.value || 'all';

      let filtered = globalPicksData.top_picks.filter(pick => {
        // FILTRADO ESTRICTO POR FECHA
        const pickDate = getPickDateKey(pick);
        if (dateFilter === 'today' && pickDate !== '2026-11-20') return false;
        if (dateFilter === 'yesterday' && pickDate !== '2026-11-19') return false;

        if (leagueFilter !== 'all' && pick.league !== leagueFilter) return false;
        if (matchFilter !== 'all' && pick.match !== matchFilter) return false;
        if (marketFilter !== 'all' && pick.market !== marketFilter) return false;
        if (statusFilter !== 'all') {
          if (statusFilter === 'APROBADO' && pick.status !== 'APROBADO') return false;
          if (statusFilter === 'PENDIENTE' && (!pick.status || !pick.status.includes('PENDIENTE'))) return false;
        }

        let hitRateNum = 0;
        if (pick.hit_rate_l5) {
          const match = pick.hit_rate_l5.match(/(\\d+)%/);
          if (match) hitRateNum = parseFloat(match[1]);
        }
        if (hitRateNum < minHitFilter) return false;

        if (searchFilter) {
          const searchSpace = \`\${pick.player} \${pick.team} \${pick.opponent} \${pick.match} \${pick.market} \${pick.line}\`.toLowerCase();
          if (!searchSpace.includes(searchFilter)) return false;
        }

        return true;
      });`
  );

  // Sincronizar datos embebidos
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
  console.log(`[Fixed] ${filePath}`);
}

fixFile('dashboard.html');
fixFile('index.html');
