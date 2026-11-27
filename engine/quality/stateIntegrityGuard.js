/**
 * STATE INTEGRITY GUARD & CANONICAL STATUS RESOLVER
 * Implementa las reglas obligatorias de la Sección 8 de DARADOR IA:
 *
 * 1. Una selección manual no puede recibir automáticamente aprobación de Elena.
 * 2. Una selección Shadow Passive no puede aparecer como aprobada para apostar.
 * 3. Un candidato con EV inferior al umbral productivo (+7.0%) no puede aparecer como aprobado en producción.
 * 4. Un candidato con cuota fuera del rango productivo [1.60, 2.35] no puede heredar aprobación productiva.
 * 5. Se crean estados inequívocos: DISCOVERED, UNDER_RESEARCH, MATHEMATICAL_PASS, COMMITTEE_APPROVED,
 *    RISK_APPROVED, SHADOW_PASSIVE, EXPERIMENTAL_APPROVED, REJECTED, EXPIRED, VOID.
 * 6. Validación estricta tanto en backend como exportable para frontend.
 */

const CANONICAL_STATES = {
  DISCOVERED: 'DISCOVERED',
  UNDER_RESEARCH: 'UNDER_RESEARCH',
  MATHEMATICAL_PASS: 'MATHEMATICAL_PASS',
  COMMITTEE_APPROVED: 'COMMITTEE_APPROVED',
  RISK_APPROVED: 'RISK_APPROVED',
  SHADOW_PASSIVE: 'SHADOW_PASSIVE',
  EXPERIMENTAL_APPROVED: 'EXPERIMENTAL_APPROVED',
  EXPERIMENTAL_REJECTED_BY_RISK_MANAGER: 'EXPERIMENTAL_REJECTED_BY_RISK_MANAGER',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  VOID: 'VOID'
};

/**
 * Validador backend que resuelve el estado verificado de un pick
 */
function resolveCanonicalPickStatus(pick) {
  if (!pick) {
    return {
      status: CANONICAL_STATES.REJECTED,
      elenaStatus: 'RECHAZADO',
      isOperativeApproved: false,
      badgeText: 'Inválido',
      badgeClass: 'sem-red',
      reason: 'Registro nulo o vacío'
    };
  }

  const odds = Number(pick.odds || pick.bookmakerOdds || 0);
  const evVal = Number(pick.edge_pct !== undefined ? pick.edge_pct : (parseFloat(pick.ev_pct) || 0));
  const isShadowMode = Boolean(pick.shadow_mode) || pick.status === 'SHADOW_PASSIVE' || pick.tribunalDecision === 'SHADOW_PASSIVE' || pick.category === 'shadow_passive';
  const isManual = Boolean(pick.isManual) || Boolean(pick.manualOverride) || pick.source === 'MANUAL_INJECTION';
  const isExperimental = pick.policy === 'EXPERIMENTAL_ODDS_V24' || pick.environment === 'EXPERIMENTAL';

  // REGLA 2: Una selección Shadow Passive NO puede aparecer como aprobada para apostar
  if (isShadowMode || pick.status === 'SHADOW_PASSIVE' || pick.tribunalDecision === 'SHADOW_PASSIVE') {
    return {
      status: CANONICAL_STATES.SHADOW_PASSIVE,
      elenaStatus: 'OBSERVACION_PASIVA',
      isOperativeApproved: false,
      badgeText: '🔭 Shadow Passive',
      badgeClass: 'sem-cyan',
      reason: 'Selección congelada en protocolo de observación pasiva (sin aprobación operativa).'
    };
  }

  // REGLA 1: Una selección manual no puede recibir automáticamente aprobación de Elena
  if (isManual && !pick.verifiedByRiskManager) {
    return {
      status: CANONICAL_STATES.UNDER_RESEARCH,
      elenaStatus: 'PENDIENTE_AUDITORIA',
      isOperativeApproved: false,
      badgeText: '⚠️ Manual no verificada',
      badgeClass: 'sem-amber',
      reason: 'Carga manual pendiente de auditoría y verificación por Elena.'
    };
  }

  // REGLA 4: Candidato con cuota fuera de rango productivo [1.60, 2.35]
  if (odds < 1.60 && !isExperimental) {
    // Si fue forzado como "APROBADO" pero no cumple rango, degradar a SHADOW_PASSIVE o RECHAZADO
    return {
      status: CANONICAL_STATES.SHADOW_PASSIVE,
      elenaStatus: 'OBSERVACION_PASIVA',
      isOperativeApproved: false,
      badgeText: '🔭 Shadow Passive (Cuota < 1.60)',
      badgeClass: 'sem-cyan',
      reason: `Cuota @${odds.toFixed(2)} inferior al suelo productivo de 1.60. Clasificado en observación pasiva.`
    };
  }

  // REGLA 3: Candidato con EV inferior al umbral productivo (+7.0%)
  if (evVal < 7.0 && !isExperimental) {
    return {
      status: CANONICAL_STATES.SHADOW_PASSIVE,
      elenaStatus: 'OBSERVACION_PASIVA',
      isOperativeApproved: false,
      badgeText: '🔭 Shadow Passive (EV < +7%)',
      badgeClass: 'sem-cyan',
      reason: `EV (+${evVal.toFixed(1)}%) inferior al umbral institucional de +7.0%. No elegible para aprobación operativa.`
    };
  }

  // Candidatos experimentales
  if (isExperimental) {
    if (pick.finalState === CANONICAL_STATES.EXPERIMENTAL_APPROVED) {
      return {
        status: CANONICAL_STATES.EXPERIMENTAL_APPROVED,
        elenaStatus: 'APROBADO_EXPERIMENTAL',
        isOperativeApproved: false, // NO ES OPERATIVO PRODUCTIVO
        badgeText: '🧪 Experimental V2.4',
        badgeClass: 'sem-purple',
        reason: 'Aprobado bajo protocolo experimental V2.4 (aislado de producción).'
      };
    }
    return {
      status: pick.finalState || CANONICAL_STATES.REJECTED,
      elenaStatus: 'RECHAZADO_EXPERIMENTAL',
      isOperativeApproved: false,
      badgeText: '✕ Exp. Rechazado',
      badgeClass: 'sem-red',
      reason: pick.discardReason || 'Rechazado en protocolo experimental.'
    };
  }

  // Estados deportivos terminales
  const sportsStatus = String(pick.status || pick.sports_result || '').toUpperCase();
  if (['ACERTADA', 'GANADA'].includes(sportsStatus)) {
    return {
      status: 'ACERTADA',
      elenaStatus: 'APROBADO',
      isOperativeApproved: true,
      badgeText: '✓ Acertada',
      badgeClass: 'sem-green',
      reason: 'Apuesta liquidada como ganadora.'
    };
  }
  if (['FALLADA', 'PERDIDA'].includes(sportsStatus)) {
    return {
      status: 'FALLADA',
      elenaStatus: 'APROBADO',
      isOperativeApproved: true,
      badgeText: '✕ Fallada',
      badgeClass: 'sem-red',
      reason: 'Apuesta liquidada como fallada.'
    };
  }
  if (['ANULADA', 'ANULADA_NO_TITULAR', 'ANULADA_LINEUP', 'VOID'].includes(sportsStatus)) {
    return {
      status: CANONICAL_STATES.VOID,
      elenaStatus: 'ANULADA',
      isOperativeApproved: false,
      badgeText: '⊘ Anulada',
      badgeClass: 'sem-gray',
      reason: pick.rationale || 'Apuesta anulada (sin participación o suspensión).'
    };
  }

  // Selección Aprobada legítima
  if (pick.status === 'APROBADO' && odds >= 1.60 && odds <= 2.35 && evVal >= 7.0) {
    return {
      status: CANONICAL_STATES.RISK_APPROVED,
      elenaStatus: 'APROBADO',
      isOperativeApproved: true,
      badgeText: '✓ Elena: Aprobado',
      badgeClass: 'sem-green',
      reason: 'Aprobado por el Tribunal con cumplimiento pleno de reglas institucionales.'
    };
  }

  return {
    status: CANONICAL_STATES.UNDER_RESEARCH,
    elenaStatus: 'PENDIENTE',
    isOperativeApproved: false,
    badgeText: '⏳ Pendiente',
    badgeClass: 'sem-amber',
    reason: 'En proceso de evaluación.'
  };
}

module.exports = {
  CANONICAL_STATES,
  resolveCanonicalPickStatus
};
