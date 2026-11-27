/**
 * CANDIDATE NORMALIZER - NORMALIZADOR CENTRAL DE CANDIDATOS
 * Garantiza esquema canónico, inmutabilidad de identidad y deduplicación inteligente
 * evitando que distintas cuotas generen candidatos duplicados.
 */

class CandidateNormalizer {
  constructor() {
    this.version = '3.0.0';
  }

  /**
   * Genera el ID canónico reproducible del evento y selección
   */
  generateCanonicalId(data) {
    const cleanMatch = String(data.match || `${data.homeTeam || ''}_vs_${data.awayTeam || ''}`)
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanEntity = String(data.player || data.playerOrTeam || data.team || 'team')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanMarket = String(data.market || '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanLine = String(data.line || data.selection || '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const dateKey = String(data.date || data.eventDateLocal || '').slice(0, 10).replace(/[^0-9]/g, '');

    return `cand_can_${dateKey}_${cleanMatch.slice(0, 8)}_${cleanEntity.slice(0, 8)}_${cleanMarket.slice(0, 6)}_${cleanLine.slice(0, 6)}`;
  }

  /**
   * Normaliza un registro bruto a esquema canónico completo
   */
  normalize(raw, options = {}) {
    if (!raw) return null;

    const oddsNum = Number(raw.odds);
    if (isNaN(oddsNum) || oddsNum <= 1.0) return null;

    const canonicalId = this.generateCanonicalId(raw);
    const nowIso = new Date().toISOString();

    const home = raw.homeTeam || (raw.match ? raw.match.split(' vs ')[0] : 'Local');
    const away = raw.awayTeam || (raw.match ? raw.match.split(' vs ')[1] : 'Visitante');

    const normalized = {
      candidateId: canonicalId,
      id: raw.id || canonicalId,
      canonicalId: canonicalId,
      matchId: raw.matchId || raw.fixtureId || `${home}_vs_${away}`.toLowerCase().replace(/\s+/g, '_'),
      fixtureId: raw.fixtureId || raw.matchId,
      competitionId: raw.competitionId || 'unknown_competition',
      competition: raw.competition || raw.league || 'Liga General',
      league: raw.league || raw.competition || 'Liga General',
      match: raw.match || `${home} vs ${away}`,
      homeTeam: home,
      awayTeam: away,
      player: raw.player || (raw.isPlayerProp ? raw.playerOrTeam : null),
      team: raw.team || raw.playerOrTeam || home,
      playerOrTeam: raw.player || raw.team || raw.playerOrTeam || home,
      market: raw.market || 'General',
      selection: raw.selection || raw.line || 'General',
      line: raw.line || raw.selection || 'General',
      odds: oddsNum,
      bookmaker: raw.bookmaker || 'Consensus',
      origin: raw.origin || (raw.policy === 'EXPERIMENTAL_ODDS_V24' ? 'EXPERIMENTAL_V24' : (raw.shadow_mode ? 'SHADOW' : 'PRODUCTION')),
      shadow_mode: raw.shadow_mode !== undefined ? raw.shadow_mode : true,
      is_operative_recommendation: false,
      source: raw.source || 'Discovery3.0',
      sourceEventTimestamp: raw.sourceEventTimestamp || raw.eventDateUtc || raw.kickoffUtc || nowIso,
      dataCutoffTimestamp: raw.dataCutoffTimestamp || nowIso,
      ingestedAt: nowIso,
      snapshotVersion: 1,
      status: raw.status || 'UNDER_RESEARCH',
      preliminaryScore: raw.hitRate || raw.hit_rate_l5 ? parseFloat(raw.hitRate || raw.hit_rate_l5) : 50,
      
      // Historial de ofertas de precio y snapshots de cuotas
      priceAlternatives: [
        {
          odds: oddsNum,
          bookmaker: raw.bookmaker || 'Consensus',
          timestamp: nowIso
        }
      ],

      // Metadatos de motor
      discoveryEngine: options.engineVersion || '3.0.0',
      executionId: options.executionId || null,
      rawPayload: raw
    };

    return normalized;
  }

  /**
   * Fusiona una oferta de cuota diferente para el mismo candidato sin duplicar
   */
  mergePriceAlternative(existing, incoming) {
    if (!existing || !incoming) return existing;

    existing.priceAlternatives = existing.priceAlternatives || [];
    const isKnownBookmaker = existing.priceAlternatives.some(
      alt => alt.bookmaker === incoming.bookmaker && Math.abs(alt.odds - incoming.odds) < 0.001
    );

    if (!isKnownBookmaker) {
      existing.priceAlternatives.push({
        odds: incoming.odds,
        bookmaker: incoming.bookmaker,
        timestamp: new Date().toISOString()
      });

      // Conservar la mejor cuota disponible como cuota representativa
      if (incoming.odds > existing.odds) {
        existing.odds = incoming.odds;
        existing.bookmaker = incoming.bookmaker;
      }

      existing.snapshotVersion = (existing.snapshotVersion || 1) + 1;
    }

    return existing;
  }
}

module.exports = {
  CandidateNormalizer,
  candidateNormalizer: new CandidateNormalizer()
};
