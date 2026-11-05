import { Point, FittedSine } from './types';
import { TiltDetector } from './TiltDetector';

export interface CoordinateFrame {
  /** Screen position of the baseline start (origin of the drawn wave). */
  readonly origin: Point;
  /** Screen segment for the baseline x'-axis (extends slightly beyond curve span). */
  readonly baselineAxis: { readonly start: Point; readonly end: Point };
  /** Screen segment for the perpendicular y'-axis at origin (height proportional to amplitude). */
  readonly verticalAxis: { readonly start: Point; readonly end: Point };
  /** Tilt angle in radians. */
  readonly angle: number;
}

/**
 * CoordinateSystem calculates the reference coordinate frame (origin, baseline axis, and vertical axis)
 * for a fitted sine curve in screen coordinates.
 */
export class CoordinateSystem {
  /**
   * Computes the screen-space coordinate frame for a given fitted sine wave and stroke points.
   *
   * @param fit The fitted sine wave parameters.
   * @param points The original screen-space stroke points.
   * @param axisPadding Padding in pixels to extend the baseline axis beyond stroke bounds (default 25).
   */
  public static computeFrame(
    fit: FittedSine,
    points: readonly Point[],
    axisPadding: number = 25
  ): CoordinateFrame {
    const { angle, centroid } = fit.tilt;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    if (!points || points.length === 0) {
      return {
        origin: { x: centroid.x, y: centroid.y },
        baselineAxis: {
          start: { x: centroid.x - axisPadding * cosA, y: centroid.y - axisPadding * sinA },
          end: { x: centroid.x + axisPadding * cosA, y: centroid.y + axisPadding * sinA },
        },
        verticalAxis: {
          start: { x: centroid.x + axisPadding * sinA, y: centroid.y - axisPadding * cosA },
          end: { x: centroid.x - axisPadding * sinA, y: centroid.y + axisPadding * cosA },
        },
        angle,
      };
    }

    // Align points to determine bounds along the baseline axis (x')
    const aligned = TiltDetector.transformPoints(points, fit.tilt);
    let minX = aligned[0].x;
    let maxX = aligned[0].x;

    for (let i = 1; i < aligned.length; i++) {
      if (aligned[i].x < minX) minX = aligned[i].x;
      if (aligned[i].x > maxX) maxX = aligned[i].x;
    }

    // Origin is at x' = minX, y' = 0 (baseline start)
    const origin: Point = {
      x: centroid.x + minX * cosA,
      y: centroid.y + minX * sinA,
    };

    // Baseline axis spans from minX - axisPadding to maxX + axisPadding along y' = 0
    const startXPrime = minX - axisPadding;
    const endXPrime = maxX + axisPadding;

    const baselineAxis = {
      start: {
        x: centroid.x + startXPrime * cosA,
        y: centroid.y + startXPrime * sinA,
      },
      end: {
        x: centroid.x + endXPrime * cosA,
        y: centroid.y + endXPrime * sinA,
      },
    };

    // Vertical axis at origin (x' = minX), spanning [-amp, +amp]
    const axisAmp = Math.max(fit.amplitude * 1.25, 30);
    const verticalAxis = {
      start: {
        x: origin.x + axisAmp * sinA,
        y: origin.y - axisAmp * cosA,
      },
      end: {
        x: origin.x - axisAmp * sinA,
        y: origin.y + axisAmp * cosA,
      },
    };

    return {
      origin,
      baselineAxis,
      verticalAxis,
      angle,
    };
  }
}
