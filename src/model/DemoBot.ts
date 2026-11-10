import { Point } from './types';

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
  /** Drawing speed in pixels per second (default 250) */
  readonly speedPxPerSec?: number;
  /** Step size in pixels along the wave baseline (default 3) */
  readonly stepPx?: number;
  /** Optional pseudo-random number generator for deterministic testing */
  readonly rng?: () => number;
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
    const omega = (2 * Math.PI) / wavelength;

    // Organic hand-drawing dynamics (smooth, realistic, non-jagged):
    // 1. Natural peak/trough amplitude modulation across cycles
    const ampModFreq = omega * 0.45;
    const ampModPhase = rng() * Math.PI * 2;
    const ampModDepth = jitterLevel > 0 ? Math.min(0.12, (jitterLevel / 2.5) * 0.07) : 0;

    // 2. Smooth neuromuscular oscillation (smooth continuous wave, no discrete white noise)
    const smoothTremorFreq = omega * 4.2;
    const smoothTremorPhase = rng() * Math.PI * 2;
    const smoothTremorAmp = jitterLevel > 0 ? (jitterLevel / 2.5) * 1.5 : 0;

    // 3. Fast-stroke asymmetric momentum / hand drag (slight 2nd harmonic turning skew)
    const skewFactor = jitterLevel > 0 ? (jitterLevel / 2.5) * 0.04 : 0;

    // 4. Smooth arm/wrist pivot baseline drift
    const driftPhase = rng() * Math.PI * 2;
    const driftAmp = jitterLevel > 0 ? (jitterLevel / 2.5) * 2.0 : 0;

    let currentTime = 0;

    for (let xPrime = startXPrime; xPrime <= -startXPrime; xPrime += stepPx) {
      const u = xPrime - startXPrime;
      const progress = u / totalLength;
      const nominalAngle = omega * u + initialPhase;

      // 1. Local dynamic amplitude (each peak/trough is slightly organic)
      const localAmplitude = amplitude * (1 + ampModDepth * Math.sin(ampModFreq * u + ampModPhase));

      // 2. Stroke curve with fast-hand skew and smooth natural tremor
      const skew = skewFactor * Math.sin(2 * nominalAngle);
      const tremor = smoothTremorAmp * Math.sin(smoothTremorFreq * u + smoothTremorPhase);
      const idealY = localAmplitude * Math.sin(nominalAngle + skew) + tremor;

      // 3. Gentle baseline drift from wrist/arm pivot
      const baselineDrift = driftAmp * Math.sin(progress * Math.PI + driftPhase);

      const localX = xPrime;
      const localY = idealY + baselineDrift;

      // 4. Rotate and translate into screen space
      const screenX = centerX + localX * cosTilt - localY * sinTilt;
      const screenY = centerY + localX * sinTilt + localY * cosTilt;

      // Dynamic velocity: faster through zero-crossings (momentum), slightly slower around crest turns
      const velFactor = 1.0 + 0.20 * Math.pow(Math.cos(nominalAngle), 2) - 0.10 * Math.pow(Math.sin(nominalAngle), 2);
      const dt = (stepPx / (speedPxPerSec * velFactor)) * 1000;
      currentTime += dt;

      points.push({
        x: Math.round(screenX * 10) / 10,
        y: Math.round(screenY * 10) / 10,
        time: Math.round(currentTime),
      });
    }

    return points;
  }
}
