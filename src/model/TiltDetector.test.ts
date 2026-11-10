import { describe, it, expect } from 'vitest';
import { TiltDetector } from './TiltDetector';
import { Point } from './types';

describe('TiltDetector (PCA & Linear Tilt Detection)', () => {
  it('should return angle 0 and origin for empty points array', () => {
    const res = TiltDetector.detectTilt([]);
    expect(res.angle).toBe(0);
    expect(res.centroid).toEqual({ x: 0, y: 0 });
  });

  it('should return angle 0 and point coordinate for single point', () => {
    const res = TiltDetector.detectTilt([{ x: 42, y: 84 }]);
    expect(res.angle).toBe(0);
    expect(res.centroid).toEqual({ x: 42, y: 84 });
  });

  it('should return angle 0 and centroid for identical/degenerate points', () => {
    const points: Point[] = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    const res = TiltDetector.detectTilt(points);
    expect(res.angle).toBe(0);
    expect(res.centroid).toEqual({ x: 10, y: 10 });
  });

  it('should detect horizontal stroke directed from left to right (~0 rad)', () => {
    const points: Point[] = [
      { x: 0, y: 100 },
      { x: 50, y: 100 },
      { x: 100, y: 100 },
    ];
    const res = TiltDetector.detectTilt(points);
    expect(Math.abs(res.angle)).toBeCloseTo(0, 4);
    expect(res.centroid.x).toBeCloseTo(50, 4);
    expect(res.centroid.y).toBeCloseTo(100, 4);
  });

  it('should detect horizontal stroke directed from right to left (flipping direction)', () => {
    const points: Point[] = [
      { x: 100, y: 100 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const res = TiltDetector.detectTilt(points);
    expect(Math.abs(Math.abs(res.angle) - Math.PI)).toBeCloseTo(0, 4);
  });

  it('should detect vertical stroke downwards (~PI/2 rad)', () => {
    const points: Point[] = [
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ];
    const res = TiltDetector.detectTilt(points);
    expect(res.angle).toBeCloseTo(Math.PI / 2, 4);
  });

  it('should detect 45 degree diagonal stroke (~PI/4 rad)', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ];
    const res = TiltDetector.detectTilt(points);
    expect(res.angle).toBeCloseTo(Math.PI / 4, 4);
  });

  it('should correctly detect tilt of a synthetic sine wave rotated by 30 degrees', () => {
    const alpha = (30 * Math.PI) / 180;
    const cos = Math.cos(alpha);
    const sin = Math.sin(alpha);
    const points: Point[] = [];

    // Generate 2 full cycles of sine wave along rotated axis
    for (let u = 0; u <= 200; u += 2) {
      const v = 30 * Math.sin((u / 200) * 4 * Math.PI);
      // Rotate (u, v) into (x, y)
      const x = 100 + u * cos - v * sin;
      const y = 100 + u * sin + v * cos;
      points.push({ x, y });
    }

    const res = TiltDetector.detectTilt(points);
    expect(res.angle).toBeCloseTo(alpha, 1);
  });

  it('should transform and inverse-transform points without loss of precision', () => {
    const tilt = {
      angle: Math.PI / 6, // 30 deg
      centroid: { x: 150, y: 250 },
    };

    const original: Point[] = [
      { x: 100, y: 200, time: 10 },
      { x: 200, y: 300, time: 20 },
      { x: 300, y: 150, time: 30 },
    ];

    const transformed = TiltDetector.transformPoints(original, tilt);
    expect(transformed.length).toBe(original.length);

    // Check inverse transform
    for (let i = 0; i < original.length; i++) {
      const reconstructed = TiltDetector.inverseTransformPoint(transformed[i], tilt);
      expect(reconstructed.x).toBeCloseTo(original[i].x, 6);
      expect(reconstructed.y).toBeCloseTo(original[i].y, 6);
      expect(reconstructed.time).toBe(original[i].time);
    }
  });

  it('should fallback to PCA angle when chord distance is small (closed loop/ellipse)', () => {
    // Ellipse drawn around (100, 100) closing back on start point
    const points: Point[] = [];
    for (let angle = 0; angle <= Math.PI * 2; angle += 0.2) {
      points.push({
        x: 100 + 40 * Math.cos(angle),
        y: 100 + 10 * Math.sin(angle),
      });
    }
    const res = TiltDetector.detectTilt(points);
    expect(Math.abs(res.centroid.x - 100)).toBeLessThan(1.5);
    expect(Math.abs(res.centroid.y - 100)).toBeLessThan(1.5);
    expect(Math.sin(res.angle)).toBeCloseTo(0, 1);
  });

  it('should snap near-horizontal wave with start-trough/end-peak asymmetry (chord ~15 deg) to 0 rad', () => {
    // 1.5 cycles starting at trough (-PI/2) and ending at peak (+PI)
    // Chord angle is ~15°, but PCA mass axis is ~2.7° (< 10° snap threshold)
    const points: Point[] = [];
    const L = 300;
    const A = 40;
    for (let i = 0; i <= 60; i++) {
      const u = (i / 60) * L;
      const v = A * Math.sin(-Math.PI / 2 + (u / L) * 3 * Math.PI);
      points.push({ x: 100 + u, y: 200 + v });
    }

    const res = TiltDetector.detectTilt(points);
    expect(res.angle).toBe(0); // Successfully snapped to horizontal
  });

  it('should preserve tilt for an intentionally slanted wave at 21 degrees (not snap to 0)', () => {
    const alpha = (21 * Math.PI) / 180;
    const cos = Math.cos(alpha);
    const sin = Math.sin(alpha);
    const points: Point[] = [];
    const L = 600;
    const A = 50;

    for (let u = 0; u <= L; u += 5) {
      const v = A * Math.sin((u / L) * 6 * Math.PI);
      const x = 50 + u * cos - v * sin;
      const y = 50 + u * sin + v * cos;
      points.push({ x, y });
    }

    const res = TiltDetector.detectTilt(points);
    expect(res.angle).not.toBe(0);
    expect(res.angle).toBeCloseTo(alpha, 1);
  });
});
