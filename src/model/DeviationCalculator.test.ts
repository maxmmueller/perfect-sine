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
    expect(evalRes.score).toBeGreaterThanOrEqual(980);
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
    expect(evalRes.score).toBeLessThanOrEqual(400);
    expect(evalRes.rmse).toBeGreaterThanOrEqual(20);
    expect(evalRes.maxDeviation).toBeGreaterThanOrEqual(25);
  });

  it('should scale gamified score with cycle count (accuracy * cycles * factor)', () => {
    const points: Point[] = [{ x: 0, y: 0 }];
    const fit1Cycle: FittedSine = { ...dummyFit, fullCycles: 1.0 };
    const fit3Cycles: FittedSine = { ...dummyFit, fullCycles: 3.0 };

    const res1 = DeviationCalculator.evaluate(points, fit1Cycle, 25, 10);
    const res3 = DeviationCalculator.evaluate(points, fit3Cycles, 25, 10);

    expect(res3.accuracy).toBe(res1.accuracy);
    expect(res3.score).toBe(res1.score * 3);
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
});

