/**
 * DARADORBET — RETO ESCALERA («La magia del interés compuesto»)
 * Versión v2.0 — Oportunidades Dinámicas, Ejecución Secuencial y Control de Ventanas Horarias.
 * Modo visual / experimental (DEMO — NO OPERATIVO): sin apuestas reales ni ejecución automática.
 *
 * Secciones internas (Mobile-First):
 *   1. Principal  (Capital disponible/comprometido, Estado de escalera, Próxima oportunidad / Motivo de bloqueo, Progresión compacta)
 *   2. Escalera   (30 escalones teóricos @1.20 con detalle expandible al tocar)
 *   3. Disciplina (Principio oficial + 12 métricas reales de oportunidades y exposición, sin tope diario)
 *   4. Historial  (Evolución auditable de estados de cada oportunidad y escalón en ARS)
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
  let previewMode = 'demo_opportunity'; // 'demo_opportunity' | 'demo_active_bet' | 'demo_no_bet' | 'base_step0'
  let selectedStepNum = null;

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
      } else if (s.status === 'APROBADO' || s.status === 'EJECUTADO') {
        endCap = startCap * s.odds;
      }
      out.push({
        step: s.step,
        startCapital: startCap,
        odds: s.odds,
        oddsLabel: (s.status === 'APROBADO' || s.status === 'EJECUTADO') ? `${s.odds.toFixed(2)} (Ref.)` : s.odds.toFixed(2),
        endCapital: endCap,
        status: s.status,
        date: s.date,
        note: s.note || '',
        isNext: s.status === 'APROBADO' || s.status === 'EJECUTADO'
      });
    }

    const lastNum = out.length > 0 ? out[out.length - 1].step : 0;
    const hasCurrent = out.some(s => s.status === 'APROBADO' || s.status === 'EJECUTADO');
    let projCap = hasCurrent ? out[out.length - 1].endCapital : cap;

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
          ? 'Supera $ 10.000.000 ARS bajo simulación @ 1.20 (referencia matemática, no obligación).'
          : 'Escalón proyectado con reinversión teórica 100% @ 1.20.',
        isNext: !hasCurrent && i === lastNum + 1
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
        badgeLabel: 'ESTADO BASE — NO OPERATIVO',
        ladderState: 'DISPONIBLE',
        blockReason: null,
        currentStep: 0,
        availableCapital: actualCapital,
        committedCapital: 0,
        progressPct: 0,
        daysWithoutBet: 0,
        steps,
        opportunity: null,
        waitingQueue: [],
        metrics: {
          detected: 0, evaluated: 0, approved: 0, rejected: 0,
          waiting: 0, executed: 0, settled: 0, discardedByCondition: 0,
          avgResolution: '—', won: 0, lost: 0, voidCount: 0
        },
        history: []
      };
    }

    if (mode === 'demo_active_bet') {
      const done = [
        { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-4', note: 'Liquidación confirmada.' },
        { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-2', note: 'Liquidación confirmada.' },
        { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-1', note: 'Void por rotación T-60. Capital preservado.' },
        { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. Hoy 14:00', note: 'Liquidación confirmada — habilitó E5 el mismo día.' },
        { step: 5, odds: 1.20, status: 'EJECUTADO', date: 'Sim. Hoy 17:00', note: 'Capital comprometido en evento en curso. Esperando liquidación oficial.' }
      ];
      const { steps, actualCapital } = buildSteps(done);
      return {
        isDemo: true,
        badgeLabel: 'DEMO — NO OPERATIVO',
        ladderState: 'APUESTA_ACTIVA',
        blockReason: 'Escalón E5 comprometido ($ 86.400 ARS en juego · ventana 17:00–19:30 ART). Ninguna otra oportunidad puede ejecutarse hasta confirmar liquidación oficial.',
        currentStep: 4,
        availableCapital: 0,
        committedCapital: actualCapital,
        progressPct: (3 / CONFIG.totalSteps) * 100,
        daysWithoutBet: 2,
        steps,
        opportunity: null,
        waitingQueue: [
          {
            match: 'Partido Nocturno Demo (20:30 ART)',
            selection: 'Mercado conservador de referencia @ 1.22',
            state: 'EN_ESPERA',
            reason: 'Bloqueo Risk Manager: existe escalón activo (E5). Se reevaluará cuota, Elena y ventana horaria tras la liquidación.'
          }
        ],
        metrics: {
          detected: 12, evaluated: 12, approved: 5, rejected: 5,
          waiting: 1, executed: 5, settled: 4, discardedByCondition: 1,
          avgResolution: '138 min (Demo)', won: 3, lost: 0, voidCount: 1
        },
        history: [
          { date: 'Sim. Hoy 17:05', step: '—', event: 'Partido Nocturno Demo (20:30 ART)', flow: 'DETECTADA → EN_ESPERA', odds: '1.22', capBefore: 86400, capAfter: 86400, status: 'EN_ESPERA' },
          { date: 'Sim. Hoy 17:00', step: 'E5', event: 'Partido Tarde Demo (Capital comprometido)', flow: 'DETECTADA → APROBADA → EJECUTADA', odds: '1.20', capBefore: 86400, capAfter: 86400, status: 'EJECUTADA' },
          { date: 'Sim. Hoy 14:00', step: 'E4', event: 'Partido Mediodía Demo (1º del día liquidado)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
          { date: 'Sim. D-1', step: '—', event: 'Oportunidad B (Cuota cayó 9% mientras esperaba)', flow: 'DETECTADA → EN_ESPERA → DESCARTADA', odds: '1.09', capBefore: 72000, capAfter: 72000, status: 'DESCARTADA' },
          { date: 'Sim. D-1', step: 'E3', event: 'Partido C Demo (Void por rotación T-60)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' }
        ]
      };
    }

    if (mode === 'demo_no_bet') {
      const done = [
        { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-7', note: 'Liquidación confirmada.' },
        { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-5', note: 'Liquidación confirmada.' },
        { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-4', note: 'Void — capital preservado.' },
        { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. D-2', note: 'Liquidación confirmada.' }
      ];
      const { steps, actualCapital } = buildSteps(done);
      return {
        isDemo: true,
        badgeLabel: 'DEMO — NO OPERATIVO',
        ladderState: 'DISPONIBLE',
        blockReason: null,
        currentStep: 4,
        availableCapital: actualCapital,
        committedCapital: 0,
        progressPct: (3 / CONFIG.totalSteps) * 100,
        daysWithoutBet: 4,
        steps,
        opportunity: null,
        waitingQueue: [],
        metrics: {
          detected: 9, evaluated: 9, approved: 4, rejected: 4,
          waiting: 0, executed: 4, settled: 4, discardedByCondition: 1,
          avgResolution: '132 min (Demo)', won: 3, lost: 0, voidCount: 1
        },
        history: [
          { date: 'Sim. Hoy', step: '—', event: 'Día sin oportunidades válidas (capital intacto)', flow: 'SIN_OPORTUNIDADES', odds: '—', capBefore: actualCapital, capAfter: actualCapital, status: 'DIA_SIN_APUESTA' },
          { date: 'Sim. D-2', step: 'E4', event: 'Ejemplo Partido D (Simulación)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
          { date: 'Sim. D-4', step: 'E3', event: 'Ejemplo Partido C (Void — capital intacto)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' }
        ]
      };
    }

    // Default: demo_opportunity (DISPONIBLE con oportunidad lista para decisión manual)
    const done = [
      { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-6', note: 'Liquidación confirmada.' },
      { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-4', note: 'Liquidación confirmada.' },
      { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-3', note: 'Void por rotación T-60.' },
      { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. D-1', note: 'Liquidación confirmada.' },
      { step: 5, odds: 1.20, status: 'APROBADO', date: 'Sim. Hoy', note: 'Aprobada por Elena y validada por Risk Manager (decisión manual pendiente).' }
    ];
    const { steps, actualCapital } = buildSteps(done);
    return {
      isDemo: true,
      badgeLabel: 'DEMO — NO OPERATIVO',
      ladderState: 'DISPONIBLE',
      blockReason: null,
      currentStep: 4,
      availableCapital: actualCapital,
      committedCapital: 0,
      progressPct: (3 / CONFIG.totalSteps) * 100,
      daysWithoutBet: 3,
      steps,
      opportunity: {
        stepNum: 5,
        match: 'Partido de Demostración (Ejemplo Visual)',
        competition: 'Competición Tier 1 · Demo',
        kickoffArt: 'Hoy 17:00 hs (ART)',
        windowArt: 'Ventana estimada: 17:00 – 19:15 hs (sin superposición)',
        market: 'Mercado conservador de referencia',
        selection: 'Selección ilustrativa (No operativa)',
        odds: 1.20,
        projectedCapital: Math.round(actualCapital * 1.20),
        elenaStatus: 'APROBADO',
        riskManagerStatus: 'VALIDADO'
      },
      waitingQueue: [],
      metrics: {
        detected: 11, evaluated: 11, approved: 5, rejected: 5,
        waiting: 0, executed: 4, settled: 4, discardedByCondition: 1,
        avgResolution: '134 min (Demo)', won: 3, lost: 0, voidCount: 1
      },
      history: [
        { date: 'Sim. Hoy', step: 'E5', event: 'Partido de Demostración (Decisión manual pendiente)', flow: 'DETECTADA → EN_EVALUACION → APROBADA', odds: '1.20', capBefore: 86400, capAfter: 103680, status: 'APROBADA' },
        { date: 'Sim. D-1', step: 'E4', event: 'Ejemplo Partido D (Simulación)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
        { date: 'Sim. D-2', step: '—', event: 'Oportunidad rechazada por Risk Manager (superposición horaria)', flow: 'DETECTADA → EN_EVALUACION → RECHAZADA', odds: '1.19', capBefore: 72000, capAfter: 72000, status: 'RECHAZADA' },
        { date: 'Sim. D-3', step: 'E3', event: 'Ejemplo Partido C (Void — capital intacto)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' },
        { date: 'Sim. D-4', step: 'E2', event: 'Ejemplo Partido B (Simulación)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.20', capBefore: 60000, capAfter: 72000, status: 'GANADO' },
        { date: 'Sim. D-6', step: 'E1', event: 'Ejemplo Partido A (Simulación)', flow: 'DETECTADA → APROBADA → EJECUTADA → LIQUIDADA', odds: '1.20', capBefore: 50000, capAfter: 60000, status: 'GANADO' }
      ]
    };
  }

  function ladderStateBadge(state) {
    const map = {
      DISPONIBLE: { cls: 'sem-green', txt: '● DISPONIBLE' },
      OPORTUNIDAD_EN_EVALUACION: { cls: 'sem-violet', txt: '◎ EN EVALUACIÓN' },
      EN_ESPERA: { cls: 'sem-amber', txt: '⏳ EN ESPERA' },
      APUESTA_ACTIVA: { cls: 'sem-blue', txt: '▶ APUESTA ACTIVA' },
      LIQUIDACION_PENDIENTE: { cls: 'sem-amber', txt: '🔒 LIQUIDACIÓN PENDIENTE' },
      DETENIDA: { cls: 'sem-red', txt: '✖ DETENIDA' }
    };
    const c = map[state] || { cls: 'sem-gray', txt: state };
    return `<span class="sem-badge ${c.cls}">${c.txt}</span>`;
  }

  function badgeHtml(status) {
    const map = {
      GANADO: { cls: 'sem-green', txt: '✔ GANADO' },
      APROBADO: { cls: 'sem-violet', txt: '◆ APROBADO' },
      APROBADA: { cls: 'sem-violet', txt: '◆ APROBADA' },
      EJECUTADO: { cls: 'sem-blue', txt: '▶ EJECUTADO' },
      EJECUTADA: { cls: 'sem-blue', txt: '▶ EJECUTADA' },
      LIQUIDADA: { cls: 'sem-green', txt: '✔ LIQUIDADA' },
      EN_ESPERA: { cls: 'sem-amber', txt: '⏳ EN ESPERA' },
      DESCARTADA: { cls: 'lm-badge-void', txt: '⊘ DESCARTADA' },
      RECHAZADA: { cls: 'sem-red', txt: '✕ RECHAZADA' },
      PENDIENTE: { cls: 'sem-gray', txt: '◦ PENDIENTE' },
      ANULADO: { cls: 'lm-badge-void', txt: '⊘ ANULADO' },
      PERDIDO: { cls: 'sem-red', txt: '✖ PERDIDO' },
      DIA_SIN_APUESTA: { cls: 'sem-amber', txt: '🛡️ SIN APUESTA' }
    };
    const c = map[status] || { cls: 'sem-gray', txt: status };
    return `<span class="sem-badge ${c.cls}">${c.txt}</span>`;
  }

  // ==================== 1. PRINCIPAL ====================
  function renderPrincipalTab(st) {
    const totalCap = st.availableCapital + st.committedCapital;
    const remainingArs = Math.max(0, CONFIG.targetCapitalArs - totalCap);
    const wonSteps = st.steps.filter(s => s.status === 'GANADO').length;

    let actionCardHtml = '';
    if (st.blockReason) {
      const waitListHtml = (st.waitingQueue || []).map(w => `
        <div class="lm-wait-item">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;">
            <strong style="color:#f8fafc;font-size:0.82rem;">${w.match}</strong>
            ${badgeHtml(w.state)}
          </div>
          <div style="font-size:0.75rem;color:#cbd5e1;margin-top:0.15rem;">${w.selection}</div>
          <div style="font-size:0.72rem;color:#fbbf24;margin-top:0.2rem;">${w.reason}</div>
        </div>
      `).join('');

      actionCardHtml = `
        <section class="lm-card lm-block-card" aria-label="Estado de exposición y bloqueo secuencial">
          <div class="lm-next-head">
            ${ladderStateBadge(st.ladderState)}
            <span class="lm-demo-tag">Secuencial · 1 escalón activo máx.</span>
          </div>
          <div class="lm-block-msg">${st.blockReason}</div>
          ${waitListHtml}
        </section>
      `;
    } else if (st.opportunity) {
      actionCardHtml = `
        <section class="lm-card lm-next-card" aria-label="Próximo escalón">
          <div class="lm-next-head">
            <span class="sem-badge sem-violet">PRÓXIMO ESCALÓN · E${st.opportunity.stepNum}</span>
            <span class="lm-demo-tag">Simulación · Decisión manual</span>
          </div>
          <div class="lm-next-match">${st.opportunity.match}</div>
          <div class="lm-next-sub">${st.opportunity.competition} · ⏰ ${st.opportunity.kickoffArt}</div>
          <div class="lm-next-sub" style="color:#38bdf8;">🕒 ${st.opportunity.windowArt}</div>
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
      `;
    } else {
      actionCardHtml = `
        <section class="lm-card lm-empty-next" aria-label="Estado sin oportunidad">
          <div class="lm-empty-icon">🛡️</div>
          <div class="lm-empty-title">No hay una oportunidad que cumpla los criterios. Hoy no apostamos.</div>
          <div class="lm-empty-sub">Capital disponible intacto: <strong>${formatArs(st.availableCapital)} ARS</strong>. La escalera avanza solo cuando existe calidad estadística verificada.</div>
        </section>
      `;
    }

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
      <!-- Resumen de Capital + Estado de la Escalera -->
      <section class="lm-capital-hero" aria-label="Resumen de capital y estado">
        <div class="lm-cap-top">
          <div>
            <div style="display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;margin-bottom:0.15rem;">
              <span class="lm-cap-lbl">CAPITAL ACTUAL</span>
              ${ladderStateBadge(st.ladderState)}
            </div>
            <div class="lm-cap-value">${formatArs(totalCap)} <small>ARS</small></div>
            <div class="lm-cap-split">
              Disponible: <strong style="color:#4ade80;">${formatArs(st.availableCapital)}</strong> · Comprometido: <strong style="color:${st.committedCapital > 0 ? '#38bdf8' : '#94a3b8'};">${formatArs(st.committedCapital)}</strong>
            </div>
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

      <!-- Próximo Escalón / Motivo de bloqueo secuencial -->
      ${actionCardHtml}

      <!-- Resumen de Progresión -->
      <section class="lm-card lm-prog-summary" aria-label="Resumen de progresión">
        <div class="lm-sec-head">
          <div>
            <h3 class="lm-sec-title">Progresión</h3>
            <span class="lm-sec-sub">Sin tope diario · Avance secuencial tras liquidación confirmada</span>
          </div>
          <button type="button" class="lm-link-btn" onclick="window.LadderModule.setTab('escalera')">Ver escalera completa →</button>
        </div>
        <div class="lm-step-dots-row">
          ${pillsHtml}
        </div>
      </section>

      <!-- Resumen de Disciplina -->
      <button type="button" class="lm-discipline-strip" onclick="window.LadderModule.setTab('disciplina')">
        <span>🛡️ <strong>Sin límite diario</strong> · Días sin apuesta: ${st.daysWithoutBet} · Ejecución secuencial</span>
        <span class="lm-strip-arrow">Métricas y reglas →</span>
      </button>
    `;
  }

  // ==================== 2. ESCALERA (30 escalones) ====================
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
              <div><strong>Fórmula:</strong> ${formatArs(s.startCapital)} × ${s.odds.toFixed(2)} = <strong>${formatArs(s.endCapital)} ARS</strong></div>
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
            <span class="lm-sec-sub">Tocá cualquier escalón para ver el detalle · Capital se actualiza solo tras liquidación confirmada</span>
          </div>
          <span class="sem-badge sem-violet">Meta: ${formatArs(CONFIG.targetCapitalArs)}</span>
        </div>
        <div class="lm-steps-list">${rowsHtml}</div>
      </section>
    `;
  }

  // ==================== 3. DISCIPLINA (Sin tope diario + 12 métricas reales) ====================
  function renderDisciplinaTab(st) {
    const m = st.metrics;
    return `
      <section class="lm-card" aria-label="Disciplina y métricas de exposición">
        <div class="lm-sec-head" style="margin-bottom:0.75rem;">
          <div>
            <h3 class="lm-sec-title">Disciplina & Control de Exposición</h3>
            <span class="lm-sec-sub">Oportunidades dinámicas · Ejecución secuencial estricta</span>
          </div>
          ${ladderStateBadge(st.ladderState)}
        </div>

        <div class="lm-principle-callout">
          <strong>Principio de disciplina:</strong> "RETO ESCALERA no tiene límite de oportunidades ni calendario obligatorio. Avanza cuando existe una oportunidad válida y espera cuando no existe. Nunca se fuerza una apuesta para cumplir un objetivo."
        </div>

        <div class="lm-kv-list">
          <div class="lm-kv-row"><span>Oportunidades detectadas</span><strong>${m.detected}</strong></div>
          <div class="lm-kv-row"><span>Oportunidades evaluadas</span><strong>${m.evaluated}</strong></div>
          <div class="lm-kv-row"><span>Oportunidades aprobadas (Elena + RM)</span><strong style="color:#c4b5fd;">${m.approved}</strong></div>
          <div class="lm-kv-row"><span>Oportunidades rechazadas</span><strong style="color:#f87171;">${m.rejected}</strong></div>
          <div class="lm-kv-row"><span>Oportunidades en espera (secuencial / ventana)</span><strong style="color:#fbbf24;">${m.waiting}</strong></div>
          <div class="lm-kv-row"><span>Oportunidades ejecutadas (decisión manual)</span><strong style="color:#38bdf8;">${m.executed}</strong></div>
          <div class="lm-kv-row"><span>Oportunidades liquidadas</span><strong>${m.settled}</strong></div>
          <div class="lm-kv-row"><span>Descartadas por cambio de condiciones / cuota</span><strong>${m.discardedByCondition}</strong></div>
          <div class="lm-kv-row"><span>Tiempo medio de resolución</span><strong>${m.avgResolution}</strong></div>
          <div class="lm-kv-row"><span>Escalones ganados / perdidos / anulados</span><strong><span style="color:#4ade80;">${m.won}</span> / <span style="color:#f87171;">${m.lost}</span> / ${m.voidCount}</strong></div>
          <div class="lm-kv-row"><span>Capital comprometido</span><strong style="color:#38bdf8;">${formatArs(st.committedCapital)} ARS</strong></div>
          <div class="lm-kv-row"><span>Capital disponible</span><strong style="color:#4ade80;">${formatArs(st.availableCapital)} ARS</strong></div>
          <div class="lm-kv-row"><span>Umbral de probabilidad de referencia</span><strong style="color:#38bdf8;">95% <small style="color:#94a3b8;font-weight:500;">(pend. validación)</small></strong></div>
          <div class="lm-kv-row"><span>Bloqueo Risk Manager sobre Elena</span><span class="sem-badge sem-green">Vinculante</span></div>
        </div>
      </section>
    `;
  }

  // ==================== 4. HISTORIAL (Evolución de estados por oportunidad) ====================
  function renderHistorialTab(st) {
    const hist = st.history || [];
    if (hist.length === 0) {
      return `
        <section class="lm-card" aria-label="Historial auditable">
          <div class="lm-sec-head"><h3 class="lm-sec-title">Historial Auditable</h3><span class="sem-badge sem-gray">0 registros</span></div>
          <div class="lm-empty-next" style="margin-top:0.75rem;">
            <div class="lm-empty-sub">Todavía no hay transiciones registradas en el Estado Base (E0).</div>
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
        <div style="font-family:var(--font-mono);font-size:0.67rem;color:#38bdf8;">${h.flow}</div>
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
        <td>
          <div style="color:#f8fafc;">${h.event}</div>
          <div style="font-family:var(--font-mono);font-size:0.67rem;color:#38bdf8;margin-top:0.15rem;">${h.flow}</div>
        </td>
        <td style="font-family:var(--font-mono);color:#facc15;font-weight:700;">${h.odds}</td>
        <td style="font-family:var(--font-mono);color:#cbd5e1;white-space:nowrap;">${formatArs(h.capBefore)} → <strong style="color:#4ade80;">${formatArs(h.capAfter)}</strong></td>
        <td>${badgeHtml(h.status)}</td>
      </tr>
    `).join('');

    return `
      <section class="lm-card" aria-label="Historial auditable de oportunidades y estados">
        <div class="lm-sec-head" style="margin-bottom:0.75rem;">
          <div>
            <h3 class="lm-sec-title">Historial Auditable de Estados</h3>
            <span class="lm-sec-sub">Evolución completa: DETECTADA → EVALUADA → APROBADA / EN ESPERA / DESCARTADA → EJECUTADA → LIQUIDADA</span>
          </div>
          <span class="sem-badge sem-gray">${hist.length} registros</span>
        </div>

        <div class="lm-hist-mobile-list">${mobileCards}</div>

        <div class="lm-hist-desktop-table daily-board-container" tabindex="0" role="region" aria-label="Tabla de historial de RETO ESCALERA" style="margin-bottom:0;">
          <table class="daily-board-table">
            <thead>
              <tr>
                <th>FECHA</th>
                <th>ESCALÓN</th>
                <th>OPORTUNIDAD & EVOLUCIÓN DE ESTADOS</th>
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

  // ==================== ORQUESTADOR ====================
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
        <div class="lm-header">
          <div class="lm-header-main">
            <div class="lm-title-line">
              <h2 class="lm-title">RETO ESCALERA</h2>
              <span class="sem-badge ${st.isDemo ? 'sem-amber' : 'sem-blue'}" style="font-size:0.62rem;">${st.badgeLabel}</span>
            </div>
            <div class="lm-slogan">«La magia del interés compuesto»</div>
            <div class="lm-tagline">Un objetivo. Una progresión. Cada paso cuenta.</div>
            <div class="lm-meta-line">
              <span>Base: <strong>${formatArs(CONFIG.initialCapitalArs)} ARS</strong></span>
              <span>·</span>
              <span>Meta: <strong>${formatArs(CONFIG.targetCapitalArs)} ARS</strong></span>
              <span>·</span>
              <span>Secuencial · Sin tope diario</span>
            </div>
          </div>

          <div class="lm-scenario-select" role="group" aria-label="Escenario de vista previa">
            <button type="button" class="lm-sc-btn ${previewMode === 'demo_opportunity' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_opportunity')">Disponible</button>
            <button type="button" class="lm-sc-btn ${previewMode === 'demo_active_bet' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_active_bet')">Apuesta Activa</button>
            <button type="button" class="lm-sc-btn ${previewMode === 'demo_no_bet' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_no_bet')">Sin apuesta</button>
            <button type="button" class="lm-sc-btn ${previewMode === 'base_step0' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('base_step0')">Base E0</button>
          </div>
        </div>

        <nav class="lm-subnav" role="tablist" aria-label="Secciones de RETO ESCALERA">
          <button type="button" role="tab" aria-selected="${activeTab === 'principal'}" class="lm-tab ${activeTab === 'principal' ? 'active' : ''}" onclick="window.LadderModule.setTab('principal')">Principal</button>
          <button type="button" role="tab" aria-selected="${activeTab === 'escalera'}" class="lm-tab ${activeTab === 'escalera' ? 'active' : ''}" onclick="window.LadderModule.setTab('escalera')">Escalera <span class="lm-tab-num">30</span></button>
          <button type="button" role="tab" aria-selected="${activeTab === 'disciplina'}" class="lm-tab ${activeTab === 'disciplina' ? 'active' : ''}" onclick="window.LadderModule.setTab('disciplina')">Disciplina</button>
          <button type="button" role="tab" aria-selected="${activeTab === 'historial'}" class="lm-tab ${activeTab === 'historial' ? 'active' : ''}" onclick="window.LadderModule.setTab('historial')">Historial <span class="lm-tab-num">${st.history.length}</span></button>
        </nav>

        <div class="lm-body">${bodyHtml}</div>
      </div>
    `;
  }

  global.LadderModule = {
    render: renderLadderDashboard,
    setTab: function (tab) { activeTab = tab; renderLadderDashboard(); },
    setPreviewMode: function (mode) { previewMode = mode; renderLadderDashboard(); },
    toggleStepDetail: function (stepNum) { selectedStepNum = selectedStepNum === stepNum ? null : stepNum; renderLadderDashboard(); },
    inspectStep: function (stepNum) { selectedStepNum = stepNum; activeTab = 'escalera'; renderLadderDashboard(); },
    getState: function () { return { activeTab, previewMode, selectedStepNum }; }
  };
})(window);
