import { Point, BoundingBox } from './types';

/**
 * StrokeBuffer
 * Stores, normalizes, and filters sampled user stroke points.
 * Zero DOM dependency for headless verification.
 */
export class StrokeBuffer {
  private points: Point[] = [];
  private readonly minDistanceSquared: number;

  /**
   * @param minDistance Minimum Euclidean distance in px between consecutive sampled points to reduce noise.
   */
  constructor(minDistance: number = 2.0) {
    this.minDistanceSquared = minDistance * minDistance;
  }

  public addPoint(x: number, y: number, time: number = Date.now()): boolean {
    if (this.points.length > 0) {
      const lastPoint = this.points[this.points.length - 1];
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      if (dx * dx + dy * dy < this.minDistanceSquared) {
        return false;
      }
    }

    this.points.push({ x, y, time });
    return true;
  }

  public getPoints(): readonly Point[] {
    return this.points;
  }

  public getLength(): number {
    return this.points.length;
  }

  public clear(): void {
    this.points = [];
  }

  public getBoundingBox(): BoundingBox | null {
    if (this.points.length === 0) {
      return null;
    }

    let minX = this.points[0].x;
    let maxX = this.points[0].x;
    let minY = this.points[0].y;
    let maxY = this.points[0].y;

    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
}
