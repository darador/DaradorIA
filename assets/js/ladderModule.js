/**
 * DARADORBET — THE LADDER (Gran Escalera)
 * Módulo UI autocontenido (Fase de Diseño Visual — NO OPERATIVO).
 *
 * Componentes:
 *  - LadderDashboard
 *  - LadderProgression
 *  - LadderOpportunityCard
 *  - LadderHistory
 *  - LadderStatistics
 *
 * Restricciones respetadas:
 *  - No modifica motor productivo, Daily Board, filtros, Risk Manager ni históricos.
 *  - No ejecuta apuestas reales ni inventa resultados productivos.
 *  - Todos los ejemplos visuales están explícitamente etiquetados como DEMO / SIMULACIÓN.
 */
(function (global) {
  'use strict';

  let currentPreviewMode = 'demo_opportunity'; // 'demo_opportunity' | 'demo_no_bet' | 'unconfigured'

  const PREVIEW_STATES = {
    unconfigured: {
      isDemoData: false,
      isOperative: false,
      modeLabel: 'ESTADO BASE (SIN CONFIGURAR)',
      summary: {
        initialCapital: 'Por definir',
        currentCapital: 'Por definir',
        targetCapital: 'Por definir',
        currentStep: '0 / —',
        progressPct: 0,
        daysWithoutBet: 0
      },
      discipline: {
        state: 'ESPERANDO',
        label: 'ESPERANDO CONFIGURACIÓN',
        detail: 'Módulo en fase de diseño visual. Capital inicial, objetivo final y umbral estadístico (ref. 95%) pendientes de validación.',
        consecutiveNoBetDays: 0,
        dailySelectionsUsed: '0 / 2 máx.'
      },
      steps: [],
      nextOpportunity: null,
      history: [],
      stats: {
        evaluatedDays: 0,
        noBetDays: 0,
        conversionRate: '—',
        avgOdds: '—',
        avgProb: '—',
        capitalPreservation: '100%'
      }
    },

    demo_opportunity: {
      isDemoData: true,
      isOperative: false,
      modeLabel: 'SIMULACIÓN VISUAL (DEMO — NO OPERATIVO)',
      summary: {
        initialCapital: 'Demo Base (100 u)',
        currentCapital: '148.6 u (Demo)',
        targetCapital: 'Objetivo Demo (1,000 u)',
        currentStep: 'Escalón 4 / 12',
        progressPct: 33.3,
        daysWithoutBet: 3
      },
      discipline: {
        state: 'OPORTUNIDAD_DISPONIBLE',
        label: 'OPORTUNIDAD ELEGIBLE (DEMO)',
        detail: 'Ejemplo ilustrativo: 1 selección cumple doble candado (Elena + Risk Manager) y consenso de modelos. Ejecución estrictamente manual.',
        consecutiveNoBetDays: 0,
        dailySelectionsUsed: '0 / 2 máx.'
      },
      steps: [
        { step: 1, stageCapital: '100.0 u', resultCapital: '112.0 u', odds: '1.12', status: 'GANADO', date: 'Demo D-6', note: 'Reinversión teórica 100%' },
        { step: 2, stageCapital: '112.0 u', resultCapital: '126.6 u', odds: '1.13', status: 'GANADO', date: 'Demo D-4', note: 'Reinversión teórica 100%' },
        { step: 3, stageCapital: '126.6 u', resultCapital: '126.6 u', odds: '1.11', status: 'ANULADO', date: 'Demo D-3', note: 'No titular — capital preservado' },
        { step: 4, stageCapital: '126.6 u', resultCapital: '148.6 u', odds: '1.17', status: 'GANADO', date: 'Demo D-1', note: 'Reinversión teórica 100%' },
        { step: 5, stageCapital: '148.6 u', resultCapital: '—', odds: '1.14 (Ref.)', status: 'APROBADO', date: 'Demo Hoy', note: 'Esperando ejecución manual' },
        { step: 6, stageCapital: '169.4 u (Proy.)', resultCapital: '—', odds: '—', status: 'PENDIENTE', date: 'Próximo', note: 'Escalón futuro' },
        { step: 7, stageCapital: '193.1 u (Proy.)', resultCapital: '—', odds: '—', status: 'PENDIENTE', date: 'Próximo', note: 'Escalón futuro' }
      ],
      nextOpportunity: {
        isDemo: true,
        match: 'Partido de Demostración (Ejemplo Visual)',
        competition: 'Competición Tier 1 · Demo',
        kickoffArt: 'Hoy 17:00 hs (ART)',
        market: 'Mercado conservador de ejemplo',
        selection: 'Selección de demostración (No operativa)',
        odds: '1.14',
        estimatedProb: '95.4% (Demo)',
        ev: '+8.8% (Demo)',
        modelConsensus: '5 / 6 modelos alineados (Ref. Shadow Lab)',
        elenaStatus: 'APROBADO',
        riskManagerStatus: 'VALIDADO',
        lineupsStatus: 'XI Confirmado (T-60) · 20/20',
        dataAvailability: 'Serie histórica completa (Demo)'
      },
      history: [
        { date: 'Demo D-1', step: 'Escalón 4', event: 'Ejemplo Partido D (Mercado Demo)', odds: '1.17', capitalBefore: '126.6 u', capitalAfter: '148.6 u', status: 'GANADO' },
        { date: 'Demo D-2', step: '—', event: 'Día sin apuesta — ningún candidato superó umbral de referencia', odds: '—', capitalBefore: '126.6 u', capitalAfter: '126.6 u', status: 'DIA_SIN_APUESTA' },
        { date: 'Demo D-3', step: 'Escalón 3', event: 'Ejemplo Partido C (Void por rotación T-60)', odds: '1.11', capitalBefore: '126.6 u', capitalAfter: '126.6 u', status: 'ANULADO' },
        { date: 'Demo D-4', step: 'Escalón 2', event: 'Ejemplo Partido B (Mercado Demo)', odds: '1.13', capitalBefore: '112.0 u', capitalAfter: '126.6 u', status: 'GANADO' },
        { date: 'Demo D-5', step: '—', event: 'Día sin apuesta — disciplina de capital aplicada', odds: '—', capitalBefore: '112.0 u', capitalAfter: '112.0 u', status: 'DIA_SIN_APUESTA' },
        { date: 'Demo D-6', step: 'Escalón 1', event: 'Ejemplo Partido A (Mercado Demo)', odds: '1.12', capitalBefore: '100.0 u', capitalAfter: '112.0 u', status: 'GANADO' }
      ],
      stats: {
        evaluatedDays: 7,
        noBetDays: 3,
        conversionRate: '3 / 3 resueltos (Demo)',
        avgOdds: '1.14 (Demo)',
        avgProb: '95.2% (Ref. Demo)',
        capitalPreservation: '100% en días sin apuesta'
      }
    },

    demo_no_bet: {
      isDemoData: true,
      isOperative: false,
      modeLabel: 'SIMULACIÓN VISUAL: DÍA SIN APUESTA (NO OPERATIVO)',
      summary: {
        initialCapital: 'Demo Base (100 u)',
        currentCapital: '148.6 u (Demo)',
        targetCapital: 'Objetivo Demo (1,000 u)',
        currentStep: 'Escalón 4 / 12',
        progressPct: 33.3,
        daysWithoutBet: 4
      },
      discipline: {
        state: 'DIA_SIN_APUESTA',
        label: 'DÍA SIN APUESTA — CAPITAL PRESERVADO',
        detail: 'Ninguna oportunidad de la jornada alcanzó el umbral de referencia (95%) con aprobación conjunta de Elena y Risk Manager. El capital permanece intacto.',
        consecutiveNoBetDays: 2,
        dailySelectionsUsed: '0 / 2 máx.'
      },
      steps: [
        { step: 1, stageCapital: '100.0 u', resultCapital: '112.0 u', odds: '1.12', status: 'GANADO', date: 'Demo D-7', note: 'Reinversión teórica 100%' },
        { step: 2, stageCapital: '112.0 u', resultCapital: '126.6 u', odds: '1.13', status: 'GANADO', date: 'Demo D-5', note: 'Reinversión teórica 100%' },
        { step: 3, stageCapital: '126.6 u', resultCapital: '126.6 u', odds: '1.11', status: 'ANULADO', date: 'Demo D-4', note: 'Capital preservado' },
        { step: 4, stageCapital: '126.6 u', resultCapital: '148.6 u', odds: '1.17', status: 'GANADO', date: 'Demo D-2', note: 'Reinversión teórica 100%' },
        { step: 5, stageCapital: '148.6 u', resultCapital: '—', odds: '—', status: 'PENDIENTE', date: 'Esperando', note: 'Sin candidato elegible hoy' }
      ],
      nextOpportunity: null,
      history: [
        { date: 'Demo Hoy', step: '—', event: 'Día sin apuesta — 0 selecciones con prob. ≥ 95% + doble aprobación', odds: '—', capitalBefore: '148.6 u', capitalAfter: '148.6 u', status: 'DIA_SIN_APUESTA' },
        { date: 'Demo Ayer', step: '—', event: 'Día sin apuesta — vetado por riesgo de rotación', odds: '—', capitalBefore: '148.6 u', capitalAfter: '148.6 u', status: 'DIA_SIN_APUESTA' },
        { date: 'Demo D-2', step: 'Escalón 4', event: 'Ejemplo Partido D (Mercado Demo)', odds: '1.17', capitalBefore: '126.6 u', capitalAfter: '148.6 u', status: 'GANADO' }
      ],
      stats: {
        evaluatedDays: 8,
        noBetDays: 4,
        conversionRate: '3 / 3 resueltos (Demo)',
        avgOdds: '1.14 (Demo)',
        avgProb: '95.2% (Ref. Demo)',
        capitalPreservation: '100% en días sin apuesta'
      }
    }
  };

  function renderStatusBadge(status) {
    const map = {
      PENDIENTE: { cls: 'sem-gray', txt: '◦ PENDIENTE' },
      APROBADO: { cls: 'sem-green', txt: '✓ APROBADO' },
      EJECUTADO: { cls: 'sem-blue', txt: '▶ EJECUTADO' },
      GANADO: { cls: 'sem-green', txt: '✔ GANADO' },
      PERDIDO: { cls: 'sem-red', txt: '✖ PERDIDO' },
      ANULADO: { cls: 'sem-gray', txt: '⊘ ANULADO' },
      DIA_SIN_APUESTA: { cls: 'sem-amber', txt: '🛡️ DÍA SIN APUESTA' },
      OPORTUNIDAD_DISPONIBLE: { cls: 'sem-green', txt: '● OPORTUNIDAD DISPONIBLE' },
      ESPERANDO: { cls: 'sem-blue', txt: '⏳ ESPERANDO' }
    };
    const cfg = map[status] || { cls: 'sem-gray', txt: status || 'PENDIENTE' };
    return `<span class="sem-badge ${cfg.cls}">${cfg.txt}</span>`;
  }

  // 1. Componente LadderProgression
  function renderLadderProgression(steps) {
    if (!steps || steps.length === 0) {
      return `
        <section class="ladder-panel" aria-label="Progresión de escalones">
          <div class="ladder-panel-header">
            <div>
              <h3 class="ladder-panel-title">📈 Progresión de Escalones</h3>
              <p class="ladder-panel-sub">Reinversión teórica del 100% del retorno por etapa validada</p>
            </div>
            <span class="sem-badge sem-gray">0 escalones iniciados</span>
          </div>
          <div class="ladder-empty-box">
            Sin escalones activos todavía. Cuando se configure el capital inicial y se valide el umbral estadístico, aquí se mostrará la curva ascendente de cada etapa.
          </div>
        </section>
      `;
    }

    const maxSteps = steps.length;
    const barsHtml = steps.map((s, idx) => {
      const heightPct = Math.round(28 + ((idx + 1) / maxSteps) * 72);
      const isWon = s.status === 'GANADO';
      const isApproved = s.status === 'APROBADO' || s.status === 'EJECUTADO';
      const isVoid = s.status === 'ANULADO';
      const barCls = isWon ? 'won' : (isApproved ? 'active' : (isVoid ? 'void' : 'pending'));
      return `
        <div class="ladder-step-col" title="Escalón ${s.step}: ${s.stageCapital} · ${s.status}">
          <div class="ladder-step-top-meta">
            <span class="ladder-step-odds">${s.odds}</span>
          </div>
          <div class="ladder-step-bar-track">
            <div class="ladder-step-bar ${barCls}" style="height: ${heightPct}%;">
              <span class="ladder-step-num">E${s.step}</span>
            </div>
          </div>
          <div class="ladder-step-foot">
            <div class="ladder-step-cap">${s.stageCapital}</div>
            <div class="ladder-step-status">${renderStatusBadge(s.status)}</div>
            <div class="ladder-step-date">${s.date}</div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <section class="ladder-panel" aria-label="Progresión ascendente de escalones">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">📈 Progresión Ascendente — Gran Escalera</h3>
            <p class="ladder-panel-sub">Reinversión teórica del 100% del retorno · Capital por etapa, cuota alcanzada y estado auditable</p>
          </div>
          <span class="sem-badge sem-violet">1 Escalera Activa Máx.</span>
        </div>
        <div class="ladder-progression-grid" role="list">
          ${barsHtml}
        </div>
      </section>
    `;
  }

  // 2. Componente LadderOpportunityCard
  function renderLadderOpportunityCard(opp, discipline) {
    if (!opp) {
      return `
        <section class="ladder-panel ladder-opp-panel" aria-label="Próxima oportunidad">
          <div class="ladder-panel-header">
            <div>
              <h3 class="ladder-panel-title">🎯 Próxima Oportunidad</h3>
              <p class="ladder-panel-sub">Filtro estricto: Elena + Risk Manager + consenso de modelos</p>
            </div>
            ${renderStatusBadge(discipline.state)}
          </div>
          <div class="ladder-empty-box">
            <div style="font-size: 1.5rem; margin-bottom: 0.4rem;">🛡️</div>
            <div style="font-weight: 700; color: #f8fafc; margin-bottom: 0.25rem;">${discipline.label}</div>
            <div style="font-size: 0.82rem; color: #94a3b8; max-width: 520px; margin: 0 auto;">${discipline.detail}</div>
          </div>
        </section>
      `;
    }

    return `
      <section class="ladder-panel ladder-opp-panel" aria-label="Próxima oportunidad">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">🎯 Próxima Oportunidad Elegible</h3>
            <p class="ladder-panel-sub">Lectura desde motores existentes · Ejecución estrictamente manual (0 automatización)</p>
          </div>
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
            <span class="sem-badge sem-amber">DEMO VISUAL</span>
            ${renderStatusBadge('APROBADO')}
          </div>
        </div>

        <div class="ladder-opp-main">
          <div class="ladder-opp-match-row">
            <span class="sem-badge sem-violet">${opp.competition}</span>
            <span class="ladder-opp-time">⏰ ${opp.kickoffArt}</span>
          </div>
          <div class="ladder-opp-match">${opp.match}</div>
          <div class="ladder-opp-selection">${opp.market} · <strong>${opp.selection}</strong></div>

          <div class="ladder-opp-metrics-grid">
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">Cuota</span>
              <span class="ladder-mini-val" style="color:#facc15;">${opp.odds}</span>
            </div>
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">Prob. Estimada</span>
              <span class="ladder-mini-val" style="color:#4ade80;">${opp.estimatedProb}</span>
            </div>
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">Valor Esperado (EV)</span>
              <span class="ladder-mini-val" style="color:#4ade80;">${opp.ev}</span>
            </div>
            <div class="ladder-mini-kpi">
              <span class="ladder-mini-lbl">Consenso Modelos</span>
              <span class="ladder-mini-val" style="color:#38bdf8; font-size:0.8rem;">${opp.modelConsensus}</span>
            </div>
          </div>

          <div class="ladder-gates-grid">
            <div class="ladder-gate-item">
              <span class="ladder-gate-lbl">Decisión de Elena</span>
              <span class="sem-badge sem-green">✓ ${opp.elenaStatus}</span>
            </div>
            <div class="ladder-gate-item">
              <span class="ladder-gate-lbl">Risk Manager</span>
              <span class="sem-badge sem-green">🛡️ ${opp.riskManagerStatus}</span>
            </div>
            <div class="ladder-gate-item">
              <span class="ladder-gate-lbl">Alineaciones y Datos</span>
              <span class="sem-badge sem-blue">📋 ${opp.lineupsStatus}</span>
            </div>
          </div>

          <div class="ladder-manual-note">
            🔒 <strong>Modo No Operativo:</strong> Ninguna apuesta se ejecuta automáticamente. Este panel muestra la estructura visual previa a la conexión con el motor validado.
          </div>
        </div>
      </section>
    `;
  }

  // 3. Componente LadderStatistics & Discipline Panel
  function renderLadderStatistics(state) {
    const d = state.discipline;
    const st = state.stats;
    return `
      <section class="ladder-panel" aria-label="Disciplina y Estadísticas de la Escalera">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">🧭 Disciplina & Métricas de Control</h3>
            <p class="ladder-panel-sub">Preservación de capital y cumplimiento de reglas</p>
          </div>
          ${renderStatusBadge(d.state)}
        </div>

        <div class="ladder-discipline-callout">
          <div style="font-weight:700; color:#f8fafc; font-size:0.86rem; margin-bottom:0.2rem;">${d.label}</div>
          <div style="font-size:0.79rem; color:#cbd5e1; line-height:1.45;">${d.detail}</div>
        </div>

        <div class="ladder-stats-list">
          <div class="ladder-stat-row">
            <span>Cupo diario de selecciones</span>
            <strong>${d.dailySelectionsUsed}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Jornadas consecutivas sin selección</span>
            <strong>${d.consecutiveNoBetDays}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Días evaluados / Días sin apuesta</span>
            <strong>${st.evaluatedDays} / ${st.noBetDays}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Escalones resueltos</span>
            <strong>${st.conversionRate}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Cuota media alcanzada</span>
            <strong style="color:#facc15;">${st.avgOdds}</strong>
          </div>
          <div class="ladder-stat-row">
            <span>Probabilidad mínima de referencia</span>
            <strong style="color:#38bdf8;">95% <small style="color:#94a3b8; font-weight:500;">(pend. validación)</small></strong>
          </div>
          <div class="ladder-stat-row">
            <span>Capital en días sin apuesta</span>
            <strong style="color:#4ade80;">${st.capitalPreservation}</strong>
          </div>
        </div>
      </section>
    `;
  }

  // 4. Componente LadderHistory
  function renderLadderHistory(history) {
    const rows = (!history || history.length === 0)
      ? `<tr><td colspan="6" style="text-align:center; padding:1.75rem; color:#94a3b8;">Sin registros de progresión todavía. Cada escalón y cada día sin apuesta se registrará aquí de forma auditable.</td></tr>`
      : history.map(h => `
          <tr>
            <td style="font-family:var(--font-mono); color:#94a3b8; white-space:nowrap;">${h.date}</td>
            <td style="font-weight:700; color:#e2e8f0; white-space:nowrap;">${h.step}</td>
            <td style="color:#f8fafc;">${h.event}</td>
            <td style="font-family:var(--font-mono); color:#facc15; font-weight:700;">${h.odds}</td>
            <td style="font-family:var(--font-mono); color:#cbd5e1; white-space:nowrap;">${h.capitalBefore} → <strong style="color:#4ade80;">${h.capitalAfter}</strong></td>
            <td>${renderStatusBadge(h.status)}</td>
          </tr>
        `).join('');

    return `
      <section class="ladder-panel" aria-label="Historial auditable de progresión">
        <div class="ladder-panel-header">
          <div>
            <h3 class="ladder-panel-title">📜 Historial de Progresión Auditable</h3>
            <p class="ladder-panel-sub">Registro cronológico de escalones ejecutados, anulados y jornadas sin apuesta</p>
          </div>
          <span class="sem-badge sem-gray">${history.length} registros</span>
        </div>
        <div class="daily-board-container" tabindex="0" role="region" aria-label="Tabla de historial de THE LADDER" style="margin-bottom:0;">
          <table class="daily-board-table">
            <thead>
              <tr>
                <th>JORNADA</th>
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

  // 5. Componente Principal LadderDashboard
  function renderLadderDashboard() {
    const root = document.getElementById('viewLadder');
    if (!root) return;

    const state = PREVIEW_STATES[currentPreviewMode] || PREVIEW_STATES.demo_opportunity;
    const s = state.summary;

    root.innerHTML = `
      <div class="ladder-wrapper">
        <!-- Cabecera del módulo + Selector de vista previa (Demo vs Sin Configurar) -->
        <div class="ladder-hero-header">
          <div>
            <div class="ladder-eyebrow">MÓDULO DE INTELIGENCIA FINANCIERA Y DEPORTIVA · FASE VISUAL</div>
            <h2 class="ladder-title">THE LADDER <span class="ladder-title-sub">— Gran Escalera</span></h2>
            <p class="ladder-desc">Progresión disciplinada de capital con reinversión teórica del 100%, doble validación (Elena + Risk Manager) y protección en días sin apuesta.</p>
          </div>
          <div class="ladder-mode-controls">
            <span class="sem-badge ${state.isDemoData ? 'sem-amber' : 'sem-blue'}">${state.modeLabel}</span>
            <div class="ladder-preview-switcher" role="group" aria-label="Selector de vista previa visual">
              <button type="button" class="ladder-switch-btn ${currentPreviewMode === 'demo_opportunity' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_opportunity')">Demo: Oportunidad</button>
              <button type="button" class="ladder-switch-btn ${currentPreviewMode === 'demo_no_bet' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('demo_no_bet')">Demo: Día sin apuesta</button>
              <button type="button" class="ladder-switch-btn ${currentPreviewMode === 'unconfigured' ? 'active' : ''}" onclick="window.LadderModule.setPreviewMode('unconfigured')">Sin configurar</button>
            </div>
          </div>
        </div>

        <!-- Banner de integridad y no-operatividad -->
        <div class="ladder-integrity-banner" role="note">
          <span>🛡️</span>
          <div>
            <strong>Módulo en revisión visual (NO OPERATIVO):</strong> No conectado a apuestas reales, no modifica el Daily Board ni el motor productivo.
            ${state.isDemoData ? 'Los valores mostrados corresponden a <strong>datos de demostración</strong> para validar diseño y jerarquía.' : 'Sin datos simulados: capital inicial y objetivo final pendientes de definición por el usuario.'}
          </div>
        </div>

        <!-- Resumen Superior (6 KPIs) -->
        <section class="ladder-kpi-grid" aria-label="Resumen superior de la Gran Escalera">
          <div class="ladder-kpi-card">
            <span class="ladder-kpi-lbl">Capital Inicial</span>
            <div class="ladder-kpi-val">${s.initialCapital}</div>
            <span class="ladder-kpi-sub">Base de la escalera activa</span>
          </div>
          <div class="ladder-kpi-card">
            <span class="ladder-kpi-lbl">Capital Actual</span>
            <div class="ladder-kpi-val accent-green">${s.currentCapital}</div>
            <span class="ladder-kpi-sub">Intacto en días sin apuesta</span>
          </div>
          <div class="ladder-kpi-card">
            <span class="ladder-kpi-lbl">Objetivo Final</span>
            <div class="ladder-kpi-val accent-cyan">${s.targetCapital}</div>
            <span class="ladder-kpi-sub">Meta de progresión</span>
          </div>
          <div class="ladder-kpi-card">
            <span class="ladder-kpi-lbl">Escalón Actual</span>
            <div class="ladder-kpi-val accent-violet">${s.currentStep}</div>
            <span class="ladder-kpi-sub">1–2 selecciones máx./día</span>
          </div>
          <div class="ladder-kpi-card">
            <span class="ladder-kpi-lbl">Progreso Porcentual</span>
            <div class="ladder-kpi-val">${s.progressPct.toFixed(1)}%</div>
            <div class="ladder-progress-track"><div class="ladder-progress-fill" style="width:${Math.min(100, s.progressPct)}%;"></div></div>
          </div>
          <div class="ladder-kpi-card">
            <span class="ladder-kpi-lbl">Días Sin Apuesta</span>
            <div class="ladder-kpi-val accent-amber">${s.daysWithoutBet}</div>
            <span class="ladder-kpi-sub">Disciplina sin forzar picks</span>
          </div>
        </section>

        <!-- Progresión Ascendente -->
        ${renderLadderProgression(state.steps)}

        <!-- Grid 2 columnas: Próxima Oportunidad + Disciplina / Estadísticas -->
        <div class="ladder-two-col">
          ${renderLadderOpportunityCard(state.nextOpportunity, state.discipline)}
          ${renderLadderStatistics(state)}
        </div>

        <!-- Historial Auditable -->
        ${renderLadderHistory(state.history)}
      </div>
    `;
  }

  global.LadderModule = {
    render: renderLadderDashboard,
    setPreviewMode: function (mode) {
      if (PREVIEW_STATES[mode]) {
        currentPreviewMode = mode;
        renderLadderDashboard();
      }
    },
    getPreviewMode: function () {
      return currentPreviewMode;
    }
  };
})(window);
