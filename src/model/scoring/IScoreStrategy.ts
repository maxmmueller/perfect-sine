import { Point, FittedSine, StrokeEvaluation } from '../types';

/**
 * Common GoF Strategy interface for pluggable sine wave score calculation algorithms.
 */
export interface IScoreStrategy {
  /** Unique machine identifier (e.g. 'rmse_l2', 'area_l1'). */
  readonly id: string;
  /** Human-readable strategy name. */
  readonly name: string;
  /** Concise description of mathematical characteristics and weighting. */
  readonly description: string;

  /**
   * Evaluates the drawn stroke against the fitted sine wave.
   *
   * @param points Raw sampled stroke points.
   * @param fit Fitted reference sine wave parameters.
   * @param maxTolerance Baseline orthogonal error threshold in pixels.
   * @param baseScoreScale Base score factor for 100% accuracy and 1 cycle.
   */
  evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance?: number,
    baseScoreScale?: number
  ): StrokeEvaluation;
}
