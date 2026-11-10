import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CurveImageExporter } from './CurveImageExporter';
import { RecordedCurve } from '../model/types';

describe('CurveImageExporter', () => {
  const dummyCurve: RecordedCurve = {
    id: 'test_curve_1',
    timestamp: 1700000000000,
    label: 'Natural Human Sine',
    points: [
      { x: 100, y: 300, time: 0 },
      { x: 150, y: 220, time: 60 },
      { x: 200, y: 300, time: 120 },
      { x: 250, y: 380, time: 180 },
      { x: 300, y: 300, time: 240 },
    ],
    metrics: {
      score: 1840,
      accuracy: 93.8,
      fullCycles: 2.5,
      amplitude: 52,
      wavelength: 200,
      r2: 0.942,
      tiltAngle: 0.02,
    },
    evaluation: {
      score: 1840,
      accuracy: 93.8,
      rmse: 2.8,
      meanDeviation: 2.1,
      maxDeviation: 6.5,
      deviations: [
        { point: { x: 100, y: 300 }, distance: 1.2, normalizedError: 0.04, hue: 115, color: 'hsl(115, 100%, 50%)' },
        { point: { x: 150, y: 220 }, distance: 2.5, normalizedError: 0.08, hue: 110, color: 'hsl(110, 100%, 50%)' },
        { point: { x: 200, y: 300 }, distance: 1.0, normalizedError: 0.03, hue: 116, color: 'hsl(116, 100%, 50%)' },
        { point: { x: 250, y: 380 }, distance: 3.2, normalizedError: 0.11, hue: 107, color: 'hsl(107, 100%, 50%)' },
        { point: { x: 300, y: 300 }, distance: 1.4, normalizedError: 0.05, hue: 114, color: 'hsl(114, 100%, 50%)' },
      ],
      fittedSine: {
        amplitude: 52,
        frequency: 0.0314,
        period: 200,
        phase: 0,
        offset: 300,
        fullCycles: 2.5,
        r2: 0.942,
        tilt: { angle: 0.02, centroid: { x: 200, y: 300 } },
      },
    },
  };

  it('should render a clean vector SVG string representation without DOM', () => {
    const svg = CurveImageExporter.renderToSvg(dummyCurve, {
      width: 800,
      height: 500,
    });

    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 800 500"');
    expect(svg).toContain('93.8%');
    expect(svg).toContain('Natural Human Sine');
    expect(svg).toContain('PERFECT SINE');
    expect(svg).toContain('stroke-dasharray="6,6"'); // Reference sine
  });

  describe('Canvas Rendering & Image Download', () => {
    let mockContext: Record<string, unknown>;
    let mockCanvas: HTMLCanvasElement;

    beforeEach(() => {
      mockContext = {
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        fillText: vi.fn(),
        setLineDash: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
      };

      mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext),
        toDataURL: vi.fn(() => 'data:image/png;base64,mockPngData'),
      } as unknown as HTMLCanvasElement;

      vi.stubGlobal('document', {
        createElement: vi.fn((tagName: string) => {
          if (tagName === 'canvas') return mockCanvas;
          if (tagName === 'a') {
            return {
              href: '',
              download: '',
              click: vi.fn(),
            };
          }
          return {};
        }),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      });
    });

    it('should render to canvas and set dimensions', () => {
      const canvas = CurveImageExporter.renderToCanvas(dummyCurve, {
        width: 1000,
        height: 600,
      });

      expect(canvas.width).toBe(1000);
      expect(canvas.height).toBe(600);
      expect(mockContext.fillRect).toHaveBeenCalledWith(0, 0, 1000, 600);
      expect(mockContext.fillText).toHaveBeenCalledWith('93.8%', expect.any(Number), expect.any(Number));
    });

    it('should export dataUrl and render thumbnail dataUrl', () => {
      const dataUrl = CurveImageExporter.toDataUrl(dummyCurve);
      expect(dataUrl).toBe('data:image/png;base64,mockPngData');

      const thumbUrl = CurveImageExporter.renderThumbnailDataUrl(dummyCurve);
      expect(thumbUrl).toBe('data:image/png;base64,mockPngData');
    });

    it('should trigger browser file download when downloadImage is called', () => {
      CurveImageExporter.downloadImage(dummyCurve, 'my-test-sample.png');
      expect(document.body.appendChild).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalled();
    });
  });
});
