const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const startBlock = html.indexOf('<div class="stats-markets-header">');
const endBlock = html.indexOf('</div>', html.indexOf('Haz clic en un mercado para filtrar')) + 6;

console.log('Block to replace:');
console.log(html.slice(startBlock, endBlock));

const replacement = `<div class="stats-markets-header">
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

const updatedHtml = html.slice(0, startBlock) + replacement + html.slice(endBlock);
fs.writeFileSync('index.html', updatedHtml, 'utf8');
console.log('✅ stats-markets-header reemplazado con éxito.');
