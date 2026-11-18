# PROTOCOLO DE ANÁLISIS DEPORTIVO +EV (StatsHub MCP & bet365)

Este documento establece el protocolo operativo obligatorio y estandarizado que se ejecuta de manera automatizada cada vez que el usuario solicite:
* *"Analizá la fecha de hoy"*
* *"Buscá props para hoy"*
* *"Analizá la jornada"*
* O solicitudes equivalentes de análisis de apuestas deportivas.

---

## 🎯 Objetivo General
Identificar oportunidades de valor esperado positivo (**+EV**) en mercados de jugadores y equipos de **bet365**, respaldadas con evidencia estadística rigurosa proveniente del **MCP de StatsHub**, generando una salida estructurada en `picks_hoy.json` y presentándola en `dashboard.html`.

---

## 📋 Flujo de Trabajo en 4 Pasos

### PASO 0: Auditoría y Optimización Continua (Track Record & Backtesting)
Antes de generar nuevos pronósticos (o cuando el usuario indique *"Auditá los resultados de ayer"* o *"Cómo salieron las apuestas"*):
1. **Verificación de Resultados en StatsHub**:
   - Consultar los partidos terminados con `getMatchDetails(matchId)` o estadísticas de jugador `getPlayerStats(playerId)`.
   - Comparar el resultado real con la línea fijada (ej. Gabriel Barbosa registró 5 remates ➔ superó la línea de Más de 3.5 ➔ **ACERTADA ✅**).
2. **Actualización de `historial_picks.json`**:
   - Marcar el estado: `GANADA` (suma `cuota - 1` unidades), `PERDIDA` (resta `1` unidad) o `ANULADA` (`0` unidades).
   - Recalcular automáticamente:
     $$\text{Win Rate (\%)} = \left( \frac{\text{Apuestas Ganadas}}{\text{Apuestas Cerradas}} \right) \times 100$$
     $$\text{Yield / ROI (\%)} = \left( \frac{\text{Ganancia Neta en Unidades}}{\text{Total Unidades Apostadas}} \right) \times 100$$
3. **Retroalimentación de la Estrategia**:
   - Evaluar qué mercados rinden con mayor consistencia (ej. Remates al arco y Faltas recibidas vs Tarjetas).
   - Si un mercado desciende del $70\%$ de acierto histórico, ajustar las líneas mínimas o suspenderlo temporalmente para proteger el bankroll.

### PASO 1: Relevamiento de Partidos y Fixtures
1. **Determinar la fecha objetivo**:
   - Usar la fecha actual del sistema (y partidos de la madrugada/mañana siguiente si corresponde por huso horario).
2. **Consultar la cartelera en StatsHub**:
   - Ejecutar `getFixturesByDate(date)` para obtener todos los encuentros programados.
   - Priorizar las siguientes ligas principales:
     * 🇦🇷 Liga Profesional de Fútbol (Argentina)
     * 🇧🇷 Brasileirão Série A (Brasil)
     * 🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League (Inglaterra)
     * 🇪🇸 LaLiga (España)
     * 🇮🇹 Serie A (Italia)
     * 🇩🇪 Bundesliga (Alemania)
     * 🏆 UEFA Champions League / Copa Libertadores / Sudamericana
     * Ligas adicionales solicitadas explícitamente por el usuario.
3. **Mapear IDs y Contexto de Partidos**:
   - Identificar ID del partido (`fixture_id`), equipos involucrados, local/visitante y árbitro asignado.

---

### PASO 2: Filtrado Estadístico y Detección de Valor (+EV) en bet365
Consultar las herramientas analíticas del MCP (`getPropScreener`, `getPlayerStatsWithOdds`, `getPlayerTrends`, `getTeamPropScreener`, `getReferee`, `getOutliers`) cruzando los mercados de **bet365**.

#### Mercados Analizados
* 🎯 **Remates Totales** (ej. Más de 1.5, Más de 2.5)
* ⚽ **Remates al Arco** (ej. Más de 0.5, Más de 1.5)
* 🛑 **Faltas Cometidas / Sufridas** (ej. Más de 1.5 faltas)
* 🟨 **Tarjetas** (Jugador amonestado / Over de tarjetas del partido según árbitro)
* 🚩 **Córners** (Líneas de equipo y totales)
* 🥅 **Goles y Asistencias** (Goleador en cualquier momento o Asistencia)

#### Criterios Estrictos de Aprobación (+EV)
Una selección solo se considera válida si cumple con **TODOS** los siguientes requisitos:

1. **Racha y Regularidad (Tasa de Acierto / Hit Rate)**:
   - **Mínimo 75%** de acierto en los últimos 5 partidos ($L5 \ge 4/5$).
   - **Mínimo 70%** de acierto en los últimos 10 partidos ($L10 \ge 7/10$) o en la temporada completa.
   - Promedio por partido superior a la línea propuesta (ej. si la línea es $+1.5$ remates, promedio $\ge 2.2$).

2. **Filtro de Cuota y Valor Matemático (+EV)**:
   - **Cuota en bet365 $\ge 1.65$** (ideal entre $1.70$ y $2.20$ para picks individuales).
   - **Probabilidad Real ($P_{real}$)** estimada por racha/promedio debe ser **estrictamente mayor** a la **Probabilidad Implícita ($P_{imp}$)** de la cuota:
     $$P_{imp} = \frac{1}{\text{Cuota}}$$
     $$\text{Edge (\%)} = \left( P_{real} - P_{imp} \right) \times 100 \ge 5.0\%$$

3. **Validación Contextual**:
   - **Titularidad**: Confirmación de alineación o alta probabilidad de titularidad (sin riesgo alto de rotación).
   - **Factor Local / Visitante**: Confirmar que la racha no sea exclusivamente dependiente de jugar de local.
   - **Debilidad del Rival**: El equipo contrario debe conceder un volumen significativo en esa métrica (ej. el rival concede más de 14 tiros o 13 faltas por partido).
   - **Factor Árbitro (para tarjetas/faltas)**: Verificar con `getReferee` que el colegiado promedie $\ge 4.5$ tarjetas o $\ge 24$ faltas por partido antes de enviar un pick de tarjetas.

---

### PASO 3: Generación del Archivo de Salida (`picks_hoy.json`)
Consolidar los resultados en el archivo `picks_hoy.json` en la raíz del proyecto, estructurado de la siguiente manera:

```json
{
  "updated_at": "YYYY-MM-DDTHH:mm:ssZ",
  "date": "YYYY-MM-DD",
  "bookmaker": "bet365",
  "total_analyzed": 45,
  "top_picks": [
    {
      "id": "prop-1",
      "league": "Premier League",
      "match": "Arsenal vs Chelsea",
      "time": "16:30",
      "player": "Bukayo Saka",
      "team": "Arsenal",
      "opponent": "Chelsea",
      "market": "Remates al arco",
      "line": "Más de 0.5",
      "odds": 1.72,
      "hit_rate_l5": "5/5 (100%)",
      "hit_rate_l10": "8/10 (80%)",
      "avg_per_game": 1.4,
      "implied_prob": 58.1,
      "real_prob": 80.0,
      "edge_pct": 21.9,
      "confidence": "Alta",
      "rationale": "Saka cumplió la línea en sus últimos 5 partidos como local. Chelsea concede un promedio de 4.8 tiros al arco por fecha fuera de casa."
    }
  ],
  "parlays": [
    {
      "id": "parlay-safe",
      "name": "Combinada Conservadora",
      "type": "Conservadora",
      "target_odds": 2.25,
      "legs": [
        {
          "match": "Arsenal vs Chelsea",
          "selection": "Bukayo Saka - Más de 0.5 remates al arco",
          "odds": 1.72
        },
        {
          "match": "Real Madrid vs Real Sociedad",
          "selection": "Real Madrid - Más de 4.5 córners",
          "odds": 1.32
        }
      ],
      "rationale": "Picks con hit rate superior al 85% y contexto de alta presión ofensiva local."
    },
    {
      "id": "parlay-value",
      "name": "Combinada de Valor (+EV)",
      "type": "Valor",
      "target_odds": 4.85,
      "legs": [ ... ],
      "rationale": "Cruces de props de remates y faltas con edges superiores al 15%."
    }
  ]
}
```

* **Cantidad de Top Picks**: Entre 5 y 8 selecciones individuales de máxima solidez.
* **Combinadas Sugeridas**:
  * **1 Combinada Conservadora**: Cuota final entre **2.00 y 2.50**, compuesta por 2 selecciones de confianza máxima ($Hit\ Rate \ge 80\%$).
  * **1 Combinada de Valor**: Cuota final entre **4.00 y 6.00**, compuesta por 3 o 4 selecciones con edge marcado.

---

### PASO 4: Visualización, Git Push Automático y Reporte al Usuario
1. Escribir o actualizar el archivo `picks_hoy.json` y sincronizar los respaldos en `dashboard.html` e `index.html`.
2. **Push Automático a GitHub / Vercel**:
   - Ejecutar automáticamente:
     ```bash
     git add picks_hoy.json dashboard.html index.html
     git commit -m "feat(picks): actualizar pronosticos EV para la fecha YYYY-MM-DD"
     git push origin main
     ```
   - Esto dispara el despliegue automático e instantáneo en **Vercel** para que la web quede actualizada en vivo.
3. Notificar al usuario que la información está lista y disponible tanto en el enlace de Vercel como en `dashboard.html`.
4. Brindar en la respuesta del chat un **Resumen Ejecutivo** claro que incluya:
   - Tabla ordenada de los Top Picks Individuales (Partido, Jugador/Línea, Cuota bet365, Racha y Edge).
   - Detalle de las 2 Combinadas Sugeridas (cuota total y desglose de selecciones).
   - Recomendación de gestión de banca (Stake sugerido: 1% - 2% para simples, 0.5% para combinadas).
