import { Point } from './types';

export interface DemoWaveOptions {
  /** Canvas/viewport width (default 800) */
  readonly width?: number;
  /** Canvas/viewport height (default 600) */
  readonly height?: number;
  /** Amplitude in pixels (default 45) */
  readonly amplitude?: number;
  /** Wavelength in pixels for 1 full cycle (default 220) */
  readonly wavelength?: number;
  /** Number of full cycles to draw (default 1.8) */
  readonly cycles?: number;
  /** Baseline tilt in radians (default 0) */
  readonly tiltAngle?: number;
  /** Human tremor/jitter magnitude in pixels (default 2.5, 0 = pristine) */
  readonly jitterLevel?: number;
  /** Step size in pixels along the wave baseline (default 3) */
  readonly stepPx?: number;
  /** Optional pseudo-random number generator for deterministic testing */
  readonly rng?: () => number;
}

/**
 * DemoBot generates procedurally synthesized freehand sine wave strokes
 * with realistic human micro-tremors, neuromuscular jitter, and baseline drift.
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
    const tiltAngle = options.tiltAngle ?? 0;
    const jitterLevel = Math.max(options.jitterLevel ?? 2.5, 0);
    const stepPx = Math.max(options.stepPx ?? 3, 1);
    const rng = options.rng ?? Math.random;

    const totalLength = cycles * wavelength;
    const centerX = width / 2;
    const centerY = height / 2;
    const startXPrime = -totalLength / 2;

    const cosTilt = Math.cos(tiltAngle);
    const sinTilt = Math.sin(tiltAngle);

    const points: Point[] = [];
    const omega = (2 * Math.PI) / wavelength;

    // Harmonic tremor frequencies to simulate neuromuscular oscillations (3-8 Hz band)
    const tremorFreq1 = omega * 4.3;
    const tremorFreq2 = omega * 9.7;
    const phaseOffset1 = rng() * Math.PI * 2;
    const phaseOffset2 = rng() * Math.PI * 2;

    let currentTime = 0;
    const speedPxPerSec = 250; // realistic hand speed

    for (let xPrime = startXPrime; xPrime <= -startXPrime; xPrime += stepPx) {
      const progress = (xPrime - startXPrime) / totalLength;

      // 1. Nominal mathematical sine wave
      const idealY = amplitude * Math.sin(omega * (xPrime - startXPrime));

      // 2. Neuromuscular tremor and hand jitter
      let jitterY = 0;
      let jitterX = 0;
      if (jitterLevel > 0) {
        const harmonicJitter =
          0.6 * Math.sin(tremorFreq1 * xPrime + phaseOffset1) +
          0.4 * Math.sin(tremorFreq2 * xPrime + phaseOffset2);
        const noise = (rng() - 0.5) * 1.5;
        jitterY = (harmonicJitter + noise) * jitterLevel;

        // Slight horizontal motor hesitation
        jitterX = (rng() - 0.5) * jitterLevel * 0.5;
      }

      // 3. Natural human fatigue / baseline drift (subtle quadratic or linear droop)
      const driftY = jitterLevel > 0 ? Math.sin(progress * Math.PI) * (rng() - 0.5) * 3 : 0;

      const localX = xPrime + jitterX;
      const localY = idealY + jitterY + driftY;

      // 4. Rotate and translate into screen space
      const screenX = centerX + localX * cosTilt - localY * sinTilt;
      const screenY = centerY + localX * sinTilt + localY * cosTilt;

      currentTime += (stepPx / speedPxPerSec) * 1000;
      points.push({
        x: Math.round(screenX * 10) / 10,
        y: Math.round(screenY * 10) / 10,
        time: Math.round(currentTime),
      });
    }

    return points;
  }
}
