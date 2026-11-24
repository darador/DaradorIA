# DARADORBET — EXPANSIÓN DEL UNIVERSO DE MERCADOS (1X2 & DOBLE OPORTUNIDAD)
## Documentación Técnica (Fases 1 a 8 — Experimental / Shadow Mode)

> **Modo actual:** 100% Experimental / Shadow Mode (`autoExecutionAllowed: false`). Cero modificaciones en Daily Board, Prediction Engine V1 productivo, agentes globales, Risk Manager productivo, RETO ESCALERA ni en los 101 hashes históricos SHA-256.

---

### 1. Arquitectura Implementada (`engine/experimental/markets/`)

| Módulo | Fase | Responsabilidad |
| :--- | :---: | :--- |
| `matchOutcomeModel.js` | Fase 2 | Modelo bivariado Poisson + corrección **Dixon-Coles** ($\rho$) con xG, fuerza ofensiva/defensiva con decaimiento temporal, localía, descanso y ausencias (`getTeamNews`). Deriva de forma exacta y coherente `1X2` ($\sum = 1$), `Doble Oportunidad` (`1X`, `X2`, `12`), `BTTS`, `Total Goles` y `Hándicap Asiático`, más devig 3-way y filtro de `first-half prices mixed in` en `movement: true`. |
| `marketCoverageAudit.js` | Fase 3 | Clasifica la cobertura real de StatsHub en `COMPLETO`, `AGREGADO_SIN_SERIE`, `DATOS_INSUFICIENTES` y `NO_DISPONIBLE`. Corrige lectura de `goalsFor`/`goalsAgainst` sin inventar series partido a partido para córners/remates/tarjetas/faltas. |
| `matchDiscoveryScreener.js` | Fase 4 | Screening en **2 etapas** sobre las ligas ya habilitadas en `competitions_config.json`: Etapa 1 (`getFixturesByDate(withOdds: true)`, 1 llamada/liga) → Etapa 2 acotada a `maxDeepMatches` (`getMatchOdds` + `getTeamPerformance` + `getTeamNews` Tier 1), respetando `cache.js` y `rateGovernor.js`. |
| `shadowLabMarkets.js` | Fase 5 | Shadow Lab aislado (`shadow_lab_markets.json`) con sello **SHA-256**, guarda anti-leakage (`observedAtUtc < kickoffUtc`), deduplicación, liquidación idempotente, CLV y evaluación separada por `marketFamily`: **Log Loss y Brier Score multiclase** para 1X2, **Log Loss y Brier binario** para Doble Oportunidad. |
| `marketElenaRiskGuard.js` | Fase 6 | Paquete específico de mercado para Elena + validación vinculante de Risk Manager reutilizando `computeEventWindow` y `windowsOverlap` de `engine/ladder/ladderRiskGuard.js`. La aprobación de Elena nunca puede omitir un veto del Risk Manager. |
| `opportunityRanker.js` | Fase 7 | Ranking común multi-familia con filtros duros obligatorios previos y compuerta multiplicativa de evidencia que impide que mercados con datos pobres superen a oportunidades con evidencia sólida. |
| `evidenceCenter.js` | Fase 8 | Agregador multi-dimensional (`league`, `sport`, `marketFamily`, `market`, `selection`, `modelName`, `modelVersion`, `period`, `dataQualityTier`) con indicador obligatorio `INSUFFICIENT_SAMPLE` ($N < 30$) y `PRELIMINARY_SAMPLE` ($N < 100$). |

---

### 2. Pruebas y Verificación

- Suite dedicada: `node engine/tests/test_markets_expansion_1x2_dc.js` (**10/10 PASS**).
- No regresión: `test_ladder_sequential_rules.js` (12/12), `test_audit_daily_board_and_dates.js` (20/20), `test_fase2_1_2_2_experimental.js`, `test_fase2_3_shadow_lab.js` y `npm run build` (101/101 hashes SHA-256 intactos).
