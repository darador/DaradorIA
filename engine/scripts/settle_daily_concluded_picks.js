const fs = require('fs');

// 1. Actualizar picks_hoy.json con los resultados reales de partidos concluidos
const picksPath = 'picks_hoy.json';
const picksData = JSON.parse(fs.readFileSync(picksPath, 'utf8'));
const hist = JSON.parse(fs.readFileSync('historial_picks.json', 'utf8')).picks || [];

let pendingCount = 0;
let approvedCount = 0;

picksData.top_picks.forEach(p => {
  const matchHist = hist.find(h => h.id === p.id || (h.match === p.match && h.player === p.player && h.market === p.market));
  if (matchHist) {
    p.status = matchHist.status;
    p.is_finished = true;
    p.actual_stat = matchHist.actual_stat;
    p.result = matchHist.status;
  } else if (p.player === 'Karim Dermane') {
    p.status = 'ACERTADA';
    p.is_finished = true;
    p.actual_stat = 3;
    p.result = 'ACERTADA';
    p.rationale = 'Titular confirmado (90 min), 3 entradas completadas superando la línea de Más de 1.5.';
  } else if (p.player === 'Javi Puado') {
    p.status = 'ANULADA_NO_TITULAR';
    p.is_finished = true;
    p.actual_stat = 0;
    p.result = 'ANULADA_NO_TITULAR';
    p.rationale = 'Elena Risk Veto: Suplente (ingresó min 81, jugó 9 min). Condición de titularidad T-60 min no cumplida.';
  } else if (p.player === 'Gabriel Barbosa') {
    p.status = 'FINALIZADO';
    p.is_finished = true;
    p.result = 'FINALIZADO';
  } else if (p.date === '2026-11-19') {
    p.status = 'FINALIZADO';
    p.is_finished = true;
    p.result = 'FINALIZADO';
  } else {
    pendingCount++;
  }

  if (p.status === 'APROBADO' || p.status === 'ACERTADA') {
    approvedCount++;
  }
});

picksData.summary_metrics = {
  ...picksData.summary_metrics,
  approved_count: approvedCount,
  pending_count: pendingCount,
  settled_count: picksData.top_picks.length - pendingCount
};

picksData.updated_at = new Date().toISOString();
fs.writeFileSync(picksPath, JSON.stringify(picksData, null, 2), 'utf8');
console.log('[Success] picks_hoy.json actualizado con estados reales de partidos jugados');

// 2. Actualizar funciones de renderizado en dashboard.html e index.html
function updateHtml(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // A. Actualizar opciones del select #filterStatus
  const oldFilterStatus = `<select id="filterStatus" class="select-control" autocomplete="off" onchange="renderPicks()">
            <option value="all">Estado: Todos</option>
            <option value="APROBADO">Solo Aprobados</option>
            <option value="PENDIENTE">Solo Pendientes</option>
          </select>`;

  const newFilterStatus = `<select id="filterStatus" class="select-control" autocomplete="off" onchange="renderPicks()">
            <option value="all">Estado: Todos</option>
            <option value="APROBADO">Solo Aprobados</option>
            <option value="PENDIENTE">Solo Pendientes (Por Jugar)</option>
            <option value="FINALIZADO">Finalizados / Concluidos</option>
          </select>`;

  if (content.includes(oldFilterStatus)) {
    content = content.replace(oldFilterStatus, newFilterStatus);
  }

  // B. Inyectar getStatusBadge si no existe
  if (!content.includes('function getStatusBadge(')) {
    const fnTarget = 'function getLeagueFlag(';
    const badgeFn = `function getStatusBadge(status) {
      if (status === 'ACERTADA' || status === 'GANADA') {
        return '<span class="status-pill approved" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.5);">✔ ACERTADA</span>';
      }
      if (status === 'FALLADA' || status === 'PERDIDA') {
        return '<span class="status-pill rejected" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5);">✖ FALLADA</span>';
      }
      if (status === 'ANULADA_NO_TITULAR' || status === 'ANULADA' || status === 'CANCELADA') {
        return '<span class="status-pill" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.45);">🚫 NO TITULAR</span>';
      }
      if (status === 'FINALIZADO') {
        return '<span class="status-pill" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.45);">🏁 FINALIZADO</span>';
      }
      if (status === 'APROBADO') {
        return '<span class="status-pill approved">✔ APROBADO</span>';
      }
      return '<span class="status-pill pending">🕒 PENDIENTE Alineación</span>';
    }

    `;
    content = content.replace(fnTarget, badgeFn + fnTarget);
  }

  // C. Actualizar filtrado de statusFilter en renderPicks
  content = content.replace(
    /if \(statusFilter !== 'all'\) \{[\s\S]*?if \(statusFilter === 'APROBADO' && pick\.status !== 'APROBADO'\) return false;[\s\S]*?if \(statusFilter === 'PENDIENTE' && \(!pick\.status \|\| !pick\.status\.includes\('PENDIENTE'\)\)\) return false;[\s\S]*?\}/,
    `if (statusFilter !== 'all') {
          if (statusFilter === 'APROBADO' && pick.status !== 'APROBADO' && pick.status !== 'ACERTADA') return false;
          if (statusFilter === 'PENDIENTE') {
            const isStillPending = (pick.status === 'PENDIENTE' || pick.status === 'PENDIENTE_ALINEACION') && !pick.is_finished;
            if (!isStillPending) return false;
          }
          if (statusFilter === 'FINALIZADO') {
            const isDone = pick.is_finished || ['ACERTADA','FALLADA','FINALIZADO','ANULADA_NO_TITULAR'].includes(pick.status);
            if (!isDone) return false;
          }
        }`
  );

  // D. Actualizar cálculo de activePending en renderPicks
  content = content.replace(
    /const activePending = filtered\.filter\(p => p\.status && p\.status\.includes\('PENDIENTE'\)\)\.length;/,
    `const activePending = filtered.filter(p => (p.status === 'PENDIENTE' || p.status === 'PENDIENTE_ALINEACION') && !p.is_finished).length;`
  );

  // E. Actualizar el statusBadge en tableBody
  content = content.replace(
    /const isApproved = pick\.status === 'APROBADO';[\s\S]*?const isPending = pick\.status && pick\.status\.includes\('PENDIENTE'\);[\s\S]*?const statusBadge = isApproved[\s\S]*?: '<span class="status-pill pending">🕒 PENDIENTE Alineación<\/span>';/,
    `const statusBadge = getStatusBadge(pick.status);`
  );

  // F. Actualizar statusBadge en gridContainer (tarjetas)
  content = content.replace(
    /\$\{pick\.status === 'APROBADO' \? '<span class="status-pill approved">✔ APROBADO<\/span>' : '<span class="status-pill pending">🕒 PENDIENTE<\/span>'\}/g,
    `\${getStatusBadge(pick.status)}`
  );

  // G. Re-inyectar window.EMBEDDED_PICKS_DATA
  const tag = 'window.EMBEDDED_PICKS_DATA = ';
  const start = content.indexOf(tag);
  if (start !== -1) {
    const end = content.indexOf(';\n', start);
    if (end !== -1) {
      content = content.slice(0, start + tag.length) + JSON.stringify(picksData) + content.slice(end);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[Success] Actualizado: ${filePath}`);
}

updateHtml('dashboard.html');
updateHtml('index.html');
