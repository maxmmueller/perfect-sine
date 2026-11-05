import { Point, FittedSine, PointDeviation, StrokeEvaluation } from './types';
import { TiltDetector } from './TiltDetector';

/**
 * DeviationCalculator computes synchronous point-wise orthogonal distance deviations from drawn strokes
 * to the fitted reference sine curve, maps deviations into an HSL color gradient
 * (120° Green -> 60° Yellow -> 0° Red), and calculates intrinsic accuracy (0-100%) as well as
 * gamified period-scaled scores (accuracy * cycles * factor).
 */
export class DeviationCalculator {
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
   * Computes intrinsic wave accuracy (0-100%) and gamified period-scaled score (accuracy * cycles * factor).
   *
   * @param points Raw sampled stroke points.
   * @param fit FittedSine model.
   * @param maxTolerance Maximum deviation threshold (default 30px).
   * @param scoreFactor Multiplier factor for gamified score (default 10).
   */
  public static evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30,
    scoreFactor: number = 10
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
      };
    }

    // Transform raw points to baseline-aligned frame
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

      const { hue, normalizedError, color } = this.mapDistanceToColor(dist, maxTolerance);

      deviations.push({
        point: orig,
        distance: dist,
        normalizedError,
        hue,
        color,
      });
    }

    const meanDeviation = sumDist / points.length;
    const rmse = Math.sqrt(sumSqDist / points.length);

    // Intrinsic accuracy (0 - 100%) based on RMSE error and R² fit quality
    const rawAccuracy = Math.max(0, 1 - rmse / maxTolerance);
    const scoreNorm = 0.65 * rawAccuracy + 0.35 * fit.r2;
    const accuracy = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    // Gamified total score: accuracy * cycles * factor
    const score = Math.round(accuracy * fit.fullCycles * scoreFactor);

    return {
      fittedSine: fit,
      deviations,
      meanDeviation,
      maxDeviation: maxDist,
      rmse,
      accuracy,
      score,
    };
  }
}
