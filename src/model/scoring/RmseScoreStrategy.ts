import { Point, FittedSine, StrokeEvaluation } from '../types';
import { DeviationCalculator } from '../DeviationCalculator';
import { IScoreStrategy } from './IScoreStrategy';

/**
 * Scorer 1 (RMSE / L2 Quadratic Distance)
 * Evaluates quadratic mean orthogonal deviations. Strongly penalizes isolated jerky hand twitches.
 */
export class RmseScoreStrategy implements IScoreStrategy {
  public readonly id = 'rmse_l2';
  public readonly name = 'RMSE / L2 Quadratic Distance';
  public readonly description =
    'Standard quadratic mean orthogonal distance. Strongly penalizes isolated outliers and hand jerks.';

  public evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30,
    baseScoreScale: number = 1000
  ): StrokeEvaluation {
    return DeviationCalculator.evaluate(points, fit, maxTolerance, baseScoreScale);
  }
}
