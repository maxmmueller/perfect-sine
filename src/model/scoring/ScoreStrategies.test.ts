import { describe, it, expect, vi } from 'vitest';
import { RmseScoreStrategy } from './RmseScoreStrategy';
import { AreaDeviationScoreStrategy } from './AreaDeviationScoreStrategy';
import { HarmonicSymmetryScoreStrategy } from './HarmonicSymmetryScoreStrategy';
import { CurvatureFlowScoreStrategy } from './CurvatureFlowScoreStrategy';
import { ChebyshevStrictScoreStrategy } from './ChebyshevStrictScoreStrategy';
import { ScoreStrategyManager } from './ScoreStrategyManager';
import { DemoBot } from '../DemoBot';
import { SineFitter } from '../SineFitter';
import { FittedSine, Point } from '../types';

describe('Pluggable Scoring Strategies (A/B/n Multi-Variant Testing - US07)', () => {
  const pristinePoints = DemoBot.generateStroke({
    amplitude: 50,
    wavelength: 200,
    cycles: 1.5,
    jitterLevel: 0,
    stepPx: 2,
  });

  const fit = SineFitter.fit(pristinePoints)!;

  describe('5 Distinct Scorer Implementations', () => {
    const s1 = new RmseScoreStrategy();
    const s2 = new AreaDeviationScoreStrategy();
    const s3 = new HarmonicSymmetryScoreStrategy();
    const s4 = new CurvatureFlowScoreStrategy();
    const s5 = new ChebyshevStrictScoreStrategy();

    it('should evaluate pristine wave with high accuracy across all 5 strategies', () => {
      [s1, s2, s3, s4, s5].forEach((strategy) => {
        const evalResult = strategy.evaluate(pristinePoints, fit);
        expect(evalResult.accuracy).toBeGreaterThanOrEqual(90);
        expect(evalResult.score).toBeGreaterThan(0);
        expect(evalResult.deviations.length).toBe(pristinePoints.length);
      });
    });

    it('should handle boundary case: empty points array for all strategies', () => {
      [s1, s2, s3, s4, s5].forEach((strategy) => {
        const evalResult = strategy.evaluate([], fit);
        expect(evalResult.accuracy).toBe(0);
        expect(evalResult.score).toBe(0);
        expect(evalResult.deviations).toHaveLength(0);
      });
    });

    it('Scorer 5 (Chebyshev) should penalize an isolated spike much more severely than Scorer 2 (Area)', () => {
      // Create a wave with 1 isolated spike in the middle
      const spikedPoints: Point[] = pristinePoints.map((p, i) => {
        if (i === Math.floor(pristinePoints.length / 2)) {
          return { x: p.x, y: p.y + 40 }; // sharp 40px spike
        }
        return p;
      });

      const areaEval = s2.evaluate(spikedPoints, fit);
      const chebEval = s5.evaluate(spikedPoints, fit);

      // Area is forgiving of single point outlier; Chebyshev strictly punishes max deviation
      expect(areaEval.accuracy).toBeGreaterThan(chebEval.accuracy);
    });

    it('Scorer 3 (Harmonic Symmetry) should penalize asymmetric peak vs trough amplitudes', () => {
      // Create wave where positive half-cycles have amplitude 60 but negative have only 15
      const asymPoints: Point[] = [];
      const L = 200;
      for (let x = 0; x <= 300; x += 3) {
        const rad = (x / L) * 2 * Math.PI;
        const sinVal = Math.sin(rad);
        const y = sinVal >= 0 ? 300 + 60 * sinVal : 300 + 15 * sinVal;
        asymPoints.push({ x, y });
      }

      const asymFit: FittedSine = {
        ...fit,
        amplitude: 37.5,
        offset: 300,
      };

      const symEval = s3.evaluate(asymPoints, asymFit);
      expect(symEval.accuracy).toBeLessThan(90);
    });

    it('Scorer 4 (Curvature Flow) should penalize erratic or backward velocity direction', () => {
      // Create jagged zigzag points
      const jaggedPoints: Point[] = [];
      for (let i = 0; i < 50; i++) {
        jaggedPoints.push({
          x: i * 4,
          y: 200 + (i % 2 === 0 ? 30 : -30),
        });
      }

      const flowEval = s4.evaluate(jaggedPoints, fit);
      expect(flowEval.accuracy).toBeLessThan(70);
    });
  });

  describe('ScoreStrategyManager (Registry & A/B/n Allocation)', () => {
    it('should register all 5 canonical strategies upon creation', () => {
      const manager = new ScoreStrategyManager();
      const all = manager.getAllStrategies();
      expect(all).toHaveLength(5);

      const ids = all.map((s) => s.id);
      expect(ids).toContain('rmse_l2');
      expect(ids).toContain('area_l1');
      expect(ids).toContain('harmonic_symmetry');
      expect(ids).toContain('curvature_flow');
      expect(ids).toContain('chebyshev_linf');
    });

    it('should return active strategy and allow manual switching', () => {
      const manager = new ScoreStrategyManager();
      expect(manager.getActiveStrategy().id).toBe('rmse_l2');

      const switched = manager.setActiveStrategy('chebyshev_linf');
      expect(switched).toBe(true);
      expect(manager.getActiveStrategy().id).toBe('chebyshev_linf');

      const invalid = manager.setActiveStrategy('unknown_id');
      expect(invalid).toBe(false);
      expect(manager.getActiveStrategy().id).toBe('chebyshev_linf');
    });

    it('should fall back to default strategy for unknown ID lookup', () => {
      const manager = new ScoreStrategyManager();
      expect(manager.getStrategy('non_existent').id).toBe('rmse_l2');
    });

    it('should evaluate a curve across all 5 strategies simultaneously via evaluateAll()', () => {
      const manager = new ScoreStrategyManager();
      const results = manager.evaluateAll(pristinePoints, fit);
      expect(results).toHaveLength(5);
      results.forEach((item) => {
        expect(item.strategy).toBeDefined();
        expect(item.evaluation.accuracy).toBeGreaterThan(0);
        expect(item.evaluation.score).toBeGreaterThan(0);
      });
    });

    it('should record votes, calculate percentages, and identify leading strategy', () => {
      const manager = new ScoreStrategyManager('rmse_l2');
      manager.clearVotes();

      expect(manager.getVoteSummary().totalVotes).toBe(0);
      expect(manager.getVoteSummary().leadingStrategyId).toBeNull();

      manager.recordVote('rmse_l2');
      manager.recordVote('rmse_l2');
      manager.recordVote('harmonic_symmetry');

      const summary = manager.getVoteSummary();
      expect(summary.totalVotes).toBe(3);
      expect(summary.votesPerStrategy['rmse_l2']).toBe(2);
      expect(summary.votesPerStrategy['harmonic_symmetry']).toBe(1);
      expect(summary.votesPerStrategy['area_l1']).toBe(0);
      expect(summary.percentages['rmse_l2']).toBe(66.7);
      expect(summary.percentages['harmonic_symmetry']).toBe(33.3);
      expect(summary.leadingStrategyId).toBe('rmse_l2');
    });

    it('should throw error when attempting to vote for an unknown strategy ID', () => {
      const manager = new ScoreStrategyManager();
      expect(() => manager.recordVote('invalid_strategy_xyz')).toThrow();
    });

    it('should notify subscribers reactively when votes are recorded or cleared', () => {
      const manager = new ScoreStrategyManager();
      manager.clearVotes();

      let lastTotal = -1;
      const unsubscribe = manager.subscribeVotes((summary) => {
        lastTotal = summary.totalVotes;
      });

      manager.recordVote('area_l1');
      expect(lastTotal).toBe(1);

      manager.clearVotes();
      expect(lastTotal).toBe(0);

      unsubscribe();
      manager.recordVote('area_l1');
      expect(lastTotal).toBe(0); // listener unsubscribed
    });

    it('should handle corrupted or pre-existing storage gracefully upon creation', () => {
      const mockStorage = {
        data: '{"rmse_l2": 5, "invalid": "val"}',
        getItem: vi.fn(() => '{"rmse_l2": 5}'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const manager = new ScoreStrategyManager('rmse_l2', mockStorage);
      expect(manager.getVoteSummary().votesPerStrategy['rmse_l2']).toBe(5);

      const corruptedStorage = {
        getItem: vi.fn(() => 'invalid-json{{{'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const safeManager = new ScoreStrategyManager('rmse_l2', corruptedStorage);
      expect(safeManager.getVoteSummary().totalVotes).toBe(0);
    });

    it('should allocate deterministically or pseudo-randomly', () => {
      const manager = new ScoreStrategyManager();
      const s1 = manager.allocateStrategy('session_seed_1');
      const s2 = manager.allocateStrategy('session_seed_1');
      expect(s1.id).toBe(s2.id);

      const randStrategy = manager.allocateStrategy();
      expect(randStrategy).toBeDefined();
    });
  });
});
