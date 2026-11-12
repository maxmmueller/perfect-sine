import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShareCardGenerator, type ShareCardSnapshot } from './ShareCardGenerator';
import { drawnWave, waveEvaluation } from './share.test-fixtures';

const invalidWave: ShareCardSnapshot = {
  stroke: { points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], evaluation: null, validationMessage: 'Sine Wave Too Flat' },
};

describe('ShareCardGenerator: current drawing only', () => {
  let ctx: Record<string, unknown>;
  let canvas: HTMLCanvasElement;
  let link: { href: string; download: string; click: ReturnType<typeof vi.fn> };
  let labels: string[];

  beforeEach(() => {
    labels = [];
    vi.stubGlobal('Path2D', class { constructor(readonly path: string) {} });
    ctx = {
      fillRect: vi.fn(), translate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(),
      clip: vi.fn(), stroke: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
      fillText: vi.fn((text: string) => labels.push(text)),
      measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
    canvas = {
      width: 0, height: 0, getContext: vi.fn(() => ctx),
      toDataURL: vi.fn(() => 'data:image/png;base64,currentWave'),
      toBlob: vi.fn((callback: (blob: Blob) => void) => callback(new Blob(['wave'], { type: 'image/png' }))),
    } as unknown as HTMLCanvasElement;
    link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => tag === 'canvas' ? canvas : link),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('builds share text from only the current accuracy and score', () => {
    expect(ShareCardGenerator.buildShareText(drawnWave)).toBe(
      'Perfect Sine — 94.6% | 1,840 pts\nhttps://perfect-sine.test/'
    );
    expect(ShareCardGenerator.buildShareText(invalidWave)).toBe('Perfect Sine — Sine Wave Too Flat');
  });

  it.each([
    {}, { stroke: null }, { stroke: { points: [], evaluation: null } },
    { stroke: { points: [{ x: 1, y: 2 }], evaluation: null } },
  ] satisfies ShareCardSnapshot[])('rejects an absent or single-point drawing before rendering', snapshot => {
    expect(ShareCardGenerator.canShare(snapshot)).toBe(false);
    expect(() => ShareCardGenerator.renderShareCard(snapshot)).toThrow('Draw a wave before sharing.');
    expect(() => ShareCardGenerator.buildShareText(snapshot)).toThrow('Draw a wave before sharing.');
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it('cannot download, copy or natively share an idle/demo canvas', async () => {
    const share = vi.fn(); const write = vi.fn(); const writeText = vi.fn();
    vi.stubGlobal('navigator', { share, clipboard: { write, writeText } });
    expect(ShareCardGenerator.canShare(null)).toBe(false);
    expect(ShareCardGenerator.canShare(undefined)).toBe(false);
    expect(ShareCardGenerator.downloadShareCard({})).toBe(false);
    expect((await ShareCardGenerator.copyShareCard({})).status).toBe('error');
    expect((await ShareCardGenerator.share({})).status).toBe('error');
    expect(document.createElement).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
  });

  it('renders the actual drawing and its metrics without any session information or synthetic waveform', () => {
    const result = ShareCardGenerator.renderShareCard(drawnWave);
    expect(result.width).toBe(960); expect(result.height).toBe(960);
    expect(labels).toContain(`${waveEvaluation.accuracy.toFixed(1)}%`);
    expect(labels).toContain('1,840 pts');
    expect(labels.join(' ')).not.toContain('cycles');
    expect(ctx.fillText).toHaveBeenCalledWith('perfect-sine.test', 92, 910);
    expect(labels.join(' ')).not.toMatch(/Personal Best|Average|Avg Accuracy|Attempts|Streak|Consistency|Session/);
    expect(ctx.fill).toHaveBeenCalledWith(expect.any(Path2D));
    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it('retains an invalid drawing and its validation message without fabricating score or accuracy', () => {
    ShareCardGenerator.renderShareCard(invalidWave);
    expect(labels).toContain('Sine Wave Too Flat');
    expect(labels.join(' ')).not.toMatch(/\d|%|pts|cycles|Personal Best/);
  });

  it('renders an unevaluated drawing without substituting session data or a demo', () => {
    ShareCardGenerator.renderShareCard({ stroke: { ...invalidWave.stroke!, validationMessage: null } });
    expect(labels).toHaveLength(0);
  });

  it('always exports the fixed dark appearance', () => {
    const backgrounds: unknown[] = [];
    ctx.fillRect = vi.fn(() => backgrounds.push(ctx.fillStyle));
    ShareCardGenerator.toDataUrl(drawnWave);
    expect(backgrounds).toEqual(['#1c252c']);
  });

  it('downloads only the captured wave with the expected filename', () => {
    expect(ShareCardGenerator.downloadShareCard(drawnWave)).toBe(true);
    expect(link.download).toBe('perfect-sine-wave.png');
    expect(link.href).toBe('data:image/png;base64,currentWave');
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(document.body.appendChild).toHaveBeenCalledWith(link);
    expect(document.body.removeChild).toHaveBeenCalledWith(link);
  });

  it('copies the current PNG and falls back to current-wave text when image writes are blocked', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(readonly images: Record<string, Blob>) {} });
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    expect((await ShareCardGenerator.copyShareCard(drawnWave)).status).toBe('copied-image');
    expect(write).toHaveBeenCalledOnce();
    write.mockRejectedValueOnce(new Error('Blocked'));
    expect((await ShareCardGenerator.copyShareCard(drawnWave)).status).toBe('copied-text');
    expect(writeText).toHaveBeenCalledWith(ShareCardGenerator.buildShareText(drawnWave));
  });

  it('shares the current file and current-wave metadata, and treats cancellation as cancellation', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    expect((await ShareCardGenerator.share(drawnWave)).status).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Perfect Sine', text: ShareCardGenerator.buildShareText(drawnWave),
      files: [expect.objectContaining({ name: 'perfect-sine-wave.png' })],
    }));
    const error = new Error('Cancelled'); error.name = 'AbortError'; share.mockRejectedValueOnce(error);
    expect((await ShareCardGenerator.share(drawnWave)).status).toBe('cancelled');
    expect(link.click).not.toHaveBeenCalled();
  });

  it('retries native sharing without files and downloads the current wave when sharing and copying are unavailable', async () => {
    const share = vi.fn().mockRejectedValueOnce(new Error('Files blocked')).mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    expect((await ShareCardGenerator.share(drawnWave)).status).toBe('shared');
    expect(share).toHaveBeenLastCalledWith(expect.objectContaining({ text: ShareCardGenerator.buildShareText(drawnWave) }));
    vi.stubGlobal('navigator', {});
    expect((await ShareCardGenerator.share(drawnWave)).status).toBe('downloaded');
    expect(link.click).toHaveBeenCalledOnce();
  });
});
