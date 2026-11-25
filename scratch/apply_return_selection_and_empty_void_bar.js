const fs = require('fs');

// 1. Modificar ladderModule.js
let ladderContent = fs.readFileSync('assets/js/ladderModule.js', 'utf8');

const oldLadderButtons = `<button type="button" onclick="window.LadderModule.confirmSelection()" style="background:#22c55e; color:#052e16; border:none; border-radius:8px; padding:0.5rem 0.95rem; font-weight:800; font-size:0.8rem; cursor:pointer;">✓ Confirmar selección</button>
            <button type="button" onclick="window.LadderModule.backToOpportunities()" style="background:rgba(148,163,184,0.16); color:#e2e8f0; border:1px solid rgba(148,163,184,0.35); border-radius:8px; padding:0.5rem 0.95rem; font-weight:700; font-size:0.8rem; cursor:pointer;">← Volver a oportunidades</button>`;
const oldLadderButtonsCRLF = oldLadderButtons.replace(/\n/g, '\r\n');

const newLadderButtons = `<button type="button" onclick="window.LadderModule.confirmSelection()" style="background:#22c55e; color:#052e16; border:none; border-radius:8px; padding:0.5rem 0.95rem; font-weight:800; font-size:0.8rem; cursor:pointer;">✓ Confirmar selección</button>
            <button type="button" onclick="window.LadderModule.cancelSelection()" style="background:rgba(239,68,68,0.16); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); border-radius:8px; padding:0.5rem 0.95rem; font-weight:700; font-size:0.8rem; cursor:pointer;">✕ Devolver selección</button>
            <button type="button" onclick="window.LadderModule.backToOpportunities()" style="background:rgba(148,163,184,0.16); color:#e2e8f0; border:1px solid rgba(148,163,184,0.35); border-radius:8px; padding:0.5rem 0.95rem; font-weight:700; font-size:0.8rem; cursor:pointer;">← Ver otras oportunidades</button>`;
const newLadderButtonsCRLF = newLadderButtons.replace(/\n/g, '\r\n');

if (ladderContent.includes(oldLadderButtonsCRLF)) {
  ladderContent = ladderContent.replace(oldLadderButtonsCRLF, newLadderButtonsCRLF);
  console.log('ladderModule updated CRLF');
} else if (ladderContent.includes(oldLadderButtons)) {
  ladderContent = ladderContent.replace(oldLadderButtons, newLadderButtons);
  console.log('ladderModule updated LF');
} else {
  console.error('oldLadderButtons NOT found in ladderModule.js');
}

fs.writeFileSync('assets/js/ladderModule.js', ladderContent, 'utf8');

// 2. Modificar index.html y dashboard.html para ocultar barra de progreso si isVoid
function updateHtml(file) {
  let content = fs.readFileSync(file, 'utf8');

  // Desktop bar block
  const oldDesktopBar = `<div style="display:flex; align-items:center; gap:0.55rem; margin-top:0.45rem;">
                    <div style="flex:1; height:4px; border-radius:999px; background:\${barColor};"></div>
                    <span style="min-width:34px; text-align:center; padding:0.1rem 0.45rem; border-radius:999px; background:\${pillBg}; color:\${pillText}; font-family:var(--font-mono); font-size:0.74rem; font-weight:800;">\${pillVal}</span>
                  </div>`;
  const oldDesktopBarCRLF = oldDesktopBar.replace(/\n/g, '\r\n');

  const newDesktopBar = `\${isVoid ? '' : \`<div style="display:flex; align-items:center; gap:0.55rem; margin-top:0.45rem;">
                    <div style="flex:1; height:4px; border-radius:999px; background:\${barColor};"></div>
                    <span style="min-width:34px; text-align:center; padding:0.1rem 0.45rem; border-radius:999px; background:\${pillBg}; color:\${pillText}; font-family:var(--font-mono); font-size:0.74rem; font-weight:800;">\${pillVal}</span>
                  </div>\`}`;
  const newDesktopBarCRLF = newDesktopBar.replace(/\n/g, '\r\n');

  if (content.includes(oldDesktopBarCRLF)) {
    content = content.replace(oldDesktopBarCRLF, newDesktopBarCRLF);
    console.log(file, 'desktop bar updated CRLF');
  } else if (content.includes(oldDesktopBar)) {
    content = content.replace(oldDesktopBar, newDesktopBar);
    console.log(file, 'desktop bar updated LF');
  } else {
    console.error(file, 'oldDesktopBar NOT found');
  }

  // Mobile bar block
  const oldMobileBar = `<div style="display:flex; align-items:center; gap:0.45rem; margin-top:0.4rem;">
                    <div style="flex:1; height:4px; border-radius:999px; background:\${barColor};"></div>
                    <span style="min-width:32px; text-align:center; padding:0.08rem 0.4rem; border-radius:999px; background:\${pillBg}; color:\${pillText}; font-family:var(--font-mono); font-size:0.72rem; font-weight:800;">\${pillVal}</span>
                  </div>`;
  const oldMobileBarCRLF = oldMobileBar.replace(/\n/g, '\r\n');

  const newMobileBar = `\${isVoid ? '' : \`<div style="display:flex; align-items:center; gap:0.45rem; margin-top:0.4rem;">
                    <div style="flex:1; height:4px; border-radius:999px; background:\${barColor};"></div>
                    <span style="min-width:32px; text-align:center; padding:0.08rem 0.4rem; border-radius:999px; background:\${pillBg}; color:\${pillText}; font-family:var(--font-mono); font-size:0.72rem; font-weight:800;">\${pillVal}</span>
                  </div>\`}`;
  const newMobileBarCRLF = newMobileBar.replace(/\n/g, '\r\n');

  if (content.includes(oldMobileBarCRLF)) {
    content = content.replace(oldMobileBarCRLF, newMobileBarCRLF);
    console.log(file, 'mobile bar updated CRLF');
  } else if (content.includes(oldMobileBar)) {
    content = content.replace(oldMobileBar, newMobileBar);
    console.log(file, 'mobile bar updated LF');
  } else {
    console.error(file, 'oldMobileBar NOT found');
  }

  fs.writeFileSync(file, content, 'utf8');
}

updateHtml('index.html');
updateHtml('dashboard.html');
