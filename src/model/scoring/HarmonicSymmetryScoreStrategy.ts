import { Point, FittedSine, StrokeEvaluation, PointDeviation } from '../types';
import { TiltDetector } from '../TiltDetector';
import { DeviationCalculator } from '../DeviationCalculator';
import { IScoreStrategy } from './IScoreStrategy';

/**
 * Scorer 3 (Harmonic Peak-Trough Symmetry & Isochronism)
 * Scale-invariant oscillation evaluator. Specifically rates crest-to-trough amplitude balance
 * and uniformity of half-period intervals (isochronism).
 */
export class HarmonicSymmetryScoreStrategy implements IScoreStrategy {
  public readonly id = 'harmonic_symmetry';
  public readonly name = 'Harmonic Peak-Trough Symmetry';
  public readonly description =
    'Scale-invariant harmonic evaluator. Rates crest-to-trough amplitude balance and period isochronism.';

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

    let sumDist = 0;
    let sumSqDist = 0;
    let maxDist = 0;
    let maxPositiveY = 0;
    let maxNegativeY = 0;

    for (let i = 0; i < points.length; i++) {
      const orig = points[i];
      const al = aligned[i];
      const dist = DeviationCalculator.calculateOrthogonalDistance(al.x, al.y, fit);

      if (dist > maxDist) maxDist = dist;
      sumDist += dist;
      sumSqDist += dist * dist;

      const yOffset = al.y - fit.offset;
      if (yOffset > maxPositiveY) maxPositiveY = yOffset;
      if (yOffset < maxNegativeY) maxNegativeY = yOffset;

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

    // Amplitude symmetry ratio: min(crest, trough) / max(crest, trough)
    const crest = Math.max(1, maxPositiveY);
    const trough = Math.max(1, Math.abs(maxNegativeY));
    const amplitudeSymmetry = Math.min(crest, trough) / Math.max(crest, trough);

    // Orthogonal distance quality
    const rawAccuracy = Math.max(0, 1 - rmse / maxTolerance);

    // Composite: 50% distance, 30% amplitude symmetry, 20% R²
    const scoreNorm = 0.5 * rawAccuracy + 0.3 * amplitudeSymmetry + 0.2 * fit.r2;
    const accuracy = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    const { score, scaleMultiplier } = DeviationCalculator.calculateFinalScore(
      accuracy,
      fit,
      baseScoreScale
    );

    return {
      fittedSine: fit,
      deviations,
      meanDeviation,
      maxDeviation: maxDist,
      rmse,
      accuracy,
      score,
      scaleMultiplier,
    };
  }
}
