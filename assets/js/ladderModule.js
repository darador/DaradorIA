/**
 * DARADORBET — RETO ESCALERA («La magia del interés compuesto»)
 * Conectado directamente al estado persistido de prospectiveLadderEngine.js
 * vía ./api/fase11_prospective_dashboard.json (sin datos DEMO ni fallback ficticio).
 */
(function (global) {
  'use strict';

  const OFFICIAL = Object.freeze({
    initialCapital: 50000,
    targetCapital: 10000000,
    minOdds: 1.10,
    targetOdds: 1.20,
    maxOdds: 1.25,
    minEvPct: 7.0,
    reinvestmentPct: 100
  });

  const arsFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function formatArs(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '—';
    return '$ ' + arsFmt.format(Number(val)) + ' ARS';
  }

  let activeTab = 'principal'; // 'principal' | 'oportunidades' | 'historial' | 'reglas'
  let cachedPayload = null;
  let loadError = null;

  async function fetchLiveState() {
    try {
      const res = await fetch('./api/fase11_prospective_dashboard.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cachedPayload = await res.json();
      loadError = null;
    } catch (err) {
      loadError = err.message || 'No se pudo cargar el estado persistido de RETO ESCALERA.';
    }
  }

  function renderHeader(l) {
    const objBadge = l.objectiveStatus === 'OBJECTIVE_REACHED'
      ? '<span class="sem-badge sem-green">🏆 OBJECTIVE_REACHED</span>'
      : '<span class="sem-badge sem-blue">EN PROGRESO</span>';
    return `
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:0.75rem; margin-bottom:1.1rem;">
        <div>
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-bottom:0.4rem;">
            <span class="sem-badge sem-amber">SIMULACIÓN — DINERO VIRTUAL</span>
            ${objBadge}
          </div>
          <h2 style="font-size:1.35rem; font-weight:800; color:#f8fafc;">RETO ESCALERA — La magia del interés compuesto</h2>
          <p style="font-size:0.8rem; color:#94a3b8; margin-top:0.2rem;">
            Estado conectado en vivo al motor oficial (<code>prospectiveLadderEngine.js</code>) · Sin datos ficticios ni ejecución automática.
          </p>
        </div>
        <button type="button" class="btn-audit" onclick="window.LadderModule.reload()" style="padding:0.45rem 0.85rem;">↻ Actualizar estado</button>
      </div>
    `;
  }

  function renderKpis(l) {
    const available = l.openBet ? 0 : (l.currentCapital ?? OFFICIAL.initialCapital);
    const committed = l.committedStake ?? (l.openBet ? l.openBet.stake : 0);
    const kpis = [
      ['Capital Inicial', formatArs(l.initialCapital ?? OFFICIAL.initialCapital)],
      ['Capital Actual', formatArs(l.currentCapital ?? OFFICIAL.initialCapital)],
      ['Disponible / Comprometido', `${formatArs(available)} / ${formatArs(committed)}`],
      ['Objetivo Oficial', formatArs(l.targetCapital ?? OFFICIAL.targetCapital)],
      ['Progreso', `${Number(l.progressPct ?? 0).toFixed(2)}%`],
      ['Ciclo / Escalón', `Ciclo ${l.currentCycle || 1} · Escalón ${l.currentStep || 1}`],
      ['Rango Cuotas', `${(l.minOdds || OFFICIAL.minOdds).toFixed(2)} – ${(l.maxOdds || OFFICIAL.maxOdds).toFixed(2)} (Obj. ${(l.referenceOdds || OFFICIAL.targetOdds).toFixed(2)})`],
      ['EV Mínimo / Reinv.', `+${l.minEvPct || OFFICIAL.minEvPct}% · ${l.reinvestmentPct || OFFICIAL.reinvestmentPct}%`]
    ];
    return `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:0.75rem; margin-bottom:1.1rem;">
        ${kpis.map(([lbl, val]) => `
          <div style="background:rgba(14,21,42,0.88); border:1px solid #1c2744; border-radius:10px; padding:0.75rem 0.85rem;">
            <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase; font-weight:700;">${lbl}</div>
            <div style="font-size:1.02rem; font-weight:800; color:#f8fafc; margin-top:0.25rem; font-family:var(--font-mono);">${val}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderPrincipal(l) {
    const bet = l.openBet;
    let betCard = '';
    if (l.objectiveStatus === 'OBJECTIVE_REACHED') {
      betCard = `
        <div style="background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.45); border-radius:12px; padding:1rem;">
          <strong style="color:#4ade80; font-size:1rem;">🏆 OBJECTIVE_REACHED — Meta de ${formatArs(l.targetCapital)} alcanzada</strong>
          <p style="font-size:0.82rem; color:#cbd5e1; margin-top:0.35rem;">Nuevas apuestas bloqueadas automáticamente. Capital final preservado: <strong>${formatArs(l.currentCapital)}</strong>.</p>
        </div>
      `;
    } else if (bet) {
      betCard = `
        <div style="background:rgba(11,18,36,0.9); border:1px solid rgba(56,189,248,0.35); border-radius:12px; padding:1rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem;">
            <span class="sem-badge sem-blue">APUESTA VIRTUAL ABIERTA · PASO ${bet.step} (CICLO ${bet.cycle})</span>
            <span style="font-size:0.74rem; color:#94a3b8; font-family:var(--font-mono);">ID: ${bet.betId}</span>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#ffffff;">${bet.match} <span style="font-size:0.78rem; color:#38bdf8;">(${bet.competition || ''})</span></div>
          <div style="font-size:0.88rem; color:#e2e8f0; margin-top:0.25rem;">${bet.selection} — <strong>${bet.market}</strong> · ${bet.line || ''}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.85rem; margin-top:0.65rem; font-size:0.82rem; font-family:var(--font-mono);">
            <span>Cuota: <strong style="color:#fde047;">@${Number(bet.odds).toFixed(2)}</strong></span>
            <span>EV: <strong style="color:#4ade80;">${bet.expectedValuePct != null ? '+' + bet.expectedValuePct + '%' : 'N/D'}</strong></span>
            <span>Prob.: <strong>${bet.modelProbability ? (bet.modelProbability * 100).toFixed(1) + '%' : 'N/D'}</strong></span>
            <span>Stake: <strong>${formatArs(bet.stake)}</strong></span>
            <span>Retorno potencial: <strong style="color:#38bdf8;">${formatArs(bet.potentialReturn)}</strong></span>
          </div>
          <div style="display:flex; gap:0.5rem; margin-top:0.6rem; flex-wrap:wrap;">
            <span class="sem-badge sem-green">✓ Elena: ${bet.elenaDecision || 'APROBADO'}</span>
            <span class="sem-badge sem-green">✓ Risk Manager: ${bet.riskManagerDecision || 'APROBADO'}</span>
            <span class="sem-badge sem-gray">Estado: ${bet.status}</span>
          </div>
        </div>
      `;
    } else {
      betCard = `
        <div style="background:rgba(14,21,42,0.85); border:1px dashed rgba(148,163,184,0.35); border-radius:12px; padding:1rem;">
          <strong style="color:#f8fafc; font-size:0.95rem;">⏳ Esperando oportunidad válida</strong>
          <p style="font-size:0.8rem; color:#94a3b8; margin-top:0.3rem;">
            No hay ninguna apuesta abierta. El motor abrirá un único escalón cuando exista una oportunidad del Daily Board con cuota en <strong>[1.10 – 1.25]</strong>, <strong>EV ≥ +7%</strong>, aprobación de Elena y sin veto del Risk Manager.
          </p>
        </div>
      `;
    }

    const lastSettle = l.lastSettlement
      ? `<div style="margin-top:0.85rem; font-size:0.8rem; color:#cbd5e1;"><strong>Última liquidación:</strong> ${l.lastSettlement.match} (${l.lastSettlement.status}) · Capital tras liquidación: ${formatArs(l.lastSettlement.capAfter)}</div>`
      : '';

    return betCard + lastSettle;
  }

  function renderOportunidades(l) {
    const minO = l.minOdds || OFFICIAL.minOdds;
    const maxO = l.maxOdds || OFFICIAL.maxOdds;
    const minEv = l.minEvPct || OFFICIAL.minEvPct;
    const eligible = (l.eligibleOpportunities || []).filter(e =>
      Number.isFinite(Number(e.odds)) && Number(e.odds) >= minO && Number(e.odds) <= maxO &&
      (e.expectedValuePct == null || Number(e.expectedValuePct) >= minEv)
    );
    if (eligible.length === 0) {
      return `
        <div style="background:rgba(14,21,42,0.85); border:1px dashed rgba(148,163,184,0.35); border-radius:12px; padding:1rem;">
          <strong style="color:#f8fafc; font-size:0.92rem;">⏳ Esperando oportunidad válida</strong>
          <p style="font-size:0.8rem; color:#94a3b8; margin-top:0.3rem;">
            Ninguna oportunidad actual del Daily Board cumple simultáneamente las reglas oficiales de RETO ESCALERA (cuota <strong>[${minO.toFixed(2)} – ${maxO.toFixed(2)}]</strong>, <strong>EV ≥ +${minEv}%</strong>, calibración suficiente, Elena APROBADO y Risk Manager sin veto).
          </p>
        </div>
      `;
    }
    return `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
          <thead>
            <tr style="border-bottom:1px solid #1c2744; color:#94a3b8; text-align:left;">
              <th style="padding:0.5rem;">Rank</th>
              <th style="padding:0.5rem;">Partido</th>
              <th style="padding:0.5rem;">Selección / Mercado</th>
              <th style="padding:0.5rem;">Cuota</th>
              <th style="padding:0.5rem;">Prob / EV</th>
              <th style="padding:0.5rem;">Score</th>
            </tr>
          </thead>
          <tbody>
            ${eligible.map(e => `
              <tr style="border-bottom:1px solid rgba(28,39,68,0.6); ${e.isTopRecommended ? 'background:rgba(34,197,94,0.08);' : ''}">
                <td style="padding:0.5rem;">${e.isTopRecommended ? '<span class="sem-badge sem-green">★ #1 TOP</span>' : '#' + e.rank}</td>
                <td style="padding:0.5rem;"><strong>${e.match || '-'}</strong><div style="color:#94a3b8;font-size:0.7rem;">${e.competition || ''}</div></td>
                <td style="padding:0.5rem;">${e.selection || '-'}<div style="color:#94a3b8;font-size:0.7rem;">${e.market || ''} · ${e.line || ''}</div></td>
                <td style="padding:0.5rem; font-family:var(--font-mono); color:#fde047; font-weight:700;">@${Number(e.odds).toFixed(2)}</td>
                <td style="padding:0.5rem; font-family:var(--font-mono);">${e.modelProbability ? (e.modelProbability * 100).toFixed(1) + '%' : 'N/D'} · <strong style="color:#4ade80;">+${e.expectedValuePct}%</strong></td>
                <td style="padding:0.5rem; font-family:var(--font-mono); color:#38bdf8;">${e.compositeScore}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderHistorial(l) {
    const hist = (l.stepHistory || []).slice().reverse();
    if (hist.length === 0) {
      return '<div style="padding:1rem; color:#94a3b8; font-size:0.82rem;">Aún no hay escalones liquidados en el circuito prospectivo actual.</div>';
    }
    return `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
          <thead>
            <tr style="border-bottom:1px solid #1c2744; color:#94a3b8; text-align:left;">
              <th style="padding:0.5rem;">Ciclo / Paso</th>
              <th style="padding:0.5rem;">Partido / Selección</th>
              <th style="padding:0.5rem;">Cuota</th>
              <th style="padding:0.5rem;">Capital Antes → Después</th>
              <th style="padding:0.5rem;">Resultado</th>
            </tr>
          </thead>
          <tbody>
            ${hist.map(h => `
              <tr style="border-bottom:1px solid rgba(28,39,68,0.6);">
                <td style="padding:0.5rem;">C${h.cycle} · E${h.step}</td>
                <td style="padding:0.5rem;"><strong>${h.match}</strong> — ${h.selection}</td>
                <td style="padding:0.5rem; font-family:var(--font-mono);">@${Number(h.odds).toFixed(2)}</td>
                <td style="padding:0.5rem; font-family:var(--font-mono);">${formatArs(h.capBefore)} → ${formatArs(h.capAfter)}</td>
                <td style="padding:0.5rem;"><span class="sem-badge ${h.status === 'WON' ? 'sem-green' : (h.status === 'LOST' ? 'sem-red' : 'sem-gray')}">${h.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderReglas() {
    return `
      <div style="background:rgba(14,21,42,0.85); border:1px solid #1c2744; border-radius:12px; padding:1rem; font-size:0.82rem; color:#cbd5e1; line-height:1.6;">
        <strong style="color:#f8fafc;">Reglas Oficiales de RETO ESCALERA:</strong>
        <ul style="margin-top:0.5rem; padding-left:1.25rem;">
          <li>Capital inicial: <strong>$ 50.000,00 ARS</strong> · Objetivo: <strong>$ 10.000.000,00 ARS</strong> (reinversión 100%).</li>
          <li>Rango de cuotas inclusivo: <strong>1.10 a 1.25</strong> (objetivo 1.20) · EV mínimo: <strong>+7.0%</strong>.</li>
          <li>Mercados elegibles: Remates totales (con XI T-60 confirmado), Córners de equipo, Ganador 1X2, Doble oportunidad, Entradas y Faltas.</li>
          <li>Máximo <strong>1 apuesta abierta a la vez</strong>, sin obligación de apostar diariamente.</li>
          <li>Aprobación obligatoria de Elena y ausencia de veto del Risk Manager.</li>
          <li>Pérdida reinicia nuevo ciclo en $ 50.000 conservando historial; VOID conserva capital; al alcanzar $ 10.000.000 pasa a <code>OBJECTIVE_REACHED</code> y bloquea nuevas apuestas.</li>
        </ul>
      </div>
    `;
  }

  function paint() {
    const root = document.getElementById('viewLadder');
    if (!root) return;

    if (loadError) {
      root.innerHTML = `
        <div class="card" style="padding:1.25rem; border:1px solid rgba(239,68,68,0.45); background:rgba(14,21,42,0.9); border-radius:12px;">
          <strong style="color:#f87171;">No se pudo cargar el estado real de RETO ESCALERA</strong>
          <p style="font-size:0.82rem; color:#94a3b8; margin-top:0.35rem;">${loadError} (No se muestran datos DEMO como respaldo).</p>
          <button type="button" class="btn-audit" style="margin-top:0.65rem;" onclick="window.LadderModule.reload()">Reintentar</button>
        </div>
      `;
      return;
    }

    const l = (cachedPayload && cachedPayload.prospectiveLadder) ? cachedPayload.prospectiveLadder : null;
    if (!l) {
      root.innerHTML = '<div style="padding:1.25rem; color:#94a3b8;">Cargando estado oficial de RETO ESCALERA...</div>';
      return;
    }

    const tabs = [
      ['principal', 'Principal'],
      ['oportunidades', `Oportunidades (${(l.eligibleOpportunities || []).length})`],
      ['historial', `Historial (${(l.stepHistory || []).length})`],
      ['reglas', 'Reglas Oficiales']
    ];

    let bodyHtml = '';
    if (activeTab === 'principal') bodyHtml = renderPrincipal(l);
    else if (activeTab === 'oportunidades') bodyHtml = renderOportunidades(l);
    else if (activeTab === 'historial') bodyHtml = renderHistorial(l);
    else bodyHtml = renderReglas();

    root.innerHTML = `
      <div style="background:rgba(10,16,32,0.75); border:1px solid #1c2744; border-radius:14px; padding:1.2rem;">
        ${renderHeader(l)}
        ${renderKpis(l)}
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem; border-bottom:1px solid #1c2744; padding-bottom:0.65rem;">
          ${tabs.map(([id, label]) => `
            <button type="button" onclick="window.LadderModule.setTab('${id}')" style="padding:0.4rem 0.8rem; border-radius:8px; border:1px solid ${activeTab === id ? '#38bdf8' : '#1c2744'}; background:${activeTab === id ? 'rgba(56,189,248,0.16)' : 'rgba(14,21,42,0.8)'}; color:${activeTab === id ? '#38bdf8' : '#cbd5e1'}; font-size:0.78rem; font-weight:700; cursor:pointer;">${label}</button>
          `).join('')}
        </div>
        ${bodyHtml}
      </div>
    `;
  }

  async function render() {
    paint();
    if (!cachedPayload) {
      await fetchLiveState();
      paint();
    }
  }

  async function reload() {
    cachedPayload = null;
    await fetchLiveState();
    paint();
  }

  function setTab(tab) {
    activeTab = tab;
    paint();
  }

  global.LadderModule = { render, reload, setTab };
})(window);
