import { IScoreStrategy } from './IScoreStrategy';
import { RmseScoreStrategy } from './RmseScoreStrategy';
import { AreaDeviationScoreStrategy } from './AreaDeviationScoreStrategy';
import { HarmonicSymmetryScoreStrategy } from './HarmonicSymmetryScoreStrategy';
import { CurvatureFlowScoreStrategy } from './CurvatureFlowScoreStrategy';
import { ChebyshevStrictScoreStrategy } from './ChebyshevStrictScoreStrategy';
import { Point, FittedSine, StrokeEvaluation } from '../types';
import { IStorageAdapter, MemoryStorageAdapter } from '../SessionHistoryService';

export interface ScorerEvaluationItem {
  readonly strategy: IScoreStrategy;
  readonly evaluation: StrokeEvaluation;
}

export interface ScorerVoteSummary {
  readonly totalVotes: number;
  readonly votesPerStrategy: Record<string, number>;
  readonly percentages: Record<string, number>;
  readonly leadingStrategyId: string | null;
}

/**
 * ScoreStrategyManager
 * Manages registry of pluggable scoring strategies, deterministic A/B/n multi-variant allocation,
 * simultaneous multi-strategy evaluation, and empirical user preference voting persistence.
 */
export class ScoreStrategyManager {
  private static readonly STORAGE_KEY = 'perfect_sine_ab_scorer_votes_v1';
  private readonly strategies = new Map<string, IScoreStrategy>();
  private readonly storage: IStorageAdapter;
  private readonly voteListeners = new Set<(summary: ScorerVoteSummary) => void>();
  private votes: Record<string, number> = {};
  private activeStrategyId: string;

  constructor(defaultStrategyId: string = 'rmse_l2', storageAdapter?: IStorageAdapter) {
    this.storage = storageAdapter ?? this.createDefaultStorage();

    // Register the 5 canonical algorithms
    this.register(new RmseScoreStrategy());
    this.register(new AreaDeviationScoreStrategy());
    this.register(new HarmonicSymmetryScoreStrategy());
    this.register(new CurvatureFlowScoreStrategy());
    this.register(new ChebyshevStrictScoreStrategy());

    this.activeStrategyId = this.strategies.has(defaultStrategyId)
      ? defaultStrategyId
      : 'rmse_l2';

    this.loadVotes();
  }

  private createDefaultStorage(): IStorageAdapter {
    if (typeof window !== 'undefined' && window.localStorage) {
      return {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
        removeItem: (k) => window.localStorage.removeItem(k),
      };
    }
    return new MemoryStorageAdapter();
  }

  private loadVotes(): void {
    try {
      const raw = this.storage.getItem(ScoreStrategyManager.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.votes = parsed;
        }
      }
    } catch {
      this.votes = {};
    }
  }

  private saveVotes(): void {
    try {
      this.storage.setItem(ScoreStrategyManager.STORAGE_KEY, JSON.stringify(this.votes));
    } catch {
      // quota or security error ignored gracefully
    }
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
   * Evaluates a completed sine curve with ALL registered strategies simultaneously.
   * Enables immediate side-by-side comparative inspection for empirical A/B evaluation.
   */
  public evaluateAll(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30,
    baseScoreScale: number = 1000
  ): ScorerEvaluationItem[] {
    return this.getAllStrategies().map((strategy) => ({
      strategy,
      evaluation: strategy.evaluate(points, fit, maxTolerance, baseScoreScale),
    }));
  }

  /**
   * Records a user preference vote for the designated scoring algorithm.
   */
  public recordVote(strategyId: string): ScorerVoteSummary {
    if (!this.strategies.has(strategyId)) {
      throw new Error(`Cannot vote for unknown strategy: ${strategyId}`);
    }
    this.votes[strategyId] = (this.votes[strategyId] ?? 0) + 1;
    this.saveVotes();
    const summary = this.getVoteSummary();
    this.notifyVoteListeners(summary);
    return summary;
  }

  /**
   * Computes aggregate vote metrics, percentages, and identifies the currently leading strategy.
   */
  public getVoteSummary(): ScorerVoteSummary {
    let totalVotes = 0;
    const votesPerStrategy: Record<string, number> = {};
    const percentages: Record<string, number> = {};

    for (const strategy of this.getAllStrategies()) {
      const count = this.votes[strategy.id] ?? 0;
      votesPerStrategy[strategy.id] = count;
      totalVotes += count;
    }

    let maxVotes = 0;
    let leadingStrategyId: string | null = null;

    for (const strategy of this.getAllStrategies()) {
      const count = votesPerStrategy[strategy.id];
      percentages[strategy.id] =
        totalVotes > 0 ? Math.round((count / totalVotes) * 1000) / 10 : 0;
      if (count > maxVotes) {
        maxVotes = count;
        leadingStrategyId = strategy.id;
      }
    }

    return {
      totalVotes,
      votesPerStrategy,
      percentages,
      leadingStrategyId,
    };
  }

  public clearVotes(): void {
    this.votes = {};
    try {
      this.storage.removeItem(ScoreStrategyManager.STORAGE_KEY);
    } catch {
      // safe fallback
    }
    this.notifyVoteListeners(this.getVoteSummary());
  }

  public subscribeVotes(listener: (summary: ScorerVoteSummary) => void): () => void {
    this.voteListeners.add(listener);
    return () => {
      this.voteListeners.delete(listener);
    };
  }

  private notifyVoteListeners(summary: ScorerVoteSummary): void {
    this.voteListeners.forEach((listener) => {
      try {
        listener(summary);
      } catch {
        // ignore subscriber errors
      }
    });
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
