import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasView } from './CanvasView';
import { PointDeviation } from '../model/types';

describe('CanvasView', () => {
  let mockCtx: any;
  let mockCanvas: any;

  beforeEach(() => {
    mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 50 })),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
      globalAlpha: 1,
      shadowBlur: 0,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
    };

    mockCanvas = {
      getContext: vi.fn(() => mockCtx),
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
      }),
      width: 800,
      height: 600,
    };
  });

  it('should initialize and scale with device pixel ratio', () => {
    const view = new CanvasView(mockCanvas);
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    const dims = view.getDimensions();
    expect(dims.width).toBe(800);
    expect(dims.height).toBe(600);
  });

  it('should throw if 2D context is missing', () => {
    const invalidCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => new CanvasView(invalidCanvas)).toThrow('Canvas 2D context is not available');
  });

  it('should clear canvas and draw grid', () => {
    const view = new CanvasView(mockCanvas);
    view.clear();
    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(mockCtx.beginPath).toHaveBeenCalled();
  });

  it('should render evaluated stroke with gradient colors and custom alpha', () => {
    const view = new CanvasView(mockCanvas);
    const deviations: PointDeviation[] = [
      {
        point: { x: 10, y: 20 },
        distance: 1.5,
        normalizedError: 0.05,
        hue: 114,
        color: 'hsl(114, 100%, 50%)',
      },
      {
        point: { x: 30, y: 40 },
        distance: 2.0,
        normalizedError: 0.06,
        hue: 112,
        color: 'hsl(112, 100%, 50%)',
      },
    ];

    view.renderEvaluatedStroke(deviations, 4, 0.65);
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.globalAlpha).toBeCloseTo(0.65, 2);
    expect(mockCtx.lineWidth).toBe(4);
    expect(mockCtx.createLinearGradient).toHaveBeenCalledWith(10, 20, 30, 40);
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('should skip rendering evaluated stroke when deviations < 2 or alpha <= 0.005', () => {
    const view = new CanvasView(mockCanvas);
    mockCtx.save.mockClear();

    view.renderEvaluatedStroke([]);
    expect(mockCtx.save).not.toHaveBeenCalled();

    const singleDev: PointDeviation[] = [
      {
        point: { x: 10, y: 20 },
        distance: 0,
        normalizedError: 0,
        hue: 120,
        color: 'hsl(120, 100%, 50%)',
      },
    ];
    view.renderEvaluatedStroke(singleDev);
    expect(mockCtx.save).not.toHaveBeenCalled();

    const validDevs: PointDeviation[] = [
      singleDev[0],
      {
        point: { x: 20, y: 30 },
        distance: 1,
        normalizedError: 0.03,
        hue: 116,
        color: 'hsl(116, 100%, 50%)',
      },
    ];
    view.renderEvaluatedStroke(validDevs, 3.5, 0.001);
    expect(mockCtx.save).not.toHaveBeenCalled();
  });

  it('should render plain strokes and guidelines', () => {
    const view = new CanvasView(mockCanvas);
    view.renderStroke([{ x: 10, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 40 }]);
    expect(mockCtx.stroke).toHaveBeenCalled();

    view.renderFittedSineGuideline([{ x: 10, y: 20 }, { x: 20, y: 30 }]);
    expect(mockCtx.setLineDash).toHaveBeenCalledWith([6, 6]);
  });

  it('should consistently render wave tracer for all tiers including low tier', () => {
    const view = new CanvasView(mockCanvas);
    const deviations: PointDeviation[] = [
      { point: { x: 0, y: 100 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
      { point: { x: 100, y: 150 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
      { point: { x: 200, y: 100 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
    ];

    mockCtx.save.mockClear();
    mockCtx.arc.mockClear();

    // Low tier MUST consistently render (user requirement)
    view.renderWaveTracer(deviations, 0.5, 'low');
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.arc).toHaveBeenCalled();

    // Boundary conditions
    mockCtx.save.mockClear();
    view.renderWaveTracer(deviations, 0, 'low');
    expect(mockCtx.save).not.toHaveBeenCalled();

    view.renderWaveTracer(deviations, 1.2, 'low');
    expect(mockCtx.save).not.toHaveBeenCalled();

    // Legendary tier with trailing sparks
    mockCtx.save.mockClear();
    const longDeviations: PointDeviation[] = Array.from({ length: 15 }, (_, i) => ({
      point: { x: i * 20, y: 100 },
      distance: 0,
      normalizedError: 0,
      hue: 120,
      color: 'green',
    }));
    view.renderWaveTracer(longDeviations, 0.8, 'legendary');
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('computes monotonic start-to-end point fade factors via computePointFadeFactor', () => {
    expect(CanvasView.computePointFadeFactor(0, 10, { eraseProgress: 0, fadeSpan: 0.3 })).toBe(1);
    expect(CanvasView.computePointFadeFactor(9, 10, { eraseProgress: 0, fadeSpan: 0.3 })).toBe(1);
    expect(CanvasView.computePointFadeFactor(0, 10, { eraseProgress: 1, fadeSpan: 0.3 })).toBe(0);
    expect(CanvasView.computePointFadeFactor(9, 10, { eraseProgress: 1, fadeSpan: 0.3 })).toBe(0);

    // At eraseProgress = 0.5 and fadeSpan = 0.3 -> wipeFront = 0.65, wipeTail = 0.35
    // Leading start points are fully erased, transition band smoothly climbs, trailing end points remain visible
    const midWindow = { eraseProgress: 0.5, fadeSpan: 0.3 };
    const startFactor = CanvasView.computePointFadeFactor(0, 11, midWindow); // p = 0.0
    const transFactor = CanvasView.computePointFadeFactor(5, 11, midWindow); // p = 0.5
    const endFactor = CanvasView.computePointFadeFactor(10, 11, midWindow);  // p = 1.0

    expect(startFactor).toBe(0);
    expect(transFactor).toBeGreaterThan(0);
    expect(transFactor).toBeLessThan(1);
    expect(endFactor).toBe(1);

    // Respects explicit arcProgress when provided
    const arcFactor = CanvasView.computePointFadeFactor(1, 3, {
      eraseProgress: 0.5,
      fadeSpan: 0.3,
      arcProgress: [0, 0.9, 1.0],
    });
    expect(arcFactor).toBe(1);
  });

  it('skips erased leading segments in renderEvaluatedStroke when fadeWindow progresses', () => {
    const view = new CanvasView(mockCanvas);
    const deviations: PointDeviation[] = Array.from({ length: 11 }, (_, i) => ({
      point: { x: i * 10, y: 100 },
      distance: 1,
      normalizedError: 0.03,
      hue: 120,
      color: 'hsl(120, 85%, 55%)',
    }));

    mockCtx.moveTo.mockClear();
    mockCtx.stroke.mockClear();
    view.renderEvaluatedStroke(deviations, 3.5, 0.85, { eraseProgress: 0.5, fadeSpan: 0.3 });

    // Early segments (x = 0, 10, 20, 30) are faded out and skipped; visible segments start around transition tail (x >= 30)
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.stroke.mock.calls.length).toBeLessThan(deviations.length - 1);
    const firstDrawnX = mockCtx.moveTo.mock.calls[0][0];
    expect(firstDrawnX).toBeGreaterThanOrEqual(30);
  });
});

