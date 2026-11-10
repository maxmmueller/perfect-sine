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
   * @param fitAmplitude Optional fitted harmonic amplitude from SineFitter.
   */
  public static validate(
    points: readonly Point[],
    overrideFrequency?: number,
    minCycles: number = 0.88,
    minAmplitude: number = 25,
    fitAmplitude?: number
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
      PeriodValidator.isZigzagWave(points, amplitude, omega, meanY, fitAmplitude)
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
   * and linear flank slopes instead of smooth, rounded sinusoidal crests.
   *
   * Invariant to stroke velocity, sampling density, and orientation by utilizing:
   * 1. Uniform arc-length resampling (3px step)
   * 2. Directional turn angle at vertices (window = 9px)
   * 3. Mass distribution ratio (mean(|y|) / peak(|y|))
   * 4. Fitted fundamental harmonic amplitude ratio
   *
   * @param points Baseline-aligned points.
   * @param amplitude Peak amplitude of the wave.
   * @param frequency Angular frequency omega (rad/px).
   * @param meanY Baseline mean Y offset.
   * @param fitAmplitude Optional fitted harmonic amplitude from SineFitter.
   */
  public static isZigzagWave(
    points: readonly Point[],
    amplitude: number,
    frequency: number,
    meanY: number,
    fitAmplitude?: number
  ): boolean {
    if (!points || points.length < 10 || amplitude < 15 || frequency <= 0) {
      return false;
    }

    const period = (2 * Math.PI) / frequency;
    if (period <= 0 || !isFinite(period)) return false;

    // 1. Amplitude & Energy Distribution Ratios
    const centeredY = points.map((p) => p.y - meanY);
    const peakY = Math.max(...centeredY.map(Math.abs));
    if (peakY < 15) return false;

    const meanAbsY = centeredY.reduce((sum, y) => sum + Math.abs(y), 0) / centeredY.length;
    const meanAbsRatio = meanAbsY / peakY; // Pure sine: ~0.637, Human sine: 0.50-0.65, Triangle: 0.30-0.42

    const effectiveFitAmp = fitAmplitude ?? amplitude;
    const fitToPeakRatio = effectiveFitAmp / peakY; // Pure sine: ~1.0, Triangle: 0.50-0.68

    // 2. Uniform Arc-Length Resampling (step = 3px) to handle arbitrary drawing speeds / point densities
    let totalLen = 0;
    const dists = [0];
    for (let i = 1; i < points.length; i++) {
      totalLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      dists.push(totalLen);
    }

    if (totalLen < 20) return false;

    const step = 3;
    const uniformPts: Point[] = [];
    let curIdx = 0;
    for (let s = 0; s <= totalLen; s += step) {
      while (curIdx < dists.length - 2 && dists[curIdx + 1] < s) curIdx++;
      const segLen = dists[curIdx + 1] - dists[curIdx];
      const t = segLen > 1e-4 ? (s - dists[curIdx]) / segLen : 0;
      uniformPts.push({
        x: points[curIdx].x + t * (points[curIdx + 1].x - points[curIdx].x),
        y: points[curIdx].y + t * (points[curIdx + 1].y - points[curIdx].y),
      });
    }

    // 3. Directional Turn Angle at Vertices (window = 3 steps = 9px)
    const win = 3;
    let maxTurnDeg = 0;
    let sharpVertexCount = 0;

    for (let i = win; i < uniformPts.length - win; i++) {
      const v1x = uniformPts[i].x - uniformPts[i - win].x;
      const v1y = uniformPts[i].y - uniformPts[i - win].y;
      const v2x = uniformPts[i + win].x - uniformPts[i].x;
      const v2y = uniformPts[i + win].y - uniformPts[i].y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 1e-2 && l2 > 1e-2) {
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        const turnDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
        if (turnDeg > maxTurnDeg) maxTurnDeg = turnDeg;
        if (turnDeg >= 135) sharpVertexCount++;
      }
    }

    // 4. Combined Multi-Factor Decision:
    // A zigzag/triangle wave has:
    // - Sharp vertex reversal: maxTurnDeg >= 135° (or multiple sharp vertices)
    // - AND non-sinusoidal energy distribution: meanAbsRatio < 0.46 OR (fitToPeakRatio < 0.78 && meanAbsRatio < 0.48)
    const hasSharpVertices = maxTurnDeg >= 135 || sharpVertexCount >= 2;
    const hasTriangleEnergy = meanAbsRatio < 0.46 || (fitToPeakRatio < 0.78 && meanAbsRatio < 0.48);

    return hasSharpVertices && hasTriangleEnergy;
  }
}
