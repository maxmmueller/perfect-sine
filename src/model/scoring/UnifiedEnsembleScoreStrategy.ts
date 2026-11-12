import { Point, FittedSine, StrokeEvaluation } from '../types';
import { IScoreStrategy } from './IScoreStrategy';
import { RmseScoreStrategy } from './RmseScoreStrategy';
import { HarmonicSymmetryScoreStrategy } from './HarmonicSymmetryScoreStrategy';
import { CurvatureFlowScoreStrategy } from './CurvatureFlowScoreStrategy';

/**
 * UnifiedEnsembleScoreStrategy (Final Unified Scoring Algorithm)
 * Combines empirical top-3 scoring algorithms into a single weighted score:
 * - 50% RMSE / L2 Quadratic Distance (orthogonal geometric precision)
 * - 30% Harmonic Peak-Trough Symmetry (crest-to-trough balance & isochronism)
 * - 20% Tangent Velocity & Curvature Flow (smoothness & drawing fluidity)
 */
export class UnifiedEnsembleScoreStrategy implements IScoreStrategy {
  public readonly id = 'unified_ensemble';
  public readonly name = 'Unified Harmonic Ensemble';
  public readonly description =
    'Final weighted ensemble: 50% L2 Quadratic Proximity, 30% Peak-Trough Symmetry, and 20% Curvature Flow.';

  public readonly weightL2: number;
  public readonly weightSymmetry: number;
  public readonly weightCurvatureFlow: number;

  private readonly l2Strategy: RmseScoreStrategy;
  private readonly symStrategy: HarmonicSymmetryScoreStrategy;
  private readonly flowStrategy: CurvatureFlowScoreStrategy;

  constructor(
    weightL2: number = 0.50,
    weightSymmetry: number = 0.30,
    weightCurvatureFlow: number = 0.20
  ) {
    const total = weightL2 + weightSymmetry + weightCurvatureFlow;
    const norm = total > 0 ? total : 1.0;
    this.weightL2 = weightL2 / norm;
    this.weightSymmetry = weightSymmetry / norm;
    this.weightCurvatureFlow = weightCurvatureFlow / norm;

    this.l2Strategy = new RmseScoreStrategy();
    this.symStrategy = new HarmonicSymmetryScoreStrategy();
    this.flowStrategy = new CurvatureFlowScoreStrategy();
  }

  public evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30,
    baseScoreScale: number = 1000
  ): StrokeEvaluation {
    if (!points || points.length === 0) {
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

    const evalL2 = this.l2Strategy.evaluate(points, fit, maxTolerance, baseScoreScale);
    const evalSym = this.symStrategy.evaluate(points, fit, maxTolerance, baseScoreScale);
    const evalFlow = this.flowStrategy.evaluate(points, fit, maxTolerance, baseScoreScale);

    const weightedScore = Math.round(
      this.weightL2 * evalL2.score +
      this.weightSymmetry * evalSym.score +
      this.weightCurvatureFlow * evalFlow.score
    );

    const weightedAccuracy = Math.round(
      (this.weightL2 * evalL2.accuracy +
        this.weightSymmetry * evalSym.accuracy +
        this.weightCurvatureFlow * evalFlow.accuracy) * 10
    ) / 10;

    const weightedMeanDeviation = Math.round(
      (this.weightL2 * evalL2.meanDeviation +
        this.weightSymmetry * evalSym.meanDeviation +
        this.weightCurvatureFlow * evalFlow.meanDeviation) * 100
    ) / 100;

    const maxDeviation = Math.max(evalL2.maxDeviation, evalSym.maxDeviation, evalFlow.maxDeviation);

    return {
      fittedSine: fit,
      deviations: evalL2.deviations,
      meanDeviation: weightedMeanDeviation,
      maxDeviation,
      rmse: evalL2.rmse,
      accuracy: weightedAccuracy,
      score: weightedScore,
      scaleMultiplier: evalL2.scaleMultiplier,
    };
  }
}
