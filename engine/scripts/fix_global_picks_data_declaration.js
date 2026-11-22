const fs = require('fs');

['dashboard.html', 'index.html'].forEach(filename => {
  let content = fs.readFileSync(filename, 'utf8');

  // Insert let globalPicksData right before let globalHistoryData
  if (!content.includes('let globalPicksData')) {
    content = content.replace(
      'let globalHistoryData = (typeof window !== "undefined" && window.EMBEDDED_HISTORY_DATA) ? window.EMBEDDED_HISTORY_DATA : null;',
      'let globalPicksData = (typeof window !== "undefined" && window.EMBEDDED_PICKS_DATA) ? window.EMBEDDED_PICKS_DATA : null;\n    let globalHistoryData = (typeof window !== "undefined" && window.EMBEDDED_HISTORY_DATA) ? window.EMBEDDED_HISTORY_DATA : null;'
    );
    console.log(`✅ ${filename}: let globalPicksData restaurado.`);
  } else {
    console.log(`ℹ️ ${filename}: let globalPicksData ya existía.`);
  }

  fs.writeFileSync(filename, content, 'utf8');
});
