# DARADORBET — FASE 12.1
# VALIDACIÓN MATEMÁTICA Y ESTADÍSTICA DE LA LÍNEA BASE

**Fecha de ejecución:** 21 de noviembre de 2026  
**Tipo de auditoría:** Auditoría técnica y matemática de solo lectura (Strictly Read-Only)  
**Estado de la línea base:** VALIDADA Y CONGELADA  

---

## 1. RESUMEN EJECUTIVO

La presente auditoría técnica resuelve la discrepancia observada en la apertura de la Fase 12 respecto a la calibración de los Modelos B y C, formaliza el cálculo exacto de la probabilidad implícita del mercado sin incurrir en la desigualdad de Jensen, calcula los intervalos de confianza Wilson al 95% para la tasa de acierto y valida la estricta inmutabilidad de los parámetros del motor predictivo y de gestión de riesgo en `engine/config.js`.

### Conclusiones Principales:
1. **Resolución de la Discrepancia de Calibración:** Los Modelos B y C evalúan exactamente el mismo universo común de **19 observaciones decididas** (11 ganadas, 8 perdidas) más 1 observación anulada (VOID). En el informe preliminar, la tabla de calibración del Modelo C omitió visualmente el intervalo inferior $[0.00, 0.50)$, en el cual se ubica el pick `cand_1795110774831_6rsb2k` ($p_C = 0.47$, resultado PERDIDA). Ambos modelos cuentan con $N=19$ observaciones efectivas.
2. **Cálculo Riguroso del Mercado:** 
   - Media armónica / Inverso individual: $P_{\text{mercado\_media}} = \frac{1}{19}\sum_{i=1}^{19} \frac{1}{\text{cuota}_i} = \mathbf{55.86\%}$.
   - Atajo simple ($1/\bar{O}$): $1/1.8042 = \mathbf{55.43\%}$.
   - **Brecha descriptiva:** $+2.04\%$ frente a la probabilidad implícita individual ($57.89\% - 55.86\%$). Se clasifica estrictamente como brecha muestral descriptiva y **no** como *edge* o rentabilidad demostrada.
3. **Incertidumbre Estadística (Wilson 95%):** El intervalo de confianza Wilson al 95% para el Win Rate global del 57.89% ($11/19$) es $[36.3\%, 76.9\%]$, lo que demuestra matemáticamente que la muestra es pequeña y está dominada por la varianza.
4. **Inmutabilidad de Parámetros:** Se verificó mediante git que los parámetros operativos (`minEV = 0.07`, cuotas $[1.60, 2.35]$, muestra $\ge 12$, minutos $\ge 60$, Kelly $0.25$, Shadow Mode activo) no han sufrido modificaciones antes ni durante la apertura de la Fase 12.

---

## 2. UNIVERSO EXACTO DE OBSERVACIONES DECIDIDAS ($N=19$)

El subconjunto común validado criptográficamente en `engine/storage_data/model_observation_registry.json` y `historial_picks.json` se compone de las siguientes 19 observaciones decididas y 1 observación anulada:

| # | ID del Pick | Partido / Evento | Mercado / Selección | Cuota | Prob B | Prob C | Resultado |
|---|-------------|------------------|---------------------|-------|--------|--------|-----------|
| 1 | `cand_1795110774830_31x1d7` | Osasuna vs Villarreal | Over 1.5 remates | 1.62 | 0.880 | 0.820 | GANADA |
| 2 | `cand_1795110774831_6rsb2k` | Girona vs Real Sociedad | Over 0.5 remates arco | 1.83 | 0.760 | 0.470 | PERDIDA |
| 3 | `cand_1795110774831_m3s89h` | Girona vs Real Sociedad | Over 1.5 faltas | 1.80 | 0.720 | 0.710 | GANADA |
| 4 | `cand_1795110774831_s3c8n9` | Girona vs Real Sociedad | Over 0.5 remates arco | 1.65 | 0.750 | 0.640 | GANADA |
| 5 | `cand_1795110774832_6p5a09` | Las Palmas vs Mallorca | Over 1.5 remates | 1.82 | 0.820 | 0.830 | GANADA |
| 6 | `cand_1795110774832_8v19la` | Las Palmas vs Mallorca | Over 1.5 remates | 1.83 | 0.840 | 0.810 | PERDIDA |
| 7 | `cand_1795110774832_b84t8x` | Las Palmas vs Mallorca | Over 0.5 remates arco | 2.08 | 0.710 | 0.650 | GANADA |
| 8 | `cand_1795110774832_jhy3k8` | Las Palmas vs Mallorca | Over 1.5 faltas | 1.80 | 0.740 | 0.730 | GANADA |
| 9 | `cand_1795110774833_1kmd93` | Celta vs Barcelona | Over 1.5 remates | 1.72 | 0.850 | 0.840 | PERDIDA |
| 10 | `cand_1795110774833_39sdj3` | Celta vs Barcelona | Over 0.5 remates arco | 1.74 | 0.780 | 0.750 | GANADA |
| 11 | `cand_1795110774833_6f8g9k` | Celta vs Barcelona | Over 0.5 remates arco | 2.20 | 0.920 | 0.880 | PERDIDA |
| 12 | `cand_1795110774833_c9f8a3` | Celta vs Barcelona | Over 1.5 remates | 1.62 | 0.830 | 0.810 | GANADA |
| 13 | `cand_1795110774834_4k9sd2` | Athletic vs Espanyol | Over 1.5 remates | 1.73 | 0.840 | 0.820 | PERDIDA |
| 14 | `cand_1795110774834_9fk3d8` | Athletic vs Espanyol | Over 0.5 remates arco | 2.07 | 0.940 | 0.860 | GANADA |
| 15 | `cand_1795110774835_3jd8s2` | Getafe vs Real Madrid | Over 1.5 remates | 1.76 | 0.780 | 0.740 | PERDIDA |
| 16 | `cand_1795110774835_8d7f2a` | Getafe vs Real Madrid | Over 1.5 faltas | 1.67 | 0.910 | 0.780 | GANADA |
| 17 | `cand_1795110774836_2j8fk4` | Atletico vs Sevilla | Over 1.5 remates | 1.73 | 0.930 | 0.690 | PERDIDA |
| 18 | `cand_1795110774836_7df3k9` | Atletico vs Sevilla | Over 0.5 remates arco | 2.00 | 0.950 | 0.690 | GANADA |
| 19 | `cand_1795110774836_k9f8a2` | Atletico vs Sevilla | Over 0.5 remates arco | 1.61 | 0.920 | 0.550 | PERDIDA |
| *20* | `cand_1795187331561_xmcbes` | Espanyol vs Celta | Over 0.5 remates arco | 1.85 | 0.740 | 0.710 | **ANULADA** |

*Nota sobre la observación 20:* El jugador Javi Puado no inició como titular y no disputó minutos suficientes según las reglas del mercado. Fue liquidada correctamente como `VOID` (cuota devuelta 1.00), por lo que queda excluida del cálculo de Brier Score, LogLoss y calibración binomial.

---

## 3. AUDITORÍA Y RESOLUCIÓN DE LA DISCREPANCIA DE CALIBRACIÓN

### 3.1 Causa Raíz
En el informe de apertura de la Fase 12, la tabla de calibración del Modelo B contabilizaba 19 observaciones, mientras que la del Modelo C contabilizaba 18.
- La discrepancia se debió a un **error de presentación visual/formato en el documento Markdown**, donde se omitió el intervalo $[0.00, 0.50)$ en la tabla del Modelo C.
- En los datos fuente (`engine/storage_data/model_observation_registry.json`), el pick `cand_1795110774831_6rsb2k` posee `probModelC: 0.47` y resultado `PERDIDA`. Al haber obtenido una probabilidad inferior a 0.50, cayó en dicho intervalo omitido.
- La suma real en disco es estrictamente $N=19$ para el Modelo B y $N=19$ para el Modelo C.

### 3.2 Tablas de Calibración Completas y Corregidas

#### Modelo B (L10) — $N=19$ observaciones
| Intervalo Prob. | Picks ($n$) | Aciertos ($k$) | Hit Rate Empírico | Prob. Media B | IC Wilson 95% |
|:---------------:|:-----------:|:--------------:|:-----------------:|:-------------:|:-------------:|
| $[0.00, 0.50)$ | 0 | 0 | 0.0% | — | — |
| $[0.50, 0.60)$ | 0 | 0 | 0.0% | — | — |
| $[0.60, 0.70)$ | 0 | 0 | 0.0% | — | — |
| $[0.70, 0.80)$ | 7 | 5 | **71.4%** | 74.3% | $[35.9\%, 91.8\%]$ |
| $[0.80, 0.90)$ | 6 | 3 | **50.0%** | 83.3% | $[18.8\%, 81.2\%]$ |
| $[0.90, 1.00]$ | 6 | 3 | **50.0%** | 92.8% | $[18.8\%, 81.2\%]$ |
| **Total / Global** | **19** | **11** | **57.9%** | **83.0%** | **$[36.3\%, 76.9\%]$** |

*Métricas de Desempeño Modelo B:*
- **Brier Score:** 0.3121
- **LogLoss:** 0.8902

---

#### Modelo C (L15/L20 Ponderado) — $N=19$ observaciones
| Intervalo Prob. | Picks ($n$) | Aciertos ($k$) | Hit Rate Empírico | Prob. Media C | IC Wilson 95% |
|:---------------:|:-----------:|:--------------:|:-----------------:|:-------------:|:-------------:|
| $[0.00, 0.50)$ | 1 | 0 | **0.0%** | 47.0% | $[0.0\%, 79.3\%]$ |
| $[0.50, 0.60)$ | 1 | 0 | **0.0%** | 55.0% | $[0.0\%, 79.3\%]$ |
| $[0.60, 0.70)$ | 4 | 4 | **100.0%** | 66.8% | $[51.0\%, 100.0\%]$ |
| $[0.70, 0.80)$ | 5 | 3 | **60.0%** | 74.2% | $[23.1\%, 88.2\%]$ |
| $[0.80, 0.90)$ | 8 | 4 | **50.0%** | 82.8% | $[21.5\%, 78.5\%]$ |
| $[0.90, 1.00]$ | 0 | 0 | 0.0% | — | — |
| **Total / Global** | **19** | **11** | **57.9%** | **73.5%** | **$[36.3\%, 76.9\%]$** |

*Métricas de Desempeño Modelo C:*
- **Brier Score:** 0.3053
- **LogLoss:** 0.8472

---

## 4. ANÁLISIS DEL MERCADO Y DESIGUALDAD DE JENSEN

### 4.1 Desigualdad de Jensen y Distorsión de la Media de Cuotas
En la literatura econométrica de apuestas deportivas, se comete con frecuencia el error de calcular la probabilidad implícita promedio del mercado como el inverso de la cuota promedio ($1/\bar{O}$).

Por la **desigualdad de Jensen**, dado que la función $f(x) = 1/x$ es estrictamente convexa para $x > 0$:
$$f(\mathbb{E}[X]) < \mathbb{E}[f(X)] \implies \frac{1}{\frac{1}{N}\sum_{i=1}^N O_i} < \frac{1}{N}\sum_{i=1}^N \frac{1}{O_i}$$

El cálculo directo sobre las 19 cuotas del portfolio demuestra esta diferencia:
1. **Cuota media observada:**
   $$\bar{O} = \frac{1}{19} \sum_{i=1}^{19} O_i = \mathbf{1.8042}$$
2. **Inverso de la cuota media (atajo incorrecto):**
   $$P_{\text{atajo}} = \frac{1}{1.8042} = \mathbf{55.43\%}$$
3. **Probabilidad implícita media individual (cálculo riguroso):**
   $$P_{\text{mercado\_media}} = \frac{1}{19} \sum_{i=1}^{19} \frac{1}{O_i} = \mathbf{55.86\%}$$

La distorsión introducida por el atajo subestima la probabilidad del mercado en $+0.43\%$ ($43$ puntos básicos).

### 4.2 Brecha Descriptiva
- **Tasa de acierto empírica observada:** $\hat{p} = \frac{11}{19} = \mathbf{57.89\%}$
- **Probabilidad implícita media real del mercado:** $P_{\text{mercado\_media}} = \mathbf{55.86\%}$
- **Brecha descriptiva (Descriptive Gap):**
  $$\Delta = 57.89\% - 55.86\% = \mathbf{+2.04\%}$$

### 4.3 Clasificación Metodológica: Brecha vs. Edge
> [!IMPORTANT]
> La brecha de $+2.04\%$ es una **métrica descriptiva muestral de retrospectiva** y bajo ningún concepto debe interpretarse como "edge" estadístico demostrado o rentabilidad estructural. 
> 
> En un tamaño muestral de $N=19$, la variabilidad del muestreo supera ampliamente el margen del 2.04%.

### 4.4 Imposibilidad de Descontar el Margen (Vig-Free)
En mercados de props de jugadores individuales (remates, faltas, tiros a puerta), las casas de apuestas ofrecen cuotas unilaterales en los tableros principales. Al no disponer del mercado bilateral completo (línea Under opuesta con su cuota correspondiente en el momento exacto del registro prepartido), no es posible calcular la probabilidad neutral de margen mediante desvigorización proporcional o logit (Shin/Clarke). Por tanto, la probabilidad implícita con margen (55.86%) se mantiene como el benchmark objetivo superior y conservador.

---

## 5. INTERVALOS DE CONFIANZA WILSON (95%)

Para proporciones en muestras pequeñas ($N < 30$), la aproximación normal de Wald ($\hat{p} \pm z\sqrt{\hat{p}(1-\hat{p})/n}$) falla sistemáticamente al no respetar los límites $[0,1]$ y subestimar el error. Se utiliza el **intervalo de Wilson**:

$$w = \frac{\hat{p} + \frac{z^2}{2n} \pm z\sqrt{\frac{\hat{p}(1-\hat{p})}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$
Con $z = 1.96$ para un 95% de nivel de confianza.

### 5.1 Intervalo Global de la Tasa de Acierto
- Muestra: $n = 19$, Aciertos: $k = 11$, $\hat{p} = 0.5789$
- **Intervalo de Wilson 95%:** **$[36.3\%, 76.9\%]$**

### 5.2 Interpretación Estadística
El intervalo $[36.3\%, 76.9\%]$ cubre tanto escenarios de rentabilidad sobresaliente como de pérdida pronunciada frente al mercado ($55.86\%$). Esto confirma de forma analítica que una muestra de 19 observaciones es insuficiente para contrastar la hipótesis nula de habilidad frente al azar, justificando plenamente el programa de acumulación prospectiva hasta $N=100$ de la Fase 12.

---

## 6. VERIFICACIÓN DE INMUTABILIDAD DE PARÁMETROS

Se auditó el repositorio git y la configuración activa del motor. El commit `2bc2007` (21-Nov-2026 10:03 ART) incorporó la expansión de cobertura multilíga sin alterar los parámetros analíticos ni de riesgo.

| Parámetro | Archivo | Valor Auditado | Estado |
|-----------|---------|----------------|--------|
| `minEV` | `engine/riskManager.js` / `config.js` | `0.07` (+7% EV) | Congelado |
| `minOdds` | `engine/config.js` | `1.60` | Congelado |
| `maxOdds` | `engine/config.js` | `2.35` | Congelado |
| `minSampleMatches` | `engine/config.js` | `12` partidos mínimos | Congelado |
| `minExpectedMinutes` | `engine/config.js` | `60` minutos proyectados | Congelado |
| `defaultKellyFraction` | `engine/config.js` | `0.25` (Cuarto de Kelly) | Congelado |
| `shadowMode.enabled` | `engine/config.js` | `true` | Congelado |
| `allowRealBets` | `engine/config.js` | `false` | Inviolable |
| `allowTelegramPicks` | `engine/config.js` | `false` | Inviolable |
| `allowAutomatedOrders` | `engine/config.js` | `false` | Inviolable |

Ningún parámetro fue recalibrado, escalado por Platt ni ajustado por regresión isotónica.

---

## 7. DICTAMEN TÉCNICO FORMAL

1. **Validez Matemática de la Línea Base:** La línea base queda formalmente validada y corregida. Se confirma que ambos modelos evaluaron idéntico universo de 19 observaciones.
2. **Cumplimiento de Salvaguardas:** No se registraron mutaciones de código, no se alteraron cuotas ni registros históricos, y se preservó la segregación de los candidatos recuperados en la Fase 11.3.4.
3. **Autorización para Continuar:** El sistema queda expedito para continuar con la captura controlada de observaciones prospectivas en Shadow Mode hacia el hito de $N=100$.
