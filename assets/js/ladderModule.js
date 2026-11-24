/**
 * DARADORBET — THE LADDER (Gran Escalera)
 * Módulo UI refinado (Fase de Diseño Visual — NO OPERATIVO).
 *
 * Configuración oficial de referencia:
 *  - Capital inicial: $ 50.000 ARS
 *  - Objetivo final:  $ 10.000.000 ARS
 *  - Reinversión teórica: 100% (capital_siguiente = capital_actual × cuota)
 *  - Cuota de referencia de simulación: 1.20 (30 escalones → $ 11.868.816 ARS)
 *
 * Componentes:
 *  - LadderDashboard (Encabezado + Franja compacta de indicadores)
 *  - LadderProgression (Protagonista central: curva ascendente + vista completa 30 escalones)
 *  - LadderOpportunityCard (Simplificada, con consenso de modelos desplegable)
 *  - LadderStatistics (Disciplina y métricas de control)
 *  - LadderHistory (Historial auditable completo en ARS)
 */
(function (global) {
  'use strict';

  const CONFIG = Object.freeze({
    initialCapitalArs: 50000,
    targetCapitalArs: 10000000,
    simOdds: 1.20,
    totalSteps: 30
  });

  const arsFormatter = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 0
  });

  function formatArs(amount) {
    if (amount === null || amount === undefined || isNaN(Number(amount))) return '—';
    return '$ ' + arsFormatter.format(Math.round(Number(amount)));
  }

  // Genera la proyección teórica exacta de los 30 escalones desde un capital y escalón dados
  function buildSimulatedSteps(completedSteps, simOdds = CONFIG.simOdds) {
    const out = [];
    let currentCap = CONFIG.initialCapitalArs;

    // 1. Escalones históricos de demostración (si existen)
    for (const s of completedSteps) {
      const startCap = currentCap;
      let endCap = startCap;
      if (s.status === 'GANADO') {
        endCap = startCap * s.odds;
        currentCap = endCap;
      } else if (s.status === 'ANULADO') {
        endCap = startCap; // Capital intacto
      } else if (s.status === 'APROBADO') {
        endCap = startCap * s.odds; // Proyectado si se gana
      }
      out.push({
        step: s.step,
        startCapital: startCap,
        odds: s.odds,
        oddsLabel: s.status === 'APROBADO' ? `${s.odds.toFixed(2)} (Ref.)` : s.odds.toFixed(2),
        endCapital: endCap,
        status: s.status,
        date: s.date,
        isNext: s.status === 'APROBADO',
        isProjected: s.status === 'APROBADO'
      });
    }

    // 2. Completar hasta el escalón 30 con la cuota de referencia de simulación (1.20)
    const lastStepNum = out.length > 0 ? out[out.length - 1].step : 0;
    const hasActiveApproved = out.some(s => s.status === 'APROBADO');
    let projCap = hasActiveApproved ? out[out.length - 1].endCapital : currentCap;

    for (let i = lastStepNum + 1; i <= CONFIG.totalSteps; i++) {
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
        isNext: !hasActiveApproved && i === lastStepNum + 1,
        isProjected: true
      });
      projCap = endCap;
    }

    return { steps: out, actualCapital: currentCap };
  }

  let currentPreviewMode = 'demo_opportunity'; // 'demo_opportunity' | 'demo_no_bet' | 'base_step0'
  let showAll30Steps = false;

  function getPreviewState(mode) {
    if (mode === 'base_step0') {
      const { steps, actualCapital } = buildSimulatedSteps([]);
      return {
        isDemoData: false,
        isOperative: false,
        modeLabel: 'ESTADO BASE — ESCALÓN 0 (NO OPERATIVO)',
        currentStep: 0,
        currentCapital: actualCapital,
        progressPct: 0,
        daysWithoutBet: 0,
        discipline: {
          state: 'ESPERANDO',
          label: 'ESPERANDO ACTIVACIÓN Y VALIDACIÓN',
          detail: 'Configuración oficial lista ($ 50.000 → $ 10.000.000 ARS). Sin apuestas ni resultados ficticios. Umbral 95% pendiente de validación estadística.',
          consecutiveNoBetDays: 0,
          dailySelectionsUsed: '0 / 2 máx.'
        },
        steps,
        nextOpportunity: null,
        history: [],
        stats: {
          evaluatedDays: 0,
          noBetDays: 0,
          resolvedSteps: '0 / 30',
          avgOdds: '—',
          refProb: '95% (pend. validación)'
        }
      };
    }

    if (mode === 'demo_no_bet') {
      const demoDone = [
        { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-7' },
        { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-5' },
        { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-4' },
        { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. D-2' }
      ];
      const { steps, actualCapital } = buildSimulatedSteps(demoDone);
      const wonCount = 3;
      const progressPct = (wonCount / CONFIG.totalSteps) * 100;
      return {
        isDemoData: true,
        isOperative: false,
        modeLabel: 'SIMULACIÓN VISUAL: DÍA SIN APUESTA (NO OPERATIVO)',
        currentStep: 4,
        currentCapital: actualCapital,
        progressPct,
        daysWithoutBet: 4,
        discipline: {
          state: 'DIA_SIN_APUESTA',
          label: 'DÍA SIN APUESTA — CAPITAL PRESERVADO',
          detail: 'Ninguna oportunidad cumplió el umbral de referencia con doble aprobación (Elena + Risk Manager). El capital se mantiene intacto en ' + formatArs(actualCapital) + ' ARS.',
          consecutiveNoBetDays: 2,
          dailySelectionsUsed: '0 / 2 máx.'
        },
        steps,
        nextOpportunity: null,
        history: [
          { date: 'Sim. Hoy', step: '—', event: 'Día sin apuesta — 0 selecciones elegibles (disciplina aplicada)', odds: '—', capBefore: actualCapital, capAfter: actualCapital, status: 'DIA_SIN_APUESTA' },
          { date: 'Sim. Ayer', step: '—', event: 'Día sin apuesta — candidato vetado por riesgo de rotación T-60', odds: '—', capBefore: actualCapital, capAfter: actualCapital, status: 'DIA_SIN_APUESTA' },
          { date: 'Sim. D-2', step: 'Escalón 4', event: 'Ejemplo Partido D (Simulación visual)', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
          { date: 'Sim. D-4', step: 'Escalón 3', event: 'Ejemplo Partido C (Anulado por no titularidad — capital intacto)', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' },
          { date: 'Sim. D-5', step: 'Escalón 2', event: 'Ejemplo Partido B (Simulación visual)', odds: '1.20', capBefore: 60000, capAfter: 72000, status: 'GANADO' },
          { date: 'Sim. D-7', step: 'Escalón 1', event: 'Ejemplo Partido A (Simulación visual)', odds: '1.20', capBefore: 50000, capAfter: 60000, status: 'GANADO' }
        ],
        stats: {
          evaluatedDays: 8,
          noBetDays: 4,
          resolvedSteps: '3 ganados · 1 anulado (Demo)',
          avgOdds: '1.20 (Sim.)',
          refProb: '95% (pend. validación)'
        }
      };
    }

    // Default: demo_opportunity
    const demoDone = [
      { step: 1, odds: 1.20, status: 'GANADO', date: 'Sim. D-6' },
      { step: 2, odds: 1.20, status: 'GANADO', date: 'Sim. D-4' },
      { step: 3, odds: 1.18, status: 'ANULADO', date: 'Sim. D-3' },
      { step: 4, odds: 1.20, status: 'GANADO', date: 'Sim. D-1' },
      { step: 5, odds: 1.20, status: 'APROBADO', date: 'Sim. Hoy' }
    ];
    const { steps, actualCapital } = buildSimulatedSteps(demoDone);
    const wonCount = 3;
    const progressPct = (wonCount / CONFIG.totalSteps) * 100;

    return {
      isDemoData: true,
      isOperative: false,
      modeLabel: 'SIMULACIÓN VISUAL (DEMO — NO OPERATIVO)',
      currentStep: 4,
      currentCapital: actualCapital,
      progressPct,
      daysWithoutBet: 3,
      discipline: {
        state: 'OPORTUNIDAD_DISPONIBLE',
        label: 'OPORTUNIDAD ELEGIBLE (SIMULACIÓN)',
        detail: 'Escenario ilustrativo: 1 selección cumple doble candado (Elena + Risk Manager). Ejecución estrictamente manual.',
        consecutiveNoBetDays: 0,
        dailySelectionsUsed: '0 / 2 máx.'
      },
      steps,
      nextOpportunity: {
        match: 'Partido de Demostración (Ejemplo Visual)',
        competition: 'Competición Tier 1 · Demo',
        kickoffArt: 'Hoy 17:00 hs (ART)',
        market: 'Mercado conservador de referencia',
        selection: 'Selección ilustrativa (No operativa)',
        odds: '1.20',
        estimatedProb: 'Ref. ≥ 95% (Demo · sin validar)',
        ev: '+14.0% (Simulación)',
        elenaStatus: 'APROBADO',
        riskManagerStatus: 'VALIDADO',
        lineupsStatus: 'XI Confirmado (T-60) · Datos 20/20',
        consensusDetail: 'Ejemplo visual de consenso multi-modelo (V1, V2, Model B, Model C, Beta-Binomial, Ensemble v2). En fase operativa leerá directamente desde Shadow Lab v2.3 sin duplicar cálculos.'
      },
      history: [
        { date: 'Sim. Hoy', step: 'Escalón 5', event: 'Partido de Demostración (Aprobado — ejecución manual pendiente)', odds: '1.20', capBefore: 86400, capAfter: 103680, status: 'APROBADO' },
        { date: 'Sim. D-1', step: 'Escalón 4', event: 'Ejemplo Partido D (Simulación visual)', odds: '1.20', capBefore: 72000, capAfter: 86400, status: 'GANADO' },
        { date: 'Sim. D-2', step: '—', event: 'Día sin apuesta — ningún candidato superó umbral de referencia', odds: '—', capBefore: 72000, capAfter: 72000, status: 'DIA_SIN_APUESTA' },
        { date: 'Sim. D-3', step: 'Escalón 3', event: 'Ejemplo Partido C (Anulado por no titularidad — capital intacto)', odds: '1.18', capBefore: 72000, capAfter: 72000, status: 'ANULADO' },
        { date: 'Sim. D-4', step: 'Escalón 2', event: 'Ejemplo Partido B (Simulación visual)', odds: '1.20', capBefore: 60000, capAfter: 72000, status: 'GANADO' },
        { date: 'Sim. D-5', step: '—', event: 'Día sin apuesta — disciplina de capital aplicada', odds: '—', capBefore: 60000, capAfter: 60000, status: 'DIA_SIN_APUESTA' },
        { date: 'Sim. D-6', step: 'Escalón 1', event: 'Ejemplo Partido A (Simulación visual)', odds: '1.20', capBefore: 50000, capAfter: 60000, status: 'GANADO' }
      ],
      stats: {
        evaluatedDays: 7,
        noBetDays: 3,
        resolvedSteps: '3 ganados · 1 anulado (Demo)',
        avgOdds: '1.20 (Sim.)',
        refProb: '95% (pend. validación)'
      }
    };
  }

  function renderStatusBadge(status) {
    const map = {
      GANADO: { cls: 'sem-green', txt: '✔ GANADO' },
      APROBADO: { cls: 'sem-violet', txt: '◆ APROBADO' },
      EJECUTADO: { cls: 'sem-blue', txt: '▶ EJECUTADO' },
      PENDIENTE: { cls: 'sem-gray', txt: '◦ PENDIENTE' },
      ANULADO: { cls: 'ladder-badge-void', txt: '⊘ ANULADO' },
      PERDIDO: { cls: 'sem-red', txt: '✖ PERDIDO' },
      DIA_SIN_APUESTA: { cls: 'sem-amber', txt: '🛡️ DÍA SIN APUESTA' },
      OPORTUNIDAD_DISPONIBLE: { cls: 'sem-green', txt: '● OPORTUNIDAD' },
      ESPERANDO: { cls: 'sem-blue', txt: '⏳ ESPERANDO' }
    };
    const cfg = map[status] || { cls: 'sem-gray', txt: status || 'PENDIENTE' };
    return `<span class="sem-badge ${cfg.cls}">${cfg.txt}</span>`;
  }

  // 1. PROTAGONISTA: Progresión Ascendente — Gran Escalera (30 escalones @ 1.20)
  function renderLadderProgression(state) {
    const steps = state.steps || [];
    const finalStep = steps[steps.length - 1];
    const remainingToTarget = Math.max(0, CONFIG.targetCapitalArs - state.currentCapital);
    const completedWon = steps.filter(s => s.status === 'GANADO').length;
    const remainingSteps = Math.max(0, CONFIG.totalSteps - completedWon);

    // Vista enfocada (primeros 6 escalones + hitos clave E10, E15, E20, E25, E30) o todos los 30
    const visibleSteps = showAll30Steps
      ? steps
      : steps.filter(s => s.step <= 6 || [10, 15, 20, 25, 30].includes(s.step));

    const cardsHtml = visibleSteps.map((s, idx) => {
      const prevStep = idx > 0 ? visibleSteps[idx - 1].step : 0;
      const isJump = !showAll30Steps && idx > 0 && (s.step - prevStep > 1);
      const statusCls = s.status === 'GANADO'
        ? 'st-won'
        : (s.status === 'APROBADO' || s.isNext)
          ? 'st-next'
          : s.status === 'ANULADO'
            ? 'st-void'
            : s.status === 'PERDIDO'
              ? 'st-lost'
              : 'st-pending';

      const heightPct = Math.round(22 + (s.step / CONFIG.totalSteps) * 78);

      return `
        ${isJump ? `<div class="ladder-step-gap" aria-hidden="true">···</div>` : ''}
        <article class="ladder-stage-card ${statusCls}" role="listitem" title="Escalón ${s.step}: ${formatArs(s.startCapital)} × ${s.odds.toFixed(2)} = ${formatArs(s.endCapital)}">
          <div class="ladder-stage-top">
            <span class="ladder-stage-num">E${s.step}</span>
            ${s.isNext ? `<span class="ladder-next-tag">PRÓXIMO</span>` : `<span class="ladder-stage-date">${s.date}</span>`}
          </div>

          <div class="ladder-stage-bar-wrap" aria-hidden="true">
            <div class="ladder-stage-bar" style="height: ${heightPct}%;"></div>
          </div>

          <div class="ladder-stage-numbers">
            <div class="ladder-stage-row">
              <span>Inicio</span>
              <strong>${formatArs(s.startCapital)}</strong>
            </div>
            <div class="ladder-stage-row">
              <span>Cuota</span>
              <strong class="odds-val">${s.oddsLabel}</strong>
            </div>
            <div class="ladder-stage-row result-row">
              <span>Resultado</span>
              <strong class="res-val">${formatArs(s.endCapital)}</strong>
            </div>
          </div>

          <div class="ladder-stage-foot">
            ${renderStatusBadge(s.status)}
          </div>
        </article>
      `;
    }).join('');

    return `
      <section class="ladder-hero-progression" aria-label="Progresión Ascendente — Gran Escalera">
        <div class="ladder-prog-header">
          <div>
            <div class="ladder-prog-title-row">
              <h3 class="ladder-panel-title">📈 Progresión Ascendente — Gran Escalera</h3>
              <span class="sem-badge sem-violet">Simulación @ 1.20 · 30 escalones</span>
            </div>
            <p class="ladder-panel-sub">
              Avance: <strong style="color:#4ade80;">${completedWon} de ${CONFIG.totalSteps} escalones ganados</strong> ·
              Restan <strong style="color:#38bdf8;">${remainingSteps} escalones</strong> (${formatArs(remainingToTarget)} ARS para alcanzar ${formatArs(CONFIG.targetCapitalArs)} · E30 proyecta ${formatArs(finalStep ? finalStep.endCapital : 11868816)})
            </p>
          </div>
          <button type="button" class="ladder-toggle-all-btn" onclick="window.LadderModule.toggleAllSteps()">
            ${showAll30Steps ? '⤡ Vista enfocada (Hitos)' : '⤢ Ver los 30 escalones completos'}
          </button>
        </div>

        <div class="ladder-formula-note">
          <span>Fórmula: <code>capital_siguiente = capital_actual × cuota</code> (reinversión teórica 100%)</span>
          <span>·</span>
          <span>Cuota <strong>1.20</strong> es solo escenario de simulación, no obligación operativa.</span>
        </div>

        <div class="ladder-stages-track ${showAll30Steps ? 'is-expanded' : ''}" role="list">
          ${cardsHtml}
        </div>
      </section>
    `;
  }

  // 2. Panel Próxima Oportunidad (simplificado + consenso desplegable)
  function renderLadderOpportunityCard(opp, discipline) {
    if (!opp) {
      return `
        <section class="ladder-panel" aria-label="Próxima oportunidad">
          <div class="ladder-panel-header">
            <div>
              <h3 class="ladder-panel-title">🎯 Próxima Oportunidad</h3>
              <p class="ladder-panel-sub">Doble filtro obligatorio: Elena + Risk Manager</p>
            </div>
            ${renderStatusBadge(discipline.state)}
          </div>
          <div class="ladder-empty-box">
            <div style="font-weight: 700; color: #f8fafc; margin-bottom: 0.25rem;">${discipline.label}</div>
            <div style="font-size: 0.8rem; color: #94a3b8; max-width: 480px; margin: 0 auto;">${discipline.detail}</div>
          </div>
        </section>
      `;
    }

    return `
      <section class="ladder-panel" aria-label="Próxima oportunidad elegible">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">🎯 Próxima Oportunidad Elegible</h3>
            <p class="ladder-panel-sub">Ejecución manual · Sin automatización de apuestas</p>
          </div>
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
            <span class="sem-badge sem-amber">DEMO VISUAL</span>
            ${renderStatusBadge('APROBADO')}
          </div>
        </div>

        <div class="ladder-opp-compact">
          <div class="ladder-opp-match-row">
            <span class="sem-badge sem-violet">${opp.competition}</span>
            <span class="ladder-opp-time">⏰ ${opp.kickoffArt}</span>
          </div>
          <div class="ladder-opp-match">${opp.match}</div>
          <div class="ladder-opp-selection">${opp.market} · <strong>${opp.selection}</strong></div>

          <div class="ladder-opp-metrics-3">
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">Cuota</span>
              <span class="ladder-mini-val" style="color:#facc15;">${opp.odds}</span>
            </div>
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">Prob. Estimada</span>
              <span class="ladder-mini-val" style="color:#4ade80; font-size:0.84rem;">${opp.estimatedProb}</span>
            </div>
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">EV Esperado</span>
              <span class="ladder-mini-val" style="color:#4ade80; font-size:0.88rem;">${opp.ev}</span>
            </div>
          </div>

          <div class="ladder-gates-grid">
            <div class="ladder-gate-item">
              <span class="ladder-gate-lbl">Elena</span>
              <span class="sem-badge sem-green">✓ ${opp.elenaStatus}</span>
            </div>
            <div class="ladder-gate-item">
              <span class="ladder-gate-lbl">Risk Manager</span>
              <span class="sem-badge sem-green">🛡️ ${opp.riskManagerStatus}</span>
            </div>
            <div class="ladder-gate-item">
              <span class="ladder-gate-lbl">Alineaciones / Datos</span>
              <span class="sem-badge sem-blue">📋 ${opp.lineupsStatus}</span>
            </div>
          </div>

          <details class="ladder-consensus-details">
            <summary>📊 Consenso de modelos (detalle secundario)</summary>
            <p>${opp.consensusDetail}</p>
          </details>

          <div class="ladder-manual-note">
            🔒 <strong>Ejecución 100% manual:</strong> ninguna apuesta se ejecuta automáticamente ni se modifica el capital real.
          </div>
        </div>
      </section>
    `;
  }

  // 3. Panel Disciplina y Métricas de Control (6 indicadores priorizados)
  function renderLadderStatistics(state) {
    const d = state.discipline;
    const st = state.stats;
    return `
      <section class="ladder-panel" aria-label="Disciplina y Métricas de Control">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">🧭 Disciplina & Control</h3>
            <p class="ladder-panel-sub">Preservación estricta de capital</p>
          </div>
          ${renderStatusBadge(d.state)}
        </div>

        <div class="ladder-philosophy-box">
          <strong>Principio de disciplina:</strong> No apostar también es una decisión válida. Nunca se incentiva una selección solamente para avanzar un escalón; los días sin apuesta no modifican el capital.
        </div>

        <div class="ladder-stats-list">
          <div class="ladder-stat-row">
            <span>Selecciones del día / máx. permitido</span>
            <strong>${d.dailySelectionsUsed}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Jornadas consecutivas sin selección</span>
            <strong>${d.consecutiveNoBetDays}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Días evaluados / días sin apuesta</span>
            <strong>${st.evaluatedDays} / ${st.noBetDays}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Escalones resueltos</span>
            <strong>${st.resolvedSteps}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Cuota media alcanzada</span>
            <strong style="color:#facc15;">${st.avgOdds}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Probabilidad mínima de referencia</span>
            <strong style="color:#38bdf8;">${st.refProb}</strong>
          </div>
        </div>
      </section>
    `;
  }

  // 4. Historial Auditable en ARS
  function renderLadderHistory(history) {
    const rows = (!history || history.length === 0)
      ? `<tr><td colspan="6" style="text-align:center; padding:1.6rem; color:#94a3b8;">Sin registros de progresión todavía. Cada escalón y cada día sin apuesta se registrará aquí de forma auditable en ARS.</td></tr>`
      : history.map(h => `
          <tr>
            <td style="font-family:var(--font-mono); color:#94a3b8; white-space:nowrap;">${h.date}</td>
            <td style="font-weight:700; color:#e2e8f0; white-space:nowrap;">${h.step}</td>
            <td style="color:#f8fafc;">${h.event}</td>
            <td style="font-family:var(--font-mono); color:#facc15; font-weight:700;">${h.odds}</td>
            <td style="font-family:var(--font-mono); color:#cbd5e1; white-space:nowrap;">${formatArs(h.capBefore)} → <strong style="color:#4ade80;">${formatArs(h.capAfter)}</strong></td>
            <td>${renderStatusBadge(h.status)}</td>
          </tr>
        `).join('');

    return `
      <section class="ladder-panel" aria-label="Historial auditable de progresión">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">📜 Historial Auditable de Progresión</h3>
            <p class="ladder-panel-sub">Escalones ganados, anulados, aprobados, perdidos y días sin apuesta registrados en ARS</p>
          </div>
          <span class="sem-badge sem-gray">${history.length} registros</span>
        </div>
        <div class="daily-board-container" tabindex="0" role="region" aria-label="Tabla de historial de THE LADDER" style="margin-bottom:0;">
          <table class="daily-board-table">
            <thead>
              <tr>
                <th>FECHA</th>
                <th>ESCALÓN</th>
                <th>EVENTO / REGISTRO DE DISCIPLINA</th>
                <th>CUOTA</th>
                <th>CAPITAL (ANTES → DESPUÉS)</th>
                <th>ESTADO</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  // 5. Orquestador Principal: LadderDashboard
  function renderLadderDashboard() {
    const root = document.getElementById('viewLadder');
    if (!root) return;

    const state = getPreviewState(currentPreviewMode);

    root.innerHTML = `
      <div class="ladder-wrapper">
        <!-- 1. Encabezado compacto + configuración base ($ 50.000 ARS) + selector de vista -->
        <div class="ladder-hero-header">
          <div>
            <div class="ladder-eyebrow">
              <span>THE LADDER · GRAN ESCALERA</span>
              <span class="ladder-config-pill">Base: ${formatArs(CONFIG.initialCapitalArs)} ARS</span>
              <span class="ladder-config-pill">Meta: ${formatArs(CONFIG.targetCapitalArs)} ARS</span>
              <span class="ladder-config-pill">1 Escalera Activa</span>
            </div>
            <h2 class="ladder-title">Progresión Estratégica de Capital</h2>
          </div>
          <div class="ladder-mode-controls">
            <span class="sem-badge ${state.isDemoData ? 'sem-amber' : 'sem-blue'}">${state.modeLabel}</span>
            <div class="ladder-preview-switcher" role="group" aria-label="Selector de escenario visual">
              <button type="button" class="ladder-switch-btn ${currentPreviewMode === 'demo_opportunity' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_opportunity')">Simulación: Oportunidad</button>
              <button type="button" class="ladder-switch-btn ${currentPreviewMode === 'demo_no_bet' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_no_bet')">Simulación: Día sin apuesta</button>
              <button type="button" class="ladder-switch-btn ${currentPreviewMode === 'base_step0' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('base_step0')">Estado Base (E0)</button>
            </div>
          </div>
        </div>

        <!-- Aviso compacto de no-operatividad -->
        <div class="ladder-integrity-banner" role="note">
          <span>🛡️</span>
          <span>
            <strong>Módulo visual (NO OPERATIVO):</strong> sin conexión a apuestas reales ni modificación de módulos productivos.
            ${state.isDemoData ? 'Los escalones ejecutados, probabilidades y EV mostrados son <strong>simulación visual (demo)</strong>; el umbral 95% está pendiente de validación estadística.' : 'Mostrando configuración oficial base ($ 50.000 → $ 10.000.000 ARS) sin datos simulados.'}
          </span>
        </div>

        <!-- 2. Franja compacta de indicadores superiores (5 KPIs, altura reducida ~55%) -->
        <section class="ladder-kpi-strip" aria-label="Indicadores principales de THE LADDER">
          <div class="ladder-strip-item">
            <span class="ladder-strip-lbl">Capital Actual</span>
            <span class="ladder-strip-val accent-green">${formatArs(state.currentCapital)} <small>ARS</small></span>
          </div>
          <div class="ladder-strip-item">
            <span class="ladder-strip-lbl">Objetivo Final</span>
            <span class="ladder-strip-val accent-cyan">${formatArs(CONFIG.targetCapitalArs)} <small>ARS</small></span>
          </div>
          <div class="ladder-strip-item">
            <span class="ladder-strip-lbl">Escalón Actual</span>
            <span class="ladder-strip-val accent-violet">E${state.currentStep} <small>/ ${CONFIG.totalSteps}</small></span>
          </div>
          <div class="ladder-strip-item">
            <span class="ladder-strip-lbl">Progreso</span>
            <div class="ladder-strip-prog">
              <span class="ladder-strip-val">${state.progressPct.toFixed(1)}%</span>
              <div class="ladder-progress-track"><div class="ladder-progress-fill" style="width:${Math.min(100, state.progressPct)}%;"></div></div>
            </div>
          </div>
          <div class="ladder-strip-item">
            <span class="ladder-strip-lbl">Días Sin Apuesta</span>
            <span class="ladder-strip-val accent-amber">${state.daysWithoutBet}</span>
          </div>
        </section>

        <!-- 3. PROTAGONISTA: Progresión Ascendente de la Gran Escalera -->
        ${renderLadderProgression(state)}

        <!-- 4. Próxima Oportunidad (simplificada) + Disciplina y Control -->
        <div class="ladder-two-col">
          ${renderLadderOpportunityCard(state.nextOpportunity, state.discipline)}
          ${renderLadderStatistics(state)}
        </div>

        <!-- 5. Historial Auditable -->
        ${renderLadderHistory(state.history)}
      </div>
    `;
  }

  global.LadderModule = {
    render: renderLadderDashboard,
    setPreviewMode: function (mode) {
      currentPreviewMode = mode;
      renderLadderDashboard();
    },
    toggleAllSteps: function () {
      showAll30Steps = !showAll30Steps;
      renderLadderDashboard();
    },
    getPreviewMode: function () {
      return currentPreviewMode;
    }
  };
})(window);
