import { describe, it, expect } from 'vitest';
import { StrokeBuffer } from './StrokeBuffer';

describe('StrokeBuffer (Coordinate Sampling & Boundary Verification)', () => {
  it('should initialize empty with length 0', () => {
    const buffer = new StrokeBuffer();
    expect(buffer.getLength()).toBe(0);
    expect(buffer.getPoints()).toEqual([]);
    expect(buffer.getBoundingBox()).toBeNull();
  });

  it('should successfully add distinct points', () => {
    const buffer = new StrokeBuffer(2.0);
    expect(buffer.addPoint(10, 20)).toBe(true);
    expect(buffer.addPoint(15, 25)).toBe(true);
    expect(buffer.getLength()).toBe(2);
  });

  it('should reject points closer than minDistance threshold', () => {
    const buffer = new StrokeBuffer(2.0);
    expect(buffer.addPoint(10, 10)).toBe(true);
    // Point at distance 1.0 (dx=1, dy=0) is < minDistance 2.0 -> rejected
    expect(buffer.addPoint(11, 10)).toBe(false);
    expect(buffer.getLength()).toBe(1);

    // Point at distance 2.5 is >= 2.0 -> accepted
    expect(buffer.addPoint(12.5, 10)).toBe(true);
    expect(buffer.getLength()).toBe(2);
  });

  it('should correctly calculate BoundingBox for sampled points', () => {
    const buffer = new StrokeBuffer(1.0);
    buffer.addPoint(10, 50);
    buffer.addPoint(100, 20);
    buffer.addPoint(50, 80);

    const bbox = buffer.getBoundingBox();
    expect(bbox).not.toBeNull();
    expect(bbox?.minX).toBe(10);
    expect(bbox?.maxX).toBe(100);
    expect(bbox?.minY).toBe(20);
    expect(bbox?.maxY).toBe(80);
    expect(bbox?.width).toBe(90);
    expect(bbox?.height).toBe(60);
  });

  it('should handle single point bounding box where width and height are 0', () => {
    const buffer = new StrokeBuffer();
    buffer.addPoint(42, 84);

    const bbox = buffer.getBoundingBox();
    expect(bbox).toEqual({
      minX: 42,
      maxX: 42,
      minY: 84,
      maxY: 84,
      width: 0,
      height: 0,
    });
  });

  it('should clear buffer and reset points and bounding box', () => {
    const buffer = new StrokeBuffer();
    buffer.addPoint(10, 20);
    buffer.addPoint(30, 40);
    expect(buffer.getLength()).toBe(2);

    buffer.clear();
    expect(buffer.getLength()).toBe(0);
    expect(buffer.getBoundingBox()).toBeNull();
  });

  it('should correctly update minX and minY when points decrease', () => {
    const buffer = new StrokeBuffer(1.0);
    buffer.addPoint(50, 50);
    buffer.addPoint(20, 10);
    buffer.addPoint(70, 90);

    const bbox = buffer.getBoundingBox();
    expect(bbox).toEqual({
      minX: 20,
      maxX: 70,
      minY: 10,
      maxY: 90,
      width: 50,
      height: 80,
    });
  });
});
