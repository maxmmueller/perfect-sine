import { describe, it, expect } from 'vitest';
import { DemoBot } from './DemoBot';
import { SineFitter } from './SineFitter';

describe('DemoBot (Procedural Human-Like Stroke Generator)', () => {
  // Simple deterministic LCG random generator for reproducible unit testing
  const createDeterministicRng = (seed: number = 42) => {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  };

  it('should generate points using default options', () => {
    const points = DemoBot.generateStroke();
    expect(points.length).toBeGreaterThan(50);
    expect(points[0]).toHaveProperty('x');
    expect(points[0]).toHaveProperty('y');
    expect(points[0]).toHaveProperty('time');
  });

  it('should generate a mathematically pristine sine wave when jitterLevel = 0', () => {
    const amplitude = 50;
    const wavelength = 200;
    const cycles = 2.0;

    const points = DemoBot.generateStroke({
      width: 1000,
      height: 800,
      amplitude,
      wavelength,
      cycles,
      jitterLevel: 0,
      stepPx: 2,
    });

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    expect(fit!.amplitude).toBeCloseTo(amplitude, 0);
    expect(fit!.fullCycles).toBeCloseTo(cycles, 1);
    expect(fit!.r2).toBeGreaterThanOrEqual(0.99);
  });

  it('should introduce human-like motor tremor when jitterLevel > 0', () => {
    const rng = createDeterministicRng(12345);
    const points = DemoBot.generateStroke({
      amplitude: 60,
      wavelength: 250,
      cycles: 1.5,
      jitterLevel: 3.5,
      rng,
    });

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    // Human jitter reduces R² from perfect (1.0) while keeping harmonic structure intact
    expect(fit!.r2).toBeGreaterThan(0.75);
    expect(fit!.r2).toBeLessThan(0.998);
    expect(fit!.fullCycles).toBeCloseTo(1.5, 1);
  });

  it('should generate correctly oriented slanted waves', () => {
    const tiltAngle = Math.PI / 6; // 30 degrees
    const points = DemoBot.generateStroke({
      amplitude: 50,
      wavelength: 200,
      cycles: 1.5,
      tiltAngle,
      jitterLevel: 0,
    });

    const fit = SineFitter.fit(points);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.tilt.angle)).toBeCloseTo(tiltAngle, 1);
  });

  it('should support custom centerX and centerY positions', () => {
    const points = DemoBot.generateStroke({
      width: 1000,
      height: 800,
      centerX: 300,
      centerY: 150,
      amplitude: 40,
      wavelength: 200,
      cycles: 1.0,
      jitterLevel: 0,
    });

    const sumY = points.reduce((acc, p) => acc + p.y, 0) / points.length;
    expect(sumY).toBeCloseTo(150, 0);
  });

  it('should clamp minimum parameters safely on boundary inputs', () => {
    const points = DemoBot.generateStroke({
      amplitude: -10, // clamped to >= 10
      wavelength: 20, // clamped to >= 50
      cycles: 0.1,    // clamped to >= 0.5
      stepPx: -5,     // clamped to >= 1
      jitterLevel: -2, // clamped to >= 0
    });

    expect(points.length).toBeGreaterThan(10);
  });

  it('should support initial phase offset (c in a*sin(b*x+c)+d)', () => {
    // Phase 0: starts at zero-crossing (y ~ centerY)
    const pointsPhase0 = DemoBot.generateStroke({
      centerY: 200,
      amplitude: 50,
      wavelength: 200,
      cycles: 1.0,
      phase: 0,
      jitterLevel: 0,
    });
    expect(pointsPhase0[0].y).toBeCloseTo(200, 0);

    // Phase PI/2: starts at peak (y ~ centerY + amplitude)
    const pointsPhasePeak = DemoBot.generateStroke({
      centerY: 200,
      amplitude: 50,
      wavelength: 200,
      cycles: 1.0,
      phase: Math.PI / 2,
      jitterLevel: 0,
    });
    expect(pointsPhasePeak[0].y).toBeCloseTo(250, 0);
  });

  it('should support varied drawing speeds (speedPxPerSec)', () => {
    const pointsFast = DemoBot.generateStroke({
      wavelength: 200,
      cycles: 2.0,
      speedPxPerSec: 600,
      jitterLevel: 0,
    });
    const pointsSlow = DemoBot.generateStroke({
      wavelength: 200,
      cycles: 2.0,
      speedPxPerSec: 200,
      jitterLevel: 0,
    });

    const durationFast = pointsFast[pointsFast.length - 1].time ?? 0;
    const durationSlow = pointsSlow[pointsSlow.length - 1].time ?? 1;

    // Fast speed should finish in roughly 1/3 of the time
    expect(durationFast).toBeLessThan(durationSlow * 0.45);
  });

  it('should compute accurate deviations with predominantly green hue for human-like demo wave', () => {
    const { points, deviations } = DemoBot.generateStrokeWithDeviations({
      width: 800,
      height: 600,
      centerX: 400,
      centerY: 300,
      amplitude: 50,
      wavelength: 180,
      cycles: 3.5,
      phase: 1.2,
      tiltAngle: -0.25,
      jitterLevel: 1.8,
    });

    expect(points.length).toBe(deviations.length);
    expect(points.length).toBeGreaterThan(50);

    const hues = deviations.map((d) => d.hue);
    const avgHue = hues.reduce((a, b) => a + b, 0) / hues.length;
    const greenCount = hues.filter((h) => h >= 90).length;
    const redCount = hues.filter((h) => h < 50).length;

    // The wave should be overwhelmingly green/lime (matching user expectation for clean demo wave)
    expect(avgHue).toBeGreaterThan(95);
    expect(greenCount / hues.length).toBeGreaterThan(0.90);
    expect(redCount).toBe(0);
  });

  it('should produce 100% pure green hue (120deg) when jitterLevel is 0', () => {
    const { deviations } = DemoBot.generateStrokeWithDeviations({
      amplitude: 40,
      wavelength: 200,
      cycles: 2.0,
      tiltAngle: 0.3,
      jitterLevel: 0,
    });

    for (const dev of deviations) {
      expect(dev.distance).toBeCloseTo(0, 1);
      expect(dev.hue).toBe(120);
      expect(dev.color).toBe('hsl(120, 100%, 50%)');
    }
  });
});
