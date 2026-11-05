import { Point, FittedSine, TiltResult } from './types';
import { TiltDetector } from './TiltDetector';

export class SineFitter {
  /**
   * Fits a sine model f(x) = A * sin(omega * x + phi) + C to the given points.
   * If points are in raw canvas coordinates, tilt detection and coordinate
   * transformation are performed automatically.
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

    // 1. Detect tilt and transform points to baseline-aligned horizontal frame
    const tilt = precomputedTilt ?? TiltDetector.detectTilt(rawPoints);
    const transformed = TiltDetector.transformPoints(rawPoints, tilt);

    // Sort transformed points along horizontal baseline x
    const sorted = [...transformed].sort((a, b) => a.x - b.x);

    // Filter points to ensure monotonic x progression (avoid backward loop noise)
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

    // 2. Initial parameter estimates
    let minY = Infinity;
    let maxY = -Infinity;
    let sumY = 0;

    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      sumY += p.y;
    }

    const cInit = sumY / pts.length;
    const aInit = Math.max((maxY - minY) / 2, 5.0);

    // Estimate dominant frequency omega from zero crossings
    const crossings: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const y1 = pts[i - 1].y - cInit;
      const y2 = pts[i].y - cInit;
      if ((y1 <= 0 && y2 > 0) || (y1 >= 0 && y2 < 0)) {
        const dy = y2 - y1;
        const t = Math.abs(dy) > 1e-9 ? -y1 / dy : 0.5;
        crossings.push(pts[i - 1].x + t * (pts[i].x - pts[i - 1].x));
      }
    }

    let omegaInit = 0.02;
    if (crossings.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < crossings.length; i++) {
        const diff = crossings[i] - crossings[i - 1];
        if (diff > 5) {
          diffs.push(diff);
        }
      }
      if (diffs.length > 0) {
        const avgHalfPeriod = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        if (avgHalfPeriod > 5) {
          omegaInit = Math.PI / avgHalfPeriod;
        }
      }
    } else {
      const spanX = pts[pts.length - 1].x - pts[0].x;
      if (spanX > 20) {
        omegaInit = (2 * Math.PI) / spanX;
      }
    }

    // Phase coarse grid search: find phase minimizing squared error
    let bestPhi = 0;
    let bestErr = Infinity;
    const phiSteps = 32;
    for (let s = 0; s < phiSteps; s++) {
      const phiCandidate = (s / phiSteps) * (2 * Math.PI);
      let err = 0;
      for (const p of pts) {
        const yPred = aInit * Math.sin(omegaInit * p.x + phiCandidate) + cInit;
        const diff = p.y - yPred;
        err += diff * diff;
      }
      if (err < bestErr) {
        bestErr = err;
        bestPhi = phiCandidate;
      }
    }

    // 3. Optimization using bounded gradient descent
    let a = aInit;
    let omega = omegaInit;
    let phi = bestPhi;
    let c = cInit;

    const maxIterations = 180;

    for (let iter = 0; iter < maxIterations; iter++) {
      let gradA = 0;
      let gradOmega = 0;
      let gradPhi = 0;
      let gradC = 0;

      for (const p of pts) {
        const angle = omega * p.x + phi;
        const sinVal = Math.sin(angle);
        const cosVal = Math.cos(angle);
        const yPred = a * sinVal + c;
        const diff = yPred - p.y;

        gradA += 2 * diff * sinVal;
        gradOmega += 2 * diff * a * cosVal * p.x;
        gradPhi += 2 * diff * a * cosVal;
        gradC += 2 * diff;
      }

      const invN = 1 / pts.length;
      gradA *= invN;
      gradOmega *= invN;
      gradPhi *= invN;
      gradC *= invN;

      a -= Math.max(-3, Math.min(3, gradA * 0.05));
      omega -= Math.max(-0.001, Math.min(0.001, gradOmega * 0.00001));
      phi -= Math.max(-0.05, Math.min(0.05, gradPhi * 0.005));
      c -= Math.max(-3, Math.min(3, gradC * 0.05));

      a = Math.max(1.0, Math.abs(a));
      if (omega < 0.0005) omega = 0.0005;
    }

    // 4. Compute metrics: R² (coefficient of determination)
    let ssTot = 0;
    let ssRes = 0;
    for (const p of pts) {
      ssTot += (p.y - cInit) * (p.y - cInit);
      const yPred = a * Math.sin(omega * p.x + phi) + c;
      const res = p.y - yPred;
      ssRes += res * res;
    }

    let r2 = ssTot > 1e-6 ? 1 - ssRes / ssTot : 0;
    r2 = Math.max(0, Math.min(1.0, r2));

    const spanX = pts[pts.length - 1].x - pts[0].x;
    const fullCycles = (spanX * omega) / (2 * Math.PI);
    const period = (2 * Math.PI) / omega;

    return {
      amplitude: a,
      frequency: omega,
      phase: phi,
      offset: c,
      tilt,
      period,
      fullCycles,
      r2,
    };
  }

  /**
   * Evaluates the fitted sine model at a given horizontal position x in baseline-aligned coordinates.
   */
  public static evaluateAligned(x: number, fit: FittedSine): number {
    return fit.amplitude * Math.sin(fit.frequency * x + fit.phase) + fit.offset;
  }

  /**
   * Generates reference sine curve points in original canvas coordinates suitable for overlay rendering.
   *
   * @param fit FittedSine model.
   * @param minX Minimum baseline-aligned coordinate.
   * @param maxX Maximum baseline-aligned coordinate.
   * @param step Step size in pixels along baseline (default 4px).
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
