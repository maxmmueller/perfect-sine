import { describe, it, expect } from 'vitest';
import { DeviationCalculator } from './DeviationCalculator';
import { FittedSine, Point } from './types';

describe('DeviationCalculator (Orthogonal Distance, HSL Gradient & Scoring)', () => {
  const dummyFit: FittedSine = {
    amplitude: 40,
    frequency: (2 * Math.PI) / 200, // Period 200px
    phase: 0,
    offset: 0,
    tilt: {
      angle: 0,
      centroid: { x: 0, y: 0 },
    },
    period: 200,
    fullCycles: 1,
    r2: 1.0,
  };

  it('should return 0 orthogonal distance for a point lying on the curve', () => {
    // At u = 0, f(0) = 40 * sin(0) = 0
    const distZero = DeviationCalculator.calculateOrthogonalDistance(0, 0, dummyFit);
    expect(distZero).toBeCloseTo(0, 2);

    // At u = 50 (quarter period), f(50) = 40 * sin(PI/2) = 40
    const distPeak = DeviationCalculator.calculateOrthogonalDistance(50, 40, dummyFit);
    expect(distPeak).toBeCloseTo(0, 2);
  });

  it('should calculate accurate distance at peak for perpendicular displacement', () => {
    // Peak is at (50, 40). Displacement to (50, 55) has vertical delta 15px.
    // At local maximum, tangent is horizontal, so perpendicular distance is exactly 15px.
    const dist = DeviationCalculator.calculateOrthogonalDistance(50, 55, dummyFit);
    expect(dist).toBeCloseTo(15, 1);
  });

  it('should correctly map distances to HSL green-yellow-red gradient', () => {
    // Zero error -> Green (120°)
    const green = DeviationCalculator.mapDistanceToColor(0, 25);
    expect(green.hue).toBe(120);
    expect(green.normalizedError).toBe(0);
    expect(green.color).toBe('hsl(120, 100%, 50%)');

    // Half tolerance (12.5px) -> Yellow (60°)
    const yellow = DeviationCalculator.mapDistanceToColor(12.5, 25);
    expect(yellow.hue).toBe(60);
    expect(yellow.normalizedError).toBe(0.5);
    expect(yellow.color).toBe('hsl(60, 100%, 50%)');

    // Max tolerance (25px) -> Red (0°)
    const red = DeviationCalculator.mapDistanceToColor(25, 25);
    expect(red.hue).toBe(0);
    expect(red.normalizedError).toBe(1);
    expect(red.color).toBe('hsl(0, 100%, 50%)');

    // Beyond max tolerance (>25px) -> Clamped to Red (0°)
    const clampedRed = DeviationCalculator.mapDistanceToColor(40, 25);
    expect(clampedRed.hue).toBe(0);
    expect(clampedRed.normalizedError).toBe(1);

    // Negative distance boundary -> Safe clamped to Green
    const safeGreen = DeviationCalculator.mapDistanceToColor(-5, 25);
    expect(safeGreen.hue).toBe(120);
    expect(safeGreen.normalizedError).toBe(0);
  });

  it('should return empty evaluation for empty points array', () => {
    const res = DeviationCalculator.evaluate([], dummyFit);
    expect(res.deviations).toEqual([]);
    expect(res.score).toBe(0);
    expect(res.meanDeviation).toBe(0);
    expect(res.rmse).toBe(0);
  });

  it('should evaluate a perfect stroke with high score and green hues', () => {
    const points: Point[] = [];
    for (let x = 0; x <= 200; x += 10) {
      points.push({ x, y: 40 * Math.sin((x / 200) * 2 * Math.PI) });
    }

    const evalRes = DeviationCalculator.evaluate(points, dummyFit, 25);
    expect(evalRes.accuracy).toBeGreaterThanOrEqual(98);
    expect(evalRes.score).toBeGreaterThanOrEqual(950);
    expect(evalRes.rmse).toBeLessThan(0.5);
    expect(evalRes.deviations.length).toBe(points.length);
    for (const dev of evalRes.deviations) {
      expect(dev.hue).toBeGreaterThanOrEqual(118);
    }
  });

  it('should evaluate a severely deviated stroke with low score and red hues', () => {
    const points: Point[] = [];
    // Stroke shifted by 30px off the curve (exceeding 25px tolerance)
    for (let x = 0; x <= 200; x += 10) {
      points.push({ x, y: 40 * Math.sin((x / 200) * 2 * Math.PI) + 30 });
    }

    const evalRes = DeviationCalculator.evaluate(points, dummyFit, 25);
    expect(evalRes.accuracy).toBeLessThanOrEqual(40);
    expect(evalRes.score).toBeLessThanOrEqual(150);
    expect(evalRes.rmse).toBeGreaterThanOrEqual(20);
    expect(evalRes.maxDeviation).toBeGreaterThanOrEqual(25);
  });

  it('should weight accuracy significantly stronger than period count (5x strength)', () => {
    const points: Point[] = [{ x: 0, y: 0 }];
    const fit1Cycle: FittedSine = { ...dummyFit, fullCycles: 1.0 };
    const fit4Cycles: FittedSine = { ...dummyFit, fullCycles: 4.0 };

    const res1 = DeviationCalculator.evaluate(points, fit1Cycle, 25);
    const res4 = DeviationCalculator.evaluate(points, fit4Cycles, 25);

    expect(res4.accuracy).toBe(res1.accuracy);
    // sqrt(4) = 2.0 -> score should be double for 4x cycles
    expect(res4.score).toBeCloseTo(res1.score * 2.0, -1);
  });

  it('should mark anti-phase wave points as red even if intersecting', () => {
    // Reference has positive peak at x=50 (y=+40).
    // Drawn wave is inverted: negative peak at x=50 (y=-40).
    const points: Point[] = [];
    for (let x = 0; x <= 200; x += 10) {
      points.push({ x, y: -40 * Math.sin((x / 200) * 2 * Math.PI) });
    }

    const evalRes = DeviationCalculator.evaluate(points, dummyFit, 25);
    // Anti-phase points at peaks have ~80px vertical difference -> pure Red
    const peakPointDev = evalRes.deviations.find((d) => d.point.x === 50);
    expect(peakPointDev).toBeDefined();
    expect(peakPointDev?.hue).toBe(0);
    expect(peakPointDev?.color).toBe('hsl(0, 100%, 50%)');
  });

  describe('Spatial Scale Multiplier & Effective Tolerance', () => {
    it('returns exact 1.0 multiplier for canonical 40px × 200px wave and clamps extremes', () => {
      expect(DeviationCalculator.calculateScaleMultiplier(dummyFit)).toBe(1.0);

      // Tiny wave (20px amp, 70px period) receives strongly reduced multiplier
      const tinyFit: FittedSine = { ...dummyFit, amplitude: 20, period: 70 };
      expect(DeviationCalculator.calculateScaleMultiplier(tinyFit)).toBeCloseTo(0.309, 2);

      // Sub-minimum degenerate size clamps safely at MIN_SCALE_MULTIPLIER (0.2)
      const microFit: FittedSine = { ...dummyFit, amplitude: 1, period: 10 };
      expect(DeviationCalculator.calculateScaleMultiplier(microFit)).toBe(0.2);

      // Large wave (72px amp, 300px period) earns substantial bonus below cap
      const largeFit: FittedSine = { ...dummyFit, amplitude: 72, period: 300 };
      expect(DeviationCalculator.calculateScaleMultiplier(largeFit)).toBeCloseTo(1.957, 2);

      // Extreme giant wave clamps safely at MAX_SCALE_MULTIPLIER (2.5)
      const hugeFit: FittedSine = { ...dummyFit, amplitude: 300, period: 900 };
      expect(DeviationCalculator.calculateScaleMultiplier(hugeFit)).toBe(2.5);

      // Negative amplitude uses absolute magnitude
      const negFit: FittedSine = { ...dummyFit, amplitude: -40, period: 200 };
      expect(DeviationCalculator.calculateScaleMultiplier(negFit)).toBe(1.0);
    });

    it('scales effective orthogonal tolerance proportionally within [0.55, 1.85] bounds', () => {
      expect(DeviationCalculator.calculateEffectiveTolerance(dummyFit, 30)).toBe(30);

      const tinyFit: FittedSine = { ...dummyFit, amplitude: 20, period: 70 };
      expect(DeviationCalculator.calculateEffectiveTolerance(tinyFit, 30)).toBeCloseTo(16.5, 2);

      const largeFit: FittedSine = { ...dummyFit, amplitude: 72, period: 300 };
      expect(DeviationCalculator.calculateEffectiveTolerance(largeFit, 30)).toBeCloseTo(43.53, 1);

      const hugeFit: FittedSine = { ...dummyFit, amplitude: 300, period: 900 };
      expect(DeviationCalculator.calculateEffectiveTolerance(hugeFit, 30)).toBeCloseTo(55.5, 2);
    });

    it('awards significantly higher score to a larger 1-period wave than a tiny 1-period wave', () => {
      const tinyFit: FittedSine = {
        ...dummyFit,
        amplitude: 22,
        frequency: (2 * Math.PI) / 80,
        period: 80,
        fullCycles: 1.0,
      };
      const tinyPoints: Point[] = [];
      for (let x = 0; x <= 80; x += 4) {
        tinyPoints.push({ x, y: 22 * Math.sin((x / 80) * 2 * Math.PI) });
      }

      const largeFit: FittedSine = {
        ...dummyFit,
        amplitude: 90,
        frequency: (2 * Math.PI) / 360,
        period: 360,
        fullCycles: 1.0,
      };
      const largePoints: Point[] = [];
      for (let x = 0; x <= 360; x += 6) {
        // Add 3px minor tremor so large wave even has slight pixel error while remaining clean
        largePoints.push({ x, y: 90 * Math.sin((x / 360) * 2 * Math.PI) + (x % 12 === 0 ? 3 : -3) });
      }

      const tinyEval = DeviationCalculator.evaluate(tinyPoints, tinyFit, 30);
      const largeEval = DeviationCalculator.evaluate(largePoints, largeFit, 30);

      expect(tinyEval.scaleMultiplier).toBeLessThan(0.4);
      expect(largeEval.scaleMultiplier).toBe(2.5);
      expect(largeEval.score).toBeGreaterThan(tinyEval.score * 2);
    });

    it('does not invert scores when a taller wave has realistic hand tremor vs a crisp small wave', () => {
      const smallFit: FittedSine = {
        ...dummyFit,
        amplitude: 35,
        frequency: (2 * Math.PI) / 180,
        period: 180,
        fullCycles: 1.0,
      };
      const smallPoints: Point[] = [];
      for (let x = 0; x <= 180; x += 4) {
        smallPoints.push({ x, y: 35 * Math.sin((x / 180) * 2 * Math.PI) + (x % 8 === 0 ? 1 : -1) });
      }

      const tallFit: FittedSine = {
        ...dummyFit,
        amplitude: 90,
        frequency: (2 * Math.PI) / 180,
        period: 180,
        fullCycles: 1.0,
      };
      const tallPoints: Point[] = [];
      for (let x = 0; x <= 180; x += 4) {
        tallPoints.push({ x, y: 90 * Math.sin((x / 180) * 2 * Math.PI) + (x % 8 === 0 ? 3.5 : -3.5) });
      }

      const smallEval = DeviationCalculator.evaluate(smallPoints, smallFit, 30);
      const tallEval = DeviationCalculator.evaluate(tallPoints, tallFit, 30);

      expect(tallEval.score).toBeGreaterThan(smallEval.score);
    });
  });
});

