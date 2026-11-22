const fs = require('fs');

const files = ['dashboard.html', 'index.html'];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  const oldTarget = `        if (isWon) {
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
        }`;

  const newReplacement = `        const bProfit = (typeof b.profit_loss === 'number') ? b.profit_loss : (parseFloat(b.profit) || (isWon ? (Number(b.odds) - 1.0) : (isLost ? -1.0 : 0.0)));
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
        }`;

  if (content.includes(oldTarget)) {
    content = content.replace(oldTarget, newReplacement);
    console.log(`[${file}] Fixed profit addition in byMarket loop`);
  } else {
    console.warn(`[${file}] oldTarget not found, check formatting`);
  }

  // Also ensure net calculation is bulletproof
  const oldNet = `        const net = byMarket[k].net_profit || 0;
        byMarket[k].profit = (net >= 0 ? '+' : '') + net.toFixed(2) + 'U';`;

  const newNet = `        const net = typeof byMarket[k].net_profit === 'number' ? byMarket[k].net_profit : (parseFloat(byMarket[k].net_profit) || 0);
        byMarket[k].profit = (net >= 0 ? '+' : '') + net.toFixed(2) + 'U';`;

  if (content.includes(oldNet)) {
    content = content.replace(oldNet, newNet);
    console.log(`[${file}] Fixed net.toFixed calculation`);
  }

  fs.writeFileSync(file, content, 'utf8');
});
