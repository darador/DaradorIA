/**
 * DATE TIME UTILS - NORMALIZACIÓN DE FECHAS Y ZONA HORARIA
 * Fase 2: Regla única de interpretación de fechas para DaradorIA / DaradorBET.
 * Zona horaria oficial del sistema: America/Argentina/Buenos_Aires (UTC-3).
 */

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Convierte cualquier fecha, string ISO o timestamp UTC a formato YYYY-MM-DD en la zona horaria dada.
 * @param {string|number|Date} dateInput 
 * @param {string} timeZone 
 * @returns {string} YYYY-MM-DD
 */
function toLocalDateString(dateInput, timeZone = DEFAULT_TIMEZONE) {
  if (!dateInput) return null;
  let dateObj;
  
  if (typeof dateInput === 'number') {
    // Si es timestamp unix en segundos (StatsHub suele devolver segundos)
    dateObj = dateInput < 10000000000 ? new Date(dateInput * 1000) : new Date(dateInput);
  } else if (typeof dateInput === 'string') {
    // Si ya viene como YYYY-MM-DD puro sin hora
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
      return dateInput.trim();
    }
    dateObj = new Date(dateInput);
  } else if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else {
    return null;
  }

  if (isNaN(dateObj.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.format(dateObj); // Devuelve YYYY-MM-DD
}

/**
 * Convierte un timestamp UTC o Date a formato legible de hora local en Argentina (ej: "17:00 hs")
 * @param {string|number|Date} dateInput 
 * @param {string} timeZone 
 * @returns {string} HH:mm hs
 */
function toLocalTimeString(dateInput, timeZone = DEFAULT_TIMEZONE) {
  if (!dateInput) return 'Horario por confirmar';
  let dateObj;
  
  if (typeof dateInput === 'number') {
    dateObj = dateInput < 10000000000 ? new Date(dateInput * 1000) : new Date(dateInput);
  } else if (typeof dateInput === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
      return 'Horario por confirmar';
    }
    dateObj = new Date(dateInput);
  } else if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else {
    return 'Horario por confirmar';
  }

  if (isNaN(dateObj.getTime())) return 'Horario por confirmar';

  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  return formatter.format(dateObj) + ' hs';
}

/**
 * Obtiene la fecha local de un evento/partido desde un objeto de pick o candidato.
 * Busca estrictamente campos de evento (eventDate, kickoffTimestamp, kickoff, matchDate),
 * evitando usar fechas de creación, investigación o decisión de agentes.
 * @param {Object} item Pick o Candidato
 * @param {string} timeZone 
 * @returns {string} YYYY-MM-DD
 */
function getEventDateLocal(item, timeZone = DEFAULT_TIMEZONE) {
  if (!item) return null;

  // 1. Campo explícito ya normalizado
  if (item.eventDateLocal && /^\d{4}-\d{2}-\d{2}$/.test(item.eventDateLocal)) {
    return item.eventDateLocal;
  }

  // 2. Timestamp unix de inicio de partido (StatsHub)
  if (item.kickoffTimestamp || item.kickoff_timestamp) {
    const ts = item.kickoffTimestamp || item.kickoff_timestamp;
    return toLocalDateString(ts, timeZone);
  }

  // 3. String o timestamp de eventDate
  if (item.eventDate || item.event_date) {
    const ed = item.eventDate || item.event_date;
    return toLocalDateString(ed, timeZone);
  }

  // 4. Cadena de texto en p.time (ej: "Thu 19 Nov 2026, 22:30 UTC" o "Fri 20 Nov 2026, 20:00 UTC")
  if (typeof item.time === 'string') {
    const utcMatch = item.time.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+\d{2}:\d{2})\s+UTC/);
    if (utcMatch) {
      const parsedUtc = new Date(utcMatch[1] + ' UTC');
      if (!isNaN(parsedUtc.getTime())) {
        return toLocalDateString(parsedUtc, timeZone);
      }
    }
  }

  // 5. matchDate o fixtureDate
  if (item.matchDate || item.fixtureDate) {
    return toLocalDateString(item.matchDate || item.fixtureDate, timeZone);
  }

  // 6. Si item.date ya viene como fecha válida de evento
  if (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    return item.date;
  }

  return null;
}

/**
 * Calcula los límites de una jornada (inicio 00:00:00 y fin 23:59:59) en hora local de Argentina
 * y devuelve los equivalentes en UTC ISO strings.
 * @param {string} localDateStr Formato YYYY-MM-DD
 * @returns {{startUtcIso: string, endUtcIso: string, startTs: number, endTs: number}}
 */
function getLocalDateDayBoundaries(localDateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDateStr)) {
    throw new Error(`Formato de fecha inválido: ${localDateStr}. Se espera YYYY-MM-DD`);
  }

  // Argentina es UTC-3 constante (sin horario de verano actualmente)
  // 00:00:00 de Argentina = 03:00:00 UTC del mismo día
  // 23:59:59.999 de Argentina = 02:59:59.999 UTC del día siguiente
  const [year, month, day] = localDateStr.split('-').map(Number);
  
  // Start: localDate 00:00:00 ART -> UTC = localDate 03:00:00 UTC
  const startUtc = new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
  // End: localDate 23:59:59.999 ART -> UTC = nextDay 02:59:59.999 UTC
  const endUtc = new Date(Date.UTC(year, month - 1, day + 1, 2, 59, 59, 999));

  return {
    localDate: localDateStr,
    timeZone: DEFAULT_TIMEZONE,
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
    startTs: Math.floor(startUtc.getTime() / 1000),
    endTs: Math.floor(endUtc.getTime() / 1000)
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  toLocalDateString,
  toLocalTimeString,
  getEventDateLocal,
  getLocalDateDayBoundaries
};
