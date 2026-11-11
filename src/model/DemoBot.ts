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

export interface HumanDemoWaveParams {
  readonly amplitude: number;
  readonly wavelength: number;
  readonly cycles: number;
  readonly phase: number;
  readonly tiltAngle: number;
  readonly speedPxPerSec: number;
}

interface MixedStrokeConfig {
  readonly phaseHarmonic1Amp: number;
  readonly phaseHarmonic1Offset: number;
  readonly phaseHarmonic2Amp: number;
  readonly phaseHarmonic2Offset: number;
  readonly ampSlope: number;
  readonly ampBow: number;
  readonly runawayCenter: number;
  readonly runawaySpread: number;
  readonly runawayOvershoot: number;
  readonly unevenCenter: number;
  readonly unevenSpread: number;
  readonly unevenDelta: number;
  readonly wobblyCenter: number;
  readonly wobblySpread: number;
  readonly bowAmp: number;
  readonly bowPhase: number;
  readonly entryDrift: number;
  readonly exitDrift: number;
  readonly tremorPhases: readonly [number, number, number];
}

/**
 * DemoBot generates procedurally synthesized freehand sine wave strokes
 * with realistic human drawing dynamics: smooth strokes, peak overshoot/skew,
 * amplitude modulation, arm-pivot drift, and variable drawing speeds.
 * Zero DOM dependency for headless verification.
 */
export class DemoBot {
  /**
   * Samples authentic human-like sine geometry and kinematics learned from
   * empirically recorded freehand strokes, scaled cleanly to the current viewport.
   */
  public static sampleHumanParameters(
    width = 800,
    height = 600,
    rng: () => number = Math.random
  ): HumanDemoWaveParams {
    const safeWidth = Math.max(width, 280);
    const safeHeight = Math.max(height, 260);
    const scaleY = Math.max(0.55, Math.min(1.25, safeHeight / 806));
    const maxWaveWidth = safeWidth * 0.72;

    // Empirical human amplitude (desktop median ~72px, IQR 56-94px), triangular center-weighted
    const baseAmp = 50 + ((rng() + rng()) * 0.5) * 42;
    const amplitude = Math.round(Math.max(28, Math.min(96, safeHeight * 0.16, baseAmp * scaleY)));

    // Empirical bimodal cycle span (~55% compact 1.15-1.70 cycles, ~45% flowing 1.85-3.15 cycles)
    const isCompact = rng() < 0.55;
    let cycles = isCompact ? 1.15 + rng() * 0.55 : 1.85 + rng() * 1.30;

    // Empirical human aspect ratio (Amp / Period IQR ~0.15-0.28, median ~0.20)
    const ampPerPeriod = 0.15 + ((rng() + rng()) * 0.5) * 0.13;
    let wavelength = amplitude / ampPerPeriod;
    const maxWavelengthForWidth = maxWaveWidth / Math.max(cycles, 1.05);
    wavelength = Math.max(120, Math.min(wavelength, maxWavelengthForWidth));
    if (cycles * wavelength > maxWaveWidth) {
      cycles = Math.max(1.05, maxWaveWidth / wavelength);
    }

    // Start phase: ~59% move upward first on canvas (cos(PI) < 0 -> y decreases),
    // ~41% move downward first, with ~75% starting near a baseline crossing
    const goesUpFirst = rng() < 0.59;
    const basePhase = goesUpFirst ? Math.PI : 0;
    const phaseJitter = rng() < 0.75
      ? (rng() + rng() - 1) * 0.45
      : (rng() - 0.5) * 1.75;
    const phase = ((basePhase + phaseJitter) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);

    // ~80% nearly horizontal with subtle wrist slant (±3.7°), ~20% gentle diagonal sweep (8°-25°)
    const tiltAngle = rng() < 0.80
      ? (rng() + rng() - 1) * 0.065
      : (rng() < 0.5 ? 1 : -1) * (0.14 + rng() * 0.30);

    // Varied human sweep speed (median brisk ~580-860px/s, moderate ~390-580px/s, deliberate ~260-390px/s)
    const speedDice = rng();
    const speedPxPerSec = speedDice < 0.45
      ? 580 + rng() * 280
      : speedDice < 0.82
      ? 390 + rng() * 190
      : 260 + rng() * 130;

    return {
      amplitude,
      wavelength,
      cycles,
      phase,
      tiltAngle,
      speedPxPerSec,
    };
  }

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

    // Human-learned mixed profile combining natural half-period elasticity, amplitude swell/sag,
    // wrist-pivot bow, uneven crest heights, subtle aperiodic tremor, and a single runaway overshoot
    const mixedConfig = profile === 'mixed'
      ? this.buildMixedConfig(amplitude, cycles, initialPhase, rng)
      : null;

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

      if (mixedConfig !== null) {
        localY = this.evaluateMixedLocalY(u, progress, amplitude, omega, initialPhase, mixedConfig);
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
            const sigmoid = 1 / (1 + Math.exp(-14 * (progress - runawayCenter)));
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

      // Dynamic velocity learned from humans: deliberate entry, brisk acceleration across middle,
      // slightly slower around crest turns, and confident finish sweep
      const sweepRamp = 0.74 + 0.48 * progress;
      const harmonicPace = 1.0 + 0.14 * Math.pow(Math.cos(nominalAngle), 2) - 0.10 * Math.pow(Math.sin(nominalAngle), 2);
      const velFactor = sweepRamp * harmonicPace;
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

  /**
   * Builds per-stroke human distortion parameters anchored cleanly to exact sinusoidal extrema.
   */
  private static buildMixedConfig(
    amplitude: number,
    cycles: number,
    initialPhase: number,
    rng: () => number
  ): MixedStrokeConfig {
    const startAng = initialPhase;
    const totalAng = 2 * Math.PI * cycles;
    const endAng = startAng + totalAng;
    const kMin = Math.ceil((startAng + 0.12 * totalAng - Math.PI / 2) / Math.PI);
    const kMax = Math.floor((endAng - 0.12 * totalAng - Math.PI / 2) / Math.PI);

    const crests: { p: number; sign: number }[] = [];
    for (let k = kMin; k <= kMax; k++) {
      const ang = k * Math.PI + Math.PI / 2;
      const p = (ang - startAng) / totalAng;
      if (p >= 0.12 && p <= 0.88) {
        crests.push({ p, sign: Math.sin(ang) > 0 ? 1 : -1 });
      }
    }

    const midCrests = crests.filter((c) => c.p >= 0.22 && c.p <= 0.78);
    const runawayCrest = midCrests.length > 0
      ? midCrests[Math.floor(rng() * midCrests.length)]
      : (crests[Math.floor(crests.length / 2)] || { p: 0.52, sign: 1 });

    const otherCrests = crests.filter((c) => Math.abs(c.p - runawayCrest.p) >= 0.18);
    const unevenCrest = otherCrests.length > 0
      ? otherCrests[Math.floor(rng() * otherCrests.length)]
      : { p: runawayCrest.p < 0.5 ? 0.78 : 0.22, sign: -runawayCrest.sign };

    const ampSlope = (rng() < 0.5 ? 1 : -1) * (0.03 + rng() * 0.055);
    const ampBow = (rng() - 0.5) * 0.08;
    const bowAmp = 4.0 + rng() * 2.2;
    const bowPhase = rng() * Math.PI * 2;

    const ampBiasAtRun =
      amplitude *
      (ampSlope * (runawayCrest.p - 0.5) + ampBow * (runawayCrest.p * (1 - runawayCrest.p) - 1 / 6));
    const bowAtRunaway = bowAmp * Math.sin(Math.PI * runawayCrest.p + bowPhase);
    const signedBowRun = bowAtRunaway * runawayCrest.sign;
    const targetRunaway = 30.8 + rng() * 2.4;
    const compensatedOvershoot = Math.max(27.5, Math.min(34.0, targetRunaway - ampBiasAtRun - signedBowRun));

    const unevenSign = rng() < 0.5 ? 1 : -1;
    const bowAtUneven = bowAmp * Math.sin(Math.PI * unevenCrest.p + bowPhase);
    const signedBowUneven = bowAtUneven * unevenCrest.sign;
    const targetUneven = 19.6 + rng() * 2.8;
    const compensatedUneven = Math.max(-23.0, Math.min(23.0, unevenSign * targetUneven - signedBowUneven));

    const wobblyCenter = (runawayCrest.p + unevenCrest.p) / 2 > 0.5 ? 0.24 : 0.74;

    return {
      phaseHarmonic1Amp: (rng() < 0.5 ? 1 : -1) * (0.08 + rng() * 0.07),
      phaseHarmonic1Offset: (rng() - 0.5) * 0.8,
      phaseHarmonic2Amp: (rng() < 0.5 ? 1 : -1) * (0.06 + rng() * 0.06),
      phaseHarmonic2Offset: rng() * Math.PI * 2,
      ampSlope,
      ampBow,
      runawayCenter: runawayCrest.p,
      runawaySpread: 0.145 + rng() * 0.015,
      runawayOvershoot: compensatedOvershoot,
      unevenCenter: unevenCrest.p,
      unevenSpread: 0.16 + rng() * 0.02,
      unevenDelta: compensatedUneven,
      wobblyCenter,
      wobblySpread: 0.34,
      bowAmp,
      bowPhase,
      entryDrift: (rng() < 0.5 ? 1 : -1) * (3.0 + rng() * 3.5),
      exitDrift: (rng() < 0.5 ? 1 : -1) * (3.5 + rng() * 3.5),
      tremorPhases: [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2],
    };
  }

  /**
   * Evaluates local vertical stroke displacement for the human-learned mixed profile.
   */
  private static evaluateMixedLocalY(
    u: number,
    progress: number,
    amplitude: number,
    omega: number,
    initialPhase: number,
    config: MixedStrokeConfig
  ): number {
    const nominalAngle = omega * u + initialPhase;

    // 1. C² smooth half-period elasticity (natural compression/stretching of adjacent arches)
    const phaseWarp =
      config.phaseHarmonic1Amp *
        Math.sin(Math.PI * progress + config.phaseHarmonic1Offset) *
        Math.sin(Math.PI * progress) +
      config.phaseHarmonic2Amp * Math.sin(2 * Math.PI * progress + config.phaseHarmonic2Offset);

    // 2. Smooth cross-stroke amplitude swell/sag + anchored crest overshoot & uneven crest
    const dRun = (progress - config.runawayCenter) / config.runawaySpread;
    const runawayWeight = Math.exp(-0.5 * dRun * dRun);
    const runawayAmp = config.runawayOvershoot * runawayWeight;

    const dUneven = (progress - config.unevenCenter) / config.unevenSpread;
    const unevenAmp = config.unevenDelta * Math.exp(-0.5 * dUneven * dUneven);

    const ampEnvelope =
      1 + config.ampSlope * (progress - 0.5) + config.ampBow * (progress * (1 - progress) - 1 / 6);
    const localAmp = amplitude * ampEnvelope + runawayAmp + unevenAmp;

    // 3. Wrist-pivot baseline bow + subtle entry/exit sweep drift (attenuated around runaway crest)
    const bow = config.bowAmp * Math.sin(Math.PI * progress + config.bowPhase);
    const endDrift =
      (config.entryDrift * Math.exp(-progress / 0.11) +
        config.exitDrift * Math.exp(-(1 - progress) / 0.11)) *
      (1 - 0.7 * runawayWeight);

    // 4. Subtle aperiodic micro-tremor across 3 incommensurate frequencies (no periodic bumps)
    const dWob = (progress - config.wobblyCenter) / config.wobblySpread;
    const wobWeight = Math.exp(-0.5 * dWob * dWob);
    const tremorMag = (3.4 + 5.8 * wobWeight) * (1 - 0.75 * runawayWeight);
    const tremor =
      tremorMag *
      (0.52 * Math.sin(omega * 1.85 * u + config.tremorPhases[0]) +
        0.31 * Math.sin(omega * 3.15 * u + config.tremorPhases[1]) +
        0.17 * Math.sin(omega * 4.70 * u + config.tremorPhases[2]));

    return localAmp * Math.sin(nominalAngle + phaseWarp) + bow + endDrift + tremor;
  }
}
