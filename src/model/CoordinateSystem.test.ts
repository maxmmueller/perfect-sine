import { describe, it, expect } from 'vitest';
import { CoordinateSystem } from './CoordinateSystem';
import { FittedSine, Point } from './types';

describe('CoordinateSystem (Reference Frame Calculation)', () => {
  const dummyFit: FittedSine = {
    amplitude: 40,
    frequency: 0.05,
    phase: 0,
    offset: 0,
    period: (2 * Math.PI) / 0.05,
    r2: 0.95,
    fullCycles: 1.5,
    tilt: {
      angle: 0,
      centroid: { x: 100, y: 100 },
    },
  };

  it('should compute coordinate frame correctly for a horizontal wave (angle = 0)', () => {
    const points: Point[] = [
      { x: 100, y: 140 },
      { x: 50, y: 100 },
      { x: 200, y: 100 },
      { x: 150, y: 60 },
    ];

    const frame = CoordinateSystem.computeFrame(dummyFit, points, 20);

    // With anchor at (100, 100) and angle 0:
    // x' = x - 100: points have x' in [-50, 100]
    // origin at x' = -50, y' = 0 => screen x = 100 - 50 = 50, y = 100
    expect(frame.origin.x).toBeCloseTo(50, 2);
    expect(frame.origin.y).toBeCloseTo(100, 2);

    // Baseline extends from -50 - 20 = -70 to 100 + 20 = 120
    expect(frame.baselineAxis.start.x).toBeCloseTo(100 - 70, 2);
    expect(frame.baselineAxis.start.y).toBeCloseTo(100, 2);
    expect(frame.baselineAxis.end.x).toBeCloseTo(100 + 120, 2);
    expect(frame.baselineAxis.end.y).toBeCloseTo(100, 2);

    // Vertical axis at origin (50, 100) with amplitude 40 * 1.25 = 50
    expect(frame.verticalAxis.start.x).toBeCloseTo(50, 2);
    expect(frame.verticalAxis.start.y).toBeCloseTo(100 - 50, 2);
    expect(frame.verticalAxis.end.x).toBeCloseTo(50, 2);
    expect(frame.verticalAxis.end.y).toBeCloseTo(100 + 50, 2);
  });

  it('should compute orthogonal axes for a slanted wave (angle = 45 deg)', () => {
    const angle = Math.PI / 4;
    const tiltedFit: FittedSine = {
      ...dummyFit,
      amplitude: 50,
      tilt: {
        angle,
        centroid: { x: 200, y: 200 },
      },
    };

    const points: Point[] = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ];

    const frame = CoordinateSystem.computeFrame(tiltedFit, points, 10);
    expect(frame.angle).toBeCloseTo(angle, 4);

    // Baseline axis vector
    const bVec = {
      x: frame.baselineAxis.end.x - frame.baselineAxis.start.x,
      y: frame.baselineAxis.end.y - frame.baselineAxis.start.y,
    };

    // Vertical axis vector
    const vVec = {
      x: frame.verticalAxis.end.x - frame.verticalAxis.start.x,
      y: frame.verticalAxis.end.y - frame.verticalAxis.start.y,
    };

    // Dot product between baseline vector and vertical axis vector must be 0 (orthogonality)
    const dot = bVec.x * vVec.x + bVec.y * vVec.y;
    expect(Math.abs(dot)).toBeLessThan(1e-5);
  });

  it('should handle boundary case: empty points array', () => {
    const frame = CoordinateSystem.computeFrame(dummyFit, [], 25);
    expect(frame.origin.x).toBe(dummyFit.tilt.centroid.x);
    expect(frame.origin.y).toBe(dummyFit.tilt.centroid.y);
    expect(frame.baselineAxis.start.x).toBe(dummyFit.tilt.centroid.x - 25);
    expect(frame.baselineAxis.end.x).toBe(dummyFit.tilt.centroid.x + 25);
  });

  it('should enforce minimum vertical axis span when amplitude is zero or very small', () => {
    const zeroAmpFit: FittedSine = {
      ...dummyFit,
      amplitude: 0,
    };

    const points: Point[] = [
      { x: 50, y: 100 },
      { x: 150, y: 100 },
    ];

    const frame = CoordinateSystem.computeFrame(zeroAmpFit, points);
    // Height should default to at least 30px
    const vertHeight = Math.hypot(
      frame.verticalAxis.end.x - frame.verticalAxis.start.x,
      frame.verticalAxis.end.y - frame.verticalAxis.start.y
    );
    expect(vertHeight).toBeGreaterThanOrEqual(60); // from -30 to +30 = 60
  });
});
