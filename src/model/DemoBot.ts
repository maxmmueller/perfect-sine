import { Point, PointDeviation, FittedSine } from './types';
import { DeviationCalculator } from './DeviationCalculator';

export interface DemoWaveOptions {
  /** Canvas/viewport width (default 800) */
  readonly width?: number;
  /** Canvas/viewport height (default 600) */
  readonly height?: number;
  /** Center X position in pixels (default width / 2) */
  readonly centerX?: number;
  /** Center Y position in pixels (default height / 2) */
  readonly centerY?: number;
  /** Amplitude in pixels (default 45) */
  readonly amplitude?: number;
  /** Wavelength in pixels for 1 full cycle (default 220) */
  readonly wavelength?: number;
  /** Number of full cycles to draw (default 1.8) */
  readonly cycles?: number;
  /** Initial phase angle in radians (default 0) */
  readonly phase?: number;
  /** Baseline tilt in radians (default 0) */
  readonly tiltAngle?: number;
  /** Human tremor/imperfection magnitude in pixels (default 2.0, 0 = pristine) */
  readonly jitterLevel?: number;
  /** Runaway drift / hand slip magnitude in pixels (e.g. 25-35px causes orange/red deviations, default 0) */
  readonly runawayDrift?: number;
  /** Center point along stroke progression for runaway drift (0.0 to 1.0, default 0.6) */
  readonly runawayCenter?: number;
  /** Spread of the runaway drift along progression (default 0.15) */
  readonly runawaySpread?: number;
  /** If true, runaway drift persists to the end of the stroke (default false) */
  readonly runawayEnd?: boolean;
  /** Drawing speed in pixels per second (default 250) */
  readonly speedPxPerSec?: number;
  /** Step size in pixels along the wave baseline (default 3) */
  readonly stepPx?: number;
  /** Optional pseudo-random number generator for deterministic testing */
  readonly rng?: () => number;
  /** Optional wave imperfection profile for demo variety (pristine, wobbly, uneven, runaway, mixed) */
  readonly profile?: 'pristine' | 'wobbly' | 'uneven' | 'runaway' | 'mixed';
}

export interface DemoWaveResult {
  readonly points: Point[];
  readonly deviations: PointDeviation[];
}

/**
 * DemoBot generates procedurally synthesized freehand sine wave strokes
 * with realistic human drawing dynamics: smooth strokes, peak overshoot/skew,
 * amplitude modulation, arm-pivot drift, and variable drawing speeds.
 * Zero DOM dependency for headless verification.
 */
export class DemoBot {
  /**
   * Generates a sequence of points simulating a human drawing a sine wave.
   */
  public static generateStroke(options: DemoWaveOptions = {}): Point[] {
    return this.generateStrokeWithDeviations(options).points;
  }

  /**
   * Generates points along with exact analytical deviations from the intended
   * nominal mathematical sine wave. This ensures the color gradient reflects
   * the true wave geometry without any PCA or empirical fitting skew.
   */
  public static generateStrokeWithDeviations(options: DemoWaveOptions = {}): DemoWaveResult {
    const width = options.width ?? 800;
    const height = options.height ?? 600;
    const amplitude = Math.max(options.amplitude ?? 45, 10);
    const wavelength = Math.max(options.wavelength ?? 220, 50);
    const cycles = Math.max(options.cycles ?? 1.8, 0.5);
    const initialPhase = options.phase ?? 0;
    const tiltAngle = options.tiltAngle ?? 0;
    const jitterLevel = Math.max(options.jitterLevel ?? 2.0, 0);
    const speedPxPerSec = Math.max(options.speedPxPerSec ?? 250, 40);
    const stepPx = Math.max(options.stepPx ?? 3, 1);
    const rng = options.rng ?? Math.random;

    const totalLength = cycles * wavelength;
    const centerX = options.centerX ?? width / 2;
    const centerY = options.centerY ?? height / 2;
    const startXPrime = -totalLength / 2;

    const cosTilt = Math.cos(tiltAngle);
    const sinTilt = Math.sin(tiltAngle);

    const points: Point[] = [];
    const deviations: PointDeviation[] = [];
    const omega = (2 * Math.PI) / wavelength;

    const nominalFit: FittedSine = {
      amplitude,
      frequency: omega,
      phase: initialPhase,
      offset: 0,
      tilt: { angle: 0, centroid: { x: 0, y: 0 } },
      period: wavelength,
      fullCycles: cycles,
      r2: 1.0,
    };

    let profile = options.profile;
    if (!profile) {
      if (options.runawayDrift && Math.abs(options.runawayDrift) >= 20) {
        profile = 'runaway';
      } else if (options.jitterLevel !== undefined && options.jitterLevel >= 3.0) {
        profile = 'wobbly';
      } else if (options.jitterLevel !== undefined && options.jitterLevel <= 2.5) {
        profile = 'pristine';
      } else {
        profile = 'mixed';
      }
    }

    // Parameters for 'mixed' profile combining all 4 human error characteristics into a single stroke:
    // - Pristine: confident, accurate stroke segments (~35% green, hue >= 90°)
    // - Wobbly: natural neuromuscular hand tremor (~30% lime & yellow, hue 60°-90°)
    // - Uneven: asymmetric peak overshoot and amplitude sag (~20% amber & orange, hue 25°-60°)
    // - Runaway: hand slip and trajectory drift (~15% deep orange & red, hue 0°-25°)
    const mixedRunawayCenter = 0.38 + rng() * 0.36;
    const mixedRunawaySpread = 0.135;
    const mixedRunawayDir = rng() < 0.5 ? 1 : -1;
    const mixedRunawayPeakOffset = mixedRunawayDir * (31 + rng() * 6);
    const mixedRunawayEnd = rng() < 0.25;

    const mixedUnevenCenter = mixedRunawayCenter < 0.55 ? 0.74 + rng() * 0.12 : 0.18 + rng() * 0.12;
    const mixedUnevenSpread = 0.145;
    const mixedUnevenDir = rng() < 0.5 ? 1 : -1;
    const mixedUnevenAmpDelta = mixedUnevenDir * (21 + rng() * 5);

    const mixedWobblyCenter = (mixedRunawayCenter + mixedUnevenCenter) / 2 > 0.5 ? 0.22 + rng() * 0.20 : 0.65 + rng() * 0.20;
    const mixedWobblySpread = 0.26;
    const mixedTremorFreq = omega * 4.2;
    const mixedTremorPhase = rng() * Math.PI * 2;
    const mixedDriftPhase = rng() * Math.PI * 2;
    const mixedDriftAmp = 5.0;

    let ampModDepth = 0;
    let smoothTremorAmp = 0;
    let skewFactor = 0;
    let driftAmp = 0;
    let runawayDrift = options.runawayDrift ?? 0;
    let runawayCenter = options.runawayCenter ?? 0.60;
    let runawaySpread = Math.max(0.04, options.runawaySpread ?? 0.14);
    let runawayEnd = options.runawayEnd ?? false;

    if (profile === 'pristine' || jitterLevel === 0) {
      ampModDepth = jitterLevel > 0 ? (jitterLevel / 2.5) * 0.05 : 0;
      smoothTremorAmp = jitterLevel > 0 ? (jitterLevel / 2.5) * 1.0 : 0;
      driftAmp = jitterLevel > 0 ? (jitterLevel / 2.5) * 1.2 : 0;
      skewFactor = jitterLevel > 0 ? 0.02 : 0;
    } else if (profile === 'wobbly') {
      // Shaky, hesitant human hand: noticeable tremor and baseline wave, showing rich lime & yellow colors (8-16px deviations)
      ampModDepth = 0.16 + (jitterLevel / 4.0) * 0.12;
      smoothTremorAmp = 4.5 + (jitterLevel / 4.0) * 4.0;
      skewFactor = 0.08;
      driftAmp = 5.5 + (jitterLevel / 4.0) * 4.0;
    } else if (profile === 'uneven') {
      // Uneven stroke with peak overshoot / rushed acceleration: transitions into yellow, amber and orange (16-26px deviations)
      ampModDepth = 0.35;
      smoothTremorAmp = 5.5;
      skewFactor = 0.12;
      driftAmp = 8.0;
      if (runawayDrift === 0) {
        const sign = rng() < 0.5 ? 1 : -1;
        runawayDrift = sign * (19 + rng() * 8);
        runawayCenter = 0.35 + rng() * 0.38;
        runawaySpread = 0.16;
      }
    } else if (profile === 'runaway') {
      // Runaway drift / hand slip ("aus dem Ufer laufen"): clearly veers off target into red and orange (28-40px deviations)
      ampModDepth = options.runawayDrift !== undefined ? 0.08 : 0.22;
      smoothTremorAmp = options.runawayDrift !== undefined ? 2.0 : 5.0;
      driftAmp = options.runawayDrift !== undefined ? 2.0 : 7.0;
      if (runawayDrift === 0) {
        const sign = rng() < 0.5 ? 1 : -1;
        runawayDrift = sign * (28 + rng() * 10);
        runawayCenter = 0.45 + rng() * 0.25;
        runawaySpread = 0.15;
        runawayEnd = rng() < 0.40;
      }
    } else if (profile !== 'mixed') {
      ampModDepth = jitterLevel > 0 ? Math.min(0.20, (jitterLevel / 2.5) * 0.10) : 0;
      smoothTremorAmp = jitterLevel > 0 ? (jitterLevel / 2.5) * 3.5 : 0;
      skewFactor = jitterLevel > 0 ? (jitterLevel / 2.5) * 0.05 : 0;
      driftAmp = jitterLevel > 0 ? (jitterLevel / 2.5) * 3.5 : 0;
    }

    // Organic hand-drawing dynamics (smooth, realistic, non-jagged):
    // 1. Natural peak/trough amplitude modulation across cycles
    const ampModFreq = omega * 0.45;
    const ampModPhase = rng() * Math.PI * 2;

    // 2. Smooth neuromuscular oscillation (smooth continuous wave, no discrete white noise)
    const smoothTremorFreq = omega * 4.2;
    const smoothTremorPhase = rng() * Math.PI * 2;

    // 3. Smooth arm/wrist pivot baseline drift
    const driftPhase = rng() * Math.PI * 2;

    let currentTime = 0;

    for (let xPrime = startXPrime; xPrime <= -startXPrime; xPrime += stepPx) {
      const u = xPrime - startXPrime;
      const progress = u / totalLength;
      const nominalAngle = omega * u + initialPhase;

      let localY: number;

      if (profile === 'mixed') {
        // 1. Runaway slip envelope (covers ~15% into deep orange & red, hue 0°-25°)
        let runawayVal = 0;
        if (mixedRunawayEnd) {
          const sigmoid = 1 / (1 + Math.exp(-12 * (progress - mixedRunawayCenter)));
          runawayVal = mixedRunawayPeakOffset * sigmoid;
        } else {
          const dRun = (progress - mixedRunawayCenter) / mixedRunawaySpread;
          runawayVal = mixedRunawayPeakOffset * Math.exp(-0.5 * dRun * dRun);
        }

        // 2. Uneven peak modulation envelope (covers ~20% into amber & orange, hue 25°-60°)
        const dUneven = (progress - mixedUnevenCenter) / mixedUnevenSpread;
        const unevenWeight = Math.exp(-0.5 * dUneven * dUneven);
        const localAmp = amplitude + mixedUnevenAmpDelta * unevenWeight;

        // 3. Wobbly tremor envelope (covers ~30% into lime & yellow, hue 60°-90°)
        const dWob = (progress - mixedWobblyCenter) / mixedWobblySpread;
        const wobWeight = Math.exp(-0.5 * dWob * dWob);
        const tremorAmp = 4.2 + wobWeight * 8.5;
        const tremor = tremorAmp * Math.sin(mixedTremorFreq * u + mixedTremorPhase);

        // 4. Arm pivot drift
        const drift = mixedDriftAmp * Math.sin(progress * Math.PI + mixedDriftPhase);

        // 5. Asymmetric momentum skew
        const skew = 0.05 * Math.sin(2 * nominalAngle);

        localY = localAmp * Math.sin(nominalAngle + skew) + tremor + drift + runawayVal;
      } else {
        // 1. Local dynamic amplitude (each peak/trough is slightly organic)
        const localAmplitude = amplitude * (1 + ampModDepth * Math.sin(ampModFreq * u + ampModPhase));

        // 2. Stroke curve with fast-hand skew and smooth natural tremor
        const skew = skewFactor * Math.sin(2 * nominalAngle);
        const tremor = smoothTremorAmp * Math.sin(smoothTremorFreq * u + smoothTremorPhase);
        const idealY = localAmplitude * Math.sin(nominalAngle + skew) + tremor;

        // 3. Gentle baseline drift from wrist/arm pivot
        const baselineDrift = driftAmp * Math.sin(progress * Math.PI + driftPhase);

        // 4. Runaway drift / hand slip ("aus dem Ufer laufen")
        let runawayOffset = 0;
        if (runawayDrift !== 0) {
          if (runawayEnd) {
            const sigmoid = 1 / (1 + Math.exp(-12 * (progress - runawayCenter)));
            runawayOffset = runawayDrift * sigmoid;
          } else {
            const dProg = (progress - runawayCenter) / runawaySpread;
            runawayOffset = runawayDrift * Math.exp(-0.5 * dProg * dProg);
          }
        }

        localY = idealY + baselineDrift + runawayOffset;
      }

      const localX = xPrime;

      // 4. Rotate and translate into screen space
      const screenX = centerX + localX * cosTilt - localY * sinTilt;
      const screenY = centerY + localX * sinTilt + localY * cosTilt;

      // Dynamic velocity: faster through zero-crossings (momentum), slightly slower around crest turns
      const velFactor = 1.0 + 0.20 * Math.pow(Math.cos(nominalAngle), 2) - 0.10 * Math.pow(Math.sin(nominalAngle), 2);
      const dt = (stepPx / (speedPxPerSec * velFactor)) * 1000;
      currentTime += dt;

      const pt: Point = {
        x: Math.round(screenX * 10) / 10,
        y: Math.round(screenY * 10) / 10,
        time: Math.round(currentTime),
      };
      points.push(pt);

      // Compute exact orthogonal distance from local coordinates to the true nominal sine wave
      const dist = DeviationCalculator.calculateOrthogonalDistance(u, localY, nominalFit);
      const { hue, normalizedError, color } = DeviationCalculator.mapDistanceToColor(dist, 30);
      deviations.push({
        point: pt,
        distance: Math.round(dist * 100) / 100,
        normalizedError: Math.round(normalizedError * 1000) / 1000,
        hue,
        color,
      });
    }

    return { points, deviations };
  }
}
