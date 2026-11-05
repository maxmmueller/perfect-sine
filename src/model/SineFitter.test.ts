import { describe, it, expect } from 'vitest';
import { SineFitter } from './SineFitter';
import { Point } from './types';

describe('SineFitter (Mathematical Regression & Parameter Fitting)', () => {
  it('should return null if points array is null, empty, or has fewer than 8 points', () => {
    expect(SineFitter.fit([])).toBeNull();
    expect(
      SineFitter.fit([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    ).toBeNull();
  });

  it('should fit a synthetic perfect horizontal sine wave with R² >= 0.98', () => {
    // y = 50 * sin(0.0314159 * x + 0.5) + 120
    const trueA = 50;
    const trueOmega = (2 * Math.PI) / 200; // Period 200px
    const truePhi = 0.5;
    const trueC = 120;
    const points: Point[] = [];

    // 2 full cycles (400px)
    for (let x = 0; x <= 400; x += 4) {
      points.push({
        x,
        y: trueA * Math.sin(trueOmega * x + truePhi) + trueC,
      });
    }

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    if (!fit) return;

    expect(fit.r2).toBeGreaterThanOrEqual(0.98);
    expect(Math.abs(fit.amplitude - trueA)).toBeLessThan(2.0);
    expect(fit.frequency).toBeCloseTo(trueOmega, 2);
    expect(Math.abs(fit.fullCycles - 2.0)).toBeLessThan(0.1);
  });

  it('should accurately fit a tilted sine wave rotated by 45 degrees', () => {
    const alpha = Math.PI / 4; // 45 deg
    const cos = Math.cos(alpha);
    const sin = Math.sin(alpha);
    const trueA = 40;
    const trueOmega = (2 * Math.PI) / 150; // Period 150px
    const points: Point[] = [];

    for (let u = 0; u <= 300; u += 3) {
      const v = trueA * Math.sin(trueOmega * u);
      // Rotate by alpha and translate
      const x = 100 + u * cos - v * sin;
      const y = 50 + u * sin + v * cos;
      points.push({ x, y });
    }

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    if (!fit) return;

    expect(fit.r2).toBeGreaterThanOrEqual(0.95);
    expect(Math.abs(fit.fullCycles - 2.0)).toBeLessThan(0.15);
    expect(fit.tilt.angle).toBeCloseTo(alpha, 1);
  });

  it('should robustly fit a noisy sine wave', () => {
    const points: Point[] = [];
    const trueA = 45;
    const trueOmega = (2 * Math.PI) / 250;
    const trueC = 200;

    // Deterministic pseudo-noise using sin harmonic
    for (let x = 0; x <= 500; x += 5) {
      const noise = 4.0 * Math.sin(17 * x);
      points.push({
        x,
        y: trueA * Math.sin(trueOmega * x) + trueC + noise,
      });
    }

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    if (!fit) return;

    expect(fit.r2).toBeGreaterThan(0.90);
    expect(fit.amplitude).toBeCloseTo(trueA, -1);
    expect(fit.fullCycles).toBeCloseTo(2.0, 1);
  });

  it('should compute fullCycles < 1.0 for an incomplete sine wave', () => {
    const points: Point[] = [];
    const trueA = 35;
    const trueOmega = (2 * Math.PI) / 300; // Period is 300px

    // Only draw 150px (half period)
    for (let x = 0; x <= 150; x += 3) {
      points.push({
        x,
        y: trueA * Math.sin(trueOmega * x) + 100,
      });
    }

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    if (!fit) return;

    expect(fit.fullCycles).toBeLessThan(1.0);
  });

  it('should generate reference curve points in canvas coordinates', () => {
    const points: Point[] = [];
    for (let x = 0; x <= 200; x += 4) {
      points.push({ x, y: 30 * Math.sin((x / 200) * 2 * Math.PI) + 100 });
    }

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    if (!fit) return;

    const curve = SineFitter.generateFittedCurve(fit, -100, 100, 10);
    expect(curve.length).toBeGreaterThan(10);
    expect(curve[0]).toHaveProperty('x');
    expect(curve[0]).toHaveProperty('y');
  });

  it('should accurately fit a 5-period wave with baseline drift and hand tremor', () => {
    const W = 900;
    const truePeriods = 5;
    const trueOmega = (truePeriods * 2 * Math.PI) / W;
    const trueA = 100;
    const trueC = 350;
    const points: Point[] = [];

    for (let x = 0; x <= W; x += 4) {
      const drift = 25 * Math.sin((x / W) * Math.PI);
      const tremor = 6 * Math.sin(11 * x);
      points.push({
        x,
        y: trueA * Math.sin(trueOmega * x) + trueC + drift + tremor,
      });
    }

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    if (!fit) return;

    // Must detect ~5 periods, NOT 12 or 13
    expect(fit.fullCycles).toBeGreaterThanOrEqual(4.5);
    expect(fit.fullCycles).toBeLessThanOrEqual(5.5);
    expect(fit.r2).toBeGreaterThanOrEqual(0.85);
  });
});
