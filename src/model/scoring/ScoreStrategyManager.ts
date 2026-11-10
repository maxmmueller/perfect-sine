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

export interface ScorerRankingSummary {
  readonly totalRankings: number;
  readonly bordaScore: Record<string, number>;
  readonly averageRank: Record<string, number>;
  readonly rankCounts: Record<string, number[]>; // [count1st, count2nd, count3rd, count4th, count5th]
  readonly leadingStrategyId: string | null;

  // Backward compatibility with ScorerVoteSummary
  readonly totalVotes: number;
  readonly votesPerStrategy: Record<string, number>;
  readonly percentages: Record<string, number>;
}

export type ScorerVoteSummary = ScorerRankingSummary;

/**
 * ScoreStrategyManager
 * Manages registry of pluggable scoring strategies, deterministic A/B/n multi-variant allocation,
 * simultaneous multi-strategy evaluation, and empirical user preference ranking persistence (Borda Count).
 */
export class ScoreStrategyManager {
  private static readonly STORAGE_KEY = 'perfect_sine_ab_scorer_votes_v1';
  private readonly strategies = new Map<string, IScoreStrategy>();
  private readonly storage: IStorageAdapter;
  private readonly voteListeners = new Set<(summary: ScorerRankingSummary) => void>();
  private totalRankings: number = 0;
  private rankCounts: Record<string, number[]> = {};
  private userRankingOrder: string[] = [];
  private activeStrategyId: string;

  constructor(defaultStrategyId: string = 'rmse_l2', storageAdapter?: IStorageAdapter) {
    this.storage = storageAdapter ?? this.createDefaultStorage();

    // Register the 5 canonical experimental algorithms
    this.register(new RmseScoreStrategy());
    this.register(new AreaDeviationScoreStrategy());
    this.register(new HarmonicSymmetryScoreStrategy());
    this.register(new CurvatureFlowScoreStrategy());
    this.register(new ChebyshevStrictScoreStrategy());

    this.activeStrategyId = this.strategies.has(defaultStrategyId)
      ? defaultStrategyId
      : 'rmse_l2';

    this.userRankingOrder = this.getAllStrategies().map((s) => s.id);
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
          if (parsed.rankCounts && typeof parsed.rankCounts === 'object') {
            this.rankCounts = parsed.rankCounts;
            this.totalRankings = parsed.totalRankings ?? 0;
            if (Array.isArray(parsed.userOrder) && parsed.userOrder.length === this.strategies.size) {
              this.userRankingOrder = parsed.userOrder;
            }
          } else {
            // Legacy simple vote count migration: Record<string, number>
            this.totalRankings = 0;
            this.rankCounts = {};
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === 'number' && this.strategies.has(k)) {
                this.rankCounts[k] = [v, 0, 0, 0, 0];
                this.totalRankings += v;
              }
            }
          }
        }
      }
    } catch {
      this.totalRankings = 0;
      this.rankCounts = {};
    }

    if (this.userRankingOrder.length !== this.strategies.size) {
      this.userRankingOrder = this.getAllStrategies().map((s) => s.id);
    }
  }

  private saveVotes(): void {
    try {
      this.storage.setItem(
        ScoreStrategyManager.STORAGE_KEY,
        JSON.stringify({
          totalRankings: this.totalRankings,
          rankCounts: this.rankCounts,
          userOrder: this.userRankingOrder,
        })
      );
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

  public getUserRankingOrder(): readonly string[] {
    return this.userRankingOrder;
  }

  public setUserRankingOrder(order: readonly string[]): void {
    const valid = order.filter((id) => this.strategies.has(id));
    if (valid.length === this.strategies.size) {
      this.userRankingOrder = [...valid];
      this.saveVotes();
    }
  }

  public moveStrategyRank(fromIndex: number, toIndex: number): readonly string[] {
    if (
      fromIndex < 0 ||
      fromIndex >= this.userRankingOrder.length ||
      toIndex < 0 ||
      toIndex >= this.userRankingOrder.length ||
      fromIndex === toIndex
    ) {
      return this.userRankingOrder;
    }
    const newOrder = [...this.userRankingOrder];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    this.userRankingOrder = newOrder;
    this.saveVotes();
    return this.userRankingOrder;
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
   * Records a complete user preference ranking (positions 1 through 5).
   * Aggregates using Borda Count (Rank 1 = 5 pts, Rank 5 = 1 pt).
   */
  public recordRanking(rankedIds: readonly string[]): ScorerRankingSummary {
    if (!rankedIds || rankedIds.length === 0) {
      throw new Error('Cannot record empty ranking');
    }
    for (const id of rankedIds) {
      if (!this.strategies.has(id)) {
        throw new Error(`Cannot rank unknown strategy: ${id}`);
      }
    }

    this.totalRankings++;

    rankedIds.forEach((id, rankIndex) => {
      if (!this.rankCounts[id]) {
        this.rankCounts[id] = [0, 0, 0, 0, 0];
      }
      if (rankIndex < 5) {
        this.rankCounts[id][rankIndex] = (this.rankCounts[id][rankIndex] ?? 0) + 1;
      }
    });

    this.userRankingOrder = [...rankedIds];
    this.saveVotes();
    const summary = this.getRankingSummary();
    this.notifyVoteListeners(summary);
    return summary;
  }

  /**
   * Records a user preference vote for the designated scoring algorithm.
   */
  public recordVote(strategyId: string): ScorerVoteSummary {
    if (!this.strategies.has(strategyId)) {
      throw new Error(`Cannot vote for unknown strategy: ${strategyId}`);
    }
    const otherStrategies = this.getAllStrategies()
      .map((s) => s.id)
      .filter((id) => id !== strategyId);
    return this.recordRanking([strategyId, ...otherStrategies]);
  }

  /**
   * Computes aggregate ranking metrics, Borda counts, average ranks, and identifies leading strategy.
   */
  public getRankingSummary(): ScorerRankingSummary {
    const bordaScore: Record<string, number> = {};
    const averageRank: Record<string, number> = {};
    const votesPerStrategy: Record<string, number> = {};
    const percentages: Record<string, number> = {};

    let maxBorda = -1;
    let leadingStrategyId: string | null = null;

    for (const strategy of this.getAllStrategies()) {
      const counts = this.rankCounts[strategy.id] ?? [0, 0, 0, 0, 0];
      const firstPlace = counts[0] ?? 0;
      votesPerStrategy[strategy.id] = firstPlace;

      let bScore = 0;
      let rankSum = 0;
      let totalStrategyRankings = 0;

      for (let r = 0; r < 5; r++) {
        const c = counts[r] ?? 0;
        bScore += c * (5 - r);
        rankSum += c * (r + 1);
        totalStrategyRankings += c;
      }

      bordaScore[strategy.id] = bScore;
      averageRank[strategy.id] =
        totalStrategyRankings > 0
          ? Math.round((rankSum / totalStrategyRankings) * 10) / 10
          : 0;

      percentages[strategy.id] =
        this.totalRankings > 0
          ? Math.round((firstPlace / this.totalRankings) * 1000) / 10
          : 0;

      if (bScore > maxBorda && this.totalRankings > 0) {
        maxBorda = bScore;
        leadingStrategyId = strategy.id;
      }
    }

    return {
      totalRankings: this.totalRankings,
      bordaScore,
      averageRank,
      rankCounts: this.rankCounts,
      leadingStrategyId,
      totalVotes: this.totalRankings,
      votesPerStrategy,
      percentages,
    };
  }

  public getVoteSummary(): ScorerVoteSummary {
    return this.getRankingSummary();
  }

  public clearVotes(): void {
    this.totalRankings = 0;
    this.rankCounts = {};
    this.userRankingOrder = this.getAllStrategies().map((s) => s.id);
    try {
      this.storage.removeItem(ScoreStrategyManager.STORAGE_KEY);
    } catch {
      // safe fallback
    }
    this.notifyVoteListeners(this.getRankingSummary());
  }

  public subscribeVotes(listener: (summary: ScorerRankingSummary) => void): () => void {
    this.voteListeners.add(listener);
    return () => {
      this.voteListeners.delete(listener);
    };
  }

  private notifyVoteListeners(summary: ScorerRankingSummary): void {
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
