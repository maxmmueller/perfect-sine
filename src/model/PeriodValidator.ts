import { Point, PeriodValidationResult } from './types';

/**
 * PeriodValidator verifies that a drawn curve satisfies the V-Model acceptance criteria:
 * it must span at least one harmonic cycle, with a natural drawing tolerance of ~0.88 - 0.90 periods.
 */
export class PeriodValidator {
  /**
   * Analyzes baseline-aligned points and validates period coverage.
   *
   * @param points Baseline-aligned points (x along baseline, y oscillating around offset).
   * @param overrideFrequency Optional known frequency omega (rad/px). If omitted, estimated from zero-crossings and extrema.
   * @param minCycles Minimum full cycles required (defaults to 0.88 = ~0.9 period tolerance).
   */
  public static validate(
    points: readonly Point[],
    overrideFrequency?: number,
    minCycles: number = 0.88
  ): PeriodValidationResult {
    if (!points || points.length < 5) {
      return {
        isValid: false,
        fullCycles: 0,
        totalSpan: 0,
        zeroCrossingsCount: 0,
        message: 'Insufficient points to determine period.',
      };
    }

    // Determine baseline span along x-axis and compute mean
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
        message: 'Curve has zero baseline span.',
      };
    }

    const amplitude = (maxY - minY) / 2;
    if (amplitude < 1.0) {
      return {
        isValid: false,
        fullCycles: 0,
        totalSpan: 0,
        zeroCrossingsCount: 0,
        message: 'Curve amplitude is too flat to form a wave.',
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
          message: 'Curve does not exhibit alternating harmonic peaks and troughs.',
        };
      }
    }

    // Angular span = baselineSpan * omega
    const totalSpan = baselineSpan * omega;
    const fullCycles = totalSpan / (2 * Math.PI);

    // Curve is valid if it covers at least minCycles (~0.88 - 0.90 tolerance) and exhibits harmonic alternation
    const hasAlternation = crossings.length >= 2 || (peaks.length >= 1 && troughs.length >= 1);
    const isValid = fullCycles >= minCycles && hasAlternation;

    return {
      isValid,
      fullCycles,
      totalSpan,
      zeroCrossingsCount: crossings.length,
      message: isValid
        ? `Valid period: ${fullCycles.toFixed(2)} cycles.`
        : `Curve spans only ${fullCycles.toFixed(2)} cycles. At least ~0.9 full period is required.`,
    };
  }
}
