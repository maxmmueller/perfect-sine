import { describe, it, expect } from 'vitest';
import { UnifiedEnsembleScoreStrategy } from './UnifiedEnsembleScoreStrategy';
import { RmseScoreStrategy } from './RmseScoreStrategy';
import { HarmonicSymmetryScoreStrategy } from './HarmonicSymmetryScoreStrategy';
import { CurvatureFlowScoreStrategy } from './CurvatureFlowScoreStrategy';
import { DemoBot } from '../DemoBot';
import { SineFitter } from '../SineFitter';
import { Point } from '../types';

describe('UnifiedEnsembleScoreStrategy (Final Weighted Top-3 Scorer)', () => {
  const pristinePoints = DemoBot.generateStroke({
    amplitude: 50,
    wavelength: 200,
    cycles: 1.5,
    jitterLevel: 0,
    stepPx: 2,
  });
  const fit = SineFitter.fit(pristinePoints)!;

  it('should initialize with canonical weights (50% L2, 30% Symmetry, 20% Flow)', () => {
    const ensemble = new UnifiedEnsembleScoreStrategy();
    expect(ensemble.id).toBe('unified_ensemble');
    expect(ensemble.weightL2).toBeCloseTo(0.50, 4);
    expect(ensemble.weightSymmetry).toBeCloseTo(0.30, 4);
    expect(ensemble.weightCurvatureFlow).toBeCloseTo(0.20, 4);
  });

  it('should normalize custom weights accurately', () => {
    const custom = new UnifiedEnsembleScoreStrategy(60, 20, 20);
    expect(custom.weightL2).toBeCloseTo(0.60, 4);
    expect(custom.weightSymmetry).toBeCloseTo(0.20, 4);
    expect(custom.weightCurvatureFlow).toBeCloseTo(0.20, 4);

    const degenerate = new UnifiedEnsembleScoreStrategy(0, 0, 0);
    expect(degenerate.weightL2).toBe(0);
  });

  it('should handle boundary case: empty points array', () => {
    const ensemble = new UnifiedEnsembleScoreStrategy();
    const result = ensemble.evaluate([], fit);
    expect(result.score).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.deviations).toHaveLength(0);
  });

  it('should evaluate a pristine wave with high accuracy >= 95% and high score >= 900', () => {
    const ensemble = new UnifiedEnsembleScoreStrategy();
    const result = ensemble.evaluate(pristinePoints, fit);

    expect(result.accuracy).toBeGreaterThanOrEqual(95);
    expect(result.score).toBeGreaterThanOrEqual(900);
    expect(result.fittedSine).toBe(fit);
    expect(result.deviations.length).toBeGreaterThan(0);
  });

  it('should compute exact weighted score and accuracy matching the linear combination of top 3', () => {
    const l2 = new RmseScoreStrategy();
    const sym = new HarmonicSymmetryScoreStrategy();
    const flow = new CurvatureFlowScoreStrategy();
    const ensemble = new UnifiedEnsembleScoreStrategy();

    const evalL2 = l2.evaluate(pristinePoints, fit);
    const evalSym = sym.evaluate(pristinePoints, fit);
    const evalFlow = flow.evaluate(pristinePoints, fit);
    const evalEnsemble = ensemble.evaluate(pristinePoints, fit);

    const expectedScore = Math.round(
      0.50 * evalL2.score + 0.30 * evalSym.score + 0.20 * evalFlow.score
    );
    const expectedAccuracy = Math.round(
      (0.50 * evalL2.accuracy + 0.30 * evalSym.accuracy + 0.20 * evalFlow.accuracy) * 10
    ) / 10;

    expect(evalEnsemble.score).toBe(expectedScore);
    expect(evalEnsemble.accuracy).toBe(expectedAccuracy);
  });

  it('should reflect asymmetry penalties in the composite score', () => {
    // Generate an asymmetric wave with crest amplitude 70px and trough amplitude 20px
    const asymmetricPoints: Point[] = [];
    const L = 200;
    for (let x = 0; x <= 300; x += 3) {
      const angle = (x / L) * 2 * Math.PI;
      const rawSin = Math.sin(angle);
      const yVal = rawSin >= 0 ? 70 * rawSin : 20 * rawSin;
      asymmetricPoints.push({ x, y: 150 + yVal });
    }
    const asymFit = SineFitter.fit(asymmetricPoints)!;

    const l2 = new RmseScoreStrategy();
    const ensemble = new UnifiedEnsembleScoreStrategy();

    const evalL2 = l2.evaluate(asymmetricPoints, asymFit);
    const evalEnsemble = ensemble.evaluate(asymmetricPoints, asymFit);

    // Because Symmetry penalizes amplitude imbalance, ensemble score is lower than pure L2
    expect(evalEnsemble.score).toBeLessThanOrEqual(evalL2.score);
  });
});
