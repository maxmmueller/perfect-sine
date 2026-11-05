import { Point, FittedSine, PointDeviation, StrokeEvaluation } from './types';
import { TiltDetector } from './TiltDetector';

/**
 * DeviationCalculator computes point-wise orthogonal distance deviations from drawn strokes
 * to the fitted reference sine curve, maps deviations into an HSL color gradient
 * (120° Green -> 60° Yellow -> 0° Red), and calculates overall accuracy scores.
 */
export class DeviationCalculator {
  /**
   * Calculates the perpendicular orthogonal distance from a point in aligned coordinates (u, v)
   * to the fitted sine curve f(u) = A * sin(omega * u + phi) + C using Newton-Raphson optimization.
   */
  public static calculateOrthogonalDistance(
    u: number,
    v: number,
    fit: FittedSine
  ): number {
    const { amplitude: a, frequency: omega, phase: phi, offset: c } = fit;

    // Initial estimate of closest curve coordinate u is u itself
    let uCurr = u;

    // Minimize squared Euclidean distance:
    // D(u) = (u - u_pt)^2 + (f(u) - v_pt)^2
    // D'(u) = 2 * ( (u - u_pt) + (f(u) - v_pt) * f'(u) ) = 0
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
      uCurr -= step;
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
   * @param maxTolerance Distance in pixels considered 100% error (defaults to 25px).
   */
  public static mapDistanceToColor(
    distance: number,
    maxTolerance: number = 25
  ): { hue: number; normalizedError: number; color: string } {
    const safeDistance = Math.max(0, distance);
    const normalizedError = Math.min(1.0, safeDistance / maxTolerance);
    const hue = Math.round(120 * (1 - normalizedError));
    const color = `hsl(${hue}, 100%, 50%)`;

    return { hue, normalizedError, color };
  }

  /**
   * Evaluates an entire drawn stroke against the fitted sine wave.
   *
   * @param points Raw sampled stroke points.
   * @param fit FittedSine model.
   * @param maxTolerance Maximum deviation threshold (default 25px).
   */
  public static evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 25
  ): StrokeEvaluation {
    if (points.length === 0) {
      return {
        fittedSine: fit,
        deviations: [],
        meanDeviation: 0,
        maxDeviation: 0,
        rmse: 0,
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

    // V-Model score calculation: weighted between RMSE accuracy and R² shape adherence
    const rawAccuracy = Math.max(0, 1 - rmse / maxTolerance);
    const scoreNorm = 0.7 * rawAccuracy + 0.3 * fit.r2;
    const score = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    return {
      fittedSine: fit,
      deviations,
      meanDeviation,
      maxDeviation: maxDist,
      rmse,
      score,
    };
  }
}
