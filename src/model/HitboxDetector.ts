import { Point } from './types';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * HitboxDetector provides collision and target proximity detection for interactive UI elements.
 * Conforms to WCAG 2.5.5 / Apple Human Interface Guidelines for accessible touch targets (>= 44x44px).
 */
export class HitboxDetector {
  /** Standard minimum touch target radius in pixels (diameter = 48px >= 44px). */
  public static readonly MIN_ACCESSIBLE_RADIUS = 24;

  /**
   * Calculates Euclidean distance between two points.
   */
  public static distance(p1: Point, p2: Point): number {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  /**
   * Checks if a point lies within a circular hitbox.
   *
   * @param point The test point (e.g. pointer coordinates).
   * @param center The circle center.
   * @param radius The circle radius. Must be >= 0.
   */
  public static isPointInCircle(point: Point, center: Point, radius: number): boolean {
    if (radius < 0) return false;
    return this.distance(point, center) <= radius;
  }

  /**
   * Checks if a pointer interaction targets the coordinate origin marker,
   * enforcing the accessible minimum target size (>= 44x44px, radius >= 22px).
   *
   * @param pointer The pointer position.
   * @param origin The coordinate system origin.
   * @param customRadius Optional custom radius (defaults to 24px, clamped to min 22px).
   */
  public static isOriginHit(
    pointer: Point,
    origin: Point,
    customRadius: number = HitboxDetector.MIN_ACCESSIBLE_RADIUS
  ): boolean {
    const effectiveRadius = Math.max(customRadius, 22);
    return this.isPointInCircle(pointer, origin, effectiveRadius);
  }

  /**
   * Checks if a point lies within an axis-aligned rectangular hitbox.
   */
  public static isPointInRect(point: Point, rect: Rect): boolean {
    if (rect.width < 0 || rect.height < 0) return false;
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }
}
