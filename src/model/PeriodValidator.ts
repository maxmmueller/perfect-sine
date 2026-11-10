import { Point, PeriodValidationResult } from './types';

/**
 * PeriodValidator verifies that a drawn curve satisfies the V-Model acceptance criteria:
 * it must span at least one harmonic cycle (~0.88 - 0.90 tolerance) and possess a minimum
 * physical amplitude (>= 25px) to prevent straight/flat lines from scoring as waves.
 */
export class PeriodValidator {
  /**
   * Analyzes baseline-aligned points and validates period coverage and minimum amplitude.
   *
   * @param points Baseline-aligned points (x along baseline, y oscillating around offset).
   * @param overrideFrequency Optional known frequency omega (rad/px). If omitted, estimated from zero-crossings and extrema.
   * @param minCycles Minimum full cycles required (defaults to 0.88 = ~0.9 period tolerance).
   * @param minAmplitude Minimum peak amplitude in pixels (defaults to 25px).
   */
  public static validate(
    points: readonly Point[],
    overrideFrequency?: number,
    minCycles: number = 0.88,
    minAmplitude: number = 25
  ): PeriodValidationResult {
    if (!points || points.length < 5) {
      return {
        isValid: false,
        fullCycles: 0,
        totalSpan: 0,
        zeroCrossingsCount: 0,
        amplitude: 0,
        message: 'Insufficient points to determine period.',
      };
    }

    // Determine baseline span along x-axis and compute bounding box
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    let sumY = 0;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      sumY += p.y;
    }

    const baselineSpan = maxX - minX;
    if (baselineSpan <= 0) {
      return {
        isValid: false,
        fullCycles: 0,
        totalSpan: 0,
        zeroCrossingsCount: 0,
        amplitude: 0,
        message: 'Curve has zero baseline span.',
      };
    }

    const amplitude = (maxY - minY) / 2;
    if (amplitude < minAmplitude) {
      return {
        isValid: false,
        fullCycles: 0,
        totalSpan: 0,
        zeroCrossingsCount: 0,
        amplitude,
        message: `Wave is too flat (amplitude ${amplitude.toFixed(0)}px). At least ${minAmplitude}px amplitude is required.`,
      };
    }

    const meanY = sumY / points.length;

    // Detect zero-crossings around meanY
    const crossings: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const y1 = points[i - 1].y - meanY;
      const y2 = points[i].y - meanY;
      if ((y1 <= 0 && y2 > 0) || (y1 >= 0 && y2 < 0)) {
        const dy = y2 - y1;
        const t = Math.abs(dy) > 1e-9 ? -y1 / dy : 0.5;
        const crossX = points[i - 1].x + t * (points[i].x - points[i - 1].x);
        crossings.push(crossX);
      }
    }

    // Detect local extrema (peaks above meanY, troughs below meanY)
    const peaks: number[] = [];
    const troughs: number[] = [];
    const window = Math.max(2, Math.floor(points.length / 30));

    for (let i = window; i < points.length - window; i++) {
      let isMax = true;
      let isMin = true;
      for (let j = i - window; j <= i + window; j++) {
        if (points[j].y > points[i].y) isMax = false;
        if (points[j].y < points[i].y) isMin = false;
      }
      if (isMax && points[i].y > meanY + 0.2 * amplitude) {
        peaks.push(points[i].x);
      }
      if (isMin && points[i].y < meanY - 0.2 * amplitude) {
        troughs.push(points[i].x);
      }
    }

    let omega = overrideFrequency;
    if (omega === undefined || omega <= 0) {
      // Strategy 1: estimate half-period from zero-crossings
      if (crossings.length >= 2) {
        const halfPeriods: number[] = [];
        for (let i = 1; i < crossings.length; i++) {
          const diff = crossings[i] - crossings[i - 1];
          if (diff > 0) {
            halfPeriods.push(diff);
          }
        }
        if (halfPeriods.length > 0) {
          const avgHalfPeriod = halfPeriods.reduce((a, b) => a + b, 0) / halfPeriods.length;
          if (avgHalfPeriod > 1e-4) {
            omega = Math.PI / avgHalfPeriod;
          }
        }
      }

      // Strategy 2: if crossings < 2 but both peaks and troughs exist, estimate from peak-trough distance
      if ((!omega || omega <= 0) && peaks.length >= 1 && troughs.length >= 1) {
        const peakTroughDists: number[] = [];
        for (const p of peaks) {
          for (const t of troughs) {
            const dist = Math.abs(p - t);
            if (dist > 5) {
              peakTroughDists.push(dist);
            }
          }
        }
        if (peakTroughDists.length > 0) {
          const halfPeriod = Math.min(...peakTroughDists);
          omega = Math.PI / halfPeriod;
        }
      }

      if (!omega || omega <= 0) {
        return {
          isValid: false,
          fullCycles: 0,
          totalSpan: 0,
          zeroCrossingsCount: crossings.length,
          amplitude,
          message: 'Curve does not exhibit alternating harmonic peaks and troughs.',
        };
      }
    }

    // Angular span = baselineSpan * omega
    const totalSpan = baselineSpan * omega;
    const fullCycles = totalSpan / (2 * Math.PI);

    // Curve is valid if it covers at least minCycles and exhibits harmonic alternation
    const hasAlternation = crossings.length >= 2 || (peaks.length >= 1 && troughs.length >= 1);
    const isValidPeriod = fullCycles >= minCycles && hasAlternation;

    if (!isValidPeriod) {
      return {
        isValid: false,
        fullCycles,
        totalSpan,
        zeroCrossingsCount: crossings.length,
        amplitude,
        message: `Curve spans only ${fullCycles.toFixed(2)} cycles. At least ~0.9 full period is required.`,
      };
    }

    // Check if the curve is a triangle or zigzag waveform with sharp apex cusps
    if (
      omega > 0 &&
      amplitude >= minAmplitude &&
      PeriodValidator.isZigzagWave(points, amplitude, omega, meanY)
    ) {
      return {
        isValid: false,
        fullCycles,
        totalSpan,
        zeroCrossingsCount: crossings.length,
        amplitude,
        message: 'Not a sine: Wave has sharp peaks (zigzag detected). Sine waves require rounded crests.',
      };
    }

    return {
      isValid: true,
      fullCycles,
      totalSpan,
      zeroCrossingsCount: crossings.length,
      amplitude,
      message: `Valid period: ${fullCycles.toFixed(2)} cycles.`,
    };
  }

  /**
   * Evaluates whether the curve is a triangle or zigzag waveform with sharp apex cusps
   * instead of smooth, rounded sinusoidal crests.
   *
   * @param points Baseline-aligned points.
   * @param amplitude Peak amplitude of the wave.
   * @param frequency Angular frequency omega (rad/px).
   * @param meanY Baseline mean Y offset.
   */
  public static isZigzagWave(
    points: readonly Point[],
    amplitude: number,
    frequency: number,
    meanY: number
  ): boolean {
    if (!points || points.length < 12 || amplitude < 15 || frequency <= 0) {
      return false;
    }

    const period = (2 * Math.PI) / frequency;
    if (period <= 0 || !isFinite(period)) return false;

    // 1. Moving average 5-point smoothing to suppress high-frequency hand jitter
    const sm: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      let sumY = 0;
      let count = 0;
      const start = Math.max(0, i - 2);
      const end = Math.min(points.length - 1, i + 2);
      for (let j = start; j <= end; j++) {
        sumY += points[j].y;
        count++;
      }
      sm.push({ x: points[i].x, y: sumY / count });
    }

    // 2. Extrema detection & Apex Sharpness Evaluation
    // deltaX: sampling distance around the apex (~8% of period, min 5px)
    const deltaX = Math.max(5, period * 0.08);
    let totalExtrema = 0;
    let sharpExtrema = 0;
    const dropRatios: number[] = [];

    for (let i = 2; i < sm.length - 2; i++) {
      const yNorm = sm[i].y - meanY;
      const isPeak =
        sm[i].y > sm[i - 1].y &&
        sm[i].y > sm[i - 2].y &&
        sm[i].y > sm[i + 1].y &&
        sm[i].y > sm[i + 2].y &&
        yNorm > 0.25 * amplitude;

      const isTrough =
        sm[i].y < sm[i - 1].y &&
        sm[i].y < sm[i - 2].y &&
        sm[i].y < sm[i + 1].y &&
        sm[i].y < sm[i + 2].y &&
        yNorm < -0.25 * amplitude;

      if (!isPeak && !isTrough) continue;

      totalExtrema++;
      const xApex = sm[i].x;
      const yApex = sm[i].y;

      let pLeft = sm[0];
      let pRight = sm[sm.length - 1];

      for (let j = i - 1; j >= 0; j--) {
        if (Math.abs(xApex - sm[j].x) >= deltaX) {
          pLeft = sm[j];
          break;
        }
      }
      for (let j = i + 1; j < sm.length; j++) {
        if (Math.abs(sm[j].x - xApex) >= deltaX) {
          pRight = sm[j];
          break;
        }
      }

      const dLeft = Math.abs(xApex - pLeft.x);
      const dRight = Math.abs(pRight.x - xApex);

      if (dLeft < 2 || dRight < 2) continue;

      // Expected vertical drop for a pure sine calculated at the exact sampled horizontal distances
      const expLeft = amplitude * (1 - Math.cos(frequency * dLeft));
      const expRight = amplitude * (1 - Math.cos(frequency * dRight));
      const expectedDrop = (expLeft + expRight) / 2;

      const actualDrop = isPeak
        ? (yApex - pLeft.y + (yApex - pRight.y)) / 2
        : (pLeft.y - yApex + (pRight.y - yApex)) / 2;

      if (expectedDrop > 1e-4) {
        const ratio = actualDrop / expectedDrop;
        dropRatios.push(ratio);
        // Pure sine drop ratio is ~1.0; pure triangle drop ratio is ~2.1.
        // If ratio > 1.45, the apex behaves as a sharp triangle corner.
        if (ratio > 1.45) {
          sharpExtrema++;
        }
      }
    }

    // 3. Horizontal slope dwell metric:
    // Sine waves spend ~20-30% of their length with tangent close to horizontal (|slope| < 0.35 * A * omega).
    // Triangle waves spend < 3% near horizontal because slopes are purely diagonal (+m and -m).
    const maxSlope = amplitude * frequency;
    let nearZeroSlopeCount = 0;
    for (let i = 1; i < sm.length; i++) {
      const dx = sm[i].x - sm[i - 1].x;
      const dy = sm[i].y - sm[i - 1].y;
      if (Math.abs(dx) > 1e-4) {
        const slope = dy / dx;
        if (Math.abs(slope) < 0.35 * maxSlope) {
          nearZeroSlopeCount++;
        }
      }
    }
    const horizontalDwellRatio = nearZeroSlopeCount / Math.max(1, sm.length - 1);

    const avgDropRatio =
      dropRatios.length > 0
        ? dropRatios.reduce((a, b) => a + b, 0) / dropRatios.length
        : 1.0;

    return (
      (totalExtrema >= 1 && sharpExtrema / totalExtrema >= 0.5 && avgDropRatio > 1.45) ||
      (totalExtrema >= 2 && horizontalDwellRatio < 0.05 && avgDropRatio > 1.35)
    );
  }
}
