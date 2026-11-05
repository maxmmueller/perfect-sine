import { Point, FittedSine, StrokeEvaluation, PointDeviation } from '../types';
import { TiltDetector } from '../TiltDetector';
import { DeviationCalculator } from '../DeviationCalculator';
import { IScoreStrategy } from './IScoreStrategy';

/**
 * Scorer 5 (Chebyshev L-infinity Strict Worst-Case Tolerance)
 * Strict maximum error mode. Rates the stroke by its worst single deviation (L-infinity norm).
 * Unforgiving of any single spike or departure from the reference curve.
 */
export class ChebyshevStrictScoreStrategy implements IScoreStrategy {
  public readonly id = 'chebyshev_linf';
  public readonly name = 'Chebyshev L-infinity Strict Worst-Case';
  public readonly description =
    'Strict maximum error mode. Evaluates the single worst deviation, heavily penalizing any slip.';

  public evaluate(
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
      const dist = DeviationCalculator.calculateOrthogonalDistance(al.x, al.y, fit);

      if (dist > maxDist) maxDist = dist;
      sumDist += dist;
      sumSqDist += dist * dist;

      const { hue, normalizedError, color } = DeviationCalculator.mapDistanceToColor(dist, maxTolerance);
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

    // Chebyshev L-infinity penalty: heavily governed by maxDist
    const chebyshevAccuracy = Math.max(0, 1 - maxDist / maxTolerance);
    const rmseAccuracy = Math.max(0, 1 - rmse / maxTolerance);

    // 60% worst-case deviation, 25% RMSE, 15% R²
    const scoreNorm = 0.6 * chebyshevAccuracy + 0.25 * rmseAccuracy + 0.15 * fit.r2;
    const accuracy = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    const normalizedAccuracy = accuracy / 100;
    const cycleMultiplier = Math.sqrt(Math.max(0.1, fit.fullCycles));
    const score = Math.round(baseScoreScale * Math.pow(normalizedAccuracy, 2.5) * cycleMultiplier);

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
