const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1. Agregar estilos CSS para los botones de pestañas del desglose analítico
const cssTarget = '.stats-markets-header {';
const cssAdd = `/* SUB-PESTAÑAS DESGLOSE ANALÍTICO (MERCADOS VS LIGAS) */
    .breakdown-tabs-nav {
      display: inline-flex;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 3px;
      gap: 3px;
    }
    .breakdown-tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.35rem 0.85rem;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s ease;
    }
    .breakdown-tab-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.04);
    }
    .breakdown-tab-btn.active {
      background: rgba(139, 92, 246, 0.2);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.35);
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.15);
    }
    .breakdown-tab-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }
    .breakdown-tab-btn.active .breakdown-tab-badge {
      background: rgba(168, 85, 247, 0.3);
      color: #e9d5ff;
    }
    ` + cssTarget;

if (html.includes(cssTarget) && !html.includes('.breakdown-tabs-nav')) {
  html = html.replace(cssTarget, cssAdd);
  console.log('✅ CSS de breakdown tabs agregado.');
}

// 2. Modificar el HTML del header del bloque 3 para incorporar el switch de pestañas
const htmlTarget = `<div class="stats-markets-header">
          <div>
            <div class="stats-block-tag">DESGLOSE ANALÍTICO</div>
            <h3 class="stats-chart-title">Rendimiento por Mercado & Tamaño de Muestra</h3>
          </div>
          <span style="font-size: 11px; color: var(--text-dim); font-weight: 500;">Haz clic en un mercado para filtrar</span>
        </div>`;

const htmlReplacement = `<div class="stats-markets-header">
          <div>
            <div class="stats-block-tag">DESGLOSE ANALÍTICO</div>
            <h3 class="stats-chart-title" id="breakdownChartTitle">Rendimiento por Mercado & Tamaño de Muestra</h3>
          </div>
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <div class="breakdown-tabs-nav" role="tablist">
              <button type="button" class="breakdown-tab-btn active" id="tabBreakdownMarkets" onclick="switchBreakdownView('markets')" role="tab" aria-selected="true">
                <span>📊 Por Mercado</span>
                <span class="breakdown-tab-badge" id="badgeBreakdownMarkets">12</span>
              </button>
              <button type="button" class="breakdown-tab-btn" id="tabBreakdownLeagues" onclick="switchBreakdownView('leagues')" role="tab" aria-selected="false">
                <span>🏆 Por Liga</span>
                <span class="breakdown-tab-badge" id="badgeBreakdownLeagues">18</span>
              </button>
            </div>
            <span style="font-size: 11px; color: var(--text-dim); font-weight: 500;" id="breakdownFilterHint">Haz clic en una fila para filtrar</span>
          </div>
        </div>`;

if (html.includes(htmlTarget)) {
  html = html.replace(htmlTarget, htmlReplacement);
  console.log('✅ HTML de stats-markets-header actualizado con tabs.');
} else {
  console.log('❌ No coincidió htmlTarget exacto.');
}

// 3. Agregar estado y funciones JS para manejar la alternancia de pestañas y el desglose de ligas
const jsTarget = 'let historyFilterState = {';
const jsAdd = `let breakdownActiveTab = 'markets'; // 'markets' o 'leagues'
    let currentByMarketData = {};
    let currentByLeagueData = {};

    function switchBreakdownView(tab) {
      breakdownActiveTab = tab;
      const btnMarkets = document.getElementById('tabBreakdownMarkets');
      const btnLeagues = document.getElementById('tabBreakdownLeagues');
      const title = document.getElementById('breakdownChartTitle');

      if (tab === 'markets') {
        if (btnMarkets) {
          btnMarkets.classList.add('active');
          btnMarkets.setAttribute('aria-selected', 'true');
        }
        if (btnLeagues) {
          btnLeagues.classList.remove('active');
          btnLeagues.setAttribute('aria-selected', 'false');
        }
        if (title) title.textContent = 'Rendimiento por Mercado & Tamaño de Muestra';
        renderMarketsBreakdown(currentByMarketData);
      } else {
        if (btnMarkets) {
          btnMarkets.classList.remove('active');
          btnMarkets.setAttribute('aria-selected', 'false');
        }
        if (btnLeagues) {
          btnLeagues.classList.add('active');
          btnLeagues.setAttribute('aria-selected', 'true');
        }
        if (title) title.textContent = 'Rendimiento por Liga & Competición';
        renderLeaguesBreakdown(currentByLeagueData);
      }
    }

    function renderLeaguesBreakdown(byLeague) {
      const container = document.getElementById('marketsBreakdownGrid');
      if (!container) return;

      const entries = Object.entries(byLeague || {}).sort((a, b) => b[1].total - a[1].total);
      if (entries.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--text-dim); padding: 0.5rem 0;">No hay datos de ligas para los filtros seleccionados.</div>';
        return;
      }

      container.innerHTML = entries.map(([leagueName, stats]) => {
        const rateNum = parseFloat(stats.win_rate) || 0;
        const total = stats.total || 0;
        const won = stats.won || 0;
        
        let sampleTag = '';
        let winRateDisplay = stats.win_rate;

        if (total === 1) {
          sampleTag = '<span class="sample-pill limited">Muestra 1 pick · Preliminar</span>';
          winRateDisplay = stats.win_rate + '*';
        } else if (total < 4) {
          sampleTag = '<span class="sample-pill prelim">Muestra limitada (' + total + ' picks)</span>';
        } else {
          sampleTag = '<span class="sample-pill solid">Muestra ' + total + ' picks</span>';
        }

        const rateColor = rateNum >= 70 ? '#4ade80' : (rateNum >= 50 ? '#facc15' : '#f87171');
        const profitColor = stats.profit.startsWith('+') ? '#4ade80' : '#f87171';
        const barGradient = rateNum >= 60 ? 'linear-gradient(90deg, #10b981, #06b6d4)' : (rateNum >= 40 ? 'linear-gradient(90deg, #f59e0b, #eab308)' : 'linear-gradient(90deg, #ef4444, #f87171)');

        const cleanLeague = leagueName.replace(/'/g, "\\\\'");

        return \`
          <div class="market-row-item" onclick="syncHistoryFilterChange('search', '\${cleanLeague}')" title="Filtrar historial por \${leagueName}">
            <div class="market-name">🏆 \${leagueName}</div>
            <div style="white-space:nowrap; display:flex; align-items:center; min-width:0;">\${sampleTag}</div>
            <div class="market-ratio-box">
              <span>\${won}/\${total}</span>
              <div class="market-bar-track">
                <div class="market-bar-fill" style="width: \${rateNum}%; background: \${barGradient};"></div>
              </div>
            </div>
            <div class="market-rate-val" style="color: \${rateColor};">\${winRateDisplay}</div>
            <div class="market-profit-val" style="color: \${profitColor};">\${stats.profit}</div>
          </div>
        \`;
      }).join('');
    }

    ` + jsTarget;

if (html.includes(jsTarget) && !html.includes('let breakdownActiveTab')) {
  html = html.replace(jsTarget, jsAdd);
  console.log('✅ JS de breakdown tabs y renderLeaguesBreakdown agregado.');
}

// 4. Modificar applyHistoryFiltersAndRender para calcular también byLeague y pasarlo al renderizador
const loopTarget = `      let settled = 0, won = 0, lost = 0, voidCount = 0, pending = 0, staked = 0, profit = 0;
      const byMarket = {};
      const uniqueMatchesSet = new Set();`;

const loopReplacement = `      let settled = 0, won = 0, lost = 0, voidCount = 0, pending = 0, staked = 0, profit = 0;
      const byMarket = {};
      const byLeague = {};
      const uniqueMatchesSet = new Set();`;

if (html.includes(loopTarget)) {
  html = html.replace(loopTarget, loopReplacement);
  console.log('✅ byLeague inicializado en applyHistoryFiltersAndRender.');
}

const perItemTarget = `        const m = b.market || 'Otros';
        if (!byMarket[m]) {
          byMarket[m] = { total: 0, won: 0, lost: 0, void: 0, win_rate: '0.0%', profit: '+0.00U', net_profit: 0 };
        }
        byMarket[m].total++;`;

const perItemReplacement = `        const m = b.market || 'Otros';
        if (!byMarket[m]) {
          byMarket[m] = { total: 0, won: 0, lost: 0, void: 0, win_rate: '0.0%', profit: '+0.00U', net_profit: 0 };
        }
        byMarket[m].total++;

        const l = b.league || 'Otras Ligas';
        if (!byLeague[l]) {
          byLeague[l] = { total: 0, won: 0, lost: 0, void: 0, win_rate: '0.0%', profit: '+0.00U', net_profit: 0 };
        }
        byLeague[l].total++;`;

if (html.includes(perItemTarget)) {
  html = html.replace(perItemTarget, perItemReplacement);
  console.log('✅ byLeague agregado al loop de filtrado.');
}

const profitTarget = `          byMarket[m].won++;
          byMarket[m].net_profit = (byMarket[m].net_profit || 0) + bProfit;
        } else if (isLost) {
          settled++;
          lost++;
          staked += (b.stake || 1.0);
          profit += bProfit;
          byMarket[m].lost++;
          byMarket[m].net_profit = (byMarket[m].net_profit || 0) + bProfit;
        } else if (isVoid) {
          voidCount++;
          byMarket[m].void++;
        }`;

const profitReplacement = `          byMarket[m].won++;
          byMarket[m].net_profit = (byMarket[m].net_profit || 0) + bProfit;
          byLeague[l].won++;
          byLeague[l].net_profit = (byLeague[l].net_profit || 0) + bProfit;
        } else if (isLost) {
          settled++;
          lost++;
          staked += (b.stake || 1.0);
          profit += bProfit;
          byMarket[m].lost++;
          byMarket[m].net_profit = (byMarket[m].net_profit || 0) + bProfit;
          byLeague[l].lost++;
          byLeague[l].net_profit = (byLeague[l].net_profit || 0) + bProfit;
        } else if (isVoid) {
          voidCount++;
          byMarket[m].void++;
          byLeague[l].void++;
        }`;

if (html.includes(profitTarget)) {
  html = html.replace(profitTarget, profitReplacement);
  console.log('✅ Acumulación de profit en byLeague completada.');
}

const formatTarget = `      for (const k of Object.keys(byMarket)) {
        const setM = byMarket[k].won + byMarket[k].lost;
        byMarket[k].win_rate = setM > 0 ? ((byMarket[k].won / setM) * 100).toFixed(1) + '%' : '0.0%';
        const net = typeof byMarket[k].net_profit === 'number' ? byMarket[k].net_profit : (parseFloat(byMarket[k].net_profit) || 0);
        byMarket[k].profit = (net >= 0 ? '+' : '') + net.toFixed(2) + 'U';
        delete byMarket[k].net_profit;
      }`;

const formatReplacement = `      for (const k of Object.keys(byMarket)) {
        const setM = byMarket[k].won + byMarket[k].lost;
        byMarket[k].win_rate = setM > 0 ? ((byMarket[k].won / setM) * 100).toFixed(1) + '%' : '0.0%';
        const net = typeof byMarket[k].net_profit === 'number' ? byMarket[k].net_profit : (parseFloat(byMarket[k].net_profit) || 0);
        byMarket[k].profit = (net >= 0 ? '+' : '') + net.toFixed(2) + 'U';
        delete byMarket[k].net_profit;
      }

      for (const k of Object.keys(byLeague)) {
        const setL = byLeague[k].won + byLeague[k].lost;
        byLeague[k].win_rate = setL > 0 ? ((byLeague[k].won / setL) * 100).toFixed(1) + '%' : '0.0%';
        const netL = typeof byLeague[k].net_profit === 'number' ? byLeague[k].net_profit : (parseFloat(byLeague[k].net_profit) || 0);
        byLeague[k].profit = (netL >= 0 ? '+' : '') + netL.toFixed(2) + 'U';
        delete byLeague[k].net_profit;
      }

      currentByMarketData = byMarket;
      currentByLeagueData = byLeague;

      const badgeMarkets = document.getElementById('badgeBreakdownMarkets');
      if (badgeMarkets) badgeMarkets.textContent = Object.keys(byMarket).length;
      const badgeLeagues = document.getElementById('badgeBreakdownLeagues');
      if (badgeLeagues) badgeLeagues.textContent = Object.keys(byLeague).length;`;

if (html.includes(formatTarget)) {
  html = html.replace(formatTarget, formatReplacement);
  console.log('✅ Formateo de byLeague y badges completado.');
}

// 5. En el render final de applyHistoryFiltersAndRender llamar a la vista activa
const renderCallTarget = `renderMarketsBreakdown(byMarket);`;
const renderCallReplacement = `if (breakdownActiveTab === 'leagues') {
        renderLeaguesBreakdown(byLeague);
      } else {
        renderMarketsBreakdown(byMarket);
      }`;

if (html.includes(renderCallTarget)) {
  html = html.replace(renderCallTarget, renderCallReplacement);
  console.log('✅ renderMarketsBreakdown condicionado por breakdownActiveTab.');
}

fs.writeFileSync('index.html', html, 'utf8');
console.log('🎉 index.html actualizado con soporte completo para pestañas Mercado / Ligas.');
