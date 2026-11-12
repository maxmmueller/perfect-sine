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

  it('should support runaway drift ("aus dem Ufer laufen") that transitions into orange and red', () => {
    const { deviations } = DemoBot.generateStrokeWithDeviations({
      amplitude: 45,
      wavelength: 180,
      cycles: 3.0,
      jitterLevel: 1.5,
      runawayDrift: 30, // 30px slip off the intended course
      runawayCenter: 0.6,
      runawaySpread: 0.12,
    });

    const hues = deviations.map((d) => d.hue);
    const minHue = Math.min(...hues);
    const maxHue = Math.max(...hues);
    const redPoints = deviations.filter((d) => d.hue <= 25);
    const greenPoints = deviations.filter((d) => d.hue >= 90);

    // Initial and normal parts should be solid green
    expect(greenPoints.length).toBeGreaterThan(30);
    expect(maxHue).toBeGreaterThanOrEqual(110);

    // Runaway slip should reach deep orange/red
    expect(minHue).toBeLessThanOrEqual(25);
    expect(redPoints.length).toBeGreaterThan(5);
    expect(redPoints[0].color).toMatch(/^hsl\(([0-9]|1[0-9]|2[0-5]),/);
  });

  it('should support end runaway drift persisting to the end of stroke', () => {
    const { deviations } = DemoBot.generateStrokeWithDeviations({
      amplitude: 40,
      wavelength: 160,
      cycles: 2.5,
      runawayDrift: 28,
      runawayCenter: 0.7,
      runawayEnd: true,
    });

    const lastDeviations = deviations.slice(-3);
    // End points should be strongly off-course (red/orange/amber)
    for (const d of lastDeviations) {
      expect(d.distance).toBeGreaterThan(12);
      expect(d.hue).toBeLessThanOrEqual(70);
    }
  });

  it('should generate distinct color spectrums according to imperfection profile', () => {
    const rng = createDeterministicRng();
    // 1. pristine: predominantly green (>90% green)
    const pristine = DemoBot.generateStrokeWithDeviations({
      rng,
      profile: 'pristine',
      amplitude: 45,
      wavelength: 180,
      cycles: 2.0,
    });
    const pristineGreenRatio = pristine.deviations.filter((d) => d.hue >= 90).length / pristine.deviations.length;
    expect(pristineGreenRatio).toBeGreaterThan(0.90);

    // 2. wobbly: dips down to yellow/lime (< 95 deg)
    const wobbly = DemoBot.generateStrokeWithDeviations({
      rng,
      profile: 'wobbly',
      amplitude: 45,
      wavelength: 180,
      cycles: 2.0,
    });
    const minWobblyHue = Math.min(...wobbly.deviations.map((d) => d.hue));
    expect(minWobblyHue).toBeLessThan(95);

    // 3. uneven: dips down into yellow/amber/orange (< 65 deg)
    const uneven = DemoBot.generateStrokeWithDeviations({
      rng,
      profile: 'uneven',
      amplitude: 45,
      wavelength: 180,
      cycles: 2.0,
    });
    const minUnevenHue = Math.min(...uneven.deviations.map((d) => d.hue));
    expect(minUnevenHue).toBeLessThan(65);

    // 4. runaway: dips down into deep orange/red (< 30 deg)
    const runaway = DemoBot.generateStrokeWithDeviations({
      rng,
      profile: 'runaway',
      amplitude: 45,
      wavelength: 180,
      cycles: 2.0,
    });
    const minRunawayHue = Math.min(...runaway.deviations.map((d) => d.hue));
    expect(minRunawayHue).toBeLessThan(30);
  });

  it('should combine all 4 error types (pristine, wobbly, uneven, runaway) in a single mixed demo stroke', () => {
    const rng = createDeterministicRng();
    let totalGreen = 0;
    let totalLimeYellow = 0;
    let totalAmberOrange = 0;
    let totalRed = 0;
    let totalPoints = 0;

    for (let trial = 0; trial < 15; trial++) {
      const stroke = DemoBot.generateStrokeWithDeviations({
        rng,
        profile: 'mixed',
        cycles: 2.5,
        amplitude: 45,
        wavelength: 180,
      });

      const hues = stroke.deviations.map((d) => d.hue);
      const green = hues.filter((h) => h >= 90).length;
      const limeYellow = hues.filter((h) => h >= 60 && h < 90).length;
      const amberOrange = hues.filter((h) => h >= 25 && h < 60).length;
      const red = hues.filter((h) => h < 25).length;

      // In each individual stroke, multiple error classes must be present
      expect(green).toBeGreaterThan(0);
      expect(limeYellow + amberOrange).toBeGreaterThan(0);
      expect(amberOrange + red).toBeGreaterThan(0);

      // Verify human sine harmonic structure is authentically preserved (R2 >= 0.82 per stroke)
      const fit = SineFitter.fit(stroke.points);
      expect(fit).not.toBeNull();
      expect(fit!.r2).toBeGreaterThanOrEqual(0.82);

      totalGreen += green;
      totalLimeYellow += limeYellow;
      totalAmberOrange += amberOrange;
      totalRed += red;
      totalPoints += hues.length;
    }

    const pctGreen = (totalGreen / totalPoints) * 100;
    const pctLimeYellow = (totalLimeYellow / totalPoints) * 100;
    const pctAmberOrange = (totalAmberOrange / totalPoints) * 100;
    const pctRed = (totalRed / totalPoints) * 100;

    // Verify organic target proportions: ~35-50% green, ~25% lime/yellow, ~15% amber/orange, ~10% red
    expect(pctGreen).toBeGreaterThanOrEqual(25);
    expect(pctGreen).toBeLessThanOrEqual(65);

    expect(pctLimeYellow).toBeGreaterThanOrEqual(18);
    expect(pctLimeYellow).toBeLessThanOrEqual(40);

    expect(pctAmberOrange).toBeGreaterThanOrEqual(10);
    expect(pctAmberOrange).toBeLessThanOrEqual(30);

    expect(pctRed).toBeGreaterThanOrEqual(7);
    expect(pctRed).toBeLessThanOrEqual(25);
  });

  it('samples authentic human-learned proportions, bimodal cycles, and baseline phase bias', () => {
    let seed = 0x9e3779b9;
    const seededRng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const compactCount = { value: 0 };
    const flowingCount = { value: 0 };
    let nearCrossingStarts = 0;

    for (let i = 0; i < 60; i++) {
      const params = DemoBot.sampleHumanParameters(1200, 800, seededRng);
      expect(params.amplitude).toBeGreaterThanOrEqual(28);
      expect(params.amplitude).toBeLessThanOrEqual(96);
      expect(params.wavelength).toBeGreaterThanOrEqual(120);
      expect(params.cycles * params.wavelength).toBeLessThanOrEqual(1200 * 0.72 + 1e-6);

      if (params.cycles < 1.75) compactCount.value++;
      else flowingCount.value++;

      const distToZero = Math.min(params.phase, 2 * Math.PI - params.phase);
      const distToPi = Math.abs(params.phase - Math.PI);
      if (Math.min(distToZero, distToPi) < 0.75) {
        nearCrossingStarts++;
      }
    }

    expect(compactCount.value).toBeGreaterThan(10);
    expect(flowingCount.value).toBeGreaterThan(10);
    expect(nearCrossingStarts).toBeGreaterThan(30);
  });

  it('produces realistic intra-stroke half-period elasticity in mixed human-learned waves', () => {
    let seed = 0x1234abcd;
    const seededRng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const result = DemoBot.generateStrokeWithDeviations({
      amplitude: 56,
      wavelength: 220,
      cycles: 2.5,
      phase: 0,
      tiltAngle: 0,
      profile: 'mixed',
      rng: seededRng,
    });

    const centerY = 300;
    const crossings: number[] = [];
    for (let i = 1; i < result.points.length; i++) {
      const y0 = result.points[i - 1].y - centerY;
      const y1 = result.points[i].y - centerY;
      if ((y0 <= 0 && y1 > 0) || (y0 >= 0 && y1 < 0)) {
        const t = Math.abs(y0) / Math.max(1e-6, Math.abs(y1 - y0));
        crossings.push(result.points[i - 1].x + t * (result.points[i].x - result.points[i - 1].x));
      }
    }

    expect(crossings.length).toBeGreaterThanOrEqual(4);
    const halfPeriods: number[] = [];
    for (let i = 1; i < crossings.length; i++) {
      halfPeriods.push(crossings[i] - crossings[i - 1]);
    }
    const meanHP = halfPeriods.reduce((a, b) => a + b, 0) / halfPeriods.length;
    const maxDiff = Math.max(...halfPeriods.map((hp) => Math.abs(hp - meanHP)));
    // Human-like arches vary naturally in width rather than staying strictly uniform
    expect(maxDiff).toBeGreaterThan(3);
  });
});
