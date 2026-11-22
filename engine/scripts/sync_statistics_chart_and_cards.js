const fs = require('fs');
const path = require('path');

function updateFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. In applyHistoryFiltersAndRender: Add void handling & uniqueMatchesSet
  const oldLoopPattern = /let settled = 0, won = 0, lost = 0, pending = 0, staked = 0, profit = 0;\r?\n\s+const byMarket = \{\};[\s\S]*?delete byMarket\[k\]\.net_profit;\r?\n\s+\}/;
  
  const newLoopCode = `let settled = 0, won = 0, lost = 0, voidCount = 0, pending = 0, staked = 0, profit = 0;
      const byMarket = {};
      const uniqueMatchesSet = new Set();

      filtered.forEach(b => {
        if (b.match) uniqueMatchesSet.add(b.match);
        const m = b.market || 'Otros';
        if (!byMarket[m]) {
          byMarket[m] = { total: 0, won: 0, lost: 0, void: 0, win_rate: '0.0%', profit: '+0.00U', net_profit: 0 };
        }
        byMarket[m].total++;

        const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
        const isLost = b.status === 'PERDIDA' || b.status === 'FALLADA';
        const isVoid = b.status && (b.status.includes('ANULADA') || b.status.includes('VOID') || b.status === 'CANCELADA');

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
          voidCount++;
          byMarket[m].void++;
        } else {
          pending++;
        }
      });

      for (const k of Object.keys(byMarket)) {
        const setM = byMarket[k].won + byMarket[k].lost;
        byMarket[k].win_rate = setM > 0 ? ((byMarket[k].won / setM) * 100).toFixed(1) + '%' : '0.0%';
        const net = byMarket[k].net_profit || 0;
        byMarket[k].profit = (net >= 0 ? '+' : '') + net.toFixed(2) + 'U';
        delete byMarket[k].net_profit;
      }`;

  if (oldLoopPattern.test(content)) {
    content = content.replace(oldLoopPattern, newLoopCode);
    console.log(`✅ Fixed history aggregation loop in ${fileName}`);
  } else {
    console.warn(`⚠️ History loop pattern not matched in ${fileName}`);
  }

  // 2. In applyHistoryFiltersAndRender: Update filteredSummary & headerSample
  const oldSummaryPattern = /const filteredSummary = \{[\s\S]*?by_market: byMarket\r?\n\s+\};\r?\n\s+const headerSample = document\.getElementById\('statsHeaderSample'\);\r?\n\s+if \(headerSample\) \{\r?\n\s+headerSample\.textContent = `\$\{filtered\.length\} de \$\{historyList\.length\} Apuestas Auditadas`;\r?\n\s+\}/;

  const newSummaryCode = `const filteredSummary = {
        total_bets: filtered.length,
        unique_matches: uniqueMatchesSet.size,
        settled_bets: settled,
        won_bets: won,
        lost_bets: lost,
        void_bets: voidCount,
        pending_bets: pending,
        win_rate_pct: settled > 0 ? Number(((won / settled) * 100).toFixed(1)) : 0.0,
        total_staked_units: Number(staked.toFixed(2)),
        net_profit_units: Number(profit.toFixed(2)),
        roi_pct: staked > 0 ? Number(((profit / staked) * 100).toFixed(1)) : 0.0,
        by_market: byMarket
      };

      const headerSample = document.getElementById('statsHeaderSample');
      if (headerSample) {
        headerSample.textContent = \`\${filtered.length} Selecciones Auditadas (\${uniqueMatchesSet.size} Partidos Analizados)\`;
      }`;

  if (oldSummaryPattern.test(content)) {
    content = content.replace(oldSummaryPattern, newSummaryCode);
    console.log(`✅ Fixed filteredSummary in ${fileName}`);
  } else {
    console.warn(`⚠️ Summary pattern not matched in ${fileName}`);
  }

  // 3. In updateKpisForHistory: Update card subtitles and remove the hijack of kpiLabel1/2/3/4
  const oldKpisPattern = /function updateKpisForHistory\(sum\) \{[\s\S]*?renderEquityCurve\(bets\) \{/;
  
  const newKpisCode = `function updateKpisForHistory(sum) {
      const winRate = sum.win_rate_pct || 0;
      const won = sum.won_bets || 0;
      const lost = sum.lost_bets || 0;
      const voidBets = sum.void_bets || 0;
      const settled = sum.settled_bets !== undefined ? sum.settled_bets : (won + lost);
      const pending = sum.pending_bets !== undefined ? sum.pending_bets : 0;
      const roi = sum.roi_pct !== undefined ? sum.roi_pct : 0;
      const profit = sum.net_profit_units !== undefined ? sum.net_profit_units : 0;
      const staked = sum.total_staked_units !== undefined ? sum.total_staked_units : (settled * 1.0);
      const uniqueMatches = sum.unique_matches || 20;

      // 1. Tarjetas KPI de Estadísticas
      const elWinRate = document.getElementById('statsWinRate');
      if (elWinRate) {
        elWinRate.textContent = winRate.toFixed(1) + '%';
        elWinRate.style.color = winRate >= 55 ? '#4ade80' : (winRate >= 45 ? '#facc15' : '#f87171');
      }
      
      const elWinRateSub = document.getElementById('statsWinRateSub');
      if (elWinRateSub) elWinRateSub.textContent = \`\${won} Acertadas de \${settled} Resueltas (\${voidBets} Anuladas)\`;

      const elWinRateBar = document.getElementById('statsWinRateBar');
      if (elWinRateBar) elWinRateBar.style.width = Math.min(100, Math.max(0, winRate)) + '%';

      const elWon = document.getElementById('statsWonCount');
      if (elWon) elWon.textContent = won;

      const elLost = document.getElementById('statsLostCount');
      if (elLost) elLost.textContent = lost;

      const elPending = document.getElementById('statsPendingSub');
      if (elPending) elPending.textContent = \`\${voidBets} Anuladas (No Titular) · \${pending} Pendientes\`;

      const elRatioSub = document.getElementById('statsRatioSub');
      if (elRatioSub) {
        const ratio = lost > 0 ? (won / lost).toFixed(2) + ':1 ratio' : (won > 0 ? '100% efectividad' : 'Sin liquidar');
        elRatioSub.textContent = \`\${uniqueMatches} Partidos · \${ratio}\`;
      }

      const elRoi = document.getElementById('statsRoiVal');
      if (elRoi) {
        elRoi.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%';
        elRoi.style.color = roi >= 0 ? '#4ade80' : '#f87171';
      }

      const elRoiSub = document.getElementById('statsRoiSub');
      if (elRoiSub) elRoiSub.textContent = \`Retorno sobre \${staked.toFixed(2)} U apostadas\`;

      const elProfit = document.getElementById('statsProfitVal');
      if (elProfit) {
        elProfit.textContent = (profit >= 0 ? '+' : '') + profit.toFixed(2) + ' U';
        elProfit.style.color = profit >= 0 ? '#4ade80' : '#f87171';
      }

      const elStaked = document.getElementById('statsStakedSub');
      if (elStaked) elStaked.textContent = \`En \${sum.total_bets} selecciones (\${uniqueMatches} partidos)\`;
    }

    function renderEquityCurve(bets) {`;

  if (oldKpisPattern.test(content)) {
    content = content.replace(oldKpisPattern, newKpisCode);
    console.log(`✅ Fixed updateKpisForHistory in ${fileName}`);
  } else {
    console.warn(`⚠️ Kpis pattern not matched in ${fileName}`);
  }

  // 4. In renderEquityCurve: Plot all bets in chronological order, handle void bets & show matches
  const oldEquityPattern = /function renderEquityCurve\(bets\) \{[\s\S]*?const dotsHtml = points\.map[\s\S]*?\}\)\.join\(''\);/;

  const newEquityCode = `function renderEquityCurve(bets) {
      const container = document.getElementById('equityChartWrapper');
      if (!container) return;

      const peakPill = document.getElementById('chartPeakPill');
      const curPill = document.getElementById('chartCurrentPill');
      const samplePill = document.getElementById('chartSamplePill');

      if (!bets || bets.length === 0) {
        if (samplePill) samplePill.textContent = '0 picks';
        if (peakPill) peakPill.textContent = 'Pico: 0.00 U';
        if (curPill) curPill.textContent = 'Balance: 0.00 U';
        container.innerHTML = '<div style="display: flex; height: 100%; align-items: center; justify-content: center; font-size: 12px; color: var(--text-dim);">No hay apuestas para los filtros seleccionados.</div>';
        return;
      }

      // Orden cronológico estricto: el más antiguo primero
      const chrono = [...bets].sort((a, b) => {
        if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
        return (a.id || '').localeCompare(b.id || '');
      });

      const uniqueMatches = new Set(chrono.map(b => b.match).filter(Boolean)).size;
      if (samplePill) samplePill.textContent = \`\${chrono.length} selecciones · \${uniqueMatches} partidos\`;

      let cum = 0;
      const points = [{ i: 0, bal: 0, match: 'Punto de Partida', player: 'Inicio', profit: 0, status: 'INICIO', date: '' }];
      chrono.forEach((b, idx) => {
        cum = Number((cum + (b.profit || 0)).toFixed(2));
        points.push({
          i: idx + 1,
          bal: cum,
          match: b.match || 'Partido',
          player: b.player || 'Selección',
          profit: b.profit || 0,
          status: b.status,
          date: b.date || ''
        });
      });

      const maxBal = Math.max(...points.map(p => p.bal));
      const minBal = Math.min(...points.map(p => p.bal));
      const finalBal = points[points.length - 1].bal;

      if (peakPill) peakPill.textContent = \`Pico: \${maxBal >= 0 ? '+' : ''}\${maxBal.toFixed(2)} U\`;
      if (curPill) {
        curPill.textContent = \`Balance: \${finalBal >= 0 ? '+' : ''}\${finalBal.toFixed(2)} U\`;
        curPill.style.color = finalBal >= 0 ? '#4ade80' : '#f87171';
        curPill.style.borderColor = finalBal >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)';
      }

      // Parámetros de proyección SVG
      const width = 760;
      const height = 200;
      const padding = { top: 22, right: 35, bottom: 24, left: 55 };
      const plotW = width - padding.left - padding.right;
      const plotH = height - padding.top - padding.bottom;

      let boundMax = Math.max(0, maxBal) + 0.6;
      let boundMin = Math.min(0, minBal) - 0.6;
      const range = boundMax - boundMin;

      const getX = (idx) => padding.left + (idx / (points.length - 1)) * plotW;
      const getY = (val) => padding.top + plotH - ((val - boundMin) / range) * plotH;
      const zeroY = getY(0);

      // Grid horizontal
      let gridHtml = \`
        <line x1="\${padding.left}" y1="\${zeroY}" x2="\${width - padding.right}" y2="\${zeroY}" stroke="rgba(255,255,255,0.25)" stroke-dasharray="4,4" stroke-width="1.2" />
        <text x="\${padding.left - 8}" y="\${zeroY + 3.5}" fill="rgba(255,255,255,0.6)" font-size="10" font-family="Inter, monospace" text-anchor="end">0.00 U</text>
        
        <line x1="\${padding.left}" y1="\${getY(boundMax - 0.3)}" x2="\${width - padding.right}" y2="\${getY(boundMax - 0.3)}" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
        <text x="\${padding.left - 8}" y="\${getY(boundMax - 0.3) + 3.5}" fill="rgba(255,255,255,0.3)" font-size="9" font-family="Inter, monospace" text-anchor="end">+\${(boundMax - 0.3).toFixed(1)}U</text>

        <line x1="\${padding.left}" y1="\${getY(boundMin + 0.3)}" x2="\${width - padding.right}" y2="\${getY(boundMin + 0.3)}" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
        <text x="\${padding.left - 8}" y="\${getY(boundMin + 0.3) + 3.5}" fill="rgba(255,255,255,0.3)" font-size="9" font-family="Inter, monospace" text-anchor="end">\${(boundMin + 0.3).toFixed(1)}U</text>
      \`;

      // Trayectoria de la curva y área
      const pathPoints = points.map((p, idx) => \`\${getX(idx).toFixed(1)} \${getY(p.bal).toFixed(1)}\`);
      const strokeD = 'M ' + pathPoints.join(' L ');
      const areaD = \`\${strokeD} L \${getX(points.length - 1).toFixed(1)} \${zeroY.toFixed(1)} L \${getX(0).toFixed(1)} \${zeroY.toFixed(1)} Z\`;

      const strokeColor = finalBal >= 0 ? '#10b981' : '#f87171';
      const fillGradient = finalBal >= 0 ? 'url(#pnlGradPos)' : 'url(#pnlGradNeg)';

      // Círculos interactivos
      const dotsHtml = points.map((p, idx) => {
        if (idx === 0) return '';
        const cx = getX(idx).toFixed(1);
        const cy = getY(p.bal).toFixed(1);
        const isWon = p.status === 'GANADA' || p.status === 'ACERTADA';
        const isLost = p.status === 'PERDIDA' || p.status === 'FALLADA';
        const dotColor = isWon ? '#4ade80' : (isLost ? '#f87171' : '#94a3b8');
        return \`<circle cx="\${cx}" cy="\${cy}" r="3.5" fill="\${dotColor}" stroke="#0b1221" stroke-width="1.5" class="chart-dot" data-idx="\${idx}" style="cursor: pointer; transition: r 0.15s ease;" />\`;
      }).join('');`;

  if (oldEquityPattern.test(content)) {
    content = content.replace(oldEquityPattern, newEquityCode);
    console.log(`✅ Fixed renderEquityCurve in ${fileName}`);
  } else {
    console.warn(`⚠️ Equity pattern not matched in ${fileName}`);
  }

  // 5. In renderPicks: Ensure Daily Board KPI card labels are always pristine
  const oldRenderPicksKpi = /setEl\('kpiTotalPicks', filtered\.length\);\s*setEl\('kpiAvgEdge', '\+' \+ activeAvgEv \+ '%'\);[\s\S]*?setEl\('kpiAvgOdds', avgOdds\);\s*\}\s*setEl\('kpiSub4', 'Multiplicador promedio'\);/;

  const newRenderPicksKpi = `// Cabecera de KPIs del Daily Board
      setEl('kpiLabel1', 'Total Oportunidades');
      setEl('kpiTotalPicks', filtered.length);
      setEl('kpiAnalyzed', \`\${uniqueMatches} partidos analizados\`);

      setEl('kpiLabel2', 'EV Promedio (+Edge)');
      setEl('kpiAvgEdge', '+' + activeAvgEv + '%');
      setEl('kpiSub2', 'Sobre cuota bookie');

      setEl('kpiLabel3', 'Acierto Reciente (L5)');
      setEl('kpiAvgHitRate', '80.0%');
      setEl('kpiSub3', 'Efectividad últimos 5');

      setEl('kpiLabel4', 'Cuota Promedio');
      if (filtered.length > 0) {
        const oddsList = filtered.map(p => p.odds || 0).filter(Boolean);
        const avgOdds = oddsList.length ? (oddsList.reduce((a, b) => a + b, 0) / oddsList.length).toFixed(2) : '0.00';
        setEl('kpiAvgOdds', avgOdds);
      } else {
        setEl('kpiAvgOdds', '0.00');
      }
      setEl('kpiSub4', 'Multiplicador promedio');`;

  if (oldRenderPicksKpi.test(content)) {
    content = content.replace(oldRenderPicksKpi, newRenderPicksKpi);
    console.log(`✅ Fixed renderPicks KPI headers in ${fileName}`);
  } else {
    console.warn(`⚠️ renderPicks KPI pattern not matched in ${fileName}`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

updateFile('dashboard.html');
updateFile('index.html');
