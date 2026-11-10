import { Point, FittedSine, TiltResult } from './types';
import { TiltDetector } from './TiltDetector';

export class SineFitter {
  /**
   * Trims involuntary pointerup liftoff hooks in baseline-aligned coordinates where movement
   * along the baseline (u) stalls or reverses while oscillating perpendicularly (v).
   */
  public static trimTerminalHook(points: readonly Point[]): Point[] {
    if (points.length < 15) return [...points];

    const maxInspect = Math.min(25, Math.floor(points.length * 0.18));
    let cutIndex = points.length;

    for (let i = points.length - 1; i >= points.length - maxInspect; i--) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const du = p2.x - p1.x;
      const dv = Math.abs(p2.y - p1.y);

      // Hook signature: no forward progress along baseline (du <= 0.8), but vertical excursion (dv >= 2.5)
      if (du <= 0.8 && dv >= 2.5) {
        cutIndex = i - 1;
      } else {
        break;
      }
    }

    return cutIndex >= 10 ? points.slice(0, cutIndex) : [...points];
  }

  /**
   * Solves the linear least squares (OLS) system for harmonic parameters (c1, c2, c3)
   * where y(x) = c1 * sin(omega * x) + c2 * cos(omega * x) + c3.
   * Returns amplitude A = sqrt(c1^2 + c2^2), phase phi = atan2(c2, c1), offset C = c3, and RSS.
   */
  public static solveHarmonicOLS(
    pts: readonly Point[],
    omega: number
  ): { a: number; phi: number; c: number; rss: number } | null {
    const n = pts.length;
    if (n < 4) return null;

    let s11 = 0, s12 = 0, s13 = 0;
    let s22 = 0, s23 = 0, s33 = n;
    let v1 = 0, v2 = 0, v3 = 0;

    for (let i = 0; i < n; i++) {
      const angle = omega * pts[i].x;
      const s = Math.sin(angle);
      const c = Math.cos(angle);
      const y = pts[i].y;

      s11 += s * s;
      s12 += s * c;
      s13 += s;
      s22 += c * c;
      s23 += c;

      v1 += y * s;
      v2 += y * c;
      v3 += y;
    }

    // Determinant of symmetric 3x3 normal equation matrix:
    // [ s11 s12 s13 ]
    // [ s12 s22 s23 ]
    // [ s13 s23 s33 ]
    const det =
      s11 * (s22 * s33 - s23 * s23) -
      s12 * (s12 * s33 - s23 * s13) +
      s13 * (s12 * s23 - s22 * s13);

    if (Math.abs(det) < 1e-9) return null;

    const invDet = 1 / det;

    const det1 =
      v1 * (s22 * s33 - s23 * s23) -
      v2 * (s12 * s33 - s23 * s13) +
      v3 * (s12 * s23 - s22 * s13);

    const det2 =
      -v1 * (s12 * s33 - s23 * s13) +
      v2 * (s11 * s33 - s13 * s13) -
      v3 * (s11 * s23 - s12 * s13);

    const det3 =
      v1 * (s12 * s23 - s22 * s13) -
      v2 * (s11 * s23 - s12 * s13) +
      v3 * (s11 * s22 - s12 * s12);

    const c1 = det1 * invDet;
    const c2 = det2 * invDet;
    const c3 = det3 * invDet;

    const a = Math.hypot(c1, c2);
    const phi = Math.atan2(c2, c1);
    const offset = c3;

    let rss = 0;
    for (let i = 0; i < n; i++) {
      const yPred = c1 * Math.sin(omega * pts[i].x) + c2 * Math.cos(omega * pts[i].x) + c3;
      const diff = pts[i].y - yPred;
      rss += diff * diff;
    }

    return { a, phi, c: offset, rss };
  }

  /**
   * Fits a harmonic sine wave model f(u) = A * sin(omega * u + phi) + C to the given points
   * using a specific pre-defined coordinate tilt.
   */
  public static fitWithTilt(
    rawPoints: readonly Point[],
    tilt: TiltResult
  ): FittedSine | null {
    if (!rawPoints || rawPoints.length < 8) {
      return null;
    }

    // 1. Transform points to baseline-aligned frame
    const transformed = TiltDetector.transformPoints(rawPoints, tilt);

    // 2. Trim terminal liftoff hook in baseline coordinates
    const cleanedPoints = SineFitter.trimTerminalHook(transformed);

    // Sort transformed points along horizontal baseline u
    const sorted = [...cleanedPoints].sort((a, b) => a.x - b.x);

    // Filter points to ensure monotonic x progression
    const pts: Point[] = [];
    let lastX = -Infinity;
    for (const p of sorted) {
      if (p.x > lastX + 0.5) {
        pts.push(p);
        lastX = p.x;
      }
    }

    if (pts.length < 6) {
      return null;
    }

    const spanX = pts[pts.length - 1].x - pts[0].x;
    if (spanX <= 10) {
      return null;
    }

    // Compute total sum of squares for R²
    let sumY = 0;
    for (const p of pts) sumY += p.y;
    const meanY = sumY / pts.length;

    let ssTot = 0;
    for (const p of pts) {
      const diff = p.y - meanY;
      ssTot += diff * diff;
    }

    // 3. Dense Harmonic Frequency Scan (0.5 to 6.5 cycles across stroke span)
    const minCycles = 0.5;
    const maxCycles = 6.5;
    const cycleStep = 0.03;

    let bestOmega = (1.0 * 2 * Math.PI) / spanX;
    let bestRss = Infinity;
    let bestFit = SineFitter.solveHarmonicOLS(pts, bestOmega);
    if (bestFit) bestRss = bestFit.rss;

    for (let cycles = minCycles; cycles <= maxCycles; cycles += cycleStep) {
      const omega = (cycles * 2 * Math.PI) / spanX;
      const res = SineFitter.solveHarmonicOLS(pts, omega);
      if (res && res.rss < bestRss) {
        bestRss = res.rss;
        bestOmega = omega;
        bestFit = res;
      }
    }

    if (!bestFit) {
      return null;
    }

    // 4. Golden Section Search Refinement around bestOmega
    const deltaOmega = (cycleStep * 2 * Math.PI) / spanX;
    let aRange = Math.max((0.3 * 2 * Math.PI) / spanX, bestOmega - deltaOmega);
    let bRange = bestOmega + deltaOmega;
    const gr = (Math.sqrt(5) - 1) / 2;

    let cRange = bRange - gr * (bRange - aRange);
    let dRange = aRange + gr * (bRange - aRange);

    for (let iter = 0; iter < 18; iter++) {
      const resC = SineFitter.solveHarmonicOLS(pts, cRange);
      const resD = SineFitter.solveHarmonicOLS(pts, dRange);
      const rssC = resC ? resC.rss : Infinity;
      const rssD = resD ? resD.rss : Infinity;

      if (rssC < rssD) {
        bRange = dRange;
        dRange = cRange;
        cRange = bRange - gr * (bRange - aRange);
      } else {
        aRange = cRange;
        cRange = dRange;
        dRange = aRange + gr * (bRange - aRange);
      }
    }

    const optimalOmega = (aRange + bRange) / 2;
    const optimalFit = SineFitter.solveHarmonicOLS(pts, optimalOmega);
    if (!optimalFit) {
      return null;
    }

    // 5. Compute metrics: R² (coefficient of determination)
    let r2 = ssTot > 1e-6 ? 1 - optimalFit.rss / ssTot : 0;
    r2 = Math.max(0, Math.min(1.0, r2));

    const fullCycles = (spanX * optimalOmega) / (2 * Math.PI);
    const period = (2 * Math.PI) / optimalOmega;

    return {
      amplitude: optimalFit.a,
      frequency: optimalOmega,
      phase: optimalFit.phi,
      offset: optimalFit.c,
      tilt,
      period,
      fullCycles,
      r2,
    };
  }

  /**
   * Fits a harmonic sine wave model f(u) = A * sin(omega * u + phi) + C to the given points.
   * Uses Harmonic Linear Least Squares (Lomb-Scargle / OLS Closed Form) across human drawing frequencies,
   * completely eliminating local-minima traps from peak-counting heuristics or gradient descent.
   *
   * @param rawPoints Sequence of sampled 2D points.
   * @param precomputedTilt Optional pre-computed TiltResult.
   * @returns FittedSine model parameters, or null if points are insufficient.
   */
  public static fit(
    rawPoints: readonly Point[],
    precomputedTilt?: TiltResult
  ): FittedSine | null {
    if (!rawPoints || rawPoints.length < 8) {
      return null;
    }

    if (precomputedTilt) {
      return SineFitter.fitWithTilt(rawPoints, precomputedTilt);
    }

    const defaultTilt = TiltDetector.detectTilt(rawPoints);
    const defaultFit = SineFitter.fitWithTilt(rawPoints, defaultTilt);

    // For non-horizontal diagonal strokes, evaluate whether mass PCA baseline improves the harmonic fit
    if (
      defaultTilt.angle !== 0 &&
      Math.abs(defaultTilt.angle) !== Math.PI &&
      Math.abs(Math.abs(defaultTilt.angle) - Math.PI / 2) > 1e-4
    ) {
      const pcaTilt = TiltDetector.computePCATilt(rawPoints);
      if (Math.abs(pcaTilt.angle - defaultTilt.angle) > (1.5 * Math.PI) / 180) {
        const pcaFit = SineFitter.fitWithTilt(rawPoints, pcaTilt);
        if (pcaFit && defaultFit) {
          return pcaFit.r2 > defaultFit.r2 ? pcaFit : defaultFit;
        } else if (pcaFit) {
          return pcaFit;
        }
      }
    }

    return defaultFit;
  }

  /**
   * Evaluates the fitted sine model at a given horizontal position x in baseline-aligned coordinates.
   */
  public static evaluateAligned(x: number, fit: FittedSine): number {
    return fit.amplitude * Math.sin(fit.frequency * x + fit.phase) + fit.offset;
  }

  /**
   * Generates reference sine curve points in original canvas coordinates suitable for overlay rendering.
   */
  public static generateFittedCurve(
    fit: FittedSine,
    minX: number,
    maxX: number,
    step: number = 4
  ): Point[] {
    const points: Point[] = [];
    for (let x = minX; x <= maxX; x += step) {
      const y = this.evaluateAligned(x, fit);
      const canvasPt = TiltDetector.inverseTransformPoint({ x, y }, fit.tilt);
      points.push(canvasPt);
    }
    return points;
  }
}
