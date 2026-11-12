import { Point, FittedSine, StrokeEvaluation } from '../types';
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
        scaleMultiplier: 0,
      };
    }

    const { effectiveTolerance, deviations, meanDeviation, maxDeviation, rmse } =
      DeviationCalculator.analyzeStroke(points, fit, maxTolerance);

    // Chebyshev L-infinity penalty scaled proportionally to wave size
    const chebyshevAccuracy = Math.max(0, 1 - maxDeviation / effectiveTolerance);
    const rmseAccuracy = Math.max(0, 1 - rmse / effectiveTolerance);

    // 60% worst-case deviation, 25% RMSE, 15% R²
    const scoreNorm = 0.6 * chebyshevAccuracy + 0.25 * rmseAccuracy + 0.15 * fit.r2;
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
