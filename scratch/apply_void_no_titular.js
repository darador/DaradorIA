const fs = require('fs');

function updateFile(file) {
  let content = fs.readFileSync(file, 'utf8');

  const oldResolve = "if (['ANULADA_NO_TITULAR', 'ANULADA', 'CANCELADA', 'VOID'].includes(status) || ['ANULADA_NO_TITULAR', 'ANULADA', 'CANCELADA', 'VOID'].includes(res)) {\n        return { code: 'ANULADA', label: 'ANULADA', badgeHtml: '<span class=\"sem-badge sem-gray\" title=\"Selección anulada (Void / No titular)\">⊘ ANULADA</span>' };\n      }";
  const oldResolveCRLF = oldResolve.replace(/\n/g, '\r\n');

  const newResolve = "if (['ANULADA_NO_TITULAR', 'ANULADA', 'CANCELADA', 'VOID'].includes(status) || ['ANULADA_NO_TITULAR', 'ANULADA', 'CANCELADA', 'VOID'].includes(res)) {\n        const isTeam = String(pick.player || '').includes('(Equipo)');\n        const isNonStarterVoid = !isTeam || status === 'ANULADA_NO_TITULAR' || res === 'ANULADA_NO_TITULAR';\n        if (isNonStarterVoid) {\n          return {\n            code: 'ANULADA',\n            label: 'ANULADA - NO TITULAR',\n            isNoTitular: true,\n            badgeHtml: '<span class=\"sem-badge sem-gray\" style=\"background:rgba(148,163,184,0.18); color:#cbd5e1; border:1px solid rgba(148,163,184,0.45); font-weight:800; letter-spacing:0.3px;\" title=\"Selección anulada por no jugar o no ser titular (Void / Cuota reembolsada)\">⊘ ANULADA - NO TITULAR</span>'\n          };\n        }\n        return { code: 'ANULADA', label: 'ANULADA', isNoTitular: false, badgeHtml: '<span class=\"sem-badge sem-gray\" title=\"Selección anulada (Void)\">⊘ ANULADA</span>' };\n      }";
  const newResolveCRLF = newResolve.replace(/\n/g, '\r\n');

  if (content.includes(oldResolveCRLF)) {
    content = content.replace(oldResolveCRLF, newResolveCRLF);
    console.log(file, 'resolveSportsResult updated CRLF');
  } else if (content.includes(oldResolve)) {
    content = content.replace(oldResolve, newResolve);
    console.log(file, 'resolveSportsResult updated LF');
  } else {
    console.error(file, 'oldResolve NOT FOUND');
    return;
  }

  // Update legsHtml in desktop card view
  const oldDesktopLegs = '<span class="board-edge-badge" style="font-size:0.72rem;">${edgeDisplay}</span>\n                      ${elenaDec.badgeHtml}';
  const oldDesktopLegsCRLF = oldDesktopLegs.replace(/\n/g, '\r\n');
  const newDesktopLegs = '<span class="board-edge-badge" style="font-size:0.72rem;">${edgeDisplay}</span>\n                      ${isVoid && sportsRes.isNoTitular ? sportsRes.badgeHtml : elenaDec.badgeHtml}';
  const newDesktopLegsCRLF = newDesktopLegs.replace(/\n/g, '\r\n');

  if (content.includes(oldDesktopLegsCRLF)) {
    content = content.replace(oldDesktopLegsCRLF, newDesktopLegsCRLF);
    console.log(file, 'desktop legs updated CRLF');
  } else if (content.includes(oldDesktopLegs)) {
    content = content.replace(oldDesktopLegs, newDesktopLegs);
    console.log(file, 'desktop legs updated LF');
  } else {
    console.error(file, 'oldDesktopLegs NOT FOUND');
  }

  // Update legsHtml in mobile card view
  const oldMobileLegs = '<span class="board-edge-badge" style="font-size:0.68rem;">${edgeDisplay}</span>\n                    ${elenaDec.badgeHtml}';
  const oldMobileLegsCRLF = oldMobileLegs.replace(/\n/g, '\r\n');
  const newMobileLegs = '<span class="board-edge-badge" style="font-size:0.68rem;">${edgeDisplay}</span>\n                    ${isVoid && sportsRes.isNoTitular ? sportsRes.badgeHtml : elenaDec.badgeHtml}';
  const newMobileLegsCRLF = newMobileLegs.replace(/\n/g, '\r\n');

  if (content.includes(oldMobileLegsCRLF)) {
    content = content.replace(oldMobileLegsCRLF, newMobileLegsCRLF);
    console.log(file, 'mobile legs updated CRLF');
  } else if (content.includes(oldMobileLegs)) {
    content = content.replace(oldMobileLegs, newMobileLegs);
    console.log(file, 'mobile legs updated LF');
  } else {
    console.error(file, 'oldMobileLegs NOT FOUND');
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log(file, 'SAVED successfully');
}

updateFile('index.html');
updateFile('dashboard.html');
