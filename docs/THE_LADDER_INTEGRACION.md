# DARADORBET — THE LADDER (Gran Escalera)
## Diagnóstico de Integración y Arquitectura Conceptual

### 1. Diagnóstico del sistema actual (Inspección previa)

| Capa | Ubicación actual | Rol en DaradorBET | Integración prevista con THE LADDER (Fase futura) |
| :--- | :--- | :--- | :--- |
| **Navegación & UI** | `dashboard.html`, `index.html` | Barra superior desktop (`#desktopViewTabs`), barra inferior móvil (`#mobileBottomNav`), `switchView(view)` | Nueva pestaña `THE LADDER` (`#tabLadder` / `#mTabLadder`) y sección `#viewLadder` renderizada por `assets/js/ladderModule.js` |
| **Sistema visual** | Tokens CSS en `dashboard.html` | Dark mode (`#050813`), violeta (`#8b5cf6`), turquesa (`#00f2fe`), verde (`#4ade80`), badges semánticos `.sem-*` | Reutilización 100% de variables CSS y badges semánticos sin duplicar estilos |
| **Motor de picks** | `engine/prediction/predictionEngine.js` + `engine/experimental/shadowLabRunner.js` | Cálculo de probabilidades, cuota justa, EV y consenso multi-modelo | Lectura pasiva del consenso y probabilidad estimada (sin duplicar fórmulas) |
| **Comité IA y Riesgo** | `engine/agents/orchestrator.js`, `engine/agents/riskManager.js` | Dictámenes de los 6 agentes y aprobación/veto vinculante de Elena | Filtro obligatorio: solo candidatos con `elenaDecision === 'APROBADO'` y validación de Risk Manager |
| **Liquidación** | `engine/settlement/settlementEngine.js` | Liquidación oficial post-partido (`GANADA`, `PERDIDA`, `ANULADA`) | Consumo de eventos de liquidación para actualizar el estado del escalón de forma auditable |
| **Persistencia** | `engine/storage_data/*.json`, `picks_hoy.json`, `historial_picks.json` | Almacenamiento JSON auditado con hashes SHA-256 | Futuro archivo aislado `engine/storage_data/ladder_state.json` (solo cuando se autorice) |

---

### 2. Arquitectura modular implementada (Fase Visual / Diseño)

- **`engine/ladder/ladderSchema.js`**: Contrato de datos, reglas funcionales congeladas (`LADDER_RULES`), enumeraciones de estados (`PENDIENTE`, `APROBADO`, `EJECUTADO`, `GANADO`, `PERDIDO`, `ANULADO`) y estados de disciplina (`OPORTUNIDAD_DISPONIBLE`, `ESPERANDO`, `DIA_SIN_APUESTA`).
- **`assets/js/ladderModule.js`**: Módulo UI autocontenido organizado en los 5 componentes solicitados:
  1. `LadderDashboard`: Cabecera, banner de modo demo no operativo, resumen superior de 6 KPIs y panel de disciplina.
  2. `LadderProgression`: Visualización ascendente de escalones con capital por etapa, cuota alcanzada y estado semántico.
  3. `LadderOpportunityCard`: Ficha de próxima oportunidad con partido, mercado, selección, cuota, probabilidad estimada, EV, consenso de modelos, aprobación de Elena, validación de Risk Manager y estado de alineaciones/datos (incluye selector de vista demo para inspeccionar estado *Oportunidad disponible* vs *Esperando / Día sin apuesta*).
  4. `LadderHistory`: Tabla auditable de progresión histórica y jornadas sin apuesta.
  5. `LadderStatistics`: Métricas de disciplina, retención de capital y recordatorio de umbral de referencia (95%, pendiente de validación estadística).

---

### 3. Reglas funcionales y garantías de integridad

- **Una única Gran Escalera activa.**
- **Reinversión teórica del 100% del retorno** (sin alterar capital en días sin apuesta).
- **Máximo 1–2 selecciones diarias** y **probabilidad mínima de referencia 95%** (pendiente de validación estadística en Shadow Lab).
- **Doble candado:** solo oportunidades aprobadas por **Elena** y validadas por **Risk Manager**.
- **Ejecución manual:** ninguna apuesta se ejecuta automáticamente.
- **Producción intacta:** en esta entrega no se modificó el motor productivo, el Daily Board, los filtros, Risk Manager, Settlement ni los registros históricos sellados (101/101 hashes SHA-256).
