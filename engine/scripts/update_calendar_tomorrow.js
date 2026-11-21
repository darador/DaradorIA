const fs = require('fs');

const picksHoy = JSON.parse(fs.readFileSync('picks_hoy.json', 'utf8'));
const picksHoyStr = JSON.stringify(picksHoy);

['dashboard.html', 'index.html'].forEach(filename => {
  let content = fs.readFileSync(filename, 'utf8');

  // 1. Add "Mañana (21 Nov)" option to select id="filterDate"
  const oldSelect = `<select id="filterDate" class="select-control" autocomplete="off" onchange="onDateChange()">
            <option value="today" selected>📅 Hoy (20 Nov)</option>
            <option value="yesterday">📅 Ayer (19 Nov)</option>
            <option value="all">📅 Todas las Fechas</option>
          </select>`;

  const newSelect = `<select id="filterDate" class="select-control" autocomplete="off" onchange="onDateChange()">
            <option value="tomorrow">📅 Mañana (21 Nov)</option>
            <option value="today" selected>📅 Hoy (20 Nov)</option>
            <option value="yesterday">📅 Ayer (19 Nov)</option>
            <option value="all">📅 Todas las Fechas</option>
          </select>`;

  if (content.includes(oldSelect)) {
    content = content.replace(oldSelect, newSelect);
    console.log(filename + ': select filterDate updated with Mañana (21 Nov)');
  } else {
    // If whitespace varies
    content = content.replace(
      /<select id="filterDate"[^>]*>[\s\S]*?<\/select>/,
      newSelect
    );
    console.log(filename + ': select filterDate regex-replaced with Mañana (21 Nov)');
  }

  // 2. Update getPickDateKey to handle 21 Nov
  if (!content.includes("if (p.time.includes('21 Nov')) return '2026-11-21';")) {
    content = content.replace(
      "if (p.time.includes('20 Nov')) return '2026-11-20';",
      "if (p.time.includes('21 Nov')) return '2026-11-21';\n        if (p.time.includes('20 Nov')) return '2026-11-20';"
    );
    console.log(filename + ': getPickDateKey updated for 21 Nov');
  }

  // 3. Update onDateChange
  const oldOnDateChangeMatch = "if (dateFilter === 'today') {\n        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-20');";
  const newOnDateChangeReplace = "if (dateFilter === 'tomorrow') {\n        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-21');\n      } else if (dateFilter === 'today') {\n        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-20');";

  if (content.includes(oldOnDateChangeMatch)) {
    content = content.replace(oldOnDateChangeMatch, newOnDateChangeReplace);
    console.log(filename + ': onDateChange updated for tomorrow');
  }

  // 4. Update onLeagueChange
  const oldOnLeagueChangeMatch = "if (dateFilter === 'today') {\n        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-20');";
  const newOnLeagueChangeReplace = "if (dateFilter === 'tomorrow') {\n        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-21');\n      } else if (dateFilter === 'today') {\n        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-20');";

  if (content.includes(oldOnLeagueChangeMatch)) {
    content = content.replace(oldOnLeagueChangeMatch, newOnLeagueChangeReplace);
    console.log(filename + ': onLeagueChange updated for tomorrow');
  }

  // 5. Update renderPicks filter logic
  const oldRenderFilterMatch = "if (dateFilter === 'today' && pickDate !== '2026-11-20') return false;";
  const newRenderFilterReplace = "if (dateFilter === 'tomorrow' && pickDate !== '2026-11-21') return false;\n        if (dateFilter === 'today' && pickDate !== '2026-11-20') return false;";

  if (content.includes(oldRenderFilterMatch) && !content.includes("dateFilter === 'tomorrow'")) {
    content = content.replace(oldRenderFilterMatch, newRenderFilterReplace);
    console.log(filename + ': renderPicks updated for tomorrow');
  }

  // 6. Update window.EMBEDDED_PICKS_DATA
  const startPicks = content.indexOf('window.EMBEDDED_PICKS_DATA = ');
  if (startPicks !== -1) {
    let endPicks = content.indexOf(';\n  window.EMBEDDED_HISTORY_DATA', startPicks);
    if (endPicks === -1) {
      endPicks = content.indexOf(';\r\n  window.EMBEDDED_HISTORY_DATA', startPicks);
    }
    if (endPicks !== -1) {
      content = content.slice(0, startPicks + 'window.EMBEDDED_PICKS_DATA = '.length) + 
                picksHoyStr + 
                content.slice(endPicks);
      console.log(filename + ': EMBEDDED_PICKS_DATA synchronized with 24 picks.');
    }
  }

  fs.writeFileSync(filename, content, 'utf8');
});
