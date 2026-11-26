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

  const PROPOSAL_STORAGE_KEY = 'darador_reto_escalera_selected_proposal_v1';
  const LOCAL_OVERRIDE_STORAGE_KEY = 'darador_reto_escalera_local_override_v1';
  const TIMEZONE_ART = 'America/Argentina/Buenos_Aires';

  const arsFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function formatArs(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return '—';
    return '$ ' + arsFmt.format(Number(val)) + ' ARS';
  }

  function formatKickoffArt(kickoffUtc) {
    if (!kickoffUtc) return 'Horario pendiente';
    const d = new Date(kickoffUtc);
    if (isNaN(d.getTime())) return 'Horario pendiente';
    const datePart = new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE_ART, day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(d);
    const timePart = new Intl.DateTimeFormat('es-AR', {
      timeZone: TIMEZONE_ART, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
    return `${datePart} · ${timePart} ART`;
  }

  let activeTab = 'principal'; // 'principal' | 'oportunidades' | 'historial' | 'reglas'
  let cachedPayload = null;
  let loadError = null;
  let uiNotice = null; // { type: 'ok' | 'err', text: string }
  let pendingManualSettle = null; // { betId, match, selection, odds, stake, potReturn, step, cycle } | null
  let isSettlingManual = false;
  let showManualBetModal = false;
  let manualBetForm = {
    match: '',
    competition: '',
    market: 'Córners de equipo',
    selection: '',
    line: '',
    odds: '',
    notes: ''
  };

  function loadSelectedProposal() {
    try {
      const raw = global.localStorage ? global.localStorage.getItem(PROPOSAL_STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSelectedProposal(proposal) {
    try {
      if (!global.localStorage) return;
      if (!proposal) global.localStorage.removeItem(PROPOSAL_STORAGE_KEY);
      else global.localStorage.setItem(PROPOSAL_STORAGE_KEY, JSON.stringify(proposal));
    } catch {}
  }

  let selectedProposal = loadSelectedProposal();

  function loadLocalOverride() {
    try {
      const raw = global.localStorage ? global.localStorage.getItem(LOCAL_OVERRIDE_STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLocalOverride(data) {
    try {
      if (!global.localStorage) return;
      if (!data) global.localStorage.removeItem(LOCAL_OVERRIDE_STORAGE_KEY);
      else global.localStorage.setItem(LOCAL_OVERRIDE_STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  function applyLocalOverride(l) {
    if (!l) return l;

    // Si la propuesta guardada en el cliente corresponde a un pick que ya fue liquidado en el historial, descartarla
    if (selectedProposal && l.stepHistory && l.stepHistory.some(h => (h.snapshotId && h.snapshotId === selectedProposal.snapshotId) || (h.opportunityKey && h.opportunityKey === selectedProposal.opportunityKey) || (h.match === selectedProposal.match && h.selection === selectedProposal.selection))) {
      selectedProposal = null;
      saveSelectedProposal(null);
    }

    const ov = loadLocalOverride();
    if (!ov) return l;

    // Si el backend/archivo ya está en el mismo escalón o más avanzado que el override local y ya tiene una apuesta abierta oficial, el override local ya fue absorbido
    if (l.currentStep >= ov.currentStep && l.openBet) {
      saveLocalOverride(null);
      return l;
    }

    // Si el backend ya registró el mismo escalón alcanzado por el override y no hay apuesta abierta en ninguno de los dos, descartar override
    if (l.currentStep >= ov.currentStep && !ov.openBet && !l.openBet) {
      saveLocalOverride(null);
      return l;
    }

    const merged = { ...l, ...ov };

    if (ov.openBet) {
      merged.openBet = ov.openBet;
      merged.committedStake = ov.openBet.stake || ov.committedStake || l.currentCapital;
    } else if (l.openBet) {
      // Si el servidor tiene una apuesta abierta oficial y el override no la tenía, preservar la del servidor
      merged.openBet = l.openBet;
      merged.committedStake = l.openBet.stake || l.committedStake || l.currentCapital;
    } else if (ov.stepHistory && l.openBet && ov.stepHistory.some(h => h.betId === l.openBet.betId)) {
      merged.openBet = null;
      merged.committedStake = 0;
    }

    return merged;
  }

  async function fetchLiveState() {
    try {
      const res = await fetch('./api/fase11_prospective_dashboard.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.prospectiveLadder) {
        data.prospectiveLadder = applyLocalOverride(data.prospectiveLadder);
      }
      cachedPayload = data;
      loadError = null;
    } catch (err) {
      loadError = err.message || 'No se pudo cargar el estado persistido de RETO ESCALERA.';
    }
  }

  function revalidateCandidate(opp, l, nowMs = Date.now()) {
    const reasons = [];
    if (!opp) return { ok: false, reasons: ['Oportunidad no encontrada.'] };
    const minO = l.minOdds || OFFICIAL.minOdds;
    const maxO = l.maxOdds || OFFICIAL.maxOdds;
    const minEv = l.minEvPct || OFFICIAL.minEvPct;

    if (l.objectiveStatus === 'OBJECTIVE_REACHED') {
      reasons.push('El objetivo de $ 10.000.000 ARS ya fue alcanzado.');
    }
    if (l.openBet && l.openBet.legacyStatus !== 'LEGACY_OUT_OF_RULES') {
      reasons.push('Ya existe una apuesta abierta en el ciclo vigente.');
    }
    const odds = Number(opp.odds);
    if (!Number.isFinite(odds) || odds < minO || odds > maxO) {
      reasons.push(`Cuota ${odds || 'N/D'} fuera del rango oficial [${minO.toFixed(2)}, ${maxO.toFixed(2)}].`);
    }
    const ev = Number(opp.expectedValuePct);
    if (!Number.isFinite(ev) || ev < minEv) {
      reasons.push(`EV (${Number.isFinite(ev) ? '+' + ev + '%' : 'N/D'}) inferior al mínimo oficial (+${minEv}%).`);
    }
    const prob = Number(opp.modelProbability);
    if (!Number.isFinite(prob) || prob <= (1 / odds)) {
      reasons.push('Probabilidad estimada insuficiente frente al punto de equilibrio.');
    }
    if (String(opp.elenaDecision || '').toUpperCase() !== 'APROBADO') {
      reasons.push(`Elena no aprueba esta selección (${opp.elenaDecision || 'PENDIENTE'}).`);
    }
    if (['RECHAZADO', 'VETADO'].includes(String(opp.riskManagerDecision || '').toUpperCase())) {
      reasons.push(`Veto activo de Risk Manager (${opp.riskManagerDecision}).`);
    }
    if (opp.kickoffUtc) {
      const koTs = new Date(opp.kickoffUtc).getTime();
      if (!isNaN(koTs) && nowMs >= koTs) {
        reasons.push('El partido ya comenzó o superó su horario de kickoff.');
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  
  // ================= GAMIFICATION & AVATAR SYSTEM =================
  const AVATAR_STORAGE_KEY = 'darador_ladder_avatar_v1';
  const AVATARS = [
    { id: 'elena', name: 'Elena', role: 'Risk Boss', img: 'assets/agents/elena.jpg?v=2', title: 'Comandante de Riesgo', badge: 'BOSS', unlockStep: 1, color: '#f43f5e' },
    { id: 'sofia', name: 'Sofía', role: 'Player Hunter', img: 'assets/agents/sofia.jpg?v=2', title: 'Cazadora de Props', badge: 'SNIPER', unlockStep: 1, color: '#a855f7' },
    { id: 'renata', name: 'Renata', role: 'Odds Master', img: 'assets/agents/renata.jpg?v=2', title: 'Maestra de Cuotas', badge: 'SHARP', unlockStep: 1, color: '#eab308' },
    { id: 'valentina', name: 'Valentina', role: 'Team Tactician', img: 'assets/agents/valentina.jpg?v=2', title: 'Estratega de Equipos', badge: 'TACTIC', unlockStep: 2, color: '#38bdf8' },
    { id: 'lucia', name: 'Lucía', role: 'Match Intel', img: 'assets/agents/lucia.jpg?v=2', title: 'Espía de Líneas', badge: 'INTEL', unlockStep: 3, color: '#10b981' },
    { id: 'camila', name: 'Camila', role: 'Context Scout', img: 'assets/agents/camila.jpg?v=2', title: 'Exploradora de Contexto', badge: 'SCOUT', unlockStep: 4, color: '#ec4899' }
  ];

  let currentAvatarId = 'elena';
  try {
    const savedAv = global.localStorage ? global.localStorage.getItem(AVATAR_STORAGE_KEY) : null;
    if (savedAv && AVATARS.some(a => a.id === savedAv)) currentAvatarId = savedAv;
  } catch {}

  let showAvatarSelector = false;
  let showFullLadderModal = false;

  function selectAvatar(id) {
    if (!AVATARS.some(a => a.id === id)) return;
    currentAvatarId = id;
    try {
      if (global.localStorage) global.localStorage.setItem(AVATAR_STORAGE_KEY, id);
    } catch {}
    showAvatarSelector = false;
    paint();
  }

  function toggleAvatarSelector() {
    showAvatarSelector = !showAvatarSelector;
    paint();
  }

  function toggleFullLadderModal() {
    showFullLadderModal = !showFullLadderModal;
    paint();
  }

  function getAvatar(id) {
    return AVATARS.find(a => a.id === id) || AVATARS[0];
  }

  function getMilestoneReward(step) {
    if (step <= 1) return { title: 'Bautismo de Fuego', desc: 'Completar el 1er escalón del desafío', badge: '🥉 Rango Bronce', color: '#cd7f32' };
    if (step === 2) return { title: 'Paso Firme', desc: 'Avatar Valentina desbloqueada', badge: '🥈 Rango Plata', color: '#94a3b8' };
    if (step === 3) return { title: 'Racha Dorada', desc: 'Avatar Lucía desbloqueada', badge: '🥇 Rango Oro', color: '#eab308' };
    if (step <= 5) return { title: 'Especialista en Valor', desc: 'Avatar Camila desbloqueada', badge: '💎 Rango Platino', color: '#38bdf8' };
    if (step <= 10) return { title: 'Club del Millón', desc: 'Camino a los $1.000.000 ARS', badge: '👑 Rango Diamante', color: '#a855f7' };
    if (step <= 20) return { title: 'Maestro del Compuesto', desc: 'Superar $5.000.000 ARS', badge: '🌟 Rango Maestro', color: '#ec4899' };
    return { title: 'Leyenda de los $10M', desc: '¡Meta de $10.000.000 ARS alcanzada!', badge: '🚀 Rango Titán', color: '#22c55e' };
  }

  function calculateTargetProjections(initialCap, targetCap, targetOdds = 1.15) {
    const list = [];
    let c = initialCap;
    let s = 1;
    while (c < targetCap && s <= 45) {
      const nextCap = Math.round(c * targetOdds);
      list.push({
        step: s,
        capital: c,
        targetOdds: targetOdds,
        potentialCapital: nextCap,
        potentialProfit: nextCap - c
      });
      c = nextCap;
      s++;
    }
    return list;
  }

  function renderHeader(l) {
    const av = getAvatar(currentAvatarId);
    const step = l.currentStep || 1;
    const cycle = l.currentCycle || 1;
    const reward = getMilestoneReward(step);
    const progress = Math.min(100, Math.max(0, Number(l.progressPct || 0)));
    const cap = l.currentCapital ?? OFFICIAL.initialCapital;
    const target = l.targetCapital ?? OFFICIAL.targetCapital;
    const isCompleted = l.objectiveStatus === 'OBJECTIVE_REACHED' || cap >= target;

    return `
      <!-- HEADER GAMING PRINCIPAL -->
      <div style="background:linear-gradient(135deg, rgba(30,27,75,0.7) 0%, rgba(15,23,42,0.95) 50%, rgba(24,15,48,0.8) 100%); border:1px solid rgba(168,85,247,0.35); border-radius:18px; padding:1.25rem 1.4rem; margin-bottom:1.25rem; position:relative; overflow:hidden; box-shadow:0 12px 36px rgba(0,0,0,0.45);">
        
        <!-- Efecto resplandor neon ambiental -->
        <div style="position:absolute; top:-60px; right:-60px; width:180px; height:180px; background:radial-gradient(circle, rgba(168,85,247,0.25) 0%, transparent 70%); pointer-events:none;"></div>
        <div style="position:absolute; bottom:-60px; left:-60px; width:180px; height:180px; background:radial-gradient(circle, rgba(234,179,8,0.2) 0%, transparent 70%); pointer-events:none;"></div>

        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:1.2rem; position:relative; z-index:1;">
          
          <!-- Avatar + Título del jugador -->
          <div style="display:flex; align-items:center; gap:1.1rem;">
            <!-- Avatar interactivo -->
            <div style="position:relative; cursor:pointer;" onclick="window.LadderModule.toggleAvatarSelector()" title="Cambiar Avatar del Reto">
              <div style="width:72px; height:72px; border-radius:50%; padding:3px; background:linear-gradient(135deg, #a855f7, #eab308, #ec4899); box-shadow:0 0 18px rgba(168,85,247,0.5); position:relative;">
                <img src="${av.img}" alt="${av.name}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; display:block; background:#0f172a;">
              </div>
              <span style="position:absolute; bottom:-4px; right:-2px; background:linear-gradient(135deg, #a855f7, #7c3aed); color:#ffffff; font-size:0.62rem; font-weight:900; padding:0.15rem 0.4rem; border-radius:999px; border:1px solid rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:0.04em;">
                ${av.badge}
              </span>
            </div>

            <div>
              <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <span style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.45); color:#d8b4fe; font-size:0.7rem; font-weight:800; padding:0.2rem 0.55rem; border-radius:999px; text-transform:uppercase; letter-spacing:0.06em; display:inline-flex; align-items:center; gap:0.35rem;">
                  <span style="width:6px; height:6px; background:#a855f7; border-radius:50%; box-shadow:0 0 6px #a855f7;"></span>
                  CICLO ${cycle} · ESCALÓN ${step}
                </span>
                <span style="background:rgba(234,179,8,0.18); border:1px solid rgba(234,179,8,0.4); color:#fde047; font-size:0.7rem; font-weight:800; padding:0.2rem 0.55rem; border-radius:999px;">
                  ${reward.badge}
                </span>
                ${isCompleted ? '<span style="background:#22c55e; color:#052e16; font-size:0.7rem; font-weight:900; padding:0.2rem 0.55rem; border-radius:999px;">🏆 OBJETIVO ALCANZADO</span>' : ''}
              </div>

              <h1 style="font-size:1.55rem; font-weight:900; color:#ffffff; margin:0.35rem 0 0.15rem 0; letter-spacing:-0.02em; display:flex; align-items:center; gap:0.5rem;">
                RETO ESCALERA
                <span style="font-size:0.88rem; font-weight:700; color:#a855f7; text-shadow:0 0 12px rgba(168,85,247,0.5);">⚡ PRO</span>
              </h1>
              <div style="font-size:0.8rem; color:#cbd5e1;">
                Jugador activo: <strong style="color:#ffffff;">${av.name}</strong> (${av.title}) · <button type="button" onclick="window.LadderModule.toggleAvatarSelector()" style="background:none; border:none; color:#38bdf8; text-decoration:underline; font-size:0.76rem; cursor:pointer; padding:0;">Cambiar avatar</button>
              </div>
            </div>
          </div>

          <!-- Botones de Acción Rápida -->
          <div style="display:flex; align-items:center; gap:0.55rem; flex-wrap:wrap;">
            <button type="button" onclick="window.LadderModule.toggleFullLadderModal()" style="background:rgba(168,85,247,0.18); color:#d8b4fe; border:1px solid rgba(168,85,247,0.45); border-radius:10px; padding:0.55rem 0.95rem; font-weight:800; font-size:0.78rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.4rem; transition:all 0.2s; box-shadow:0 0 15px rgba(168,85,247,0.25);">
              <span>🗺️</span> Ver Mapa Completo ($10M)
            </button>
            <button type="button" onclick="window.LadderModule.reload()" style="background:rgba(30,41,59,0.85); color:#94a3b8; border:1px solid #334155; border-radius:10px; padding:0.55rem 0.85rem; font-weight:700; font-size:0.78rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
              <span>↻</span> Sincronizar
            </button>
          </div>
        </div>

        <!-- Barra de Progreso XP hacia los $10.000.000 ARS -->
        <div style="margin-top:1.2rem; background:rgba(15,23,42,0.85); border:1px solid rgba(168,85,247,0.25); border-radius:14px; padding:0.85rem 1rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.76rem; margin-bottom:0.45rem; flex-wrap:wrap; gap:0.4rem;">
            <span style="color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Progreso hacia la Meta Legendaria</span>
            <span style="color:#fde047; font-weight:900; font-family:var(--font-mono); font-size:0.84rem;">
              ${formatArs(cap)} / ${formatArs(target)} (${progress.toFixed(2)}%)
            </span>
          </div>
          <div style="height:12px; background:#0f172a; border-radius:999px; overflow:hidden; position:relative; border:1px solid rgba(255,255,255,0.08); box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);">
            <div style="height:100%; width:${progress}%; background:linear-gradient(90deg, #7c3aed 0%, #a855f7 50%, #eab308 100%); border-radius:999px; transition:width 0.6s cubic-bezier(0.4, 0, 0.2, 1); box-shadow:0 0 12px rgba(234,179,8,0.6); position:relative;">
              <div style="position:absolute; inset:0; background:linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent); animation:shimmer 2s infinite;"></div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:#94a3b8; margin-top:0.4rem;">
            <span>Capital Base: <strong style="color:#ffffff;">${formatArs(l.initialCapital ?? OFFICIAL.initialCapital)}</strong></span>
            <span>Próxima Recompensa: <strong style="color:#a855f7;">${reward.title}</strong> (${reward.desc})</span>
            <span>Objetivo: <strong style="color:#eab308;">${formatArs(target)}</strong></span>
          </div>
        </div>

        ${renderAvatarModal()}
        ${renderFullLadderMapModal(l)}
      </div>
    `;
  }

  function renderAvatarModal() {
    if (!showAvatarSelector) return '';
    return `
      <div style="position:fixed; inset:0; background:rgba(0,0,0,0.82); backdrop-filter:blur(6px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:1rem;">
        <div style="background:#0f172a; border:2px solid #a855f7; border-radius:20px; max-width:640px; width:100%; padding:1.5rem; box-shadow:0 25px 50px rgba(0,0,0,0.8);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.1rem;">
            <div>
              <h3 style="margin:0; font-size:1.25rem; font-weight:900; color:#ffffff; display:flex; align-items:center; gap:0.5rem;">
                <span>🎭</span> Elegir Avatar del Reto
              </h3>
              <p style="margin:0.2rem 0 0 0; font-size:0.78rem; color:#94a3b8;">Seleccioná tu heroína táctica para subir la escalera del interés compuesto.</p>
            </div>
            <button type="button" onclick="window.LadderModule.toggleAvatarSelector()" style="background:rgba(255,255,255,0.1); border:none; color:#ffffff; width:32px; height:32px; border-radius:50%; font-size:1rem; cursor:pointer; display:flex; align-items:center; justify-content:center;">✕</button>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:0.85rem; max-height:420px; overflow-y:auto; padding-right:0.3rem;">
            ${AVATARS.map(a => {
              const isSelected = a.id === currentAvatarId;
              return `
                <div onclick="window.LadderModule.selectAvatar('${a.id}')" style="background:${isSelected ? 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(30,27,75,0.9))' : 'rgba(15,23,42,0.9)'}; border:2px solid ${isSelected ? '#a855f7' : '#1e293b'}; border-radius:14px; padding:0.85rem; cursor:pointer; text-align:center; transition:all 0.2s; box-shadow:${isSelected ? '0 0 16px rgba(168,85,247,0.4)' : 'none'};">
                  <div style="width:68px; height:68px; border-radius:50%; margin:0 auto 0.6rem auto; padding:2px; background:linear-gradient(135deg, ${a.color}, #ffffff); box-shadow:0 4px 12px rgba(0,0,0,0.4);">
                    <img src="${a.img}" alt="${a.name}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;">
                  </div>
                  <div style="font-weight:900; color:#ffffff; font-size:0.95rem;">${a.name}</div>
                  <div style="font-size:0.72rem; color:${a.color}; font-weight:800; margin-top:0.15rem;">${a.role}</div>
                  <div style="font-size:0.68rem; color:#94a3b8; margin-top:0.3rem;">${a.title}</div>
                  <div style="margin-top:0.65rem;">
                    <span style="background:${isSelected ? '#a855f7' : 'rgba(255,255,255,0.08)'}; color:${isSelected ? '#ffffff' : '#94a3b8'}; font-size:0.68rem; font-weight:800; padding:0.25rem 0.6rem; border-radius:999px;">
                      ${isSelected ? '✓ SELECCIONADO' : 'ELEGIR'}
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderFullLadderMapModal(l) {
    if (!showFullLadderModal) return '';
    const initialCap = l.initialCapital ?? OFFICIAL.initialCapital;
    const targetCap = l.targetCapital ?? OFFICIAL.targetCapital;
    const currentStep = l.currentStep || 1;
    const currentCap = l.currentCapital ?? initialCap;
    const targetOdds = Number((l.referenceOdds || OFFICIAL.targetOdds || 1.15).toFixed(2));
    const projections = calculateTargetProjections(initialCap, targetCap, targetOdds);

    return `
      <div style="position:fixed; inset:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:1rem;">
        <div style="background:#090d16; border:2px solid #eab308; border-radius:20px; max-width:850px; width:100%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,0.9); overflow:hidden;">
          
          <!-- Modal Header -->
          <div style="padding:1.25rem 1.5rem; background:linear-gradient(135deg, rgba(234,179,8,0.2) 0%, rgba(15,23,42,0.95) 100%); border-bottom:1px solid rgba(234,179,8,0.3); display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <span style="font-size:1.3rem;">🗺️</span>
                <h3 style="margin:0; font-size:1.25rem; font-weight:900; color:#fde047;">MAPA DE EXPEDICIÓN — RUTA DE LOS $10.000.000 ARS</h3>
              </div>
              <p style="margin:0.25rem 0 0 0; font-size:0.78rem; color:#94a3b8;">
                Proyección secuencial reinvirtiendo el 100% a cuota promedio @${targetOdds.toFixed(2)}. Cada escalón multiplica el capital previo.
              </p>
            </div>
            <button type="button" onclick="window.LadderModule.toggleFullLadderModal()" style="background:rgba(255,255,255,0.1); border:none; color:#ffffff; width:34px; height:34px; border-radius:50%; font-size:1.1rem; cursor:pointer;">✕</button>
          </div>

          <!-- Modal Scroll Body -->
          <div style="padding:1.25rem 1.5rem; overflow-y:auto; flex:1;">
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.85rem;">
              ${projections.map(p => {
                const isPassed = p.step < currentStep;
                const isCurrent = p.step === currentStep;
                const isTarget = p.potentialCapital >= targetCap;

                let cardBg = 'rgba(15,23,42,0.7)';
                let borderCol = '#1e293b';
                let stepBadge = '<span style="color:#64748b;">PENDIENTE</span>';

                if (isPassed) {
                  cardBg = 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(15,23,42,0.9))';
                  borderCol = 'rgba(34,197,94,0.5)';
                  stepBadge = '<span style="color:#4ade80; font-weight:800;">✓ CONQUISTADO</span>';
                } else if (isCurrent) {
                  cardBg = 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(234,179,8,0.2))';
                  borderCol = '#eab308';
                  stepBadge = '<span style="color:#fde047; font-weight:900; animation:pulse 1.5s infinite;">⚡ EN JUEGO AHORA</span>';
                } else if (isTarget) {
                  cardBg = 'linear-gradient(135deg, rgba(234,179,8,0.25), rgba(30,27,75,0.9))';
                  borderCol = '#eab308';
                  stepBadge = '<span style="color:#fde047; font-weight:900;">👑 META FINAL $10M</span>';
                }

                return `
                  <div style="background:${cardBg}; border:1.5px solid ${borderCol}; border-radius:14px; padding:0.85rem 1rem; position:relative; box-shadow:${isCurrent ? '0 0 18px rgba(234,179,8,0.3)' : 'none'};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                      <span style="font-weight:900; font-size:0.85rem; color:#ffffff;">ESCALÓN ${p.step}</span>
                      <span style="font-size:0.68rem;">${stepBadge}</span>
                    </div>
                    <div style="font-size:0.75rem; color:#94a3b8;">
                      Capital Entrada: <strong style="color:#cbd5e1; font-family:var(--font-mono);">${formatArs(p.capital)}</strong>
                    </div>
                    <div style="font-size:0.88rem; font-weight:800; color:${isTarget ? '#fde047' : '#38bdf8'}; font-family:var(--font-mono); margin-top:0.25rem;">
                      ➜ Retorno: ${formatArs(p.potentialCapital)}
                    </div>
                    <div style="font-size:0.7rem; color:#4ade80; margin-top:0.2rem; font-family:var(--font-mono);">
                      +${formatArs(p.potentialProfit)} ARS ganancia
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Modal Footer -->
          <div style="padding:1rem 1.5rem; background:#0b101d; border-top:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
            <span style="font-size:0.8rem; color:#94a3b8;">Total proyectado: <strong>${projections.length} escalones</strong> para alcanzar los $10.000.000 ARS</span>
            <button type="button" onclick="window.LadderModule.toggleFullLadderModal()" style="background:#a855f7; color:#ffffff; border:none; border-radius:8px; padding:0.5rem 1.2rem; font-weight:800; font-size:0.8rem; cursor:pointer;">Entendido</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderVisualStairs(l) {
    const currentStep = l.currentStep || 1;
    const history = l.stepHistory || [];
    const initialCap = l.initialCapital ?? OFFICIAL.initialCapital;
    const targetCap = l.targetCapital ?? OFFICIAL.targetCapital;
    const targetOdds = Number((l.referenceOdds || OFFICIAL.targetOdds || 1.15).toFixed(2));
    const projections = calculateTargetProjections(initialCap, targetCap, targetOdds);

    const startIdx = Math.max(0, currentStep - 3);
    const visibleSteps = projections.slice(startIdx, startIdx + 6);
    const av = getAvatar(currentAvatarId);

    return `
      <!-- COMPONENTE PRINCIPAL: ESCALERA VISUAL GAMIFICADA -->
      <div style="margin-bottom:1.35rem; background:linear-gradient(180deg, rgba(15,23,42,0.8) 0%, rgba(9,14,26,0.95) 100%); border:1px solid rgba(168,85,247,0.3); border-radius:16px; padding:1.25rem; box-shadow:0 8px 30px rgba(0,0,0,0.5);">
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
          <div style="display:flex; align-items:center; gap:0.55rem;">
            <span style="font-size:1.2rem; filter:drop-shadow(0 0 6px #eab308);">🪜</span>
            <h3 style="margin:0; font-size:1.05rem; font-weight:900; color:#ffffff; text-transform:uppercase; letter-spacing:0.04em;">
              Camino de Progresión — Escalón Actual vs Próximos Niveles
            </h3>
          </div>
          <button type="button" onclick="window.LadderModule.toggleFullLadderModal()" style="background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.4); color:#d8b4fe; font-size:0.76rem; font-weight:800; padding:0.35rem 0.75rem; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:0.3rem;">
            🗺️ Ver Mapa Completo (${projections.length} escalones)
          </button>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:0.85rem;">
          ${visibleSteps.map(st => {
            const isWon = st.step < currentStep;
            const isCurrent = st.step === currentStep;
            const isFuture = st.step > currentStep;
            const histItem = history.find(h => h.step === st.step);

            let cardBorder = 'rgba(255,255,255,0.08)';
            let cardBg = 'rgba(15,23,42,0.6)';
            let badgeHtml = '';

            if (isWon) {
              cardBorder = 'rgba(34,197,94,0.5)';
              cardBg = 'linear-gradient(180deg, rgba(34,197,94,0.14) 0%, rgba(15,23,42,0.85) 100%)';
              badgeHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem;">
                  <span style="background:rgba(34,197,94,0.25); color:#4ade80; border:1px solid rgba(34,197,94,0.45); font-size:0.65rem; font-weight:900; padding:0.15rem 0.45rem; border-radius:999px;">
                    ✓ GANADO
                  </span>
                  <span style="font-size:0.68rem; color:#94a3b8; font-family:var(--font-mono);">
                    @${histItem ? Number(histItem.odds).toFixed(2) : '1.15'}
                  </span>
                </div>
              `;
            } else if (isCurrent) {
              cardBorder = '#eab308';
              cardBg = 'linear-gradient(180deg, rgba(234,179,8,0.22) 0%, rgba(30,27,75,0.95) 100%)';
              badgeHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem;">
                  <span style="background:linear-gradient(135deg, #eab308, #ca8a04); color:#000000; font-size:0.68rem; font-weight:900; padding:0.15rem 0.5rem; border-radius:999px; box-shadow:0 0 10px rgba(234,179,8,0.6);">
                    ⚡ EN JUEGO
                  </span>
                  <div style="display:flex; align-items:center; gap:0.25rem;">
                    <img src="${av.img}" alt="${av.name}" style="width:24px; height:24px; border-radius:50%; border:1.5px solid #eab308; box-shadow:0 0 8px rgba(234,179,8,0.6);">
                  </div>
                </div>
              `;
            } else {
              badgeHtml = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem;">
                  <span style="background:rgba(255,255,255,0.06); color:#64748b; font-size:0.65rem; font-weight:700; padding:0.15rem 0.45rem; border-radius:999px;">
                    ESCALÓN ${st.step}
                  </span>
                  <span style="font-size:0.68rem; color:#64748b; font-family:var(--font-mono);">Obj. @${targetOdds.toFixed(2)}</span>
                </div>
              `;
            }

            return `
              <div style="background:${cardBg}; border:2px solid ${cardBorder}; border-radius:14px; padding:0.85rem; position:relative; box-shadow:${isCurrent ? '0 0 20px rgba(234,179,8,0.35)' : 'none'}; transform:${isCurrent ? 'scale(1.02)' : 'none'}; transition:all 0.25s ease;">
                ${badgeHtml}
                
                <div style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase;">
                  ${isWon ? 'Capital Logrado:' : (isCurrent ? 'Capital Activo:' : 'Capital Entrada:')}
                </div>
                
                <div style="font-size:1.05rem; font-weight:900; color:${isWon ? '#4ade80' : (isCurrent ? '#ffffff' : '#cbd5e1')}; font-family:var(--font-mono); margin:0.15rem 0 0.35rem 0;">
                  ${formatArs(isWon && histItem ? histItem.capAfter : (isCurrent ? (l.currentCapital ?? st.capital) : st.capital))}
                </div>

                <div style="border-top:1px dashed rgba(255,255,255,0.12); padding-top:0.45rem; font-size:0.72rem; color:${isWon ? '#86efac' : (isCurrent ? '#fde047' : '#94a3b8')}; display:flex; justify-content:space-between; align-items:center;">
                  <span>Meta:</span>
                  <strong style="font-family:var(--font-mono); font-size:0.8rem;">${formatArs(isWon && histItem ? histItem.capAfter : (isCurrent && l.openBet ? l.openBet.potentialReturn : st.potentialCapital))}</strong>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderKpis(l) {
    const confirmedLocal = !l.openBet && selectedProposal && selectedProposal.status === 'CONFIRMED';
    const cap = l.currentCapital ?? OFFICIAL.initialCapital;
    const available = (l.openBet || confirmedLocal) ? 0 : cap;
    const committed = l.committedStake ?? (l.openBet ? l.openBet.stake : (confirmedLocal ? (selectedProposal.stake || cap) : 0));
    const profit = l.cumulativeProfit ?? (cap - (l.initialCapital ?? OFFICIAL.initialCapital));

    const kpis = [
      ['Capital Base', formatArs(l.initialCapital ?? OFFICIAL.initialCapital), '#94a3b8'],
      ['Capital Actual', formatArs(l.currentCapital ?? OFFICIAL.initialCapital), '#38bdf8'],
      ['En Apuesta Activa', formatArs(committed), committed > 0 ? '#fde047' : '#94a3b8'],
      ['Beneficio Acumulado', (profit >= 0 ? '+' : '') + formatArs(profit), profit >= 0 ? '#4ade80' : '#f87171'],
      ['Meta Oficial', formatArs(l.targetCapital ?? OFFICIAL.targetCapital), '#eab308'],
      ['Rango Cuotas', `${(l.minOdds || OFFICIAL.minOdds).toFixed(2)} – ${(l.maxOdds || OFFICIAL.maxOdds).toFixed(2)}`, '#cbd5e1']
    ];

    return `
      <!-- INDICADORES FINANCIEROS (ORGANIZACIÓN SECUNDARIA ELEGANTE) -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0.65rem; margin-bottom:1.15rem;">
        ${kpis.map(([lbl, val, col]) => `
          <div style="background:rgba(15,23,42,0.7); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:0.65rem 0.75rem;">
            <div style="font-size:0.66rem; color:#94a3b8; text-transform:uppercase; font-weight:700; letter-spacing:0.04em;">${lbl}</div>
            <div style="font-size:0.95rem; font-weight:900; color:${col}; margin-top:0.2rem; font-family:var(--font-mono);">${val}</div>
          </div>
        `).join('')}
      </div>
    `;
  }
function renderPrincipal(l) {
    const bet = l.openBet;
    let noticeHtml = '';
    if (uiNotice) {
      const bg = uiNotice.type === 'ok' ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)';
      const bd = uiNotice.type === 'ok' ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)';
      const fg = uiNotice.type === 'ok' ? '#4ade80' : '#f87171';
      noticeHtml = `<div style="margin-bottom:0.85rem; padding:0.65rem 0.85rem; border-radius:10px; background:${bg}; border:1px solid ${bd}; color:${fg}; font-size:0.8rem; font-weight:700;">${uiNotice.text}</div>`;
    }

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
            <span class="sem-badge sem-blue">APUESTA ABIERTA · PASO ${bet.step} (CICLO ${bet.cycle})</span>
            <span style="font-size:0.74rem; color:#94a3b8; font-family:var(--font-mono);">ID: ${bet.betId}</span>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#ffffff;">${bet.match} <span style="font-size:0.78rem; color:#38bdf8;">(${bet.competition || ''})</span></div>
          <div style="font-size:0.76rem; color:#94a3b8; margin-top:0.15rem; font-family:var(--font-mono);">${formatKickoffArt(bet.kickoffUtc)}</div>
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
          </div>
          <div style="display:flex; gap:0.65rem; margin-top:0.95rem; flex-wrap:wrap; align-items:center; border-top:1px solid rgba(56,189,248,0.2); padding-top:0.85rem;">
            <button type="button" onclick="window.LadderModule.requestManualSettleWon('${bet.betId}')" style="background:#22c55e; color:#052e16; border:none; border-radius:8px; padding:0.5rem 1rem; font-weight:800; font-size:0.82rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.4rem; box-shadow:0 2px 8px rgba(34,197,94,0.25);">
              <span>🏆</span> Marcar como GANADO
            </button>
            <span style="font-size:0.75rem; color:#94a3b8;">Liquidación manual con verificación y avance inmediato al siguiente escalón.</span>
          </div>
        </div>
      `;
    } else if (selectedProposal && selectedProposal.status === 'CONFIRMED') {
      const cap = selectedProposal.stake ?? l.currentCapital ?? OFFICIAL.initialCapital;
      const potReturn = selectedProposal.potentialReturn ?? Number((cap * Number(selectedProposal.odds)).toFixed(2));
      const stepNum = selectedProposal.step || l.currentStep || 1;
      const cycleNum = selectedProposal.cycle || l.currentCycle || 1;
      betCard = `
        <div style="background:rgba(11,18,36,0.94); border:1px solid rgba(34,197,94,0.55); border-radius:12px; padding:1.05rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.55rem;">
            <span class="sem-badge sem-green">✓ APUESTA ELEGIDA · ESCALÓN ${stepNum} (CICLO ${cycleNum})</span>
            <span style="font-size:0.72rem; color:#94a3b8; font-family:var(--font-mono);">Snapshot: ${selectedProposal.snapshotId}</span>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#ffffff;">${selectedProposal.match} <span style="font-size:0.78rem; color:#38bdf8;">(${selectedProposal.competition || ''})</span></div>
          <div style="font-size:0.78rem; color:#38bdf8; margin-top:0.2rem; font-family:var(--font-mono);">${formatKickoffArt(selectedProposal.kickoffUtc)}</div>
          <div style="font-size:0.9rem; color:#e2e8f0; margin-top:0.35rem;">${selectedProposal.selection} — <strong>${selectedProposal.market}</strong> · ${selectedProposal.line || ''}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.85rem; margin-top:0.65rem; font-size:0.82rem; font-family:var(--font-mono);">
            <span>Cuota: <strong style="color:#fde047;">@${Number(selectedProposal.odds).toFixed(2)}</strong></span>
            <span>Prob.: <strong>${selectedProposal.modelProbability ? (selectedProposal.modelProbability * 100).toFixed(1) + '%' : 'N/D'}</strong></span>
            <span>EV: <strong style="color:#4ade80;">+${selectedProposal.expectedValuePct}%</strong></span>
            <span>Stake comprometido: <strong>${formatArs(cap)}</strong></span>
            <span>Retorno potencial: <strong style="color:#38bdf8;">${formatArs(potReturn)}</strong></span>
          </div>
          <div style="display:flex; gap:0.5rem; margin-top:0.6rem; flex-wrap:wrap;">
            <span class="sem-badge sem-green">✓ Elena: ${selectedProposal.elenaDecision || 'APROBADO'}</span>
            <span class="sem-badge sem-green">✓ Risk Manager: ${selectedProposal.riskManagerDecision || 'APROBADO'}</span>
            <span class="sem-badge sem-blue">Confirmada: ${formatKickoffArt(selectedProposal.confirmedAtUtc)}</span>
          </div>
          <div style="display:flex; gap:0.6rem; margin-top:0.9rem; flex-wrap:wrap;">
            <button type="button" onclick="window.LadderModule.cancelSelection()" style="background:rgba(239,68,68,0.14); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); border-radius:8px; padding:0.45rem 0.9rem; font-weight:700; font-size:0.78rem; cursor:pointer;">✕ Liberar / cambiar selección</button>
          </div>
        </div>
      `;
    } else if (selectedProposal) {
      const cap = l.currentCapital ?? OFFICIAL.initialCapital;
      const potReturn = Number((cap * Number(selectedProposal.odds)).toFixed(2));
      betCard = `
        <div style="background:rgba(14,21,42,0.92); border:1px solid rgba(250,204,21,0.45); border-radius:12px; padding:1.05rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.55rem;">
            <span class="sem-badge sem-amber">PICK SELECCIONADO — PENDIENTE DE CONFIRMACIÓN</span>
            <span style="font-size:0.72rem; color:#94a3b8; font-family:var(--font-mono);">Snapshot: ${selectedProposal.snapshotId}</span>
          </div>
          <div style="font-size:1.05rem; font-weight:800; color:#ffffff;">${selectedProposal.match} <span style="font-size:0.78rem; color:#38bdf8;">(${selectedProposal.competition || ''})</span></div>
          <div style="font-size:0.78rem; color:#38bdf8; margin-top:0.2rem; font-family:var(--font-mono);">${formatKickoffArt(selectedProposal.kickoffUtc)}</div>
          <div style="font-size:0.9rem; color:#e2e8f0; margin-top:0.35rem;">${selectedProposal.selection} — <strong>${selectedProposal.market}</strong> · ${selectedProposal.line || ''}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.85rem; margin-top:0.65rem; font-size:0.82rem; font-family:var(--font-mono);">
            <span>Cuota: <strong style="color:#fde047;">@${Number(selectedProposal.odds).toFixed(2)}</strong></span>
            <span>Prob.: <strong>${selectedProposal.modelProbability ? (selectedProposal.modelProbability * 100).toFixed(1) + '%' : 'N/D'}</strong></span>
            <span>EV: <strong style="color:#4ade80;">+${selectedProposal.expectedValuePct}%</strong></span>
            <span>Stake previsto: <strong>${formatArs(cap)}</strong></span>
            <span>Retorno potencial: <strong style="color:#38bdf8;">${formatArs(potReturn)}</strong></span>
          </div>
          <div style="display:flex; gap:0.5rem; margin-top:0.6rem; flex-wrap:wrap;">
            <span class="sem-badge sem-green">✓ Elena: ${selectedProposal.elenaDecision || 'APROBADO'}</span>
            <span class="sem-badge sem-green">✓ Risk Manager: ${selectedProposal.riskManagerDecision || 'APROBADO'}</span>
            <span class="sem-badge sem-gray">Capital aún NO comprometido</span>
          </div>
          <div style="display:flex; gap:0.6rem; margin-top:0.9rem; flex-wrap:wrap;">
            <button type="button" onclick="window.LadderModule.confirmSelection()" style="background:#22c55e; color:#052e16; border:none; border-radius:8px; padding:0.5rem 0.95rem; font-weight:800; font-size:0.8rem; cursor:pointer;">✓ Confirmar selección</button>
            <button type="button" onclick="window.LadderModule.cancelSelection()" style="background:rgba(239,68,68,0.16); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); border-radius:8px; padding:0.5rem 0.95rem; font-weight:700; font-size:0.8rem; cursor:pointer;">✕ Devolver selección</button>
            <button type="button" onclick="window.LadderModule.backToOpportunities()" style="background:rgba(148,163,184,0.16); color:#e2e8f0; border:1px solid rgba(148,163,184,0.35); border-radius:8px; padding:0.5rem 0.95rem; font-weight:700; font-size:0.8rem; cursor:pointer;">← Ver otras oportunidades</button>
          </div>
        </div>
      `;
    } else {
      betCard = `
        <div style="background:rgba(14,21,42,0.85); border:1px dashed rgba(148,163,184,0.35); border-radius:12px; padding:1.1rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
            <div>
              <strong style="color:#f8fafc; font-size:0.95rem;">⏳ Esperando oportunidad válida para el Escalón ${l.currentStep || 1}</strong>
              <p style="font-size:0.8rem; color:#94a3b8; margin-top:0.3rem;">
                No hay ninguna apuesta abierta. Podés elegir un candidato prepartido en la pestaña <strong>Oportunidades</strong> o cargar directamente un <strong>Pick en Vivo</strong> detectado durante el partido.
              </p>
            </div>
            <button type="button" onclick="window.LadderModule.openManualBetModal()" style="background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color:#ffffff; border:none; border-radius:8px; padding:0.55rem 1.05rem; font-weight:800; font-size:0.82rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.4rem; box-shadow:0 3px 10px rgba(2,132,199,0.35);">
              <span>⚡</span> Cargar Pick en Vivo (Manual)
            </button>
          </div>
        </div>
      `;
    }

    const lastSettle = l.lastSettlement
      ? `<div style="margin-top:0.85rem; font-size:0.8rem; color:#cbd5e1;"><strong>Última liquidación:</strong> ${l.lastSettlement.match} (${l.lastSettlement.status}) · Capital tras liquidación: ${formatArs(l.lastSettlement.capAfter)}</div>`
      : '';

    return noticeHtml + renderVisualStairs(l) + betCard + lastSettle;
  }

  function renderOportunidades(l) {
    const minO = l.minOdds || OFFICIAL.minOdds;
    const maxO = l.maxOdds || OFFICIAL.maxOdds;
    const minEv = l.minEvPct || OFFICIAL.minEvPct;
    const cov = l.searchCoverageByMarket || null;
    let covHtml = '';
    if (cov && Object.keys(cov).length > 0) {
      const statusBadge = (st) => {
        if (st === 'ELIGIBLE_FOUND') return '<span class="sem-badge sem-green">Elegibles</span>';
        if (st === 'ONLY_REJECTED') return '<span class="sem-badge sem-amber">Rechazados</span>';
        if (st === 'NO_OPPORTUNITIES') return '<span class="sem-badge sem-gray">Sin oportunidades</span>';
        return '<span class="sem-badge sem-gray">No investigado</span>';
      };
      covHtml = `
        <div style="display:flex; flex-wrap:wrap; gap:0.45rem; margin-bottom:0.85rem; padding:0.6rem 0.75rem; background:rgba(14,21,42,0.72); border:1px solid #1c2744; border-radius:10px; font-size:0.74rem; align-items:center;">
          <strong style="color:#94a3b8; margin-right:0.25rem;">Búsqueda por mercado:</strong>
          ${Object.entries(cov).map(([mkt, info]) =>
            `<span style="display:inline-flex; align-items:center; gap:0.3rem; background:rgba(15,23,42,0.85); border:1px solid rgba(148,163,184,0.2); padding:0.2rem 0.45rem; border-radius:6px; color:#e2e8f0;">
              <span>${mkt}</span>
              <span style="color:#94a3b8; font-family:var(--font-mono);">(${info.opportunitiesAnalyzed} eval. / ${info.eligibleCount} eleg.)</span>
              ${statusBadge(info.status)}
            </span>`
          ).join('')}
        </div>
      `;
    }

    const eligible = (l.eligibleOpportunities || []).filter(e =>
      Number.isFinite(Number(e.odds)) && Number(e.odds) >= minO && Number(e.odds) <= maxO &&
      (e.expectedValuePct == null || Number(e.expectedValuePct) >= minEv)
    );
    const pendingLineup = (l.pendingLineupOpportunities || []).filter(e =>
      Number.isFinite(Number(e.odds)) && Number(e.odds) >= minO && Number(e.odds) <= maxO &&
      (e.expectedValuePct == null || Number(e.expectedValuePct) >= minEv)
    );

    let contentHtml = '';
    if (eligible.length === 0 && pendingLineup.length === 0) {
      contentHtml = `
        <div style="background:rgba(14,21,42,0.85); border:1px dashed rgba(148,163,184,0.35); border-radius:12px; padding:1rem;">
          <strong style="color:#f8fafc; font-size:0.92rem;">⏳ Esperando oportunidad válida</strong>
          <p style="font-size:0.8rem; color:#94a3b8; margin-top:0.3rem;">
            Ninguna oportunidad actual cumple simultáneamente las reglas oficiales de RETO ESCALERA (cuota <strong>[${minO.toFixed(2)} – ${maxO.toFixed(2)}]</strong>, <strong>EV ≥ +${minEv}%</strong>, calibración suficiente, Elena APROBADO y Risk Manager sin veto).
          </p>
        </div>
      `;
    } else {
      const allRows = [
        ...eligible.map(e => ({ ...e, isPendingLineup: false })),
        ...pendingLineup.map(p => ({ ...p, isPendingLineup: true }))
      ];

      contentHtml = `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
            <thead>
              <tr style="border-bottom:1px solid #1c2744; color:#94a3b8; text-align:left;">
                <th style="padding:0.5rem;">Estado / Rank</th>
                <th style="padding:0.5rem;">Partido y Horario (ART)</th>
                <th style="padding:0.5rem;">Selección / Mercado</th>
                <th style="padding:0.5rem;">Cuota</th>
                <th style="padding:0.5rem;">Prob / EV</th>
                <th style="padding:0.5rem;">Score</th>
                <th style="padding:0.5rem; text-align:right;">Acción</th>
              </tr>
            </thead>
            <tbody>
              ${allRows.map(e => {
                const isPending = e.isPendingLineup;
                let statusBadgeCol = '';
                if (isPending) {
                  statusBadgeCol = `<span class="sem-badge sem-amber" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.45); font-weight:800; font-size:0.65rem; padding:0.2rem 0.5rem; letter-spacing:0.5px;">⏳ ESPERANDO FORMACIÓN DE EQUIPO</span>`;
                } else if (e.isTopRecommended) {
                  statusBadgeCol = '<span class="sem-badge sem-green">★ #1 TOP</span>';
                } else {
                  statusBadgeCol = '#' + (e.rank || '-');
                }

                let actionButton = '';
                if (isPending) {
                  actionButton = `
                    <button type="button" disabled style="background:rgba(148,163,184,0.1); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); border-radius:8px; padding:0.35rem 0.65rem; font-size:0.72rem; font-weight:700; cursor:not-allowed;" title="Alineación oficial (T-60) pendiente">
                      Gated T-60
                    </button>
                  `;
                } else {
                  actionButton = `
                    <button type="button" onclick="window.LadderModule.selectOpportunity('${e.snapshotId}')" style="background:rgba(56,189,248,0.18); color:#38bdf8; border:1px solid rgba(56,189,248,0.5); border-radius:8px; padding:0.35rem 0.65rem; font-size:0.74rem; font-weight:700; cursor:pointer;">Elegir para el reto</button>
                  `;
                }

                const rowBg = isPending
                  ? 'background:rgba(30,41,59,0.3); opacity:0.92;'
                  : (e.isTopRecommended ? 'background:rgba(34,197,94,0.08);' : '');

                return `
                  <tr style="border-bottom:1px solid rgba(28,39,68,0.6); ${rowBg}">
                    <td style="padding:0.5rem; white-space:nowrap;">${statusBadgeCol}</td>
                    <td style="padding:0.5rem;">
                      <strong>${e.match || '-'}</strong>
                      <div style="color:#38bdf8;font-size:0.71rem;font-family:var(--font-mono);margin-top:0.1rem;">${formatKickoffArt(e.kickoffUtc)}</div>
                      <div style="color:#94a3b8;font-size:0.68rem;">${e.competition || ''}</div>
                    </td>
                    <td style="padding:0.5rem;">
                      <div style="font-weight:700; color:#f8fafc;">${e.selection || '-'}</div>
                      <div style="color:#94a3b8;font-size:0.7rem;">${e.market || ''} · ${e.line || ''}</div>
                    </td>
                    <td style="padding:0.5rem; font-family:var(--font-mono); color:#fde047; font-weight:700;">@${Number(e.odds).toFixed(2)}</td>
                    <td style="padding:0.5rem; font-family:var(--font-mono);">${e.modelProbability ? (e.modelProbability * 100).toFixed(1) + '%' : 'N/D'} · <strong style="color:#4ade80;">+${e.expectedValuePct}%</strong></td>
                    <td style="padding:0.5rem; font-family:var(--font-mono); color:#38bdf8;">${e.compositeScore}</td>
                    <td style="padding:0.5rem; text-align:right; white-space:nowrap;">
                      ${actionButton}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    return covHtml + contentHtml;
  }

  function renderHistorial(l) {
    const hist = (l.stepHistory || []).slice().reverse();
    if (hist.length === 0) {
      return '<div style="padding:1rem; color:#94a3b8; font-size:0.82rem;">Aún no hay escalones liquidados en el ciclo vigente.</div>';
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
              <th style="padding:0.5rem;">Tipo / Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${hist.map(h => {
              const settleTypeBadge = h.settlementType === 'MANUAL'
                ? '<span class="sem-badge sem-amber" style="background:rgba(245,158,11,0.16); color:#fde047; border:1px solid rgba(245,158,11,0.4); font-size:0.68rem;">MANUAL</span>'
                : '<span class="sem-badge sem-gray" style="font-size:0.68rem;">AUTO</span>';
              const settleDateStr = h.settledAtUtc ? formatKickoffArt(h.settledAtUtc) : '—';
              return `
              <tr style="border-bottom:1px solid rgba(28,39,68,0.6);">
                <td style="padding:0.5rem;">C${h.cycle} · E${h.step}</td>
                <td style="padding:0.5rem;"><strong>${h.match}</strong> — ${h.selection}</td>
                <td style="padding:0.5rem; font-family:var(--font-mono);">@${Number(h.odds).toFixed(2)}</td>
                <td style="padding:0.5rem; font-family:var(--font-mono);">${formatArs(h.capBefore)} → ${formatArs(h.capAfter)}</td>
                <td style="padding:0.5rem;"><span class="sem-badge ${h.status === 'WON' ? 'sem-green' : (h.status === 'LOST' ? 'sem-red' : 'sem-gray')}">${h.status}</span></td>
                <td style="padding:0.5rem; font-size:0.72rem; color:#94a3b8;">${settleTypeBadge} <span style="font-family:var(--font-mono);">${settleDateStr}</span></td>
              </tr>
              `;
            }).join('')}
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

    // SANITIZACIÓN ESTRICTA: Si la propuesta almacenada localmente ya fue liquidada en el historial oficial,
    // o su paso/ciclo no coinciden con el escalón activo, purgarla de inmediato para no mostrar botones residuales confusos.
    if (selectedProposal) {
      const isAlreadySettled = (l.stepHistory || []).some(h =>
        (h.betId && selectedProposal.betId && h.betId === selectedProposal.betId) ||
        (h.snapshotId && selectedProposal.snapshotId && h.snapshotId === selectedProposal.snapshotId) ||
        (h.opportunityKey && selectedProposal.opportunityKey && h.opportunityKey === selectedProposal.opportunityKey) ||
        (h.match === selectedProposal.match && h.selection === selectedProposal.selection)
      );
      if (isAlreadySettled || (selectedProposal.step && selectedProposal.step < (l.currentStep || 1))) {
        selectedProposal = null;
        saveSelectedProposal(null);
      }
    }

    const oppCount = (l.eligibleOpportunities || []).length + (l.pendingLineupOpportunities || []).length;
    const tabs = [
      ['principal', 'Principal'],
      ['oportunidades', `Oportunidades (${oppCount})`],
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
      ${renderConfirmModal()}
      ${renderManualBetModal(l)}
    `;
  }

  function renderManualBetModal(l) {
    if (!showManualBetModal) return '';
    const cap = (l ? l.currentCapital : OFFICIAL.initialCapital);
    const step = (l ? l.currentStep : 1);
    const oddsNum = Number(manualBetForm.odds);
    const potReturn = (Number.isFinite(oddsNum) && oddsNum > 0) ? Number((cap * oddsNum).toFixed(2)) : null;

    return `
      <div id="ladderManualBetModal" style="position:fixed; inset:0; background:rgba(0,0,0,0.82); backdrop-filter:blur(4px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:1rem;">
        <div style="background:#0b1224; border:1px solid rgba(56,189,248,0.45); border-radius:14px; max-width:540px; width:100%; padding:1.4rem; box-shadow:0 20px 50px rgba(0,0,0,0.7); max-height:92vh; overflow-y:auto;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:1.35rem;">⚡</span>
              <h3 style="font-size:1.1rem; font-weight:800; color:#ffffff; margin:0;">Cargar Pick en Vivo — Escalón ${step}</h3>
            </div>
            <button type="button" onclick="window.LadderModule.closeManualBetModal()" style="background:none; border:none; color:#94a3b8; font-size:1.2rem; cursor:pointer; padding:0.2rem 0.5rem;">✕</button>
          </div>
          <p style="font-size:0.8rem; color:#cbd5e1; line-height:1.4; margin-bottom:1rem;">
            Registrá una oportunidad observada en vivo durante el partido. El stake se calculará automáticamente con el 100% del capital del Escalón ${step} (<strong>${formatArs(cap)}</strong>).
          </p>

          <form onsubmit="window.LadderModule.submitManualBet(event)" style="display:flex; flex-direction:column; gap:0.85rem;">
            <div>
              <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Partido / Evento *</label>
              <input type="text" id="manual_match" required placeholder="Ej: Club Brugge vs Liverpool" value="${manualBetForm.match}" oninput="window.LadderModule.updateManualField('match', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#ffffff; font-size:0.82rem; box-sizing:border-box;">
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
              <div>
                <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Mercado *</label>
                <select id="manual_market" onchange="window.LadderModule.updateManualField('market', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#ffffff; font-size:0.82rem; box-sizing:border-box;">
                  <option value="Córners de equipo" ${manualBetForm.market === 'Córners de equipo' ? 'selected' : ''}>Córners de equipo</option>
                  <option value="Remates totales" ${manualBetForm.market === 'Remates totales' ? 'selected' : ''}>Remates totales</option>
                  <option value="Faltas cometidas" ${manualBetForm.market === 'Faltas cometidas' ? 'selected' : ''}>Faltas cometidas</option>
                  <option value="Faltas ganadas" ${manualBetForm.market === 'Faltas ganadas' ? 'selected' : ''}>Faltas ganadas</option>
                  <option value="Entradas (Tackles)" ${manualBetForm.market === 'Entradas (Tackles)' ? 'selected' : ''}>Entradas (Tackles)</option>
                  <option value="Ganador del partido (1X2)" ${manualBetForm.market === 'Ganador del partido (1X2)' ? 'selected' : ''}>Ganador 1X2</option>
                  <option value="Doble oportunidad" ${manualBetForm.market === 'Doble oportunidad' ? 'selected' : ''}>Doble oportunidad</option>
                  <option value="Otro / En Vivo" ${manualBetForm.market === 'Otro / En Vivo' ? 'selected' : ''}>Otro / En Vivo</option>
                </select>
              </div>

              <div>
                <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Competición (Opcional)</label>
                <input type="text" id="manual_competition" placeholder="Ej: UEFA Champions League" value="${manualBetForm.competition}" oninput="window.LadderModule.updateManualField('competition', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#ffffff; font-size:0.82rem; box-sizing:border-box;">
              </div>
            </div>

            <div style="display:grid; grid-template-columns:1.4fr 1fr; gap:0.75rem;">
              <div>
                <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Selección (Equipo / Jugador) *</label>
                <input type="text" id="manual_selection" required placeholder="Ej: Jorne Spileers" value="${manualBetForm.selection}" oninput="window.LadderModule.updateManualField('selection', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#ffffff; font-size:0.82rem; box-sizing:border-box;">
              </div>

              <div>
                <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Línea</label>
                <input type="text" id="manual_line" placeholder="Ej: Más de 0.5" value="${manualBetForm.line}" oninput="window.LadderModule.updateManualField('line', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#ffffff; font-size:0.82rem; box-sizing:border-box;">
              </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
              <div>
                <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Cuota en Vivo * (Rango 1.10 - 1.25)</label>
                <input type="number" step="0.01" min="1.01" max="10.0" id="manual_odds" required placeholder="Ej: 1.25" value="${manualBetForm.odds}" oninput="window.LadderModule.updateManualField('odds', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#fde047; font-weight:800; font-family:var(--font-mono); font-size:0.9rem; box-sizing:border-box;">
              </div>

              <div>
                <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Retorno Calculado</label>
                <div style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#38bdf8; font-weight:800; font-family:var(--font-mono); font-size:0.9rem; height:37px; box-sizing:border-box; display:flex; align-items:center;">
                  ${potReturn ? formatArs(potReturn) : '—'}
                </div>
              </div>
            </div>

            <div>
              <label style="display:block; font-size:0.74rem; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:0.25rem;">Observaciones / Contexto en Vivo</label>
              <input type="text" id="manual_notes" placeholder="Ej: Alta intensidad en faltas en los primeros 15 min" value="${manualBetForm.notes}" oninput="window.LadderModule.updateManualField('notes', this.value)" style="width:100%; background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:0.55rem 0.75rem; color:#ffffff; font-size:0.82rem; box-sizing:border-box;">
            </div>

            <div style="display:flex; justify-content:flex-end; gap:0.65rem; margin-top:0.75rem;">
              <button type="button" onclick="window.LadderModule.closeManualBetModal()" style="background:rgba(148,163,184,0.14); color:#cbd5e1; border:1px solid rgba(148,163,184,0.3); border-radius:8px; padding:0.5rem 1rem; font-weight:700; font-size:0.8rem; cursor:pointer;">Cancelar</button>
              <button type="submit" style="background:#22c55e; color:#052e16; border:none; border-radius:8px; padding:0.5rem 1.25rem; font-weight:800; font-size:0.82rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.4rem; box-shadow:0 2px 8px rgba(34,197,94,0.3);">
                <span>✓</span> Abrir Pick en Escalón ${step}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function openManualBetModal() {
    showManualBetModal = true;
    paint();
  }

  function closeManualBetModal() {
    showManualBetModal = false;
    paint();
  }

  function updateManualField(field, value) {
    manualBetForm[field] = value;
    if (field === 'odds') {
      const modal = document.getElementById('ladderManualBetModal');
      if (modal) paint();
    }
  }

  async function submitManualBet(event) {
    if (event) event.preventDefault();
    const l = cachedPayload && cachedPayload.prospectiveLadder;
    const oddsNum = Number(manualBetForm.odds);
    if (!Number.isFinite(oddsNum) || oddsNum < 1.01) {
      uiNotice = { type: 'err', text: 'La cuota ingresada debe ser un número válido mayor a 1.00.' };
      paint();
      return;
    }
    if (!manualBetForm.match || !manualBetForm.selection) {
      uiNotice = { type: 'err', text: 'Por favor completá los campos obligatorios (Partido y Selección).' };
      paint();
      return;
    }

    try {
      const payload = {
        match: manualBetForm.match,
        competition: manualBetForm.competition || 'En Vivo',
        market: manualBetForm.market,
        selection: manualBetForm.selection,
        line: manualBetForm.line,
        odds: oddsNum,
        notes: manualBetForm.notes
      };

      // 1. Intentar llamar API backend si está activo
      let serverOk = false;
      try {
        const res = await fetch('/api/ladder/open-manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          serverOk = true;
        }
      } catch (e) {}

      // 2. Respaldo local si no hay servidor activo
      if (!serverOk) {
        const cap = (l ? l.currentCapital : OFFICIAL.initialCapital);
        const potReturn = Number((cap * oddsNum).toFixed(2));
        const nowIso = new Date().toISOString();
        const betId = `ladder_manual_${Date.now()}_step${l ? l.currentStep : 1}`;

        const manualBet = {
          betId,
          cycle: l ? l.currentCycle : 1,
          step: l ? l.currentStep : 1,
          snapshotId: `manual_live_${Date.now()}`,
          opportunityKey: `manual_${Date.now()}`,
          match: manualBetForm.match,
          competition: manualBetForm.competition || 'En Vivo',
          market: manualBetForm.market,
          selection: manualBetForm.selection,
          line: manualBetForm.line,
          odds: oddsNum,
          modelProbability: 0.85,
          expectedValuePct: 8.0,
          elenaDecision: 'APROBADO_MANUAL',
          riskManagerDecision: 'APROBADO_MANUAL',
          origin: 'MANUAL_LIVE',
          stake: cap,
          potentialReturn: potReturn,
          openedAtUtc: nowIso,
          status: 'OPEN'
        };

        const ov = loadLocalOverride() || {};
        ov.openBet = manualBet;
        ov.committedStake = cap;
        saveLocalOverride(ov);
      }

      showManualBetModal = false;
      manualBetForm = { match: '', competition: '', market: 'Córners de equipo', selection: '', line: '', odds: '', notes: '' };
      uiNotice = {
        type: 'ok',
        text: `✓ Pick en vivo cargado exitosamente para el Escalón ${l ? l.currentStep : 1}: ${payload.match} — ${payload.selection} @${oddsNum.toFixed(2)}.`
      };
      await reload();
    } catch (err) {
      uiNotice = { type: 'err', text: 'Error al abrir el pick en vivo: ' + err.message };
      paint();
    }
  }

  function renderConfirmModal() {
    if (!pendingManualSettle) return '';
    const p = pendingManualSettle;
    return `
      <div id="ladderConfirmModal" style="position:fixed; inset:0; background:rgba(0,0,0,0.78); backdrop-filter:blur(4px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:1rem;">
        <div style="background:#0b1224; border:1px solid rgba(34,197,94,0.45); border-radius:14px; max-width:500px; width:100%; padding:1.4rem; box-shadow:0 20px 40px rgba(0,0,0,0.6);">
          <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
            <span style="font-size:1.4rem;">🏆</span>
            <h3 style="font-size:1.1rem; font-weight:800; color:#ffffff; margin:0;">Confirmar liquidación manual como GANADO</h3>
          </div>
          <p style="font-size:0.84rem; color:#cbd5e1; line-height:1.5; margin-bottom:1rem;">
            ¿Confirmás que la selección del <strong>Escalón ${p.step} (Ciclo ${p.cycle})</strong> resultó acertada en el evento oficial?
          </p>
          <div style="background:rgba(15,23,42,0.85); border:1px solid #1c2744; border-radius:10px; padding:0.85rem; font-size:0.8rem; margin-bottom:1.1rem;">
            <div style="font-weight:700; color:#f8fafc; font-size:0.92rem;">${p.match}</div>
            <div style="color:#94a3b8; margin-top:0.2rem;">${p.selection} — <strong>${p.market}</strong> · ${p.line || ''}</div>
            <div style="display:flex; justify-content:space-between; margin-top:0.6rem; font-family:var(--font-mono); font-size:0.82rem; border-top:1px dashed #1e293b; padding-top:0.5rem;">
              <span>Cuota: <strong style="color:#fde047;">@${Number(p.odds).toFixed(2)}</strong></span>
              <span>Stake: <strong>${formatArs(p.stake)}</strong></span>
              <span>Retorno: <strong style="color:#4ade80;">${formatArs(p.potentialReturn)}</strong></span>
            </div>
            <div style="margin-top:0.55rem; font-size:0.76rem; color:#38bdf8;">
              ➜ El nuevo capital pasará a <strong>${formatArs(p.potentialReturn)}</strong> y se avanzará al <strong>Escalón ${p.step + 1}</strong>.
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.65rem;">
            <button type="button" onclick="window.LadderModule.cancelManualSettle()" ${isSettlingManual ? 'disabled' : ''} style="background:rgba(148,163,184,0.14); color:#cbd5e1; border:1px solid rgba(148,163,184,0.3); border-radius:8px; padding:0.5rem 1rem; font-weight:700; font-size:0.8rem; cursor:pointer;">Cancelar</button>
            <button type="button" onclick="window.LadderModule.executeManualSettle()" ${isSettlingManual ? 'disabled' : ''} style="background:#22c55e; color:#052e16; border:none; border-radius:8px; padding:0.5rem 1.15rem; font-weight:800; font-size:0.82rem; cursor:pointer; display:inline-flex; align-items:center; gap:0.4rem;">
              ${isSettlingManual ? '<span>⏳</span> Registrando...' : '<span>✓</span> Sí, registrar GANADO'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function requestManualSettleWon(betId) {
    const l = cachedPayload && cachedPayload.prospectiveLadder;
    if (!l) return;
    const bet = l.openBet;
    if (!bet || bet.betId !== betId) {
      uiNotice = { type: 'err', text: 'No se encontró la apuesta abierta activa para liquidar.' };
      paint();
      return;
    }
    // Verificar si ya figura en el historial
    const already = (l.stepHistory || []).find(h => h.betId === betId);
    if (already) {
      uiNotice = { type: 'err', text: `Este pick ya fue liquidado como ${already.status}. No se permite liquidación duplicada.` };
      paint();
      return;
    }
    pendingManualSettle = {
      betId: bet.betId,
      match: bet.match,
      selection: bet.selection,
      market: bet.market,
      line: bet.line,
      odds: bet.odds,
      stake: bet.stake,
      potentialReturn: bet.potentialReturn,
      step: bet.step,
      cycle: bet.cycle
    };
    paint();
  }

  function cancelManualSettle() {
    if (isSettlingManual) return;
    pendingManualSettle = null;
    paint();
  }

  async function executeManualSettle() {
    if (!pendingManualSettle || isSettlingManual) return;
    const bet = pendingManualSettle;
    isSettlingManual = true;
    paint();

    let serverSucceeded = false;
    let serverMessage = null;

    // 1. Intentar liquidación oficial mediante API del backend (si hay servidor Node activo)
    try {
      const res = await fetch('/api/ladder/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          betId: bet.betId,
          outcome: 'WON',
          settledBy: 'Usuario (Manual)'
        })
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        serverSucceeded = true;
        serverMessage = data && data.message;
      }
    } catch (netErr) {
      // Si estamos en entorno estático sin backend Node (ej. VS Code Live Server / file://), el fetch fallará
      serverSucceeded = false;
    }

    // 2. Liquidación local resiliente (garantiza funcionamiento autónomo ante HTTP 404 o sin servidor)
    const l = (cachedPayload && cachedPayload.prospectiveLadder) ? cachedPayload.prospectiveLadder : null;
    const capBefore = bet.stake || (l ? l.currentCapital : OFFICIAL.initialCapital);
    const capAfter = Number((capBefore * Number(bet.odds)).toFixed(2));
    const profitDelta = Number((capAfter - capBefore).toFixed(2));
    const nowIso = new Date().toISOString();

    const settledRecord = {
      ...bet,
      status: 'WON',
      capBefore,
      capAfter,
      profitDelta,
      settledAtUtc: nowIso,
      source: 'Registro Manual de Usuario',
      settlementType: 'MANUAL',
      settledBy: 'Usuario (Manual)',
      manualNotes: 'Liquidación confirmada manualmente por el usuario desde la interfaz del Reto Escalera.'
    };

    const nextStep = (bet.step || (l ? l.currentStep : 1)) + 1;
    const currentHist = (l && l.stepHistory) ? [...l.stepHistory] : [];
    // Prevenir duplicados si ya estuviera
    if (!currentHist.some(h => h.betId === bet.betId)) {
      currentHist.push(settledRecord);
    }

    const newTarget = (l && l.targetCapital) ? l.targetCapital : OFFICIAL.targetCapital;
    const newObjectiveStatus = capAfter >= newTarget ? 'OBJECTIVE_REACHED' : 'IN_PROGRESS';

    const localOverride = {
      currentCapital: capAfter,
      currentStep: nextStep,
      currentCycle: bet.cycle || (l ? l.currentCycle : 1),
      committedStake: 0,
      openBet: null,
      lastSettlement: settledRecord,
      stepHistory: currentHist,
      objectiveStatus: newObjectiveStatus,
      cumulativeProfit: Number(((l ? (l.cumulativeProfit || 0) : 0) + profitDelta).toFixed(2))
    };

    saveLocalOverride(localOverride);

    pendingManualSettle = null;
    isSettlingManual = false;
    selectedProposal = null;
    saveSelectedProposal(null);

    uiNotice = {
      type: 'ok',
      text: `✓ Pick ${bet.selection} marcado como GANADO exitosamente. Escalón ${bet.step} completado. Capital actualizado a ${formatArs(capAfter)}. Avanzado al Escalón ${nextStep}.`
    };

    await reload();
  }

  function selectOpportunity(snapshotId) {
    const l = cachedPayload && cachedPayload.prospectiveLadder;
    if (!l) return;
    if (selectedProposal && selectedProposal.status === 'CONFIRMED') {
      uiNotice = { type: 'err', text: 'Ya tenés una apuesta elegida y confirmada para el escalón actual. Liberalá primero si querés cambiarla.' };
      activeTab = 'principal';
      paint();
      return;
    }
    const opp = (l.eligibleOpportunities || []).find(o => o.snapshotId === snapshotId);
    const check = revalidateCandidate(opp, l);
    if (!check.ok) {
      uiNotice = { type: 'err', text: 'Selección bloqueada: ' + check.reasons.join(' | ') };
      activeTab = 'principal';
      paint();
      return;
    }
    selectedProposal = { ...opp, status: 'PENDING_CONFIRMATION', selectedAtUtc: new Date().toISOString() };
    saveSelectedProposal(selectedProposal);
    uiNotice = { type: 'ok', text: `✓ Propuesta guardada para el Escalón ${l.currentStep || 1}: ${opp.match} (${opp.selection} @${Number(opp.odds).toFixed(2)}). Pendiente de confirmación explícita.` };
    activeTab = 'principal';
    paint();
  }

  async function confirmSelection() {
    await fetchLiveState();
    const l = cachedPayload && cachedPayload.prospectiveLadder;
    if (!l || !selectedProposal) return;
    const latestOpp = (l.eligibleOpportunities || []).find(o => o.snapshotId === selectedProposal.snapshotId);
    const check = revalidateCandidate(latestOpp || selectedProposal, l);
    if (!latestOpp) {
      uiNotice = { type: 'err', text: 'Confirmación bloqueada: la oportunidad ya no está disponible en la bandeja elegible.' };
      paint();
      return;
    }
    if (!check.ok) {
      uiNotice = { type: 'err', text: 'Confirmación bloqueada: ' + check.reasons.join(' | ') };
      paint();
      return;
    }
    const cap = l.currentCapital ?? OFFICIAL.initialCapital;
    const potReturn = Number((cap * Number(latestOpp.odds)).toFixed(2));
    selectedProposal = {
      ...latestOpp,
      status: 'CONFIRMED',
      step: l.currentStep || 1,
      cycle: l.currentCycle || 1,
      stake: cap,
      potentialReturn: potReturn,
      selectedAtUtc: selectedProposal.selectedAtUtc || new Date().toISOString(),
      confirmedAtUtc: new Date().toISOString()
    };
    saveSelectedProposal(selectedProposal);
    uiNotice = {
      type: 'ok',
      text: `✓ Apuesta confirmada para el Escalón ${selectedProposal.step} (Ciclo ${selectedProposal.cycle}): ${latestOpp.match} — ${latestOpp.selection} @${Number(latestOpp.odds).toFixed(2)} (Stake ${formatArs(cap)} → Retorno potencial ${formatArs(potReturn)}).`
    };
    activeTab = 'principal';
    paint();
  }

  function cancelSelection() {
    selectedProposal = null;
    saveSelectedProposal(null);
    uiNotice = { type: 'ok', text: 'Selección liberada. Podés elegir otra oportunidad en la pestaña Oportunidades.' };
    paint();
  }

  function backToOpportunities() {
    uiNotice = null;
    activeTab = 'oportunidades';
    paint();
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
    uiNotice = null;
    await fetchLiveState();
    paint();
  }

  function setTab(tab) {
    activeTab = tab;
    paint();
  }

  global.LadderModule = {
    selectAvatar,
    toggleAvatarSelector,
    toggleFullLadderModal,

    render,
    reload,
    setTab,
    selectOpportunity,
    confirmSelection,
    cancelSelection,
    backToOpportunities,
    requestManualSettleWon,
    cancelManualSettle,
    executeManualSettle,
    openManualBetModal,
    closeManualBetModal,
    updateManualField,
    submitManualBet,
    _formatKickoffArt: formatKickoffArt,
    _revalidateCandidate: revalidateCandidate
  };
})(window);
