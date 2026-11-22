# DARADORBET — FASE 12.3.1
# AUDITORÍA DE CONSISTENCIA: VERIFICACIÓN DEL VETO DE ELENA Y CÁLCULO DE EV
## Análisis Forense del Candidato `cand_1795110774831_6rsb2k`

**Fecha de ejecución:** 21 de noviembre de 2026  
**Tipo de auditoría:** Auditoría técnica y forense de solo lectura (Strictly Read-Only)  
**Objeto auditado:** Candidato `cand_1795110774831_6rsb2k` (Internacional vs. Vasco da Gama)  
**Dictamen Formal:** **ERROR DE DOCUMENTACIÓN**

---

## 1. RESUMEN EJECUTIVO

La presente auditoría fue convocada para comprobar si el motivo atribuido en el informe de la Fase 12.3 para la exclusión del pick `cand_1795110774831_6rsb2k` (atribuido a un supuesto *"Veto cuantitativo mandatorio de Elena por EV negativo de -6.0% en Modelo C"*) coincidía con las reglas de software y registros históricos vigentes al momento de la decisión (19 de noviembre de 2026).

### Hallazgos Principales:
1. **Elena NUNCA vetó formalmente este pick (`elenaVetoApplied: false`):**
   En el registro original (`engine/storage_data/model_observation_registry.json`), el pick figura con:
   - `stage`: `"ELIGIBLE"`
   - `elenaDecision`: `"PENDIENTE"`
   - `elenaVetoApplied`: `false`
   - `elenaVetoReasons`: `[]`
   - `rejectionStage`: `null`
2. **El EV operativo evaluado fue de $+40.0\%$ (o $+17.0\%$ si 50/50), NUNCA $-6.0\%$:**
   La regla implementada en `engine/agents/riskManager.js` evaluaba exclusivamente `prediction.ev` (el EV global/ensamble). Para este pick, el EV registrado en la canalización fue de **$+40.0\%$**, superando holgadamente el umbral mandatorio de $+7.0\%$. El valor $EV_C = -6.0\%$ corresponde a una métrica contrafactual interna de Fase 10.1 en el Observation Tracker y **nunca fue consumida por el Risk Manager**.
3. **Causa real de exclusión del Portfolio Elena (No Aprobación por Datos Incompletos):**
   El pick era una proposición de equipo (*Team Prop*). En `research_candidates.json`, la investigación cuantitativa de equipo arrojó `qualityStatus: "INVESTIGACION_INCOMPLETA"` (`NO_TEAM_MATCHES_RETURNED`, $N=0$). Por lo tanto, el pick **nunca fue promovido a `approved_picks.json`** (`inApp: false`). Permaneció en estado `PENDIENTE` sin llegar a ser una apuesta autorizada.
4. **Clasificación del Dictamen: ERROR DE DOCUMENTACIÓN:**
   La exclusión del pick del Portfolio Elena es **completamente legítima y correcta** (el pick jamás fue aprobado ni apostado). Sin embargo, la Fase 12.3 incurrió en un **error de documentación ex-post** al atribuir la exclusión a un "Veto por EV de Modelo C", construyendo una justificación retrospectiva ajena a la regla real del motor.
5. **Rectificación Metodológica de Rendimiento:**
   La mejora de $+5.8\%$ de Yield y $+3.2\%$ de Win Rate al separar este pick **no constituye evidencia estadística de eficacia del filtro**, sino una **diferencia aritmética muestral sobre un único caso ($N=1$)** dominada por la varianza.

---

## 2. RECONSTRUCCIÓN DEL CÁLCULO Y MATRICES DE EV

### 2.1 Datos Originales del Pick
* **PickId:** `cand_1795110774831_6rsb2k`
* **Partido:** Internacional vs. Vasco da Gama (19/11/2026, Brasileirão Série A)
* **Mercado:** Remates al arco de equipo — Más de 3.5
* **Tipo de Prop:** *Team Prop* (`isTeamProp: true`)
* **Cuota de Mercado:** `2.00` (Bet365)
* **Sello SHA-256 Prepartido:** `81cd19227aa81cfaf60224539c36ae71fb9575349123d3cf069dc507504be433`

### 2.2 Probabilidades y Valores Esperados Registrados
A partir del registro canónico en `engine/storage_data/model_observation_registry.json`:

| Parámetro | Valor Registrado | Fórmula Matemática | Estado frente al Umbral (+7.0%) |
|---|:---:|:---:|:---:|
| **Probabilidad Modelo B (L10)** | `0.7000` (70.0%) | Hit rate bruto L10 en fuente | — |
| **Probabilidad Modelo C (L15)** | `0.4700` (47.0%) | Hit rate bruto L15 en fuente | — |
| **Probabilidad Ensamble Registrada** | `0.7000` (`originalProb`) | Fallback al modelo primario | — |
| **Probabilidad Ensamble Aritmético** | `0.5850` (58.5%) | $(0.70 + 0.47) / 2$ | — |
| **EV Modelo B ($EV_B$)** | **+0.4000 (+40.0%)** | $(0.70 \times 2.00) - 1$ | **SUPERA** (+40.0% > +7.0%) |
| **EV Modelo C ($EV_C$)** | **-0.0600 (-6.0%)** | $(0.47 \times 2.00) - 1$ | No supera (-6.0% < +7.0%) |
| **EV Ensamble Registrado** | **+0.4000 (+40.0%)** | $(0.70 \times 2.00) - 1$ | **SUPERA** (+40.0% > +7.0%) |
| **EV Ensamble Aritmético (50/50)** | **+0.1700 (+17.0%)** | $(0.585 \times 2.00) - 1$ | **SUPERA** (+17.0% > +7.0%) |

### 2.3 Regla de Software en `riskManager.js`
Al examinar el código de `engine/agents/riskManager.js` (líneas 28–36):
```javascript
// --- REGLA 1: BARRERA MATEMÁTICA ESTRICTA (NO NEGOCIABLE) ---
const ev = prediction?.ev || 0;
const evPercentage = prediction?.evPercentage || 0;

if (ev < this.minEV) {
  vetoReasons.push(`VETO MATEMÁTICO: EV insuficiente (+${evPercentage}% < +${(this.minEV * 100).toFixed(1)}%).`);
}
```

#### Evidencia del Código:
1. `riskManager.js` evalúa exclusivamente `prediction.ev`.
2. En ninguna línea de `riskManager.js` se consulta `prediction.models.modelC.ev` ni `evModelC`.
3. Dado que `prediction.ev` fue transferido como `0.40` ($+40.0\%$), **el Risk Manager jamás activó el VETO MATEMÁTICO para este pick**.

---

## 3. RECONSTRUCCIÓN DEL RECHAZO: ¿VETO O NO PROMOCIÓN?

### 3.1 Inspección del Registro de Observación
En `engine/storage_data/model_observation_registry.json`, los campos relativos a la decisión de Elena declaran textualmente:
```json
{
  "stage": "ELIGIBLE",
  "rejectionStage": null,
  "rejectionCategory": null,
  "elenaDecision": "PENDIENTE",
  "elenaVetoApplied": false,
  "elenaVetoReasons": [],
  "elenaVetoRule": null,
  "stateHistory": [
    {
      "fromState": "RESEARCHED",
      "toState": "ELIGIBLE",
      "timestamp": "2026-11-19T17:52:54.866Z",
      "reason": "Filtro EV superado (EV >= +7.0%)",
      "source": "PredictionEngine"
    },
    {
      "fromState": "ELIGIBLE",
      "toState": "PENDING_LINEUP",
      "timestamp": "2026-11-19T17:52:54.866Z",
      "reason": "Aprobado cuantitativamente, supeditado a planilla oficial T-60",
      "source": "RiskManager_Elena"
    }
  ]
}
```

### 3.2 La Causa Real: Investigación Incompleta y Falta de Promoción
En `engine/storage_data/research_candidates.json`:
```json
{
  "id": "cand_1795110774831_6rsb2k",
  "status": "INVESTIGACION_INCOMPLETA",
  "researchData": {
    "teamData": {
      "success": false,
      "reason": "NO_TEAM_MATCHES_RETURNED",
      "validMatches": 0,
      "qualityStatus": "INVESTIGACION_INCOMPLETA"
    },
    "opponentData": {
      "isAvailable": false,
      "reason": "MISSING_OPPONENT_ID"
    },
    "qualityStatus": "ERROR_DATOS"
  },
  "sampleSize": 0
}
```

### 3.3 El Proceso Prepartido T-60 en `lineupWatcher.js`
En el commit `23a57f0` (19-Nov 19:27 ART), el proceso `LineupWatcher.checkPendingLineups`:
1. Filtró únicamente candidatos individuales de jugador para verificar su presencia en el XI titular oficial.
2. Al ser `cand_1795110774831_6rsb2k` una selección de equipo (*Internacional (Equipo)*) y poseer estado `INVESTIGACION_INCOMPLETA`, **nunca fue procesada ni promovida a APROBADO**.
3. **No fue transferida a `engine/storage_data/approved_picks.json`** (`inApp: false`).
4. **No fue publicada en el Daily Board operativo** (`daily_board_status: "NO_INCLUIDO"`).

### 3.4 Conclusión sobre la Reconstrucción:
* **¿Hubo veto formal de Elena?** **NO.** (`elenaVetoApplied: false`).
* **¿El motivo fue EV insuficiente?** **NO.** El EV evaluado fue $+40.0\%$.
* **¿Por qué quedó fuera del portfolio?** Porque **nunca fue aprobada**. Quedó en estado condicional `PENDIENTE` con investigación incompleta y sin confirmación final.

---

## 4. VERIFICACIÓN DE LA AFIRMACIÓN METODOLÓGICA DE FASE 12.3

El informe de la Fase 12.3 afirmó textualmente:
> *"Filtro Cuantitativo Mandatorio Incumplido: El Modelo C proyectó una probabilidad de apenas 0.47 frente a una cuota de 2.00, resultando en un valor esperado negativo (-6.0%), incumpliendo el umbral mandatorio de EV >= +7.0%."*

### Análisis Crítico:
1. **Inconsistencia Demostrada:** Esa afirmación describe un mecanismo inexistente en el motor de ejecución del 19/11/2026.
2. **Origen de la Confusión:** El campo `evModelC: -0.06` existe en el registro, pero fue introducido en la Fase 10.1 dentro del `ObservationTracker` como una métrica contrafactual analítica para evaluar a posteriori el desempeño del Modelo C aislado frente a selecciones divergentes.
3. El redactor de la Fase 12.3 tomó erróneamente esa métrica contrafactual de Fase 10.1 y la convirtió en la supuesta justificación causal del rechazo de Elena, cuando en la realidad operativa Elena nunca evaluó el pick bajo esa premisa.

---

## 5. DICTAMEN TÉCNICO FORMAL

Se clasifica el resultado de esta auditoría en la categoría:

### **ERROR DE DOCUMENTACIÓN**

#### Justificación del Dictamen:
1. **La decisión operativa fue correcta:** El pick `cand_1795110774831_6rsb2k` **efectivamente no pertenecía al Portfolio de Elena**, no fue aprobado, no estuvo en `approved_picks.json` y no fue publicado para apuestas.
2. **El error reside estrictamente en el informe explicativo:** La Fase 12.3 atribuyó un motivo inventado/incorrecto (*"Veto por EV de -6.0% en Modelo C"*), en lugar de declarar el motivo real documentado en el sistema (*"Pick no promovido a APROBADO: permaneció en estado PENDIENTE por datos incompletos de equipo y nunca ingresó al portfolio de apuestas"*).
3. **No hubo Error de Implementación:** El Risk Manager y el Orchestrator ejecutaron fielmente las reglas programadas en su momento.

---

## 6. CORRECCIÓN DOCUMENTAL PROPUESTA PARA LA FASE 12.3

### 6.1 Corrección del Motivo de Exclusión
Se sustituye la justificación anterior por la siguiente formulación exacta:

> **Texto Corregido:**  
> *«El candidato `cand_1795110774831_6rsb2k` queda excluido del Universo B (Portfolio Elena) debido a que **nunca recibió veredicto formal de APROBADO**. El candidato quedó registrado en estado condicional `PENDIENTE` (`stage: ELIGIBLE`, `elenaVetoApplied: false`) debido a una investigación incompleta de datos de equipo (`NO_TEAM_MATCHES_RETURNED`) y nunca fue promovido a `approved_picks.json` ni publicado en el Daily Board operativo. Permanece en el Universo A (Global de Predicciones) por poseer probabilidad prepartido congelada y sello criptográfico SHA-256 en el ledger.»*

### 6.2 Revisión de las Conclusiones sobre la Eficacia del Filtro
El informe de la Fase 12.3 concluía:
> *"Eficacia Confirmada del Tribunal de Riesgo: La exclusión de cand_1795110774831_6rsb2k demuestra que los filtros de Elena aportan valor tangible al portfolio (+5.8% de Yield y +3.2% de Win Rate)."*

#### Rectificación Metodológica Mandatoria:
> **Texto Corregido:**  
> *«La diferencia observada entre el Universo Global y el Portfolio Elena (+5.8 puntos de Yield y +3.2 puntos de Win Rate) es el **efecto aritmético directo de excluir una única observación perdedora ($N=1$)** de la muestra histórica.  
> 
> Bajo el rigor del método estadístico, un tamaño muestral de un solo pick ($N=1$) está totalmente dominado por la varianza y **no constituye evidencia estadística de la eficacia ni de la superioridad de los filtros de selección**. Dichos valores deben considerarse estrictamente descriptivos del subconjunto observado y no una validación empírica confirmada.»*

---

## 7. TABLA DE EVIDENCIA CRUZADA Y LOCALIZACIÓN DE FUENTES

| Elemento | Archivo / Ubicación | Propiedad / Función | Valor Verificado |
|---|---|---|---|
| **Decisión de Elena** | `engine/storage_data/model_observation_registry.json` | `elenaDecision` | `"PENDIENTE"` |
| **Veto de Elena** | `engine/storage_data/model_observation_registry.json` | `elenaVetoApplied` | `false` |
| **Razones de Veto** | `engine/storage_data/model_observation_registry.json` | `elenaVetoReasons` | `[]` (vacío) |
| **Etapa de Rechazo** | `engine/storage_data/model_observation_registry.json` | `rejectionStage` | `null` |
| **EV Modelo B** | `engine/storage_data/model_observation_registry.json` | `evModelB` | `0.40` (+40.0%) |
| **EV Modelo C** | `engine/storage_data/model_observation_registry.json` | `evModelC` | `-0.06` (-6.0%) |
| **EV Ensamble** | `engine/storage_data/model_observation_registry.json` | `evEnsemble` | `0.40` (+40.0%) |
| **Regla de EV en Risk Manager** | `engine/agents/riskManager.js` (L30) | `evaluate()` | `const ev = prediction?.ev \|\| 0;` |
| **Estado de Investigación** | `engine/storage_data/research_candidates.json` | `status` | `"INVESTIGACION_INCOMPLETA"` |
| **Falla de Datos de Equipo** | `engine/storage_data/research_candidates.json` | `researchData.teamData.reason` | `"NO_TEAM_MATCHES_RETURNED"` |
| **Pertenencia a Aprobados** | `engine/storage_data/approved_picks.json` | Búsqueda por ID | **NO EXISTE (`inApp: false`)** |
| **Daily Board Operativo** | `engine/storage_data/reconciliation_119_candidates.json` | `inPicksHoy` | `false` (`NO_INCLUIDO`) |
