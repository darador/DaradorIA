const fs = require('fs');

['dashboard.html', 'index.html'].forEach(filename => {
  let content = fs.readFileSync(filename, 'utf8');

  content = content.replace(
    /if \(dateFilter === 'today'\) \{\r?\n\s*picksForDate = availablePicks\.filter\(p => getPickDateKey\(p\) === '2026-11-20'\);/,
    "if (dateFilter === 'tomorrow') {\n        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-21');\n      } else if (dateFilter === 'today') {\n        picksForDate = availablePicks.filter(p => getPickDateKey(p) === '2026-11-20');"
  );

  content = content.replace(
    /if \(dateFilter === 'today'\) \{\r?\n\s*filtered = filtered\.filter\(p => getPickDateKey\(p\) === '2026-11-20'\);/,
    "if (dateFilter === 'tomorrow') {\n        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-21');\n      } else if (dateFilter === 'today') {\n        filtered = filtered.filter(p => getPickDateKey(p) === '2026-11-20');"
  );

  fs.writeFileSync(filename, content, 'utf8');
  console.log(filename + ': onDateChange and onLeagueChange updated successfully.');
});
