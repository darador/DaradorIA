const fs = require('fs');

['index.html', 'dashboard.html'].forEach(filePath => {
  let content = fs.readFileSync(filePath, 'utf8');

  // Normalizar saltos de línea para búsqueda confiable
  const isCrlf = content.includes('\r\n');
  const normalized = content.replace(/\r\n/g, '\n');

  const target = `    function resolveElenaDecision(pick, meta) {
      const m = meta || getPickKickoffMeta(pick);
      const rawElena = String(pick.elena_decision || pick.elenaDecision || '').toUpperCase();
      const rawStatus = String(pick.status || '').toUpperCase();`;

  const replacement = `    function resolveElenaDecision(pick, meta) {
      const m = meta || getPickKickoffMeta(pick);
      const rawElena = String(pick.elena_decision || pick.elenaDecision || '').toUpperCase();
      const rawStatus = String(pick.status || '').toUpperCase();
      const isShadowPassive = rawElena === 'SHADOW_PASSIVE' || rawStatus === 'SHADOW_PASSIVE' || pick.shadow_mode === true || pick.category === 'shadow_passive';
      if (isShadowPassive) {
        return {
          code: 'SHADOW_PASSIVE',
          label: 'SHADOW PASSIVE',
          badgeHtml: '<span class="sem-badge sem-cyan" data-tooltip="Selección en protocolo de observación pasiva (sin aprobación operativa)" title="Observación pasiva">🔭 Elena: Shadow Passive</span>'
        };
      }
      const isExpApproved = rawElena === 'EXPERIMENTAL_APPROVED' || rawStatus === 'EXPERIMENTAL_APPROVED' || pick.policy === 'EXPERIMENTAL_ODDS_V24';
      if (isExpApproved && (rawElena === 'EXPERIMENTAL_APPROVED' || rawStatus === 'EXPERIMENTAL_APPROVED')) {
        return {
          code: 'EXPERIMENTAL_APPROVED',
          label: 'EXP. APROBADO',
          badgeHtml: '<span class="sem-badge sem-purple" data-tooltip="Aprobado bajo protocolo experimental V2.4 (aislado de producción)" title="Experimental V2.4">🧪 Exp: Aprobado</span>'
        };
      }`;

  if (normalized.includes(target)) {
    const updated = normalized.replace(target, replacement);
    fs.writeFileSync(filePath, isCrlf ? updated.replace(/\n/g, '\r\n') : updated, 'utf8');
    console.log('Successfully updated resolveElenaDecision in', filePath);
  } else {
    console.warn('Target not found in', filePath);
  }
});
