# DARADORBET — INFORME DE CIERRE DE FASE 11.3
## RECUPERACIÓN HISTÓRICA, BLINDAJE DE PROCEDENCIA Y RETORNO A SHADOW MODE

**Fecha de ejecución:** 21 de Noviembre de 2026, 22:18 ART (2026-11-22T01:18:00Z)  
**Versión de sistema:** DaradorBET Core v1.1.0  
**Estado operativo:** Shadow Mode Activo (0 apuestas reales, 0 alertas Telegram, 0 órdenes automáticas)

---

### 1. ANTECEDENTES Y DIAGNÓSTICO DEL FALSO POSITIVO DE PROVENANCEGUARD
Durante la auditoría inicial de la Fase 11.1 y 11.2, se implementó `ProvenanceGuard` para proteger el sistema contra la contaminación de datos sintéticos. El guardián aplicó una regla binaria estricta:
```javascript
if (!candidate.provenance || !candidate.provenance.officialMatchId) {
    quarantine(candidate, "FAILED_PROVENANCE_CHECK: Candidato clasificado como MOCK.");
}
```
Esto provocó un falso positivo masivo: varios candidatos investigados durante la noche del 20/11 y madrugada del 21/11 fueron clasificados erróneamente como MOCK debido a que fueron estructurados antes de que se formalizara el esquema de metadatos `provenance.officialMatchId` en el adaptador MCP de StatsHub. Se confundió una omisión de metadatos de etiquetado con una falsedad ontológica de los datos.

---

### 2. CLASIFICACIÓN CORREGIDA DE LOS 30 CANDIDATOS EN CUARENTENA
La investigación forense independiente demostró que los 30 candidatos confinados pertenecían a cuatro categorías cualitativamente distintas:

1. **`REAL_ANALYZED_APPROVED` (2 candidatos):**
   - `cand_20261121_fulham_sot`: Manchester City vs Fulham. Fulham Over 2.5 remates al arco @ 1.64. Aprobado históricamente por Elena. Resultado oficial: 4 remates al arco. Liquidación histórica: WON.
   - `cand_20261121_leeds_corners`: Chelsea vs Leeds United. Leeds Over 3.5 córners @ 1.73. Aprobado históricamente por Elena. Resultado oficial: 2 córners. Liquidación histórica: LOST.
2. **`REAL_ANALYZED_PENDING` (6 candidatos):**
   - `cand_20261121_ruibal_fouls`, `cand_20261121_abde_sot`, `cand_20261121_neto_sot`, `cand_20261121_nuamah_shots`, `cand_20261121_castaneda_shots`, `cand_20261121_romano_shots`.
   - Poseían 5 informes completos de agentes (`playerAnalyst`, `teamAnalyst`, `matchContext`, `oddsAnalyst`, `matchIntel`) y dictamen histórico de Elena `PENDIENTE` (supeditado a planilla oficial T-60 min).
3. **`REAL_INVALID_PLAYER_TEAM` (3 candidatos - Permanecen en Cuarentena):**
   - `cand_20261121_banzuzi_tackles` (E. Banzuzi pertenece a OH Leuven, no a Leipzig).
   - `cand_20261121_archer_sot` (C. Archer pertenece a Southampton, no a Auxerre).
   - `cand_20261121_hojlund_sot` (R. Hojlund pertenece a Man United, no a Napoli).
4. **`SYNTHETIC_UI_TEMPLATE` (19 candidatos - Permanecen en Cuarentena):**
   - `cand_fase11_champ_metcalfe_01` al `cand_fase11_seriea_lautaro_19`. Plantillas visuales inyectadas para el selector multiligas sin informes de agentes ni deliberación deliberativa.

---

### 3. RECUPERACIÓN CONTROLADA Y SEPARACIÓN HISTORIA VS. OPERACIÓN
En la Fase 11.3.4 se ejecutó la recuperación estricta de los 8 candidatos reales sin contaminar los procesos operativos:

* **Aprobados Históricos (`historical_approved_picks.json`):**
  Fulham y Leeds fueron incorporados exclusivamente a este repositorio con sus liquidaciones oficiales (WON y LOST), sus cuotas congeladas (1.64 y 1.73) y sus dictámenes originales de Elena.
* **Investigaciones Pendientes (`historical_research_archive.json`):**
  Los 6 candidatos pendientes fueron incorporados a este archivo como `HISTORICAL_PENDING` y liquidación `PENDING_VERIFICATION`, preservando sus dictámenes sin computar en el portfolio de picks aprobados.
* **Cuarentena Confinada (`quarantine_candidates.json`):**
  Se redujo de 30 a exactamente 22 candidatos confinados (`quarantinedCount: 22`), registrando los 8 recuperados en `recoveredCandidates`.
* **Catálogo de Research (`research_candidates.json`):**
  Se incorporaron los 8 candidatos (+8 registros, total 127).
* **Ledger Criptográfico (`audit_integrity_ledger.json`):**
  Se preservaron los 57 sellos prepartido originales intactos y se generaron 8 sellos de integridad de recuperación con `is_historical_recovery: true` (total 65 sellos).

---

### 4. ACLARACIÓN DE HASHES (FASE 11.3.5.1)
Se auditó y aclaró el error de nomenclatura del informe previo:
* **Copias de Seguridad (Backups):** Los 8 archivos en `backups/backup_fase11_3_4_pre_recovery_20261121/` coinciden al 100% con los hashes registrados antes de la recuperación.
* **Archivos Modificados en Producción (4 archivos):** `quarantine_candidates.json`, `research_candidates.json`, `audit_integrity_ledger.json` y `provenanceGuard.js` variaron sus hashes debido a las modificaciones legítimas de la recuperación.
* **Archivos Intactos en Producción (4 archivos):** `approved_picks.json`, `model_observation_registry.json`, `historial_picks.json` y `picks_hoy.json` conservan exactamente sus hashes pre-recuperación, garantizando aislamiento total.

---

### 5. LIMITACIONES METODOLÓGICAS DE LAS VERIFICACIONES REALIZADAS
1. **Verificación Retrospectiva:** La validación de actas oficiales para Fulham y Leeds se realizó post-partido contra las estadísticas consolidadas en StatsHub MCP. Aunque las cuotas y análisis fueron capturados pre-match, sus sellos en el ledger reflejan recuperación forense (`is_historical_recovery: true`) y no firmas prepartido automáticas.
2. **Candidatos Pendientes:** Los 6 candidatos pendientes no fueron convertidos en aprobados porque el protocolo de Elena requiere confirmación de titularidad en tiempo real (T-60 min). Su recuperación preserva la investigación sin forzar una aprobación retroactiva.
3. **Independencia Muestral:** Los resultados de Fulham y Leeds no se incorporaron a las 19 observaciones auditadas para evitar alterar retrospectivamente la muestra común del benchmark de Brier y LogLoss.

---

### 6. ESTADO FINAL DE MÉTRICAS Y CONTINUIDAD DE SHADOW MODE
* **Universo Común Decidido:** 19 observaciones oficiales (11 Ganadas / 8 Perdidas).
* **Win Rate Oficial:** 57.9%.
* **PnL Oficial:** +0.67 U.
* **Yield (ROI %):** +3.5%.
* **Brier Score Modelo B:** 0.3121 | **LogLoss Modelo B:** 0.8902.
* **Brier Score Modelo C:** 0.3053 | **LogLoss Modelo C:** 0.8472.
* **Sellos Prepartido Intactos:** 57 de 57 (0 violaciones, 0 alteraciones).
* **Parámetros de Riesgo y Modelos:** Intactos y congelados (Min EV +7%, Modelo B L10, Modelo C L15/L20, Ensemble).
* **Políticas de Shadow Mode:** Activas (0 apuestas reales, 0 Telegram).
