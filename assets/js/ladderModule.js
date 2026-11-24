/**
 * DARADORBET — THE LADDER (Gran Escalera)
 * Rediseño UX Mobile-First con 4 secciones internas:
 *   1. Principal  (Resumen de capital, Próximo escalón, Progresión compacta, 1 línea de disciplina)
 *   2. Escalera   (30 escalones completos con detalle expandible al seleccionar, sin scroll horizontal)
 *   3. Disciplina (Principios, cupo diario, rachas sin apuesta, umbrales y validaciones Elena/RM)
 *   4. Historial  (Tarjetas auditables en móvil / tabla limpia en desktop)
 *
 * Restricciones:
 *  - Configuración oficial: $ 50.000 → $ 10.000.000 ARS · 30 escalones @ 1.20 (escenario de simulación).
 *  - Modo visual NO OPERATIVO: no ejecuta apuestas reales ni modifica otros módulos.
 */
(function (global) {
  'use strict';

  const CONFIG = Object.freeze({
    initialCapitalArs: 50000,
    targetCapitalArs: 10000000,
    simOdds: 1.20,
    totalSteps: 30
  });

  const arsFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  function formatArs(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '—';
    return '$ ' + arsFmt.format(Math.round(Number(val)));
  }

  let activeTab = 'principal';          // 'principal' | 'escalera' | 'disciplina' | 'historial'
  let previewMode = 'demo_opportunity'; // 'demo_opportunity' | 'demo_no_bet' | 'base_step0'
  let selectedStepNum = null;           // Escalón seleccionado para ver detalle en tab Escalera

  function buildSteps(completedSteps, simOdds = CONFIG.simOdds) {
    const out = [];
    let cap = CONFIG.initialCapitalArs;

    for (const s of completedSteps) {
      const startCap = cap;
      let endCap = startCap;
      if (s.status === 'GANADO') {
        endCap = startCap * s.odds;
        cap = endCap;
      } else if (s.status === 'ANULADO') {
        endCap = startCap;
      } else if (s.status === 'APROBADO') {
        endCap = startCap * s.odds;
      }
      out.push({
        step: s.step,
        startCapital: startCap,
        odds: s.odds,
        oddsLabel: s.status === 'APROBADO' ? `${s.odds.toFixed(2)} (Ref.)` : s.odds.toFixed(2),
        endCapital: endCap,
        status: s.status,
        date: s.date,
        note: s.note || '',
        isNext: s.status === 'APROBADO'
      });
    }

    const lastNum = out.length > 0 ? out[out.length - 1].step : 0;
    const hasApproved = out.some(s => s.status === 'APROBADO');
    let projCap = hasApproved ? out[out.length - 1].endCapital : cap;

    for (let i = lastNum + 1; i <= CONFIG.totalSteps; i++) {
      const startCap = projCap;
      const endCap = startCap * simOdds;
      out.push({
        step: i,
        startCapital: startCap,
        odds: simOdds,
        oddsLabel: `${simOdds.toFixed(2)} (Sim.)`,
        endCapital: endCap,
        status: 'PENDIENTE',
        date: i === CONFIG.totalSteps ? 'Meta 🎯' : 'Proy.',
        note: i === CONFIG.totalSteps
          ? 'Supera el objetivo de $ 10.000.000 ARS bajo escenario teórico @ 1.20.'
          : 'Escalón proyectado con reinversión teórica del 100% @ 1.20 (referencia de simulación).',
        isNext: !hasApproved && i === lastNum + 1
      });
      projCap = endCap;
    }

    return { steps: out, actualCapital: cap };
  }

  function getState(mode) {
    if (mode === 'base_step0') {
      const { steps, actualCapital } = buildSteps([]);
      return {
        isDemo: false,
        badgeLabel: 'Estado Base · No operativo',
        currentStep: 0,
        nextStepNum: 1,
        currentCapital: actualCapital,
        progressPct: 0,
        daysWithoutBet: 0,
        consecutiveNoBetDays: 0,
        dailyUsed: '0 / 2',
        evaluatedDays: 0,
        resolvedLabel: '0 / 30',
        avgOdds: '—',
        steps,
        opportunity: null,
        history: []
      };
    }

    if (mode === 'demo_no_bet') {
      const done = [
        { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-7', note: 'Simulación visual: escalón ganado con reinversión 100%.' },
        { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-5', note: 'Simulación visual: escalón ganado con reinversión 100%.' },
        { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-4', note: 'Anulado por rotación T-60. Capital preservado intacto.' },
        { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. D-2', note: 'Simulación visual: escalón ganado con reinversión 100%.' }
      ];
      const { steps, actualCapital } = buildSteps(done);
      return {
        isDemo: true,
        badgeLabel: 'Demo · No operativo',
        currentStep: 4,
        nextStepNum: 5,
        currentCapital: actualCapital,
        progressPct: (3 / CONFIG.totalSteps) * 100,
        daysWithoutBet: 4,
        consecutiveNoBetDays: 2,
        dailyUsed: '0 / 2',
        evaluatedDays: 8,
        resolvedLabel: '3 ganados · 1 anulado (Demo)',
        avgOdds: '1.20 (Sim.)',
        steps,
        opportunity: null,
        history: [
          { date: 'Sim. Hoy', step: '—', event: 'Día sin apuesta — ningún candidato superó criterios', odds: '—', capBefore: actualCapital, capAfter: actualCapital, status: 'DIA_SIN_APUESTA' },
          { date: 'Sim. Ayer', step: '—', event: 'Día sin apuesta — vetado por riesgo de rotación T-60', odds: '—', capBefore: actualCapital, capAfter: actualCapital, status: 'DIA_SIN_APUESTA' },
          { date: 'Sim. D-2', step: 'E4', event: 'Ejemplo Partido D (Simulación)', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
          { date: 'Sim. D-4', step: 'E3', event: 'Ejemplo Partido C (Void — capital intacto)', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' },
          { date: 'Sim. D-5', step: 'E2', event: 'Ejemplo Partido B (Simulación)', odds: '1.20', capBefore: 60000, capAfter: 72000, status: 'GANADO' },
          { date: 'Sim. D-7', step: 'E1', event: 'Ejemplo Partido A (Simulación)', odds: '1.20', capBefore: 50000, capAfter: 60000, status: 'GANADO' }
        ]
      };
    }

    // Default: demo_opportunity
    const done = [
      { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-6', note: 'Simulación visual: escalón ganado con reinversión 100%.' },
      { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-4', note: 'Simulación visual: escalón ganado con reinversión 100%.' },
      { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-3', note: 'Anulado por no titularidad. Capital preservado.' },
      { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. D-1', note: 'Simulación visual: escalón ganado con reinversión 100%.' },
      { step: 5, odds: 1.20, status: 'APROBADO', date: 'Sim. Hoy', note: 'Aprobado por Elena y validado por Risk Manager (Demo · ejecución manual).' }
    ];
    const { steps, actualCapital } = buildSteps(done);
    return {
      isDemo: true,
      badgeLabel: 'Demo · No operativo',
      currentStep: 4,
      nextStepNum: 5,
      currentCapital: actualCapital,
      progressPct: (3 / CONFIG.totalSteps) * 100,
      daysWithoutBet: 3,
      consecutiveNoBetDays: 0,
      dailyUsed: '0 / 2',
      evaluatedDays: 7,
      resolvedLabel: '3 ganados · 1 anulado (Demo)',
      avgOdds: '1.20 (Sim.)',
      steps,
      opportunity: {
        stepNum: 5,
        match: 'Partido de Demostración (Ejemplo Visual)',
        competition: 'Competición Tier 1 · Demo',
        kickoffArt: 'Hoy 17:00 hs (ART)',
        market: 'Mercado conservador de referencia',
        selection: 'Selección ilustrativa (No operativa)',
        odds: 1.20,
        projectedCapital: Math.round(actualCapital * 1.20),
        elenaStatus: 'APROBADO',
        riskManagerStatus: 'VALIDADO'
      },
      history: [
        { date: 'Sim. Hoy', step: 'E5', event: 'Partido de Demostración (Aprobado — ejecución manual)', odds: '1.20', capBefore: 86400, capAfter: 103680, status: 'APROBADO' },
        { date: 'Sim. D-1', step: 'E4', event: 'Ejemplo Partido D (Simulación)', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
        { date: 'Sim. D-2', step: '—', event: 'Día sin apuesta — ningún candidato superó criterios', odds: '—', capBefore: 72000, capAfter: 72000, status: 'DIA_SIN_APUESTA' },
        { date: 'Sim. D-3', step: 'E3', event: 'Ejemplo Partido C (Void — capital intacto)', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' },
        { date: 'Sim. D-4', step: 'E2', event: 'Ejemplo Partido B (Simulación)', odds: '1.20', capBefore: 60000, capAfter: 72000, status: 'GANADO' },
        { date: 'Sim. D-5', step: '—', event: 'Día sin apuesta — disciplina de capital aplicada', odds: '—', capBefore: 60000, capAfter: 60000, status: 'DIA_SIN_APUESTA' },
        { date: 'Sim. D-6', step: 'E1', event: 'Ejemplo Partido A (Simulación)', odds: '1.20', capBefore: 50000, capAfter: 60000, status: 'GANADO' }
      ]
    };
  }

  function badgeHtml(status) {
    const map = {
      GANADO: { cls: 'sem-green', txt: '✔ GANADO' },
      APROBADO: { cls: 'sem-violet', txt: '◆ APROBADO' },
      EJECUTADO: { cls: 'sem-blue', txt: '▶ EJECUTADO' },
      PENDIENTE: { cls: 'sem-gray', txt: '◦ PENDIENTE' },
      ANULADO: { cls: 'lm-badge-void', txt: '⊘ ANULADO' },
      PERDIDO: { cls: 'sem-red', txt: '✖ PERDIDO' },
      DIA_SIN_APUESTA: { cls: 'sem-amber', txt: '🛡️ SIN APUESTA' }
    };
    const c = map[status] || { cls: 'sem-gray', txt: status };
    return `<span class="sem-badge ${c.cls}">${c.txt}</span>`;
  }

  // ==================== SECCIÓN 1: PRINCIPAL (Ultra limpia, mobile-first) ====================
  function renderPrincipalTab(st) {
    const remainingArs = Math.max(0, CONFIG.targetCapitalArs - st.currentCapital);
    const wonSteps = st.steps.filter(s => s.status === 'GANADO').length;

    // Bloque Próximo Escalón (única tarjeta enfocada o estado vacío atractivo)
    const nextStepHtml = st.opportunity
      ? `
        <section class="lm-card lm-next-card" aria-label="Próximo escalón">
          <div class="lm-next-head">
            <span class="sem-badge sem-violet">PRÓXIMO ESCALÓN · E${st.opportunity.stepNum}</span>
            <span class="lm-demo-tag">Simulación · Manual</span>
          </div>
          <div class="lm-next-match">${st.opportunity.match}</div>
          <div class="lm-next-sub">${st.opportunity.competition} · ⏰ ${st.opportunity.kickoffArt}</div>
          <div class="lm-next-sel">${st.opportunity.market} · <strong>${st.opportunity.selection}</strong></div>

          <div class="lm-next-metrics">
            <div class="lm-nm-cell">
              <span>Cuota</span>
              <strong style="color:#facc15;">${st.opportunity.odds.toFixed(2)}</strong>
            </div>
            <div class="lm-nm-cell">
              <span>Capital proyectado</span>
              <strong style="color:#4ade80;">${formatArs(st.opportunity.projectedCapital)}</strong>
            </div>
          </div>

          <div class="lm-next-gates">
            <span class="sem-badge sem-green">✓ Elena: ${st.opportunity.elenaStatus}</span>
            <span class="sem-badge sem-green">🛡️ Risk Manager: ${st.opportunity.riskManagerStatus}</span>
          </div>
        </section>
      `
      : `
        <section class="lm-card lm-empty-next" aria-label="Estado sin oportunidad">
          <div class="lm-empty-icon">🛡️</div>
          <div class="lm-empty-title">No hay una oportunidad que cumpla los criterios. Hoy no apostamos.</div>
          <div class="lm-empty-sub">Tu capital permanece intacto en <strong>${formatArs(st.currentCapital)} ARS</strong>. La disciplina protege la escalera.</div>
        </section>
      `;

    // Resumen compacto de progresión (Ganados, Actual, Próximos)
    const miniSteps = st.steps.slice(0, 8);
    const pillsHtml = miniSteps.map(s => {
      const cls = s.status === 'GANADO' ? 'won' : (s.isNext ? 'next' : (s.status === 'ANULADO' ? 'void' : 'pending'));
      return `
        <button type="button" class="lm-step-dot ${cls}" onclick="window.LadderModule.inspectStep(${s.step})" title="Escalón ${s.step}: ${formatArs(s.endCapital)} (${s.status})">
          <span class="lm-dot-num">E${s.step}</span>
          <span class="lm-dot-cap">${formatArs(s.endCapital)}</span>
        </button>
      `;
    }).join('');

    return `
      <!-- Resumen de Capital (Protagonista) -->
      <section class="lm-capital-hero" aria-label="Resumen de capital">
        <div class="lm-cap-top">
          <div>
            <div class="lm-cap-lbl">CAPITAL ACTUAL</div>
            <div class="lm-cap-value">${formatArs(st.currentCapital)} <small>ARS</small></div>
          </div>
          <div class="lm-cap-target">
            <div class="lm-cap-lbl">OBJETIVO FINAL</div>
            <div class="lm-cap-target-val">${formatArs(CONFIG.targetCapitalArs)}</div>
          </div>
        </div>

        <div class="lm-prog-bar-wrap">
          <div class="lm-prog-bar-track"><div class="lm-prog-bar-fill" style="width:${Math.min(100, Math.max(2, st.progressPct))}%;"></div></div>
          <div class="lm-prog-meta">
            <span><strong>Escalón ${st.currentStep} / ${CONFIG.totalSteps}</strong> · ${wonSteps} ganados (${st.progressPct.toFixed(1)}%)</span>
            <span>Faltan <strong>${formatArs(remainingArs)}</strong></span>
          </div>
        </div>
      </section>

      <!-- Próximo Escalón -->
      ${nextStepHtml}

      <!-- Resumen de Progresión -->
      <section class="lm-card lm-prog-summary" aria-label="Resumen de progresión">
        <div class="lm-sec-head">
          <div>
            <h3 class="lm-sec-title">Progresión</h3>
            <span class="lm-sec-sub">Ganados · Actual · Próximos (ref. @1.20)</span>
          </div>
          <button type="button" class="lm-link-btn" onclick="window.LadderModule.setTab('escalera')">Ver escalera completa →</button>
        </div>
        <div class="lm-step-dots-row">
          ${pillsHtml}
        </div>
      </section>

      <!-- Resumen de Disciplina (1 sola línea limpia) -->
      <button type="button" class="lm-discipline-strip" onclick="window.LadderModule.setTab('disciplina')">
        <span>🛡️ <strong>Días sin apuesta: ${st.daysWithoutBet}</strong> · Disciplina preservada</span>
        <span class="lm-strip-arrow">Ver reglas →</span>
      </button>
    `;
  }

  // ==================== SECCIÓN 2: ESCALERA (30 escalones completos, tap para detalle) ====================
  function renderEscaleraTab(st) {
    const rowsHtml = st.steps.map(s => {
      const isSelected = selectedStepNum === s.step;
      const cls = s.status === 'GANADO' ? 'st-won' : (s.isNext ? 'st-next' : (s.status === 'ANULADO' ? 'st-void' : (s.status === 'PERDIDO' ? 'st-lost' : 'st-pending')));
      return `
        <div class="lm-step-item ${cls} ${isSelected ? 'is-open' : ''}" onclick="window.LadderModule.toggleStepDetail(${s.step})" role="button" tabindex="0" aria-expanded="${isSelected}">
          <div class="lm-si-main">
            <div class="lm-si-left">
              <span class="lm-si-num">E${s.step}</span>
              <div class="lm-si-caps">
                <span class="lm-si-flow">${formatArs(s.startCapital)} → <strong>${formatArs(s.endCapital)}</strong></span>
                <span class="lm-si-meta">Cuota <strong style="color:#facc15;">${s.oddsLabel}</strong> · ${s.date}</span>
              </div>
            </div>
            <div class="lm-si-right">
              ${badgeHtml(s.status)}
              <span class="lm-si-chev">${isSelected ? '▴' : '▾'}</span>
            </div>
          </div>
          ${isSelected ? `
            <div class="lm-si-detail">
              <div><strong>Cálculo:</strong> ${formatArs(s.startCapital)} × ${s.odds.toFixed(2)} = <strong>${formatArs(s.endCapital)} ARS</strong></div>
              <div style="margin-top:0.2rem; color:#94a3b8;">${s.note}</div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <section class="lm-card" aria-label="Escalera completa de 30 escalones">
        <div class="lm-sec-head" style="margin-bottom:0.75rem;">
          <div>
            <h3 class="lm-sec-title">Escalera Completa (30 Escalones)</h3>
            <span class="lm-sec-sub">Tocá cualquier escalón para ver el detalle · Fórmula: capital × cuota (simulación @1.20)</span>
          </div>
          <span class="sem-badge sem-violet">Meta: ${formatArs(CONFIG.targetCapitalArs)}</span>
        </div>
        <div class="lm-steps-list">
          ${rowsHtml}
        </div>
      </section>
    `;
  }

  // ==================== SECCIÓN 3: DISCIPLINA ====================
  function renderDisciplinaTab(st) {
    return `
      <section class="lm-card" aria-label="Disciplina y reglas de THE LADDER">
        <div class="lm-sec-head" style="margin-bottom:0.75rem;">
          <div>
            <h3 class="lm-sec-title">Disciplina & Control</h3>
            <span class="lm-sec-sub">Preservación estricta de capital por encima del avance rápido</span>
          </div>
          <span class="sem-badge sem-green">✓ Reglas activas</span>
        </div>

        <div class="lm-principle-callout">
          <strong>Principio fundamental:</strong> "No apostar también es una decisión válida. Nunca se fuerza una selección para avanzar."
        </div>

        <div class="lm-kv-list">
          <div class="lm-kv-row"><span>Selecciones del día / máximo permitido</span><strong>${st.dailyUsed} máx.</strong></div>
          <div class="lm-kv-row"><span>Jornadas consecutivas sin selección</span><strong>${st.consecutiveNoBetDays}</strong></div>
          <div class="lm-kv-row"><span>Días evaluados / días sin apuesta</span><strong>${st.evaluatedDays} / ${st.daysWithoutBet}</strong></div>
          <div class="lm-kv-row"><span>Escalones resueltos</span><strong>${st.resolvedLabel}</strong></div>
          <div class="lm-kv-row"><span>Cuota media alcanzada</span><strong style="color:#facc15;">${st.avgOdds}</strong></div>
          <div class="lm-kv-row"><span>Umbral de probabilidad de referencia</span><strong style="color:#38bdf8;">95% <small style="color:#94a3b8;font-weight:500;">(pend. validación)</small></strong></div>
          <div class="lm-kv-row"><span>Validación Elena (Gestora de Riesgo)</span><span class="sem-badge sem-green">Obligatoria</span></div>
          <div class="lm-kv-row"><span>Validación Risk Manager</span><span class="sem-badge sem-green">Obligatoria</span></div>
          <div class="lm-kv-row"><span>Ejecución de apuestas</span><span class="sem-badge sem-blue">100% Manual</span></div>
          <div class="lm-kv-row"><span>Capital en días sin apuesta</span><strong style="color:#4ade80;">100% preservado</strong></div>
        </div>
      </section>
    `;
  }

  // ==================== SECCIÓN 4: HISTORIAL (Mobile cards + Desktop table) ====================
  function renderHistorialTab(st) {
    const hist = st.history || [];
    if (hist.length === 0) {
      return `
        <section class="lm-card" aria-label="Historial auditable">
          <div class="lm-sec-head"><h3 class="lm-sec-title">Historial Auditable</h3><span class="sem-badge sem-gray">0 registros</span></div>
          <div class="lm-empty-next" style="margin-top:0.75rem;">
            <div class="lm-empty-sub">Todavía no hay registros en el Estado Base (E0). Cada escalón y cada día sin apuesta quedará registrado aquí de forma inmutable.</div>
          </div>
        </section>
      `;
    }

    const mobileCards = hist.map(h => `
      <div class="lm-hist-card">
        <div class="lm-hc-top">
          <span class="lm-hc-date">${h.date} · <strong>${h.step}</strong></span>
          ${badgeHtml(h.status)}
        </div>
        <div class="lm-hc-event">${h.event}</div>
        <div class="lm-hc-foot">
          <span>Cuota: <strong style="color:#facc15;">${h.odds}</strong></span>
          <span>${formatArs(h.capBefore)} → <strong style="color:#4ade80;">${formatArs(h.capAfter)}</strong></span>
        </div>
      </div>
    `).join('');

    const desktopRows = hist.map(h => `
      <tr>
        <td style="font-family:var(--font-mono);color:#94a3b8;white-space:nowrap;">${h.date}</td>
        <td style="font-weight:700;color:#e2e8f0;white-space:nowrap;">${h.step}</td>
        <td style="color:#f8fafc;">${h.event}</td>
        <td style="font-family:var(--font-mono);color:#facc15;font-weight:700;">${h.odds}</td>
        <td style="font-family:var(--font-mono);color:#cbd5e1;white-space:nowrap;">${formatArs(h.capBefore)} → <strong style="color:#4ade80;">${formatArs(h.capAfter)}</strong></td>
        <td>${badgeHtml(h.status)}</td>
      </tr>
    `).join('');

    return `
      <section class="lm-card" aria-label="Historial auditable de progresión">
        <div class="lm-sec-head" style="margin-bottom:0.75rem;">
          <div>
            <h3 class="lm-sec-title">Historial Auditable</h3>
            <span class="lm-sec-sub">Escalones ganados, anulados, aprobados y días sin apuesta en ARS</span>
          </div>
          <span class="sem-badge sem-gray">${hist.length} registros</span>
        </div>

        <div class="lm-hist-mobile-list">${mobileCards}</div>

        <div class="lm-hist-desktop-table daily-board-container" tabindex="0" role="region" aria-label="Tabla de historial de THE LADDER" style="margin-bottom:0;">
          <table class="daily-board-table">
            <thead>
              <tr>
                <th>FECHA</th>
                <th>ESCALÓN</th>
                <th>EVENTO / DISCIPLINA</th>
                <th>CUOTA</th>
                <th>CAPITAL (ANTES → DESPUÉS)</th>
                <th>ESTADO</th>
              </tr>
            </thead>
            <tbody>${desktopRows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  // ==================== ORQUESTADOR PRINCIPAL ====================
  function renderLadderDashboard() {
    const root = document.getElementById('viewLadder');
    if (!root) return;

    const st = getState(previewMode);
    let bodyHtml = '';
    if (activeTab === 'principal') bodyHtml = renderPrincipalTab(st);
    else if (activeTab === 'escalera') bodyHtml = renderEscaleraTab(st);
    else if (activeTab === 'disciplina') bodyHtml = renderDisciplinaTab(st);
    else if (activeTab === 'historial') bodyHtml = renderHistorialTab(st);

    root.innerHTML = `
      <div class="lm-shell">
        <!-- Encabezado compacto -->
        <div class="lm-header">
          <div class="lm-header-main">
            <div class="lm-title-line">
              <h2 class="lm-title">THE LADDER <span class="lm-title-sub">— Gran Escalera</span></h2>
              <span class="sem-badge ${st.isDemo ? 'sem-amber' : 'sem-blue'}" style="font-size:0.62rem;">${st.badgeLabel}</span>
            </div>
            <div class="lm-meta-line">
              <span>Base: <strong>${formatArs(CONFIG.initialCapitalArs)} ARS</strong></span>
              <span>·</span>
              <span>Meta: <strong>${formatArs(CONFIG.targetCapitalArs)} ARS</strong></span>
              <span>·</span>
              <span>Ref. @1.20 (30 esc.)</span>
            </div>
          </div>

          <div class="lm-scenario-select" role="group" aria-label="Escenario de vista previa">
            <button type="button" class="lm-sc-btn ${previewMode === 'demo_opportunity' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_opportunity')">Oportunidad</button>
            <button type="button" class="lm-sc-btn ${previewMode === 'demo_no_bet' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_no_bet')">Sin apuesta</button>
            <button type="button" class="lm-sc-btn ${previewMode === 'base_step0' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('base_step0')">Base E0</button>
          </div>
        </div>

        <!-- Navegación interna de 4 pestañas -->
        <nav class="lm-subnav" role="tablist" aria-label="Secciones de THE LADDER">
          <button type="button" role="tab" aria-selected="${activeTab === 'principal'}" class="lm-tab ${activeTab === 'principal' ? 'active' : ''}" onclick="window.LadderModule.setTab('principal')">Principal</button>
          <button type="button" role="tab" aria-selected="${activeTab === 'escalera'}" class="lm-tab ${activeTab === 'escalera' ? 'active' : ''}" onclick="window.LadderModule.setTab('escalera')">Escalera <span class="lm-tab-num">30</span></button>
          <button type="button" role="tab" aria-selected="${activeTab === 'disciplina'}" class="lm-tab ${activeTab === 'disciplina' ? 'active' : ''}" onclick="window.LadderModule.setTab('disciplina')">Disciplina</button>
          <button type="button" role="tab" aria-selected="${activeTab === 'historial'}" class="lm-tab ${activeTab === 'historial' ? 'active' : ''}" onclick="window.LadderModule.setTab('historial')">Historial <span class="lm-tab-num">${st.history.length}</span></button>
        </nav>

        <!-- Contenido de la pestaña activa -->
        <div class="lm-body">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  global.LadderModule = {
    render: renderLadderDashboard,
    setTab: function (tab) {
      activeTab = tab;
      renderLadderDashboard();
    },
    setPreviewMode: function (mode) {
      previewMode = mode;
      renderLadderDashboard();
    },
    toggleStepDetail: function (stepNum) {
      selectedStepNum = selectedStepNum === stepNum ? null : stepNum;
      renderLadderDashboard();
    },
    inspectStep: function (stepNum) {
      selectedStepNum = stepNum;
      activeTab = 'escalera';
      renderLadderDashboard();
    },
    getState: function () {
      return { activeTab, previewMode, selectedStepNum };
    }
  };
})(window);
