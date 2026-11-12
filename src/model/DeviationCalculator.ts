import { Point, FittedSine, PointDeviation, StrokeEvaluation } from './types';
import { TiltDetector } from './TiltDetector';

export interface StrokeMetricsAnalysis {
  readonly effectiveTolerance: number;
  readonly aligned: readonly Point[];
  readonly deviations: readonly PointDeviation[];
  readonly meanDeviation: number;
  readonly maxDeviation: number;
  readonly rmse: number;
}

/**
 * DeviationCalculator computes synchronous point-wise orthogonal distance deviations from drawn strokes
 * to the fitted reference sine curve, maps deviations into an HSL color gradient
 * (120° Green -> 60° Yellow -> 0° Red), and calculates intrinsic accuracy (0-100%) as well as
 * precision-weighted scores scaled by both period count and spatial wave size.
 */
export class DeviationCalculator {
  public static readonly REFERENCE_AMPLITUDE_PX = 40;
  public static readonly REFERENCE_PERIOD_PX = 200;
  public static readonly MIN_SCALE_MULTIPLIER = 0.2;
  public static readonly MAX_SCALE_MULTIPLIER = 2.5;
  public static readonly MIN_TOLERANCE_FACTOR = 0.55;
  public static readonly MAX_TOLERANCE_FACTOR = 1.85;

  private static computeRawSpatialRatio(fit: FittedSine): number {
    const safeAmplitude = Math.max(1, Math.abs(fit.amplitude));
    const safePeriod = Math.max(1, fit.period);
    const characteristicSize = Math.sqrt(safeAmplitude * safePeriod);
    const referenceSize = Math.sqrt(
      this.REFERENCE_AMPLITUDE_PX * this.REFERENCE_PERIOD_PX
    );
    return characteristicSize / referenceSize;
  }

  /**
   * Computes a spatial size multiplier for one fitted wave period using the geometric mean
   * of amplitude and wavelength normalized to a canonical 40px × 200px wave (multiplier = 1.0).
   * Superlinear exponent (1.35) strongly separates tiny wrist wiggles from sweeping canvas waves.
   */
  public static calculateScaleMultiplier(fit: FittedSine): number {
    const rawScale = Math.pow(this.computeRawSpatialRatio(fit), 1.35);
    const clamped = Math.max(
      this.MIN_SCALE_MULTIPLIER,
      Math.min(this.MAX_SCALE_MULTIPLIER, rawScale)
    );
    return Math.round(clamped * 1000) / 1000;
  }

  /**
   * Scales pixel error tolerance with wave size so tiny curves cannot exploit a fixed 30px
   * buffer and large expressive curves are not over-penalized for natural freehand tremor.
   */
  public static calculateEffectiveTolerance(
    fit: FittedSine,
    baseTolerance: number = 30
  ): number {
    const safeBase = Math.max(1, baseTolerance);
    const tolFactor = Math.max(
      this.MIN_TOLERANCE_FACTOR,
      Math.min(this.MAX_TOLERANCE_FACTOR, Math.pow(this.computeRawSpatialRatio(fit), 0.75))
    );
    return safeBase * tolFactor;
  }

  /**
   * Computes synchronous point-wise orthogonal deviations, color mappings, and error stats
   * using size-normalized tolerance. Shared across all scoring strategies.
   */
  public static analyzeStroke(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30
  ): StrokeMetricsAnalysis {
    const effectiveTolerance = this.calculateEffectiveTolerance(fit, maxTolerance);
    if (points.length === 0) {
      return {
        effectiveTolerance,
        aligned: [],
        deviations: [],
        meanDeviation: 0,
        maxDeviation: 0,
        rmse: 0,
      };
    }

    const aligned = TiltDetector.transformPoints(points, fit.tilt);
    const deviations: PointDeviation[] = [];
    let sumDist = 0;
    let sumSqDist = 0;
    let maxDist = 0;

    for (let i = 0; i < points.length; i++) {
      const orig = points[i];
      const al = aligned[i];
      const dist = this.calculateOrthogonalDistance(al.x, al.y, fit);

      if (dist > maxDist) maxDist = dist;
      sumDist += dist;
      sumSqDist += dist * dist;

      const { hue, normalizedError, color } = this.mapDistanceToColor(dist, effectiveTolerance);
      deviations.push({
        point: orig,
        distance: dist,
        normalizedError,
        hue,
        color,
      });
    }

    return {
      effectiveTolerance,
      aligned,
      deviations,
      meanDeviation: sumDist / points.length,
      maxDeviation: maxDist,
      rmse: Math.sqrt(sumSqDist / points.length),
    };
  }

  /**
   * Computes the final precision-, length-, and spatial-scale-weighted score.
   * Score = baseScoreScale * (accuracy / 100)^2.5 * sqrt(cycles) * scaleMultiplier
   */
  public static calculateFinalScore(
    accuracy: number,
    fit: FittedSine,
    baseScoreScale: number = 1000
  ): { score: number; scaleMultiplier: number } {
    const normalizedAccuracy = Math.max(0, Math.min(100, accuracy)) / 100;
    const cycleMultiplier = Math.sqrt(Math.max(0.1, fit.fullCycles));
    const scaleMultiplier = this.calculateScaleMultiplier(fit);
    const score = Math.round(
      baseScoreScale * Math.pow(normalizedAccuracy, 2.5) * cycleMultiplier * scaleMultiplier
    );
    return { score, scaleMultiplier };
  }

  /**
   * Calculates the perpendicular orthogonal distance from point (u, v) in baseline-aligned coordinates
   * to the reference sine curve at the corresponding cycle progression u.
   *
   * To prevent false-green intersections where curves merely cross each other at different phases,
   * search is strictly constrained to the local harmonic neighborhood (within +/- T / 8).
   */
  public static calculateOrthogonalDistance(
    u: number,
    v: number,
    fit: FittedSine
  ): number {
    const { amplitude: a, frequency: omega, phase: phi, offset: c } = fit;

    // Constrain closest-point search strictly within +/- T / 8 (one eighth period)
    // to ensure the point is evaluated against its matching wave progression phase.
    const maxSearchDelta = Math.PI / (4 * Math.max(1e-4, omega));
    let uCurr = u;

    // Newton-Raphson refinement bounded to local phase neighborhood
    for (let iter = 0; iter < 4; iter++) {
      const angle = omega * uCurr + phi;
      const fVal = a * Math.sin(angle) + c;
      const fPrime = a * omega * Math.cos(angle);
      const fDoublePrime = -a * omega * omega * Math.sin(angle);

      const diffV = fVal - v;
      const g = (uCurr - u) + diffV * fPrime;
      const gPrime = 1 + fPrime * fPrime + diffV * fDoublePrime;

      if (Math.abs(gPrime) < 1e-6) break;
      const step = g / gPrime;
      const nextU = uCurr - step;

      // Clamp within local harmonic cycle neighborhood
      if (Math.abs(nextU - u) > maxSearchDelta) {
        uCurr = u + Math.sign(nextU - u) * maxSearchDelta;
        break;
      }

      uCurr = nextU;
      if (Math.abs(step) < 1e-4) break;
    }

    const angleFinal = omega * uCurr + phi;
    const fFinal = a * Math.sin(angleFinal) + c;
    const du = uCurr - u;
    const dv = fFinal - v;

    return Math.hypot(du, dv);
  }

  /**
   * Maps an orthogonal distance to an HSL color string and hue between 120° (Green) and 0° (Red).
   *
   * @param distance Orthogonal distance in pixels.
   * @param maxTolerance Distance in pixels considered 100% error (defaults to 30px).
   */
  public static mapDistanceToColor(
    distance: number,
    maxTolerance: number = 30
  ): { hue: number; normalizedError: number; color: string } {
    const safeDistance = Math.max(0, distance);
    const normalizedError = Math.min(1.0, safeDistance / maxTolerance);
    const hue = Math.round(120 * (1 - normalizedError));
    const color = `hsl(${hue}, 100%, 50%)`;

    return { hue, normalizedError, color };
  }

  /**
   * Evaluates an entire drawn stroke against the fitted sine wave.
   * Computes intrinsic wave accuracy (0-100%) and gamified score.
   * Accuracy is weighted 5x stronger than period count (Accuracy^2.5 * sqrt(Cycles)).
   *
   * @param points Raw sampled stroke points.
   * @param fit FittedSine model.
   * @param maxTolerance Maximum deviation threshold (default 30px).
   * @param baseScoreScale Base score points at 100% accuracy and 1 cycle (default 1000).
   */
  public static evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30,
    baseScoreScale: number = 1000
  ): StrokeEvaluation {
    if (points.length === 0) {
      return {
        fittedSine: fit,
        deviations: [],
        meanDeviation: 0,
        maxDeviation: 0,
        rmse: 0,
        accuracy: 0,
        score: 0,
        scaleMultiplier: 0,
      };
    }

    const { effectiveTolerance, deviations, meanDeviation, maxDeviation, rmse } =
      this.analyzeStroke(points, fit, maxTolerance);

    // Intrinsic accuracy (0 - 100%) based on scale-normalized RMSE error and R² fit quality
    const rawAccuracy = Math.max(0, 1 - rmse / effectiveTolerance);
    const scoreNorm = 0.65 * rawAccuracy + 0.35 * fit.r2;
    const accuracy = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    // Accuracy weighted 5x stronger than cycle count, scaled by spatial wave size:
    // Score = baseScoreScale * (accuracy / 100)^2.5 * sqrt(cycles) * scaleMultiplier
    const { score, scaleMultiplier } = this.calculateFinalScore(accuracy, fit, baseScoreScale);

    return {
      fittedSine: fit,
      deviations,
      meanDeviation,
      maxDeviation,
      rmse,
      accuracy,
      score,
      scaleMultiplier,
    };
  }
}
