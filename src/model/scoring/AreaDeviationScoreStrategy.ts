import { Point, FittedSine, StrokeEvaluation, PointDeviation } from '../types';
import { TiltDetector } from '../TiltDetector';
import { DeviationCalculator } from '../DeviationCalculator';
import { IScoreStrategy } from './IScoreStrategy';

/**
 * Scorer 2 (Integral Area / L1 Mean Absolute Deviation)
 * Computes the mean absolute error (MAE) representing enclosed integral area between curves.
 * Highly robust against micro-tremor hand jitter as long as the trajectory encloses minimal area.
 */
export class AreaDeviationScoreStrategy implements IScoreStrategy {
  public readonly id = 'area_l1';
  public readonly name = 'Enclosed Integral Area / L1 MAE';
  public readonly description =
    'Mean absolute area deviation. Forgiving of rapid hand tremor if overall trajectory stays centered.';

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
        scaleMultiplier: 0,
      };
    }

    const aligned = TiltDetector.transformPoints(points, fit.tilt);
    const deviations: PointDeviation[] = [];

    let sumAbsDist = 0;
    let sumSqDist = 0;
    let maxDist = 0;

    for (let i = 0; i < points.length; i++) {
      const orig = points[i];
      const al = aligned[i];
      const dist = DeviationCalculator.calculateOrthogonalDistance(al.x, al.y, fit);

      if (dist > maxDist) maxDist = dist;
      sumAbsDist += dist;
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

    const meanAbsDeviation = sumAbsDist / points.length;
    const rmse = Math.sqrt(sumSqDist / points.length);

    // L1 accuracy uses linear error penalty rather than quadratic penalty
    const rawAccuracy = Math.max(0, 1 - meanAbsDeviation / maxTolerance);
    const scoreNorm = 0.7 * rawAccuracy + 0.3 * fit.r2;
    const accuracy = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    const { score, scaleMultiplier } = DeviationCalculator.calculateFinalScore(
      accuracy,
      fit,
      baseScoreScale
    );

    return {
      fittedSine: fit,
      deviations,
      meanDeviation: meanAbsDeviation,
      maxDeviation: maxDist,
      rmse,
      accuracy,
      score,
      scaleMultiplier,
    };
  }
}
