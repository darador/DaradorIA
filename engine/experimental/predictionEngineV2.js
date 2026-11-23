/**
 * PREDICTION ENGINE V2 (EXPERIMENTAL — SHADOW MODE ONLY)
 * Fase 2.1: Versión experimental independiente del motor productivo.
 * NO reemplaza a engine/prediction/predictionEngine.js ni altera aprobaciones productivas.
 *
 * Correcciones matemáticas implementadas:
 * 1. Soporte nativo y exacto para mercados Over y Under (líneas medias X.5 y enteras X.0 con push).
 * 2. Función logGamma mediante aproximación de Lanczos (g=7, precisión < 1e-13) para Binomial Negativa.
 * 3. Escalado coherente de media y varianza en Binomial Negativa (preservando dispersión phi = Var/Media).
 * 4. Eliminación de la doble penalización por minutos (separación explícita statPer90 vs promedio por partido).
 * 5. Shrinkage Beta-Binomial anclado a probabilidad implícita sin vig del mercado (elimina 0% y 100% extremos).
 */

const MIN_PROB = 1e-6;
const MAX_PROB = 1 - 1e-6;
const DEFAULT_ESTIMATED_OVERROUND = 1.06;

// Coeficientes de Lanczos (g = 7, n = 9) para precisión de doble punto flotante
const LANCZOS_G = 7;
const LANCZOS_COEFFS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7
];

class PredictionEngineV2Experimental {
  constructor(options = {}) {
    this.version = 'v2.1-experimental-shadow';
    this.defaultPriorStrength = options.defaultPriorStrength ?? 15; // m = 15 (validado en Fase 2)
    this.defaultOverround = options.defaultOverround ?? DEFAULT_ESTIMATED_OVERROUND;
    this.overdispersionThreshold = options.overdispersionThreshold ?? 1.15;
  }

  // --- 1. FUNCIONES MATEMÁTICAS EXACTAS ---

  /**
   * ln(Gamma(z)) mediante aproximación de Lanczos (z > 0).
   * Error relativo < 1e-13 en todo el dominio positivo.
   */
  logGammaLanczos(z) {
    if (!Number.isFinite(z) || z <= 0) {
      throw new RangeError(`logGammaLanczos requiere z > 0, recibido: ${z}`);
    }
    if (z < 0.5) {
      // Fórmula de reflexión de Euler: Gamma(z) * Gamma(1 - z) = pi / sin(pi * z)
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - this.logGammaLanczos(1 - z);
    }
    const zAdj = z - 1;
    let x = LANCZOS_COEFFS[0];
    for (let i = 1; i < LANCZOS_COEFFS.length; i++) {
      x += LANCZOS_COEFFS[i] / (zAdj + i);
    }
    const t = zAdj + LANCZOS_G + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (zAdj + 0.5) * Math.log(t) - t + Math.log(x);
  }

  /**
   * PMF Poisson: P(X = k) = exp(k * ln(lambda) - lambda - ln(k!))
   */
  poissonPmf(lambda, k) {
    if (k < 0 || !Number.isInteger(k)) return 0;
    if (lambda < 0 || !Number.isFinite(lambda)) throw new RangeError(`lambda inválido: ${lambda}`);
    if (lambda === 0) return k === 0 ? 1 : 0;
    return Math.exp(k * Math.log(lambda) - lambda - this.logGammaLanczos(k + 1));
  }

  /**
   * CDF Poisson: P(X <= kMax)
   */
  poissonCdf(lambda, kMax) {
    if (kMax < 0) return 0;
    const upper = Math.floor(kMax);
    let sum = 0;
    for (let i = 0; i <= upper; i++) {
      sum += this.poissonPmf(lambda, i);
    }
    return Math.min(1, Math.max(0, sum));
  }

  /**
   * P(X >= kMin) bajo Poisson
   */
  poissonOver(lambda, kMin) {
    if (kMin <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.poissonCdf(lambda, kMin - 1)));
  }

  /**
   * P(X <= kMax) bajo Poisson
   */
  poissonUnder(lambda, kMax) {
    return this.poissonCdf(lambda, kMax);
  }

  /**
   * PMF Binomial Negativa parametrizada por (r, p):
   * P(X = k) = Gamma(k + r) / (Gamma(k + 1) * Gamma(r)) * p^r * (1 - p)^k
   * donde media = r * (1 - p) / p y varianza = media / p.
   */
  nbPmf(k, r, p) {
    if (k < 0 || !Number.isInteger(k)) return 0;
    if (r <= 0 || p <= 0 || p >= 1) {
      throw new RangeError(`Parámetros NB inválidos: r=${r}, p=${p}`);
    }
    const logPmf =
      this.logGammaLanczos(k + r) -
      this.logGammaLanczos(k + 1) -
      this.logGammaLanczos(r) +
      r * Math.log(p) +
      k * Math.log(1 - p);
    return Math.exp(logPmf);
  }

  /**
   * Convierte (media, varianza) a parámetros NB (r, p) con escalado coherente.
   * Si se aplica un multiplicador de contexto c (rival * localía * minutos):
   *   mu' = mu * c
   *   phi = var / mu  (razón de dispersión constante)
   *   var' = phi * mu'  =>  r' = mu' / (phi - 1),  p' = 1 / phi
   */
  nbParamsFromMeanVariance(mean, variance, scaleFactor = 1.0) {
    const muScaled = mean * scaleFactor;
    if (muScaled <= 0) return { usePoisson: true, lambda: 0, phi: 1, r: Infinity, p: 1 };
    const phi = mean > 0 ? variance / mean : 1.0;
    if (!Number.isFinite(phi) || phi <= 1.0 + 1e-9) {
      return { usePoisson: true, lambda: muScaled, phi: Math.max(1, phi || 1), r: Infinity, p: 1 };
    }
    const varScaled = phi * muScaled;
    const r = muScaled / (phi - 1);
    const p = 1 / phi; // equivalente a muScaled / varScaled
    return { usePoisson: false, lambda: muScaled, varScaled, phi, r, p };
  }

  /**
   * CDF Binomial Negativa: P(X <= kMax)
   */
  nbCdf(mean, variance, kMax, scaleFactor = 1.0) {
    if (kMax < 0) return 0;
    const params = this.nbParamsFromMeanVariance(mean, variance, scaleFactor);
    if (params.usePoisson) return this.poissonCdf(params.lambda, kMax);
    const upper = Math.floor(kMax);
    let sum = 0;
    for (let i = 0; i <= upper; i++) {
      sum += this.nbPmf(i, params.r, params.p);
    }
    return Math.min(1, Math.max(0, sum));
  }

  nbOver(mean, variance, kMin, scaleFactor = 1.0) {
    if (kMin <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.nbCdf(mean, variance, kMin - 1, scaleFactor)));
  }

  nbUnder(mean, variance, kMax, scaleFactor = 1.0) {
    return this.nbCdf(mean, variance, kMax, scaleFactor);
  }

  // --- 2. PARSER DE LÍNEAS OVER / UNDER (MEDIAS Y ENTERAS) ---

  /**
   * Parsea dirección y umbrales exactos para conteos discretos X ∈ {0, 1, 2, ...}:
   * - "Más de 1.5" (Over 1.5): gana si X >= 2 (kOverMin = 2, kUnderMax = 1, hasPush = false)
   * - "Menos de 5.5" (Under 5.5): gana si X <= 5 (kUnderMax = 5, kOverMin = 6, hasPush = false)
   * - "Más de 2.0" (Over 2.0): gana si X >= 3, push si X == 2, pierde si X <= 1 (hasPush = true, pushK = 2)
   * - "Menos de 2.0" (Under 2.0): gana si X <= 1, push si X == 2, pierde si X >= 3 (hasPush = true, pushK = 2)
   */
  parseLine(lineStr, rawLine = null, explicitSide = null) {
    const s = String(lineStr || '').trim().toLowerCase();
    let side = explicitSide ? String(explicitSide).toLowerCase() : null;
    if (!side) {
      if (s.includes('menos') || s.includes('under') || s.includes('<')) side = 'under';
      else side = 'over';
    }

    let numericLine = rawLine !== null && rawLine !== undefined ? Number(rawLine) : NaN;
    if (!Number.isFinite(numericLine)) {
      const m = s.match(/(\d+(?:\.\d+)?)/);
      numericLine = m ? parseFloat(m[1]) : 0.5;
    }

    const isIntegerLine = Math.abs(numericLine - Math.round(numericLine)) < 1e-9;
    const intVal = Math.round(numericLine);

    if (isIntegerLine) {
      return {
        side,
        numericLine: intVal,
        isIntegerLine: true,
        hasPush: true,
        pushK: intVal,
        kOverMin: intVal + 1,
        kUnderMax: intVal - 1
      };
    }

    const floored = Math.floor(numericLine);
    return {
      side,
      numericLine,
      isIntegerLine: false,
      hasPush: false,
      pushK: null,
      kOverMin: floored + 1,
      kUnderMax: floored
    };
  }

  /**
   * Evalúa P(Over), P(Push) y P(Under) sobre un modelo paramétrico (Poisson o NB).
   * Garantiza P(Over) + P(Push) + P(Under) = 1.
   */
  evaluateLineDistribution(mean, variance, parsedLine, scaleFactor = 1.0, forceModel = null) {
    const params = this.nbParamsFromMeanVariance(mean, variance, scaleFactor);
    const useNB = forceModel === 'nb'
      ? !params.usePoisson
      : (forceModel === 'poisson' ? false : (!params.usePoisson && params.phi >= this.overdispersionThreshold));

    let pOver, pUnder, pPush;
    if (useNB) {
      pUnder = this.nbUnder(mean, variance, parsedLine.kUnderMax, scaleFactor);
      pPush = parsedLine.hasPush ? this.nbPmf(parsedLine.pushK, params.r, params.p) : 0;
      pOver = Math.max(0, 1 - pUnder - pPush);
    } else {
      pUnder = this.poissonUnder(params.lambda, parsedLine.kUnderMax);
      pPush = parsedLine.hasPush ? this.poissonPmf(params.lambda, parsedLine.pushK) : 0;
      pOver = Math.max(0, 1 - pUnder - pPush);
    }

    // Probabilidad condicional excluyendo push (para líneas enteras donde push devuelve stake)
    const nonPushMass = Math.max(1e-12, 1 - pPush);
    const pSelectedRaw = parsedLine.side === 'under' ? pUnder : pOver;
    const pSelectedNoPush = pSelectedRaw / nonPushMass;

    return {
      modelUsed: useNB ? 'NegativeBinomial-Lanczos' : 'Poisson',
      lambdaAdjusted: Number(params.lambda.toFixed(4)),
      dispersionPhi: Number(params.phi.toFixed(4)),
      nbR: useNB ? Number(params.r.toFixed(4)) : null,
      nbP: useNB ? Number(params.p.toFixed(4)) : null,
      pOver,
      pUnder,
      pPush,
      pSelectedRaw,
      pSelectedNoPush
    };
  }

  // --- 3. PROBABILIDAD SIN VIG Y SHRINKAGE BETA-BINOMIAL ---

  /**
   * Calcula la probabilidad implícita sin vig del mercado.
   * Si existen ambas cuotas (overOdds y underOdds > 1), usa normalización exacta 2-way (proporcional).
   * Si solo existe una cuota, aplica el margen estimado y lo declara explícitamente en `method`.
   */
  computeNoVigProb(targetOdds, oppositeOdds = null) {
    const o1 = Number(targetOdds);
    if (!Number.isFinite(o1) || o1 <= 1) {
      return { prob: null, method: 'unavailable', overround: null };
    }
    const o2 = oppositeOdds !== null && oppositeOdds !== undefined ? Number(oppositeOdds) : NaN;
    if (Number.isFinite(o2) && o2 > 1) {
      const imp1 = 1 / o1;
      const imp2 = 1 / o2;
      const sumImp = imp1 + imp2;
      return {
        prob: Number((imp1 / sumImp).toFixed(6)),
        method: 'exact_2way_proportional',
        overround: Number(sumImp.toFixed(4))
      };
    }
    const probEst = Math.min(MAX_PROB, Math.max(MIN_PROB, (1 / o1) / this.defaultOverround));
    return {
      prob: Number(probEst.toFixed(6)),
      method: 'estimated_overround',
      overround: this.defaultOverround
    };
  }

  /**
   * Shrinkage Beta-Binomial:
   * p_post = (hits + m * p_prior) / (n + m)
   * Evita probabilidades 0% y 100% injustificadas incluso con 0/5 o 10/10.
   */
  betaBinomialShrink(hits, trials, priorProb, priorStrength = this.defaultPriorStrength) {
    const p0 = Math.min(MAX_PROB, Math.max(MIN_PROB, Number(priorProb)));
    const m = Math.max(1e-6, Number(priorStrength));
    const n = Math.max(0, Number(trials));
    const k = Math.max(0, Math.min(n, Number(hits)));
    const posterior = (k + m * p0) / (n + m);
    return Math.min(MAX_PROB, Math.max(MIN_PROB, posterior));
  }

  // --- 4. CÁLCULO DE TASA SIN DOBLE PENALIZACIÓN POR MINUTOS ---

  /**
   * Resuelve correctamente la tasa esperada por partido (lambdaBase) evitando la doble penalización:
   * - Si es mercado de equipo: promedio por partido (90 min fijos).
   * - Si existe statPer90 explícito: lambdaBase = statPer90 * (expectedMinutes / 90).
   * - Si NO existe statPer90 pero existe avgMinutesPlayed > 0:
   *     statPer90 = (perMatchMean / avgMinutesPlayed) * 90
   *     lambdaBase = perMatchMean * (expectedMinutes / avgMinutesPlayed)
   * - Si NO existe statPer90 ni avgMinutesPlayed: usa perMatchMean directamente sin multiplicar por minutes/90.
   */
  computeLambdaBase({ isTeamProp, perMatchMean, statPer90 = null, avgMinutesPlayed = null, expectedMinutes = null }) {
    if (isTeamProp) {
      return { lambdaBase: perMatchMean, statPer90Resolved: perMatchMean, method: 'team_per_match' };
    }
    const expMin = Number(expectedMinutes);
    if (Number.isFinite(Number(statPer90)) && Number(statPer90) > 0 && Number.isFinite(expMin) && expMin > 0) {
      return {
        lambdaBase: Number(statPer90) * (expMin / 90),
        statPer90Resolved: Number(statPer90),
        method: 'explicit_statPer90'
      };
    }
    const avgMin = Number(avgMinutesPlayed);
    if (Number.isFinite(avgMin) && avgMin > 0 && Number.isFinite(expMin) && expMin > 0) {
      const derivedP90 = (perMatchMean / avgMin) * 90;
      return {
        lambdaBase: perMatchMean * (expMin / avgMin),
        statPer90Resolved: derivedP90,
        method: 'derived_from_avgMinutes'
      };
    }
    return {
      lambdaBase: perMatchMean,
      statPer90Resolved: null,
      method: 'per_match_unscaled_no_minutes'
    };
  }

  // --- 5. PREDICCIÓN EXPERIMENTAL COMPLETA DE UN CANDIDATO ---

  predictCandidate(candidate) {
    const isTeamProp = Boolean(candidate.isTeamProp || String(candidate.playerOrTeam || candidate.player || '').toLowerCase().includes('(equipo)'));
    const research = candidate.researchData || {};
    const rawValues = isTeamProp
      ? (research.teamData?.observations || research.teamData?.historicalValues || candidate.historicalValues || [])
      : (research.playerData?.observations || research.playerData?.historicalValues || candidate.historicalValues || []);

    const historicalValues = Array.isArray(rawValues) ? rawValues.map(Number).filter(Number.isFinite) : [];
    if (historicalValues.length === 0) {
      return {
        engineVersion: this.version,
        candidateId: candidate.id,
        error: 'NO_HISTORICAL_OBSERVATIONS',
        pCalibrated: null
      };
    }

    const parsedLine = this.parseLine(candidate.line, candidate.rawLine, candidate.oddsType || candidate.side);
    const bookmakerOdds = Number(candidate.bookmakerOdds || candidate.odds || candidate.cuota || 0);
    const oppositeOdds = candidate.oppositeOdds ?? null;
    const noVig = this.computeNoVigProb(bookmakerOdds, oppositeOdds);
    const priorProb = noVig.prob ?? 0.50;

    // Estadísticos muestrales
    const n = historicalValues.length;
    const mean = historicalValues.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1
      ? historicalValues.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1)
      : mean;

    // Lambda base sin doble penalización por minutos
    const minutesInfo = this.computeLambdaBase({
      isTeamProp,
      perMatchMean: mean,
      statPer90: research.playerData?.statPer90 ?? candidate.statPer90 ?? null,
      avgMinutesPlayed: research.playerData?.avgMinutes ?? candidate.avgMinutesPlayed ?? null,
      expectedMinutes: research.playerData?.projectedMinutes ?? candidate.minutesExpected ?? null
    });

    const opponentRatio = (research.opponentData?.isAvailable && Number.isFinite(Number(research.opponentData.concessionRatio)))
      ? Number(research.opponentData.concessionRatio)
      : 1.0;
    const venueFactor = Number.isFinite(Number(candidate.venueFactor)) ? Number(candidate.venueFactor) : 1.0;

    const totalScale = mean > 0 ? (minutesInfo.lambdaBase / mean) * opponentRatio * venueFactor : 1.0;
    const paramDist = this.evaluateLineDistribution(mean, variance, parsedLine, totalScale);

    // Ventanas empíricas con Shrinkage Beta-Binomial (Over y Under soportados correctamente)
    const countHits = (arr) => arr.filter(v => (parsedLine.side === 'under' ? v <= parsedLine.kUnderMax : v >= parsedLine.kOverMin)).length;
    const countNonPush = (arr) => parsedLine.hasPush ? arr.filter(v => v !== parsedLine.pushK).length : arr.length;

    const sliceB = historicalValues.slice(0, 10);
    const nB = countNonPush(sliceB);
    const hitsB = countHits(sliceB);
    const pModelBRaw = nB > 0 ? hitsB / nB : null;
    const pModelBShrunk = nB >= 5 ? this.betaBinomialShrink(hitsB, nB, priorProb, this.defaultPriorStrength) : null;

    const sliceC = historicalValues.length >= 20 ? historicalValues.slice(0, 20) : (historicalValues.length >= 15 ? historicalValues.slice(0, 15) : historicalValues);
    const nC = countNonPush(sliceC);
    const hitsC = countHits(sliceC);
    const pModelCRaw = nC > 0 ? hitsC / nC : null;
    const pModelCShrunk = nC > 0 ? this.betaBinomialShrink(hitsC, nC, priorProb, this.defaultPriorStrength) : null;

    // Acotar probabilidad paramétrica en (0, 1)
    const pParamBounded = Math.min(MAX_PROB, Math.max(MIN_PROB, paramDist.pSelectedNoPush));

    // Combinación experimental en Shadow Mode (50% Beta-Binomial + 50% Paramétrico corregido, para comparar 1:1 contra V1)
    const pShadowCombined = Number(((0.50 * pParamBounded) + (0.50 * pModelCShrunk)).toFixed(4));
    const evShadow = bookmakerOdds > 1 ? Number((pShadowCombined * bookmakerOdds - 1).toFixed(4)) : null;

    return {
      engineVersion: this.version,
      shadowOnly: true,
      candidateId: candidate.id,
      playerOrTeam: candidate.playerOrTeam || candidate.player,
      match: candidate.match,
      market: candidate.market,
      line: candidate.line,
      parsedLine,
      bookmakerOdds: bookmakerOdds > 1 ? bookmakerOdds : null,
      oppositeOdds,
      marketNoVig: noVig,
      sampleSize: n,
      historicalMean: Number(mean.toFixed(4)),
      historicalVariance: Number(variance.toFixed(4)),
      minutesResolution: minutesInfo,
      parametric: {
        modelUsed: paramDist.modelUsed,
        lambdaAdjusted: paramDist.lambdaAdjusted,
        dispersionPhi: paramDist.dispersionPhi,
        pOver: Number(paramDist.pOver.toFixed(6)),
        pUnder: Number(paramDist.pUnder.toFixed(6)),
        pPush: Number(paramDist.pPush.toFixed(6)),
        pSelected: Number(pParamBounded.toFixed(4))
      },
      models: {
        modelB: {
          window: 'L10',
          sampleSize: nB,
          hits: hitsB,
          pRaw: pModelBRaw !== null ? Number(pModelBRaw.toFixed(4)) : null,
          pShrunk: pModelBShrunk !== null ? Number(pModelBShrunk.toFixed(4)) : null
        },
        modelC: {
          window: historicalValues.length >= 20 ? 'L20' : (historicalValues.length >= 15 ? 'L15' : `L${n}`),
          sampleSize: nC,
          hits: hitsC,
          pRaw: pModelCRaw !== null ? Number(pModelCRaw.toFixed(4)) : null,
          pShrunk: pModelCShrunk !== null ? Number(pModelCShrunk.toFixed(4)) : null
        }
      },
      pShadowCombined,
      fairOddsShadow: Number((1 / pShadowCombined).toFixed(2)),
      evShadow,
      evShadowPct: evShadow !== null ? Number((evShadow * 100).toFixed(1)) : null,
      evaluatedAt: new Date().toISOString()
    };
  }
}

module.exports = new PredictionEngineV2Experimental();
module.exports.PredictionEngineV2Experimental = PredictionEngineV2Experimental;
