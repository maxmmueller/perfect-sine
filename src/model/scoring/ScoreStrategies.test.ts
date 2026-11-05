import { describe, it, expect } from 'vitest';
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

    it('should deterministically allocate variants based on session ID', () => {
      const manager = new ScoreStrategyManager();

      const variantA1 = manager.allocateStrategy('user_session_abc');
      const variantA2 = manager.allocateStrategy('user_session_abc');
      expect(variantA1.id).toBe(variantA2.id);

      // Random allocation without seed
      const randVariant = manager.allocateStrategy();
      expect(randVariant).toHaveProperty('id');
      expect(randVariant).toHaveProperty('name');
    });
  });
});
