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

  it('should reject a flat line with fewer than 2 crossings or amplitude < minAmplitude', () => {
    const points: Point[] = [
      { x: 0, y: 50 },
      { x: 20, y: 50 },
      { x: 40, y: 50 },
      { x: 60, y: 50 },
      { x: 80, y: 50 },
    ];
    const res = PeriodValidator.validate(points);
    expect(res.isValid).toBe(false);
    expect(res.message).toContain('Wave is too flat');
  });

  it('should reject a wave with valid periods but insufficient amplitude (< 25px)', () => {
    // Generate 1 full period but with only 10px amplitude
    const points: Point[] = [];
    const L = 200;
    for (let x = 0; x <= L; x += 2) {
      points.push({
        x,
        y: 10 * Math.sin((x / L) * 2 * Math.PI) + 100,
      });
    }

    const res = PeriodValidator.validate(points, undefined, 0.88, 25);
    expect(res.isValid).toBe(false);
    expect(res.amplitude).toBeCloseTo(10, 0);
    expect(res.message).toContain('At least 25px amplitude is required');
  });

  it('should reject an incomplete wave spanning only 0.5 cycles (< 2pi)', () => {
    // Generate half period: sin(x) from x = 0 to PI (amplitude 30px >= 25px threshold)
    const points: Point[] = [];
    const L = 100; // Half period length
    for (let x = 0; x <= L; x += 2) {
      points.push({
        x,
        y: 60 * Math.sin((x / L) * Math.PI),
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
      { x: 50, y: 30 },
      { x: 100, y: 0 },
      { x: 150, y: -30 },
      { x: 200, y: 0 },
    ];
    // omega for period of 200 is 2*PI / 200 = 0.0314159
    const omega = (2 * Math.PI) / 200;
    const res = PeriodValidator.validate(points, omega);
    expect(res.isValid).toBe(true);
    expect(res.fullCycles).toBeCloseTo(1.0, 3);
  });

  it('should reject a multi-cycle zigzag/triangle wave with "Not a sine"', () => {
    // Generate a 4-cycle zigzag wave with sharp apexes and straight flanks (amplitude 40px)
    const points: Point[] = [];
    const period = 120;
    const cycles = 4;
    const A = 40;
    const totalPoints = cycles * 50;

    for (let i = 0; i < totalPoints; i++) {
      const x = (i / (totalPoints - 1)) * (period * cycles);
      const phase = ((x % period) + period) % period;
      let y: number;
      if (phase < period / 4) {
        y = (phase / (period / 4)) * A;
      } else if (phase < (3 * period) / 4) {
        y = A - ((phase - period / 4) / (period / 4)) * 2 * A;
      } else {
        y = -A + ((phase - (3 * period) / 4) / (period / 4)) * A;
      }
      points.push({ x, y: 150 + y });
    }

    const omega = (2 * Math.PI) / period;
    const res = PeriodValidator.validate(points, omega);
    expect(res.isValid).toBe(false);
    expect(res.message).toMatch(/Not a sine|zigzag/i);
  });

  it('should reject a 1-cycle triangle wave with sharp cusps', () => {
    const points: Point[] = [];
    const period = 160;
    const A = 40;
    const totalPoints = 60;

    for (let i = 0; i < totalPoints; i++) {
      const x = (i / (totalPoints - 1)) * period;
      const phase = ((x % period) + period) % period;
      let y: number;
      if (phase < period / 4) {
        y = (phase / (period / 4)) * A;
      } else if (phase < (3 * period) / 4) {
        y = A - ((phase - period / 4) / (period / 4)) * 2 * A;
      } else {
        y = -A + ((phase - (3 * period) / 4) / (period / 4)) * A;
      }
      points.push({ x, y: 100 + y });
    }

    const omega = (2 * Math.PI) / period;
    const res = PeriodValidator.validate(points, omega);
    expect(res.isValid).toBe(false);
    expect(res.message).toMatch(/Not a sine|zigzag/i);
  });

  it('should accept a genuine sine wave with motor tremor jitter', () => {
    const points: Point[] = [];
    const period = 150;
    const cycles = 2.5;
    const A = 45;
    const omega = (2 * Math.PI) / period;
    const totalPoints = Math.round(cycles * 60);

    for (let i = 0; i < totalPoints; i++) {
      const x = (i / (totalPoints - 1)) * (period * cycles);
      // Realistic tremor (+/- 3px)
      const jitter = ((i % 5) - 2) * 1.2;
      const y = 150 + A * Math.sin(omega * x) + jitter;
      points.push({ x, y });
    }

    const res = PeriodValidator.validate(points, omega);
    expect(res.isValid).toBe(true);
    expect(res.fullCycles).toBeCloseTo(cycles, 1);
  });
});
