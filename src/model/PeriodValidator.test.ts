import { describe, it, expect } from 'vitest';
import { PeriodValidator } from './PeriodValidator';
import { Point } from './types';

describe('PeriodValidator (Boundary Value & Period Verification)', () => {
  it('should reject when points array is empty or has fewer than 5 points', () => {
    expect(PeriodValidator.validate([]).isValid).toBe(false);
    expect(PeriodValidator.validate([{ x: 0, y: 0 }]).isValid).toBe(false);
    expect(
      PeriodValidator.validate([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
        { x: 3, y: -1 },
      ]).isValid
    ).toBe(false);
  });

  it('should reject when baseline span is zero (all identical x)', () => {
    const points: Point[] = [
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 10, y: -10 },
      { x: 10, y: 0 },
    ];
    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(false);
    expect(res.message).toContain('zero baseline span');
  });

  it('should reject a flat line with fewer than 2 crossings', () => {
    const points: Point[] = [
      { x: 0, y: 50 },
      { x: 20, y: 50 },
      { x: 40, y: 50 },
      { x: 60, y: 50 },
      { x: 80, y: 50 },
    ];
    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(false);
    expect(res.zeroCrossingsCount).toBeLessThan(2);
  });

  it('should reject an incomplete wave spanning only 0.5 cycles (< 2pi)', () => {
    // Generate half period: sin(x) from x = 0 to PI
    const points: Point[] = [];
    const L = 100; // Half period length
    for (let x = 0; x <= L; x += 2) {
      points.push({
        x,
        y: 40 * Math.sin((x / L) * Math.PI),
      });
    }

    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(false);
    expect(res.fullCycles).toBeLessThan(0.88);
    expect(res.message).toContain('At least ~0.9 full period is required');
  });

  it('should accept a curve spanning ~0.95 cycles within tolerance', () => {
    // Generate 0.95 period: sin(x) from x = 0 to 0.95 * 2*PI
    const points: Point[] = [];
    const L = 200; // 1 full cycle is 200
    for (let x = 0; x <= 190; x += 2) {
      points.push({
        x,
        y: 40 * Math.sin((x / L) * 2 * Math.PI),
      });
    }

    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(true);
    expect(res.fullCycles).toBeGreaterThanOrEqual(0.88);
  });

  it('should accept a curve spanning exactly 1.0 full period (boundary condition)', () => {
    // Generate exactly 1 period: sin(x) from x = 0 to 2*PI
    const points: Point[] = [];
    const L = 200; // 1 full cycle
    for (let x = 0; x <= L; x += 2) {
      points.push({
        x,
        y: 40 * Math.sin((x / L) * 2 * Math.PI),
      });
    }

    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(true);
    expect(res.fullCycles).toBeCloseTo(1.0, 1);
    expect(res.zeroCrossingsCount).toBeGreaterThanOrEqual(1);
  });

  it('should accept curves spanning > 1 period (nominal condition: 2 full cycles)', () => {
    const points: Point[] = [];
    const L = 300;
    for (let x = 0; x <= L; x += 2) {
      points.push({
        x,
        y: 35 * Math.sin((x / L) * 4 * Math.PI),
      });
    }

    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(true);
    expect(res.fullCycles).toBeCloseTo(2.0, 1);
  });

  it('should use overrideFrequency when provided', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
      { x: 150, y: -20 },
      { x: 200, y: 0 },
    ];
    // omega for period of 200 is 2*PI / 200 = 0.0314159
    const omega = (2 * Math.PI) / 200;
    const res = PeriodValidator.validate(points, omega);
    expect(res.isValid).toBe(true);
    expect(res.fullCycles).toBeCloseTo(1.0, 3);
  });
});
