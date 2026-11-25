const fs = require('fs');

function fixFiles(file) {
  let content = fs.readFileSync(file, 'utf8');

  // Replace desktop market-row-item grid definition
  const oldDesktopGrid = 'grid-template-columns: minmax(180px, 2fr) 140px 1.4fr 80px 85px;';
  const newDesktopGrid = 'grid-template-columns: minmax(170px, 1.8fr) minmax(200px, auto) minmax(140px, 1.6fr) 65px 75px;';
  
  if (content.includes(oldDesktopGrid)) {
    content = content.replace(oldDesktopGrid, newDesktopGrid);
    console.log(file, 'desktop grid updated');
  } else {
    console.error(file, 'oldDesktopGrid NOT found');
  }

  // Update .sample-pill style
  const oldSamplePill = '.sample-pill {\n      font-size: 10px;\n      font-weight: 600;\n      padding: 0.15rem 0.5rem;\n      border-radius: 999px;\n      text-transform: uppercase;\n      letter-spacing: 0.03em;\n      white-space: nowrap;\n      display: inline-block;\n    }';
  const oldSamplePillCRLF = oldSamplePill.replace(/\n/g, '\r\n');
  const newSamplePill = '.sample-pill {\n      font-size: 10px;\n      font-weight: 600;\n      padding: 0.18rem 0.6rem;\n      border-radius: 999px;\n      text-transform: uppercase;\n      letter-spacing: 0.03em;\n      white-space: nowrap;\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      flex-shrink: 0;\n    }';
  const newSamplePillCRLF = newSamplePill.replace(/\n/g, '\r\n');

  if (content.includes(oldSamplePillCRLF)) {
    content = content.replace(oldSamplePillCRLF, newSamplePillCRLF);
    console.log(file, 'sample-pill updated CRLF');
  } else if (content.includes(oldSamplePill)) {
    content = content.replace(oldSamplePill, newSamplePill);
    console.log(file, 'sample-pill updated LF');
  } else {
    console.error(file, 'oldSamplePill NOT found');
  }

  // Replace mobile media query for market-row-item
  const oldMobileRule = '.market-row-item {\n        grid-template-columns: 1fr auto !important;\n        gap: 0.35rem 0.65rem !important;\n        padding: 0.55rem 0.65rem !important;\n      }';
  const oldMobileRuleCRLF = oldMobileRule.replace(/\n/g, '\r\n');
  const newMobileRule = '.market-row-item {\n        grid-template-columns: 1fr auto !important;\n        gap: 0.45rem 0.65rem !important;\n        padding: 0.6rem 0.75rem !important;\n      }\n      .market-row-item > div:nth-child(2) {\n        justify-self: end;\n      }\n      .market-row-item .market-ratio-box {\n        grid-column: 1 / -1;\n        width: 100%;\n      }\n      .market-row-item .market-rate-val {\n        justify-self: start;\n      }\n      .market-row-item .market-profit-val {\n        justify-self: end;\n      }';
  const newMobileRuleCRLF = newMobileRule.replace(/\n/g, '\r\n');

  if (content.includes(oldMobileRuleCRLF)) {
    content = content.replace(oldMobileRuleCRLF, newMobileRuleCRLF);
    console.log(file, 'mobile rule updated CRLF');
  } else if (content.includes(oldMobileRule)) {
    content = content.replace(oldMobileRule, newMobileRule);
    console.log(file, 'mobile rule updated LF');
  } else {
    console.error(file, 'oldMobileRule NOT found');
  }

  // Update renderMarketsBreakdown HTML wrapper: ensure min-width and no-wrap
  const oldRender = '<div>${sampleTag}</div>';
  const newRender = '<div style="white-space:nowrap; display:flex; align-items:center; min-width:0;">${sampleTag}</div>';
  if (content.includes(oldRender)) {
    content = content.replace(oldRender, newRender);
    console.log(file, 'renderMarketsBreakdown updated');
  } else {
    console.log(file, 'oldRender not found or already updated');
  }

  fs.writeFileSync(file, content, 'utf8');
}

fixFiles('index.html');
fixFiles('dashboard.html');
