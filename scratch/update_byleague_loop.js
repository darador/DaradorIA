const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const targetSection = `      let settled = 0, won = 0, lost = 0, voidCount = 0, pending = 0, staked = 0, profit = 0;
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

        const bProfit = (typeof b.profit_loss === 'number') ? b.profit_loss : (parseFloat(b.profit) || (isWon ? (Number(b.odds) - 1.0) : (isLost ? -1.0 : 0.0)));
        if (isWon) {
          settled++;
          won++;
          staked += (b.stake || 1.0);
          profit += bProfit;
          byMarket[m].won++;
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
        } else {
          pending++;
        }
      });

      for (const k of Object.keys(byMarket)) {
        const setM = byMarket[k].won + byMarket[k].lost;
        byMarket[k].win_rate = setM > 0 ? ((byMarket[k].won / setM) * 100).toFixed(1) + '%' : '0.0%';
        const net = typeof byMarket[k].net_profit === 'number' ? byMarket[k].net_profit : (parseFloat(byMarket[k].net_profit) || 0);
        byMarket[k].profit = (net >= 0 ? '+' : '') + net.toFixed(2) + 'U';
        delete byMarket[k].net_profit;
      }`;

const replacementSection = `      let settled = 0, won = 0, lost = 0, voidCount = 0, pending = 0, staked = 0, profit = 0;
      const byMarket = {};
      const byLeague = {};
      const uniqueMatchesSet = new Set();

      filtered.forEach(b => {
        if (b.match) uniqueMatchesSet.add(b.match);
        const m = b.market || 'Otros';
        if (!byMarket[m]) {
          byMarket[m] = { total: 0, won: 0, lost: 0, void: 0, win_rate: '0.0%', profit: '+0.00U', net_profit: 0 };
        }
        byMarket[m].total++;

        const l = b.league || 'Otras Ligas';
        if (!byLeague[l]) {
          byLeague[l] = { total: 0, won: 0, lost: 0, void: 0, win_rate: '0.0%', profit: '+0.00U', net_profit: 0 };
        }
        byLeague[l].total++;

        const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
        const isLost = b.status === 'PERDIDA' || b.status === 'FALLADA';
        const isVoid = b.status && (b.status.includes('ANULADA') || b.status.includes('VOID') || b.status === 'CANCELADA');

        const bProfit = (typeof b.profit_loss === 'number') ? b.profit_loss : (parseFloat(b.profit) || (isWon ? (Number(b.odds) - 1.0) : (isLost ? -1.0 : 0.0)));
        if (isWon) {
          settled++;
          won++;
          staked += (b.stake || 1.0);
          profit += bProfit;
          byMarket[m].won++;
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
        } else {
          pending++;
        }
      });

      for (const k of Object.keys(byMarket)) {
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

// Normalizar saltos de línea para que coincida exactamente
const normHtml = html.replace(/\r\n/g, '\n');
const normTarget = targetSection.replace(/\r\n/g, '\n');
const normReplacement = replacementSection.replace(/\r\n/g, '\n');

if (normHtml.includes(normTarget)) {
  const updated = normHtml.replace(normTarget, normReplacement);
  fs.writeFileSync('index.html', updated, 'utf8');
  console.log('✅ byLeague integrado con éxito en applyHistoryFiltersAndRender.');
} else {
  console.log('❌ No coincidió el bloque normTarget.');
}
