import { Point, FittedSine, TiltResult } from './types';
import { TiltDetector } from './TiltDetector';

export class SineFitter {
  /**
   * Fits a harmonic sine wave model f(u) = A * sin(omega * u + phi) + C to the given points.
   * Employs peak-to-peak extrema analysis and a multi-scale grid search to accurately identify
   * the true macroscopic wave frequency, preventing local-minima traps from hand tremors.
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

    // 1. Detect baseline tilt and transform points to horizontal frame
    const tilt = precomputedTilt ?? TiltDetector.detectTilt(rawPoints);
    const transformed = TiltDetector.transformPoints(rawPoints, tilt);

    // Sort transformed points along horizontal baseline u
    const sorted = [...transformed].sort((a, b) => a.x - b.x);

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
    const spanX = pts[pts.length - 1].x - pts[0].x;

    if (spanX <= 5) {
      return null;
    }

    // 3. Robust dominant frequency estimation using Prominent Extrema (Peak/Trough) Analysis
    const window = Math.max(3, Math.floor(pts.length / 25));
    const peaks: number[] = [];
    const troughs: number[] = [];
    const prominenceThreshold = 0.15 * aInit;

    for (let i = window; i < pts.length - window; i++) {
      let isMax = true;
      let isMin = true;
      for (let j = i - window; j <= i + window; j++) {
        if (pts[j].y > pts[i].y) isMax = false;
        if (pts[j].y < pts[i].y) isMin = false;
      }
      if (isMax && pts[i].y > cInit + prominenceThreshold) {
        peaks.push(pts[i].x);
      }
      if (isMin && pts[i].y < cInit - prominenceThreshold) {
        troughs.push(pts[i].x);
      }
    }

    // Estimate candidate period T
    const periodEstimates: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const d = peaks[i] - peaks[i - 1];
      if (d > 20) periodEstimates.push(d);
    }
    for (let i = 1; i < troughs.length; i++) {
      const d = troughs[i] - troughs[i - 1];
      if (d > 20) periodEstimates.push(d);
    }

    let omegaInit: number;

    if (periodEstimates.length > 0) {
      periodEstimates.sort((a, b) => a - b);
      const medianPeriod = periodEstimates[Math.floor(periodEstimates.length / 2)];
      omegaInit = (2 * Math.PI) / medianPeriod;
    } else if (peaks.length >= 1 && troughs.length >= 1) {
      // Half-period from closest peak-to-trough distance
      let minPTDist = Infinity;
      for (const p of peaks) {
        for (const t of troughs) {
          const dist = Math.abs(p - t);
          if (dist > 15 && dist < minPTDist) {
            minPTDist = dist;
          }
        }
      }
      if (minPTDist !== Infinity) {
        omegaInit = Math.PI / minPTDist;
      } else {
        omegaInit = (2 * Math.PI) / spanX;
      }
    } else {
      // Default to 1 full period over the span
      omegaInit = (2 * Math.PI) / spanX;
    }

    // Clamp omegaInit to physically realistic human drawing frequencies
    // Typically between 0.5 cycles and 8 cycles across the stroke span
    const minOmega = (0.5 * 2 * Math.PI) / spanX;
    const maxOmega = (8.0 * 2 * Math.PI) / spanX;
    omegaInit = Math.max(minOmega, Math.min(maxOmega, omegaInit));

    // 4. Multi-scale Grid Search around omegaInit and phase phi to find global basin of attraction
    let bestOmega = omegaInit;
    let bestPhi = 0;
    let bestErr = Infinity;

    const omegaMultipliers = [0.75, 0.85, 0.93, 1.0, 1.07, 1.15, 1.25];
    const phiSteps = 24;

    for (const mult of omegaMultipliers) {
      const candidateOmega = omegaInit * mult;
      for (let s = 0; s < phiSteps; s++) {
        const candidatePhi = (s / phiSteps) * (2 * Math.PI);
        let err = 0;
        for (const p of pts) {
          const yPred = aInit * Math.sin(candidateOmega * p.x + candidatePhi) + cInit;
          const diff = p.y - yPred;
          err += diff * diff;
        }
        if (err < bestErr) {
          bestErr = err;
          bestOmega = candidateOmega;
          bestPhi = candidatePhi;
        }
      }
    }

    // 5. Polishing using bounded gradient descent from optimal grid seed
    let a = aInit;
    let omega = bestOmega;
    let phi = bestPhi;
    let c = cInit;

    const maxIterations = 120;
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

      a -= Math.max(-4, Math.min(4, gradA * 0.05));
      omega -= Math.max(-0.0005, Math.min(0.0005, gradOmega * 0.000005));
      phi -= Math.max(-0.05, Math.min(0.05, gradPhi * 0.005));
      c -= Math.max(-4, Math.min(4, gradC * 0.05));

      a = Math.max(1.0, Math.abs(a));
      omega = Math.max(minOmega * 0.8, Math.min(maxOmega * 1.2, omega));
    }

    // 6. Compute metrics: R² (coefficient of determination)
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
