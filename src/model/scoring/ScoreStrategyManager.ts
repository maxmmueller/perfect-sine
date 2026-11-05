import { IScoreStrategy } from './IScoreStrategy';
import { RmseScoreStrategy } from './RmseScoreStrategy';
import { AreaDeviationScoreStrategy } from './AreaDeviationScoreStrategy';
import { HarmonicSymmetryScoreStrategy } from './HarmonicSymmetryScoreStrategy';
import { CurvatureFlowScoreStrategy } from './CurvatureFlowScoreStrategy';
import { ChebyshevStrictScoreStrategy } from './ChebyshevStrictScoreStrategy';

/**
 * ScoreStrategyManager
 * Manages registry of pluggable scoring strategies, deterministic A/B/n multi-variant allocation,
 * and telemetry tagging for comparative evaluation.
 */
export class ScoreStrategyManager {
  private readonly strategies = new Map<string, IScoreStrategy>();
  private activeStrategyId: string;

  constructor(defaultStrategyId: string = 'rmse_l2') {
    // Register the 5 canonical algorithms
    this.register(new RmseScoreStrategy());
    this.register(new AreaDeviationScoreStrategy());
    this.register(new HarmonicSymmetryScoreStrategy());
    this.register(new CurvatureFlowScoreStrategy());
    this.register(new ChebyshevStrictScoreStrategy());

    this.activeStrategyId = this.strategies.has(defaultStrategyId)
      ? defaultStrategyId
      : 'rmse_l2';
  }

  public register(strategy: IScoreStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  public getStrategy(id: string): IScoreStrategy {
    return this.strategies.get(id) ?? this.strategies.get('rmse_l2')!;
  }

  public getAllStrategies(): readonly IScoreStrategy[] {
    return Array.from(this.strategies.values());
  }

  public getActiveStrategy(): IScoreStrategy {
    return this.getStrategy(this.activeStrategyId);
  }

  public setActiveStrategy(id: string): boolean {
    if (this.strategies.has(id)) {
      this.activeStrategyId = id;
      return true;
    }
    return false;
  }

  /**
   * Deterministically allocates one of the N scoring strategies based on a session ID or seed.
   * If no seed is provided, picks pseudo-randomly.
   */
  public allocateStrategy(sessionId?: string): IScoreStrategy {
    const list = this.getAllStrategies();
    if (list.length === 0) {
      throw new Error('No scoring strategies registered');
    }

    if (!sessionId) {
      const randIdx = Math.floor(Math.random() * list.length);
      this.activeStrategyId = list[randIdx].id;
      return list[randIdx];
    }

    // Simple deterministic hash of sessionId
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = (hash << 5) - hash + sessionId.charCodeAt(i);
      hash |= 0;
    }

    const index = Math.abs(hash) % list.length;
    this.activeStrategyId = list[index].id;
    return list[index];
  }
}
