import { Point, FittedSine, StrokeEvaluation } from '../types';
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

    const { effectiveTolerance, deviations, meanDeviation, maxDeviation, rmse } =
      DeviationCalculator.analyzeStroke(points, fit, maxTolerance);

    // L1 accuracy uses linear scale-normalized error penalty rather than quadratic penalty
    const rawAccuracy = Math.max(0, 1 - meanDeviation / effectiveTolerance);
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
      meanDeviation,
      maxDeviation,
      rmse,
      accuracy,
      score,
      scaleMultiplier,
    };
  }
}
