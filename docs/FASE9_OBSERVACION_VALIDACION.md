# DARADORBET — FASE 9: OBSERVACIÓN Y VALIDACIÓN ESTADÍSTICA
## Documentación Técnica (Shadow Mode Exclusivo)

> **Principio Rector:** La Fase 9 no busca justificar modelos existentes; su función es probar con rigor empírico si los modelos experimentales aportan ventaja estadística real y calibración superior al mercado. **`autoExecutionAllowed: false`** en todo el flujo.

---

### 1. Arquitectura Implementada (`engine/experimental/markets/observation/`)

| Archivo | Rol |
| :--- | :--- |
| `observationStore.js` | Registro append-only inmutable (`fase9_observations.json`) con `inputSnapshotHash` y `predictionHash` SHA-256, anti-leakage temporal estricto (`observedAtUtc < kickoffUtc` y timestamps de entrada `< kickoffUtc`), snapshots de cuotas (`FIRST_VALID`, `T_MINUS_60`, `T_MINUS_30`, `T_MINUS_5`, `CLOSING`), CLV solo con cuotas comparables (mismo bookmaker, mercado, selección y línea), filtro de contaminación `first-half prices mixed in` y log local de alertas de calidad (`fase9_quality_alerts.json`, sin Telegram). |
| `settlementProcessor.js` | Liquidación independiente e idempotente (`PENDING`, `WON`, `LOST`, `VOID`, `PUSH`, `UNAVAILABLE`, `SETTLEMENT_ERROR`), solo con resultados confirmados (`resultConfirmed === true` y `FINISHED`). Partidos suspendidos/postergados nunca se marcan `LOST`. Trazabilidad de correcciones posteriores en `settlement.corrections[]`. |
| `statisticalValidator.js` | Evaluación separada por familia de mercado (nunca mezcla familias), Brier Score y Log Loss binario y multiclase (1X2 + matriz de confusión 3×3), ROI/Yield con stake plano 1U, calibración en 5 bins + ECE, comparación contra 3 Baselines sobre las mismas observaciones (mercado sin vig, base rate estrictamente anterior y versión previa), intervalos de confianza 95% (Wilson + ROI), **Cluster Bootstrap por `matchId`** y validación temporal estricta fuera de muestra (`train < validation < evaluation`, o `OUT_OF_SAMPLE_NOT_AVAILABLE`). |
| `observationOrchestrator.js` | Orquesta ciclos de observación sobre ligas habilitadas, ejecuta auditorías automáticas de degradación de Brier/LogLoss y descalibración, y exporta `api/evidence_fase9.json`. |
| `evidence_dashboard.html` | Dashboard de Evidencia experimental 100% independiente (sin tocar `dashboard.html`, Daily Board ni `server.js`), con filtros interactivos y regla visual estricta: **nunca muestra indicadores verdes de rentabilidad cuando `sampleStatus === 'INSUFFICIENT_SAMPLE'`**. |

---

### 2. Fórmulas Estadísticas Principales

- **Brier Score Binario:** $\text{BS} = \frac{1}{N}\sum_{i=1}^{N}(p_i - y_i)^2$
- **Brier Score Multiclase (1X2):** $\text{BS}_{3} = \frac{1}{N}\sum_{i=1}^{N}\sum_{c \in \{1,X,2\}}(p_{i,c} - y_{i,c})^2$
- **Log Loss Binario:** $\text{LL} = -\frac{1}{N}\sum_{i=1}^{N}\left[y_i\ln p_i + (1-y_i)\ln(1-p_i)\right]$
- **Log Loss Multiclase (1X2):** $\text{LL}_{3} = -\frac{1}{N}\sum_{i=1}^{N}\ln p_{i, y_i}$
- **CLV (%):** $\text{CLV} = \left(\frac{\text{odds}_{\text{obs}}}{\text{odds}_{\text{closing}}} - 1\right)\times 100$ (solo cuando coinciden bookmaker, mercado, selección y línea)
- **ROI / Yield (stake plano 1U):** $\text{ROI} = \frac{\sum \text{profit}_i}{N_{\text{decided}}}\times 100$
- **Umbrales de volumen:** `INSUFFICIENT_SAMPLE` ($N < 30$), `PRELIMINARY_SAMPLE` ($30 \le N \le 99$), `DEVELOPING_EVIDENCE` ($100 \le N \le 299$), `STRONGER_EVIDENCE` ($N \ge 300$).

---

### 3. Garantías de Endurecimiento (Fase 9.1) y Limitaciones Residuales

- **Persistencia y Lock Inter-Proceso:** `O_CREAT | O_EXCL` con reintentos acotados, verificación de PID vivo antes de liberar locks obsoletos, escritura atómica (`tmp → fsync → rename`) y cuarentena de JSON corrupto en `.corrupt.bak` único sin sobrescribir ni vaciar el ledger. *Limitación de filesystem:* las garantías atómicas de `O_EXCL` y `rename` aplican a filesystems locales NTFS/POSIX (no a montajes NFSv2 ni sincronizaciones de nube con conflictos concurrentes).
- **Integridad Global Encadenada:** `sequenceIndex` + `prevPredictionHash` (génesis `'0'.repeat(64)`) + `predictionHash` sobre JSON canónico, con validación automática al leer y logs append-only separados y encadenados para snapshots (`*_snapshots.json`) y liquidaciones/correcciones (`*_settlements.json`).
- **Anti-Leakage en Snapshots:** todo snapshot (incluyendo `CLOSING`) exige `capturedAtUtc < kickoffUtc`.
- **Muestra Efectiva e IC Clusterizados:** `sampleStatus` se calcula sobre partidos independientes (`uniqueMatchCount`), y los IC 95% de Hit Rate y ROI utilizan **Cluster Bootstrap por `matchId`** (`INSUFFICIENT_CLUSTERS` si $k < 2$).
- **OOS Estricto y AH de Cuartos:** partición por bloques indivisibles de `kickoffUtc` (`maxTrainKo < minValKo < minEvalKo`), liquidación exacta de `HALF_WON` / `HALF_LOST` en cuartos (`±0.25`, `±0.75`) y baseline multiclase 3-way real con `noVig1X2`.

**Limitaciones y riesgos residuales:**
1. **Volumen inicial $N=0$ en producción Shadow:** superar los tests verifica la ingeniería del sistema, **no** demuestra rentabilidad deportiva ni ventaja estadística hasta acumular muestras reales ($N \ge 100$–$300$ partidos independientes).
2. **Cuotas de cierre (`CLOSING`) en Doble Oportunidad:** StatsHub `movement: true` no incluye `doubleChance` directamente; depende de capturas pre-kickoff T−5 / T−1.
3. **Cobertura de `getTeamNews`:** consistente principalmente en Top-Flight y competiciones europeas (`coverage === 'ok'`).
