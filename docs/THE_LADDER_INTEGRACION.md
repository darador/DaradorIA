# DARADORBET — THE LADDER (Gran Escalera)
## Arquitectura v2.0: Oportunidades Dinámicas, Ejecución Secuencial y Control de Exposición

### 1. Filosofía y Reglas Operativas (v2.0)

- **Sin límite artificial de apuestas diarias (`maxDailySelections: null`):** puede haber 0, 1 o varias oportunidades válidas en un mismo día; nunca se fuerza una selección para cumplir una cuota diaria.
- **Ejecución estrictamente secuencial:** solo puede existir **1 escalón comprometido con capital activo** a la vez (`maxConcurrentCommittedSteps: 1`).
- **Liquidación confirmada obligatoria:** no se libera capital ni se habilita el siguiente escalón por el mero vencimiento del horario estimado del partido; requiere liquidación definitiva (`WON`, `LOST` o `VOID`).
- **Control estricto de ventanas horarias (`computeEventWindow`):** cada evento calcula su ventana real `[kickoffUtc, kickoffUtc + base + adicional + prórroga + bufferLiquidación]` según deporte (`football`, `basketball`, `tennis`, `default`) y zona horaria. Dos eventos con ventanas superpuestas **no pueden ejecutarse simultáneamente**.
- **Gestión de oportunidades `EN_ESPERA`:** una oportunidad en espera no queda pre-aprobada para ejecución; al liberarse la escalera debe reevaluarse por completo (disponibilidad, cambio de cuota `<= 5%`, probabilidad/EV, Elena, Risk Manager y ventana horaria). Si no revalida, pasa a `DESCARTADA`.
- **Prevalencia vinculante de Risk Manager:** implementado de forma aislada en `engine/ladder/ladderRiskGuard.js` sin alterar `engine/agents/riskManager.js`. La aprobación de Elena **nunca** puede saltarse un bloqueo de Risk Manager.
- **Concurrencia e Idempotencia:** control optimista por `stateVersion` + mutex en memoria + registro de `idempotencyKey` para evitar que dos procesos comprometan el mismo capital o dupliquen una liquidación.
- **Configuración matemática:** Capital inicial `$ 50.000 ARS`, objetivo `$ 10.000.000 ARS`, reinversión teórica `100%` (`capital_siguiente = capital_actual × cuota_liquidada`), simulación de referencia `@ 1.20` en `30` escalones (`$ 11.868.816 ARS` en E30).

---

### 2. Módulos y Servicios

| Archivo | Rol | Impacto en producción |
| :--- | :--- | :--- |
| `engine/ladder/ladderSchema.js` | Reglas v2.0, estados de escalera y oportunidades, perfiles de ventana horaria por deporte | Aislado (solo experimental) |
| `engine/ladder/ladderRiskGuard.js` | Validación aislada de exposición, superposición horaria, drift de cuota y veto vinculante | Cero cambios en `riskManager.js` productivo |
| `engine/ladder/ladderEngine.js` | Máquina de estados secuencial con concurrencia (`stateVersion`), idempotencia y audit log | Cero cambios en motores productivos |
| `engine/tests/test_ladder_sequential_rules.js` | 12 pruebas automatizadas obligatorias (12/12 PASS) | Solo pruebas |
| `assets/js/ladderModule.js` | UI Mobile-First de 4 tabs (`Principal`, `Escalera`, `Disciplina`, `Historial`) con métricas reales de exposición | Solo módulo visual THE LADDER |

---

### 3. Estados de Oportunidades y Escalera

- **Estados de Escalera:** `DISPONIBLE`, `OPORTUNIDAD_EN_EVALUACION`, `EN_ESPERA`, `APUESTA_ACTIVA`, `LIQUIDACION_PENDIENTE`, `DETENIDA`.
- **Estados de Oportunidades:** `DETECTADA`, `EN_EVALUACION`, `APROBADA`, `EN_ESPERA`, `DESCARTADA`, `RECHAZADA`, `EJECUTADA`, `LIQUIDADA`.
- **Garantía de integridad:** Daily Board, Centro de Investigación, Agentes IA, Prediction Engine, Risk Manager productivo, Settlement y los 101 hashes históricos SHA-256 permanecen intactos.
