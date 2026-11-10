import { Point, TiltResult } from './types';

/**
 * TiltDetector analyzes an arbitrary 2D stroke using Principal Component Analysis (PCA)
 * and stroke directional analysis to determine its dominant baseline tilt angle,
 * providing affine coordinate transforms to project coordinates into a horizontal reference frame.
 */
export class TiltDetector {
  /**
   * Computes the PCA principal orientation directly from the covariance matrix of the point cloud,
   * directed along stroke travel.
   */
  public static computePCATilt(points: readonly Point[]): TiltResult {
    if (points.length === 0) {
      return { angle: 0, centroid: { x: 0, y: 0 } };
    }

    if (points.length === 1) {
      return { angle: 0, centroid: { x: points[0].x, y: points[0].y } };
    }

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < points.length; i++) {
      sumX += points[i].x;
      sumY += points[i].y;
    }
    const meanX = sumX / points.length;
    const meanY = sumY / points.length;

    let covXX = 0;
    let covYY = 0;
    let covXY = 0;

    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - meanX;
      const dy = points[i].y - meanY;
      covXX += dx * dx;
      covYY += dy * dy;
      covXY += dx * dy;
    }

    covXX /= points.length;
    covYY /= points.length;
    covXY /= points.length;

    if (covXX + covYY < 1e-12) {
      return { angle: 0, centroid: { x: meanX, y: meanY } };
    }

    // Principal orientation from 2x2 covariance eigenvectors (PCA):
    // tan(2 * theta) = 2 * covXY / (covXX - covYY)
    let pcaTheta = 0.5 * Math.atan2(2 * covXY, covXX - covYY);

    const first = points[0];
    const last = points[points.length - 1];
    const strokeDx = last.x - first.x;
    const strokeDy = last.y - first.y;

    // Direct PCA angle along stroke travel
    const dot = strokeDx * Math.cos(pcaTheta) + strokeDy * Math.sin(pcaTheta);
    if (dot < 0) {
      pcaTheta = pcaTheta > 0 ? pcaTheta - Math.PI : pcaTheta + Math.PI;
    }

    return {
      angle: pcaTheta,
      centroid: { x: meanX, y: meanY },
    };
  }

  /**
   * Computes the centroid and baseline tilt angle of the given point cloud.
   * Directs the angle from stroke start to stroke end.
   */
  public static detectTilt(points: readonly Point[]): TiltResult {
    if (points.length === 0) {
      return { angle: 0, centroid: { x: 0, y: 0 } };
    }

    if (points.length === 1) {
      return { angle: 0, centroid: { x: points[0].x, y: points[0].y } };
    }

    const pcaTilt = TiltDetector.computePCATilt(points);
    const pcaTheta = pcaTilt.angle;

    const first = points[0];
    const last = points[points.length - 1];
    const strokeDx = last.x - first.x;
    const strokeDy = last.y - first.y;
    const chordDist = Math.hypot(strokeDx, strokeDy);
    const chordTheta = Math.atan2(strokeDy, strokeDx);
    const rawAngle = chordDist >= 15 ? chordTheta : pcaTheta;

    // 4. Robust Baseline Orientation:
    // Pure endpoint chords (first -> last) can exhibit a 15-20° slant when a wave starts at a trough
    // and ends at a peak or liftoff flick. Conversely, PCA measures the primary axis of variance
    // across the entire stroke mass, which remains invariant (< 3° deviation) on horizontal waves.
    // For near-horizontal strokes (either chord or PCA within 10° of 0 or ±PI), snap to exact horizontal.
    // For near-vertical strokes (within 10° of ±PI/2), snap to exact vertical.
    // For intentional diagonal strokes (>= 10°), chord vector defines the baseline.
    const snapThreshold = (10 * Math.PI) / 180; // 10° horizontal snap tolerance
    const verticalSnapThreshold = (10 * Math.PI) / 180; // 10° vertical snap tolerance
    let finalAngle = rawAngle;

    // Check near-horizontal left-to-right (around 0)
    const isNearHorizontalLTR =
      Math.abs(chordTheta) < snapThreshold || Math.abs(pcaTheta) < snapThreshold;

    // Check near-horizontal right-to-left (around ±PI)
    const isNearHorizontalRTL =
      Math.abs(Math.abs(chordTheta) - Math.PI) < snapThreshold ||
      Math.abs(Math.abs(pcaTheta) - Math.PI) < snapThreshold;

    // Check near-vertical (around ±PI/2)
    const isNearVertical =
      Math.abs(Math.abs(chordTheta) - Math.PI / 2) < verticalSnapThreshold ||
      Math.abs(Math.abs(pcaTheta) - Math.PI / 2) < verticalSnapThreshold;

    if (isNearHorizontalLTR) {
      finalAngle = 0; // Pure left-to-right horizontal
    } else if (isNearHorizontalRTL) {
      finalAngle = Math.sign(rawAngle) * Math.PI; // Pure right-to-left horizontal
    } else if (isNearVertical) {
      finalAngle = Math.sign(rawAngle) * (Math.PI / 2); // Vertical
    }

    return {
      angle: finalAngle,
      centroid: pcaTilt.centroid,
    };
  }

  /**
   * Transforms a set of points from canvas coordinates into a baseline-aligned coordinate frame,
   * where the principal axis is rotated to horizontal (x-axis) centered at (0, 0).
   */
  public static transformPoints(
    points: readonly Point[],
    tilt: TiltResult
  ): Point[] {
    const cos = Math.cos(-tilt.angle);
    const sin = Math.sin(-tilt.angle);
    const { x: cx, y: cy } = tilt.centroid;

    return points.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        x: dx * cos - dy * sin,
        y: dx * sin + dy * cos,
        time: p.time,
      };
    });
  }

  /**
   * Transforms a point back from baseline-aligned coordinate frame to original canvas coordinates.
   */
  public static inverseTransformPoint(
    point: Point,
    tilt: TiltResult
  ): Point {
    const cos = Math.cos(tilt.angle);
    const sin = Math.sin(tilt.angle);
    const { x: cx, y: cy } = tilt.centroid;

    return {
      x: point.x * cos - point.y * sin + cx,
      y: point.x * sin + point.y * cos + cy,
      time: point.time,
    };
  }
}
