import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShareCardGenerator } from './ShareCardGenerator';
import { SessionSummary } from '../model/SessionHistoryService';
import { StrokeEvaluation } from '../model/types';

const sampleSummary: SessionSummary = {
  totalAttempts: 6,
  highscore: 1840,
  latestScore: 1620,
  averageScore: 1410,
  averageAccuracy: 92.4,
  bestAccuracy: 96.2,
  standardDeviation: 4.1,
  consistencyScore: 89,
  totalCyclesDrawn: 11.5,
  streakCount: 4,
  persona: {
    title: 'Laser Harmonic Synthesizer',
    subtitle: 'Sublime neuromuscular calibration and pristine sinusoidal precision.',
  },
};

const emptySummary: SessionSummary = {
  ...sampleSummary,
  totalAttempts: 0,
  highscore: 0,
  latestScore: 0,
  averageScore: 0,
  averageAccuracy: 0,
  bestAccuracy: 0,
  totalCyclesDrawn: 0,
  streakCount: 0,
};

const sampleEvaluation: StrokeEvaluation = {
  score: 1840,
  accuracy: 94.6,
  rmse: 2.3,
  meanDeviation: 1.9,
  maxDeviation: 5.2,
  deviations: [
    {
      point: { x: 100, y: 300 },
      distance: 1.0,
      normalizedError: 0.03,
      hue: 118,
      color: 'hsl(118, 90%, 56%)',
    },
    {
      point: { x: 150, y: 240 },
      distance: 1.8,
      normalizedError: 0.06,
      hue: 110,
      color: 'hsl(110, 90%, 56%)',
    },
    {
      point: { x: 200, y: 300 },
      distance: 2.2,
      normalizedError: 0.08,
      hue: 102,
      color: 'hsl(102, 90%, 56%)',
    },
  ],
  fittedSine: {
    amplitude: 60,
    frequency: 0.04,
    phase: 0,
    offset: 300,
    period: 157,
    fullCycles: 1.8,
    r2: 0.96,
    tilt: { angle: 0, centroid: { x: 150, y: 300 } },
  },
};

describe('ShareCardGenerator', () => {
  let mockContext: Record<string, unknown>;
  let mockCanvas: HTMLCanvasElement;
  let mockLink: { href: string; download: string; click: ReturnType<typeof vi.fn> };
  let blobResult: Blob | null;

  beforeEach(() => {
    blobResult = new Blob(['mock-png'], { type: 'image/png' });

    mockContext = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      drawImage: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
    };

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext),
      toDataURL: vi.fn(() => 'data:image/png;base64,shareCardMock'),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(blobResult)),
    } as unknown as HTMLCanvasElement;

    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    };

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return mockCanvas;
        if (tag === 'a') return mockLink;
        return {};
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds formatted share text for active and empty sessions', () => {
    const activeText = ShareCardGenerator.buildShareText(sampleSummary, 'https://example.com/sine');
    expect(activeText).toContain('1,840 pts');
    expect(activeText).toContain('92.4%');
    expect(activeText).toContain('Laser Harmonic Synthesizer');
    expect(activeText).toContain('https://example.com/sine');

    const emptyText = ShareCardGenerator.buildShareText(emptySummary);
    expect(emptyText).toContain('Draw a mathematically pure sine wave');
    expect(emptyText).not.toContain('undefined');
  });

  it('renders share card with evaluated stroke, reference wave, and all stats', () => {
    const canvas = ShareCardGenerator.renderShareCard(sampleSummary, {
      stroke: {
        points: [
          { x: 100, y: 300 },
          { x: 150, y: 240 },
          { x: 200, y: 300 },
        ],
        evaluation: sampleEvaluation,
      },
      url: 'https://perfect-sine.dev/play',
    });

    expect(canvas.width).toBe(ShareCardGenerator.WIDTH);
    expect(canvas.height).toBe(ShareCardGenerator.HEIGHT);
    expect(mockContext.setLineDash).toHaveBeenCalledWith([6, 6]);
    expect(mockContext.fillText).toHaveBeenCalledWith('Wave Summary', 36, 84);
    expect(mockContext.fillText).toHaveBeenCalledWith(
      'LAST WAVE · 94.6% (1,840 pts)',
      expect.any(Number),
      56
    );
  });

  it('renders live sourceCanvas snapshot when no completed user stroke exists', () => {
    const sourceCanvas = { width: 800, height: 600 } as unknown as HTMLCanvasElement;
    ShareCardGenerator.renderShareCard(sampleSummary, { sourceCanvas });

    expect(mockContext.drawImage).toHaveBeenCalledWith(
      sourceCanvas,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('renders unevaluated stroke and fallback wave cleanly without throwing', () => {
    const url1 = ShareCardGenerator.toDataUrl(emptySummary, {
      stroke: {
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 40 },
        ],
        evaluation: null,
      },
    });
    expect(url1).toBe('data:image/png;base64,shareCardMock');

    const url2 = ShareCardGenerator.toDataUrl(emptySummary);
    expect(url2).toBe('data:image/png;base64,shareCardMock');
  });

  it('triggers PNG download with expected filename', () => {
    const result = ShareCardGenerator.downloadShareCard(
      sampleSummary,
      undefined,
      'custom-wave.png'
    );

    expect(result).toBe(true);
    expect(mockLink.download).toBe('custom-wave.png');
    expect(mockLink.href).toBe('data:image/png;base64,shareCardMock');
    expect(mockLink.click).toHaveBeenCalledTimes(1);
    expect(document.body.appendChild).toHaveBeenCalledWith(mockLink);
    expect(document.body.removeChild).toHaveBeenCalledWith(mockLink);
  });

  it('copies PNG image via ClipboardItem when supported, or falls back to clipboard text', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('ClipboardItem', function (this: Record<string, unknown>, items: Record<string, Blob>) {
      return items;
    });
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });

    const imgOutcome = await ShareCardGenerator.copyShareCard(sampleSummary, {
      url: 'https://example.com',
    });
    expect(imgOutcome.status).toBe('copied-image');
    expect(write).toHaveBeenCalledTimes(1);

    // Reject image write -> fallback to writeText
    write.mockRejectedValueOnce(new Error('NotAllowed'));
    const textOutcome = await ShareCardGenerator.copyShareCard(sampleSummary, {
      url: 'https://example.com',
    });
    expect(textOutcome.status).toBe('copied-text');
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com')
    );
  });

  it('shares file via Web Share API when supported and handles cancel cleanly', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);

    vi.stubGlobal('navigator', {
      share: shareMock,
      canShare: canShareMock,
    });

    const outcome = await ShareCardGenerator.share(sampleSummary, {
      url: 'https://example.com',
    });
    expect(outcome.status).toBe('shared');
    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Perfect Sine — Wave Summary',
        url: 'https://example.com',
        files: expect.any(Array),
      })
    );

    // AbortError cancels silently without falling back
    const abortErr = new Error('User cancelled');
    abortErr.name = 'AbortError';
    shareMock.mockRejectedValueOnce(abortErr);

    const cancelOutcome = await ShareCardGenerator.share(sampleSummary, {
      url: 'https://example.com',
    });
    expect(cancelOutcome.status).toBe('cancelled');
  });

  it('retries Web Share without files on non-AbortError and falls back to download when Web Share & Clipboard are unavailable', async () => {
    const shareMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('File sharing blocked'))
      .mockResolvedValueOnce(undefined);

    vi.stubGlobal('navigator', {
      share: shareMock,
      canShare: () => true,
    });

    const retryOutcome = await ShareCardGenerator.share(sampleSummary, {
      url: 'https://example.com',
    });
    expect(retryOutcome.status).toBe('shared');
    expect(shareMock).toHaveBeenCalledTimes(2);
    expect(shareMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: 'https://example.com' })
    );

    // No navigator.share and no clipboard -> falls back to PNG download
    vi.stubGlobal('navigator', {});
    const dlOutcome = await ShareCardGenerator.share(sampleSummary, {
      url: 'https://example.com',
    });
    expect(dlOutcome.status).toBe('downloaded');
    expect(mockLink.click).toHaveBeenCalledTimes(1);
  });
});
