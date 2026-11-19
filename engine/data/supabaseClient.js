/**
 * SUPABASE CLIENT - ADAPTADOR REST NATIVO
 * Permite interactuar con Supabase utilizando el fetch nativo de Node.js (sin npm install).
 * Si no hay credenciales configuradas, conmuta automáticamente a modo local silencioso.
 */
const config = require('../config');

class SupabaseClient {
  constructor() {
    this.url = config.supabase.url;
    this.key = config.supabase.anonKey;
    this.enabled = config.supabase.enabled;

    if (!this.enabled) {
      // Modo local
    } else {
      console.log('[Supabase] Conectado a', this.url);
    }
  }

  isReady() {
    return this.enabled && Boolean(this.url && this.key);
  }

  async _request(endpoint, options = {}) {
    if (!this.isReady()) return null;

    const url = `${this.url}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    };

    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[Supabase Error ${res.status}] en ${endpoint}:`, errorText);
        return null;
      }

      return await res.json();
    } catch (e) {
      console.warn(`[Supabase Network Error] en ${endpoint}:`, e.message);
      return null;
    }
  }

  async insert(table, data) {
    if (!this.isReady()) return null;
    return this._request(table, {
      method: 'POST',
      body: data
    });
  }

  async upsert(table, data, onConflict = 'id') {
    if (!this.isReady()) return null;
    return this._request(table, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: data
    });
  }

  async select(table, query = '') {
    if (!this.isReady()) return null;
    const endpoint = query ? `${table}?${query}` : table;
    return this._request(endpoint, { method: 'GET' });
  }
}

module.exports = new SupabaseClient();
