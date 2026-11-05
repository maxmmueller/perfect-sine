import { describe, it, expect } from 'vitest';
import { HitboxDetector } from './HitboxDetector';

describe('HitboxDetector (Boundary Value & Accessibility Tests)', () => {
  it('should calculate Euclidean distance correctly', () => {
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 30, y: 40 };
    expect(HitboxDetector.distance(p1, p2)).toBe(50);
  });

  describe('isPointInCircle', () => {
    const center = { x: 100, y: 100 };
    const radius = 25;

    it('should return true for points inside the circle', () => {
      expect(HitboxDetector.isPointInCircle({ x: 100, y: 100 }, center, radius)).toBe(true);
      expect(HitboxDetector.isPointInCircle({ x: 110, y: 110 }, center, radius)).toBe(true);
    });

    it('should return true for points exactly on the boundary (boundary condition)', () => {
      expect(HitboxDetector.isPointInCircle({ x: 125, y: 100 }, center, radius)).toBe(true);
      expect(HitboxDetector.isPointInCircle({ x: 100, y: 75 }, center, radius)).toBe(true);
    });

    it('should return false for points outside the circle', () => {
      expect(HitboxDetector.isPointInCircle({ x: 126, y: 100 }, center, radius)).toBe(false);
      expect(HitboxDetector.isPointInCircle({ x: 200, y: 200 }, center, radius)).toBe(false);
    });

    it('should return false for negative radius', () => {
      expect(HitboxDetector.isPointInCircle({ x: 100, y: 100 }, center, -5)).toBe(false);
    });
  });

  describe('isOriginHit (WCAG >= 44x44px target requirement)', () => {
    const origin = { x: 200, y: 300 };

    it('should detect hits within default accessible radius (24px)', () => {
      expect(HitboxDetector.isOriginHit({ x: 200, y: 300 }, origin)).toBe(true);
      expect(HitboxDetector.isOriginHit({ x: 220, y: 300 }, origin)).toBe(true);
      expect(HitboxDetector.isOriginHit({ x: 225, y: 300 }, origin)).toBe(false);
    });

    it('should enforce minimum radius of 22px even if smaller custom radius is passed', () => {
      // 22px radius guarantees 44x44px minimum touch target size
      expect(HitboxDetector.isOriginHit({ x: 221, y: 300 }, origin, 10)).toBe(true);
      expect(HitboxDetector.isOriginHit({ x: 223, y: 300 }, origin, 10)).toBe(false);
    });
  });

  describe('isPointInRect', () => {
    const rect = { x: 50, y: 50, width: 100, height: 60 };

    it('should return true for points inside the rectangle', () => {
      expect(HitboxDetector.isPointInRect({ x: 80, y: 70 }, rect)).toBe(true);
    });

    it('should return true for points on all 4 boundaries and corners', () => {
      expect(HitboxDetector.isPointInRect({ x: 50, y: 50 }, rect)).toBe(true);
      expect(HitboxDetector.isPointInRect({ x: 150, y: 50 }, rect)).toBe(true);
      expect(HitboxDetector.isPointInRect({ x: 150, y: 110 }, rect)).toBe(true);
      expect(HitboxDetector.isPointInRect({ x: 50, y: 110 }, rect)).toBe(true);
    });

    it('should return false for points outside bounds', () => {
      expect(HitboxDetector.isPointInRect({ x: 49, y: 70 }, rect)).toBe(false);
      expect(HitboxDetector.isPointInRect({ x: 151, y: 70 }, rect)).toBe(false);
      expect(HitboxDetector.isPointInRect({ x: 80, y: 49 }, rect)).toBe(false);
      expect(HitboxDetector.isPointInRect({ x: 80, y: 111 }, rect)).toBe(false);
    });

    it('should return false for invalid negative rectangle dimensions', () => {
      expect(HitboxDetector.isPointInRect({ x: 50, y: 50 }, { x: 50, y: 50, width: -10, height: 10 })).toBe(false);
      expect(HitboxDetector.isPointInRect({ x: 50, y: 50 }, { x: 50, y: 50, width: 10, height: -10 })).toBe(false);
    });
  });
});
