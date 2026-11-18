# 📖 MANUAL DE INSTRUCCIONES: RADAR +EV (StatsHub × bet365)

Bienvenido a tu sistema automatizado de análisis deportivo con valor esperado positivo (**+EV**), que combina las herramientas del MCP de **StatsHub** con las cuotas de **bet365**.

---

## ⚡ 1. ¿Por qué se veía en 0 en la captura de pantalla?
Cuando abres un archivo `.html` haciendo doble clic en Windows, el navegador utiliza el protocolo de archivo local (`file:///...`). 
Por motivos de seguridad de los navegadores modernos (política de seguridad de origen/CORS), el navegador bloquea las solicitudes `fetch()` hacia archivos locales como `picks_hoy.json`.

### ✅ Solución implementada:
Ya hemos actualizado el sistema para que nunca más tengas este inconveniente. Tienes dos maneras de ver los datos:

### Método A: Doble clic directo (Sin instalar nada)
1. Simplemente haz doble clic o presiona **F5 (Refrescar)** en la pestaña de [`dashboard.html`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/dashboard.html).
2. Ahora el dashboard incluye un **mecanismo de respaldo automático integrado**, por lo que cargará y renderizará los datos de inmediato, incluso bajo el protocolo `file://`.
3. Alternativamente, si alguna vez quieres cargar un archivo JSON específico, puedes hacer clic en el botón inferior **"Seleccionar archivo"** y elegir `picks_hoy.json`.

### Método B: Servidor local interactivo con 1 clic (Recomendado)
Hemos creado el ejecutable [`iniciar_dashboard.bat`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/iniciar_dashboard.bat):
1. Haz **doble clic en `iniciar_dashboard.bat`**.
2. Se abrirá una consola ligera de Node.js y automáticamente se abrirá tu navegador en:
   ```
   http://localhost:3333/dashboard.html
   ```
3. Bajo este modo, cada vez que presiones el botón **"🔄 Actualizar"** en el encabezado, leerá en vivo el archivo `picks_hoy.json` sin ninguna restricción de navegador.

---

## 🚀 2. ¿Cómo solicitar un análisis en cualquier momento?

Solo necesitas escribirme en este chat con cualquiera de estas frases:
* *"Analizá la fecha de hoy"*
* *"Buscá props para hoy"*
* *"Analizá la jornada de Champions"*
* *"Buscá faltas y remates para hoy en bet365"*

El asistente ejecutará de forma autónoma el protocolo definido en [`REGLAS_ANALISIS.md`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/REGLAS_ANALISIS.md):
1. **Releva fixtures**: Consulta en StatsHub los partidos del día en las principales ligas (Premier League, LaLiga, Liga Argentina, Brasileirão, Serie A, etc.).
2. **Cruza estadísticas con bet365**: Ejecuta screeners de props, tendencias de jugadores, historial de árbitros y debilidades del rival.
3. **Aplica el filtro +EV**:
   - $Hit\ Rate \ge 75\%$ en los últimos 5 o 10 partidos.
   - Cuota en bet365 $\ge 1.65$.
   - $Edge \ge 5\%$ (Probabilidad Real superior a la probabilidad implícita de bet365).
4. **Actualiza los archivos**:
   - Sobrescribe `picks_hoy.json` con los datos frescos.
   - Actualiza el código de respaldo en `dashboard.html`.
   - Te entrega en el chat una tabla ejecutiva con los mejores picks y los 2 parlays recomendados.

---

## 📊 3. Cómo interpretar las métricas del Dashboard

| Métrica | Significado | Criterio Ideal |
| :--- | :--- | :--- |
| **Racha L5 / L10** | Porcentaje de partidos recientes donde el jugador o equipo superó la línea. | $\ge 80\%$ (ej. 4/5 o 5/5) |
| **Promedio p/p** | Promedio de tiros, faltas o córners por partido. | Debe ser cómodamente superior a la línea de bet365. |
| **Cuota bet365** | Multiplicador ofrecido por la casa de apuestas. | $\ge 1.65$ para picks individuales. |
| **Edge +EV (%)** | Ventaja matemática calculada ($P_{real} - P_{implícita}$). | $\ge 15\% - 25\%$ (Indica valor a largo plazo). |

---

## 🧩 4. Combinadas / Parlays Sugeridos

En la pestaña **"Combinadas / Parlays Sugeridos"** encontrarás dos tipos de apuestas múltiples:
1. **Combinada Conservadora (Cuota ~2.00 a 2.50)**:
   - 2 selecciones de máxima probabilidad y acierto del 85%+.
   - Pensada para construir banca de forma sostenida.
   - **Stake sugerido**: 1.5% a 2% de tu capital.
2. **Combinada de Valor (+EV) (Cuota ~4.00 a 6.00)**:
   - 3 selecciones con edge marcado (+20%).
   - Alta recompensa matemática con riesgo controlado.
   - **Stake sugerido**: 0.5% a 1% de tu capital.
3. **Botón "📋 Copiar Cupón"**:
   - Al hacer clic, copia automáticamente al portapapeles el detalle del ticket formateado para pegarlo en tus notas o armarlo rápidamente en bet365.

---

## 🗂️ 5. Resumen de Archivos del Proyecto

* [`dashboard.html`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/dashboard.html): Interfaz web interactiva en modo oscuro.
* [`picks_hoy.json`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/picks_hoy.json): Base de datos en JSON con los pronósticos vigentes.
* [`REGLAS_ANALISIS.md`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/REGLAS_ANALISIS.md): Protocolo y reglas matemáticas fijas de análisis.
* [`iniciar_dashboard.bat`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/iniciar_dashboard.bat): Acceso directo para iniciar el servidor local con 1 clic.
* [`server.js`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/server.js): Servidor HTTP local ultra liviano en Node.js (sin dependencias externas).
* [`MANUAL_DE_USO.md`](file:///c:/Users/ruben/OneDrive/Escritorio/Proyectos/DaradorIA/MANUAL_DE_USO.md): Este documento explicativo.
