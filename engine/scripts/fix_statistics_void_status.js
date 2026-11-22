const fs = require('fs');
const path = require('path');

const histData = JSON.parse(fs.readFileSync('historial_picks.json', 'utf8'));
const histDataStr = JSON.stringify(histData);

const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const picksHoyStr = JSON.stringify(picksHoy);

['dashboard.html', 'index.html'].forEach(filename => {
  let content = fs.readFileSync(filename, 'utf8');

  // 1. Add .history-mobile-card.void in CSS if not present
  if (!content.includes('.history-mobile-card.void')) {
    content = content.replace(
      '.history-mobile-card.pending {',
      '.history-mobile-card.void {\n      border-left-color: #94a3b8;\n    }\n\n    .history-mobile-card.pending {'
    );
    console.log(filename + ': CSS .history-mobile-card.void added.');
  }

  // 2. Add ANULADA option to desktop and mobile dropdowns
  if (!content.includes('value="ANULADA"')) {
    content = content.replace(
      '<option value="PERDIDA">❌ Solo Errores (Falladas)</option>',
      '<option value="PERDIDA">❌ Solo Errores (Falladas)</option>\n              <option value="ANULADA">🚫 Anuladas (Push / No titular)</option>'
    );
    content = content.replace(
      '<option value="PERDIDA">Solo Errores (Falladas)</option>',
      '<option value="PERDIDA">Solo Errores (Falladas)</option>\n                <option value="ANULADA">Anuladas (Push / No titular)</option>'
    );
    console.log(filename + ': ANULADA options added to select controls.');
  }

  // 3. Update applyHistoryFiltersAndRender filter logic
  content = content.replace(
    /const isWon = item\.status === 'GANADA' \|\| item\.status === 'ACERTADA';\r?\n\s*const isLost = item\.status === 'PERDIDA' \|\| item\.status === 'FALLADA';\r?\n\s*const isPending = !isWon && !isLost;\r?\n\r?\n\s*if \(statusF === 'GANADA' && !isWon\) return false;\r?\n\s*if \(statusF === 'PERDIDA' && !isLost\) return false;\r?\n\s*if \(statusF === 'PENDIENTE' && !isPending\) return false;/,
    `const isWon = item.status === 'GANADA' || item.status === 'ACERTADA';
        const isLost = item.status === 'PERDIDA' || item.status === 'FALLADA';
        const isVoid = item.status && (item.status.includes('ANULADA') || item.status.includes('VOID') || item.status === 'CANCELADA');
        const isPending = !isWon && !isLost && !isVoid;

        if (statusF === 'GANADA' && !isWon) return false;
        if (statusF === 'PERDIDA' && !isLost) return false;
        if (statusF === 'ANULADA' && !isVoid) return false;
        if (statusF === 'PENDIENTE' && !isPending) return false;`
  );

  // 4. Update desktop actualStatDisplay in renderHistoryTableAndCards
  content = content.replace(
    "const actualStatDisplay = item.actual_stat !== undefined ? item.actual_stat : (isWon ? 'Línea superada' : (isLost ? 'No superada' : 'En juego'));",
    "const isVoid = item.status && (item.status.includes('ANULADA') || item.status.includes('VOID') || item.status === 'CANCELADA');\n        const actualStatDisplay = isVoid ? 'No participó (No titular)' : (item.actual_stat !== undefined ? item.actual_stat : (isWon ? 'Línea superada' : (isLost ? 'No superada' : 'En juego')));"
  );

  // 5. Update mobile card rendering in renderHistoryTableAndCards
  content = content.replace(
    /mobileList\.innerHTML = filtered\.map\(item => \{\r?\n\s*const isWon = item\.status === 'GANADA' \|\| item\.status === 'ACERTADA';\r?\n\s*const isLost = item\.status === 'PERDIDA' \|\| item\.status === 'FALLADA';\r?\n\r?\n\s*let statusClass = isWon \? 'won' : \(isLost \? 'lost' : 'pending'\);\r?\n\s*let statusBadge = isWon \? '<span class="badge-status ganada">✔ ACERTADA<\/span>' : \(isLost \? '<span class="badge-status perdida">✖ FALLADA<\/span>' : '<span class="badge-status pendiente">⏳ EN JUEGO<\/span>'\);/,
    `mobileList.innerHTML = filtered.map(item => {
        const isWon = item.status === 'GANADA' || item.status === 'ACERTADA';
        const isLost = item.status === 'PERDIDA' || item.status === 'FALLADA';
        const isVoid = item.status && (item.status.includes('ANULADA') || item.status.includes('VOID') || item.status === 'CANCELADA');

        let statusClass = isWon ? 'won' : (isLost ? 'lost' : (isVoid ? 'void' : 'pending'));
        let statusBadge = isWon ? '<span class="badge-status ganada">✔ ACERTADA</span>' : (isLost ? '<span class="badge-status perdida">✖ FALLADA</span>' : (isVoid ? '<span class="badge-status" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.45);">🚫 ANULADA</span>' : '<span class="badge-status pendiente">⏳ EN JUEGO</span>'));`
  );

  // 6. Update mobile card actualStatDisplay
  content = content.replace(
    "const actualStatDisplay = item.actual_stat !== undefined ? item.actual_stat : (isWon ? 'Línea superada' : (isLost ? 'No superada' : 'En juego'));",
    "const actualStatDisplay = isVoid ? 'No participó (No titular)' : (item.actual_stat !== undefined ? item.actual_stat : (isWon ? 'Línea superada' : (isLost ? 'No superada' : 'En juego')));"
  );

  // 7. Update accordion detail colors
  content = content.replace(
    /style="color: \$\{isWon \? '#4ade80' : '#f87171'\};">\$\{actualStatDisplay\}/g,
    `style="color: \${isWon ? '#4ade80' : (isLost ? '#f87171' : '#cbd5e1')};">\${actualStatDisplay}`
  );
  content = content.replace(
    /style="color: \$\{isWon \? '#4ade80' : '#f87171'\};">\$\{profitDisplay\}/g,
    `style="color: \${isWon ? '#4ade80' : (isLost ? '#f87171' : '#cbd5e1')};">\${profitDisplay}`
  );

  // 8. Update EMBEDDED_PICKS_DATA and EMBEDDED_HISTORY_DATA
  const startPicks = content.indexOf('window.EMBEDDED_PICKS_DATA = ');
  if (startPicks !== -1) {
    let endPicks = content.indexOf(';\n  window.EMBEDDED_HISTORY_DATA', startPicks);
    if (endPicks === -1) endPicks = content.indexOf(';\r\n  window.EMBEDDED_HISTORY_DATA', startPicks);

    if (endPicks !== -1) {
      let endHistory = content.indexOf(';\n    let globalHistoryData', endPicks);
      if (endHistory === -1) endHistory = content.indexOf(';\r\n    let globalHistoryData', endPicks);

      if (endHistory !== -1) {
        content = content.slice(0, startPicks + 'window.EMBEDDED_PICKS_DATA = '.length) +
                  picksHoyStr +
                  ';\r\n  window.EMBEDDED_HISTORY_DATA = ' +
                  histDataStr +
                  content.slice(endHistory);
        console.log(filename + ': EMBEDDED_PICKS_DATA and EMBEDDED_HISTORY_DATA synchronized.');
      } else {
        console.error(filename + ': could not find end of EMBEDDED_HISTORY_DATA');
      }
    } else {
      console.error(filename + ': could not find end of EMBEDDED_PICKS_DATA');
    }
  }

  fs.writeFileSync(filename, content, 'utf8');
  console.log(`✅ ${filename} actualizado correctamente.`);
});
