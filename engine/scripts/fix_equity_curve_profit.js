const fs = require('fs');

const files = ['dashboard.html', 'index.html'];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  const oldTarget = `      let cum = 0;
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
      });`;

  const newReplacement = `      let cum = 0;
      const points = [{ i: 0, bal: 0, match: 'Punto de Partida', player: 'Inicio', profit: 0, status: 'INICIO', date: '' }];
      chrono.forEach((b, idx) => {
        const isWon = b.status === 'GANADA' || b.status === 'ACERTADA';
        const isLost = b.status === 'PERDIDA' || b.status === 'FALLADA';
        const pNum = (typeof b.profit_loss === 'number') ? b.profit_loss : (parseFloat(b.profit) || (isWon ? (Number(b.odds) - 1.0) : (isLost ? -1.0 : 0.0)));
        cum = Number((cum + pNum).toFixed(2));
        points.push({
          i: idx + 1,
          bal: cum,
          match: b.match || 'Partido',
          player: b.player || 'Selección',
          profit: pNum,
          status: b.status,
          date: b.date || ''
        });
      });`;

  if (content.includes(oldTarget)) {
    content = content.replace(oldTarget, newReplacement);
    console.log(`[${file}] Fixed cum calculation in renderEquityCurve`);
  }

  const oldTooltip = `const pVal = p.profit !== undefined ? (p.profit >= 0 ? '+' : '') + Number(p.profit).toFixed(2) + ' U' : '';`;
  const newTooltip = `const pVal = p.profit !== undefined ? (typeof p.profit === 'number' ? ((p.profit >= 0 ? '+' : '') + p.profit.toFixed(2) + ' U') : p.profit) : '';`;

  if (content.includes(oldTooltip)) {
    content = content.replace(oldTooltip, newTooltip);
    console.log(`[${file}] Fixed tooltip profit in renderEquityCurve`);
  }

  fs.writeFileSync(file, content, 'utf8');
});
