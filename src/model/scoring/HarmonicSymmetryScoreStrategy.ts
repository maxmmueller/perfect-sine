import { Point, FittedSine, StrokeEvaluation } from '../types';
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

    const { effectiveTolerance, aligned, deviations, meanDeviation, maxDeviation, rmse } =
      DeviationCalculator.analyzeStroke(points, fit, maxTolerance);

    let maxPositiveY = 0;
    let maxNegativeY = 0;
    for (const al of aligned) {
      const yOffset = al.y - fit.offset;
      if (yOffset > maxPositiveY) maxPositiveY = yOffset;
      if (yOffset < maxNegativeY) maxNegativeY = yOffset;
    }

    // Amplitude symmetry ratio: min(crest, trough) / max(crest, trough)
    const crest = Math.max(1, maxPositiveY);
    const trough = Math.max(1, Math.abs(maxNegativeY));
    const amplitudeSymmetry = Math.min(crest, trough) / Math.max(crest, trough);

    // Scale-normalized orthogonal distance quality
    const rawAccuracy = Math.max(0, 1 - rmse / effectiveTolerance);

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
      maxDeviation,
      rmse,
      accuracy,
      score,
      scaleMultiplier,
    };
  }
}
