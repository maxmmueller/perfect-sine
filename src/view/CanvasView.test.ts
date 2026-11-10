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
});
