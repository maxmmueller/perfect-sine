import { SessionSummary } from '../model/SessionHistoryService';
import { Point, PointDeviation, StrokeEvaluation } from '../model/types';
import { TiltDetector } from '../model/TiltDetector';

export interface ShareStrokeSnapshot {
  readonly points: readonly Point[];
  readonly evaluation: StrokeEvaluation | null;
  readonly validationMessage?: string | null;
}

export interface ShareCardSnapshot {
  readonly stroke?: ShareStrokeSnapshot | null;
  readonly sourceCanvas?: HTMLCanvasElement | null;
  readonly url?: string;
}

export type ShareOutcomeStatus =
  | 'shared'
  | 'copied-image'
  | 'copied-text'
  | 'downloaded'
  | 'cancelled'
  | 'error';

export interface ShareOutcome {
  readonly status: ShareOutcomeStatus;
  readonly message: string;
}

interface RectBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const CARD_WIDTH = 960;
const CARD_HEIGHT = 560;
const PREVIEW_BOX: RectBox = { x: 36, y: 92, w: 516, h: 416 };

/**
 * Generates shareable Perfect Sine PNG cards and dispatches Web Share API,
 * clipboard image/text copy, and PNG download fallbacks cleanly.
 */
export class ShareCardGenerator {
  public static readonly WIDTH = CARD_WIDTH;
  public static readonly HEIGHT = CARD_HEIGHT;

  /**
   * Builds a concise, formatted text summary for system share sheets or clipboard.
   */
  public static buildShareText(summary: SessionSummary, url?: string): string {
    const cleanUrl = url && url.trim().length > 0 ? url.trim() : '';
    const statsLine =
      summary.totalAttempts > 0
        ? `Perfect Sine — Personal Best: ${summary.highscore.toLocaleString()} pts | Avg Accuracy: ${summary.averageAccuracy}%`
        : 'Perfect Sine';

    return cleanUrl ? `${statsLine}\n${cleanUrl}` : statsLine;
  }

  /**
   * Renders a full Wave Summary PNG card to an offscreen canvas.
   */
  public static renderShareCard(
    summary: SessionSummary,
    snapshot?: ShareCardSnapshot
  ): HTMLCanvasElement {
    if (typeof document === 'undefined') {
      throw new Error('Share card rendering requires a DOM environment');
    }

    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not obtain 2D canvas context');
    }

    this.drawCardBackground(ctx);
    this.drawHeader(ctx, summary, snapshot);
    this.drawWaveViewport(ctx, snapshot);
    this.drawStatsGrid(ctx, summary);
    this.drawFooter(ctx, snapshot?.url);

    return canvas;
  }

  public static toDataUrl(summary: SessionSummary, snapshot?: ShareCardSnapshot): string {
    const canvas = this.renderShareCard(summary, snapshot);
    return canvas.toDataURL('image/png');
  }

  public static canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    if (typeof canvas.toBlob !== 'function') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Triggers an immediate PNG download of the rendered Wave Summary card.
   */
  public static downloadShareCard(
    summary: SessionSummary,
    snapshot?: ShareCardSnapshot,
    filename: string = 'perfect-sine-summary.png'
  ): boolean {
    if (typeof document === 'undefined') return false;

    const dataUrl = this.toDataUrl(summary, snapshot);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  }

  /**
   * Copies the Wave Summary card image (when ClipboardItem is supported)
   * or falls back to copying formatted summary text + URL.
   */
  public static async copyShareCard(
    summary: SessionSummary,
    snapshot?: ShareCardSnapshot
  ): Promise<ShareOutcome> {
    const text = this.buildShareText(summary, snapshot?.url);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

    if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
      try {
        const canvas = this.renderShareCard(summary, snapshot);
        const blob = await this.canvasToBlob(canvas);
        if (blob) {
          await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          return {
            status: 'copied-image',
            message: 'Share card image copied to clipboard!',
          };
        }
      } catch {
        // Fall through to text copy if browser blocks image clipboard writes
      }
    }

    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(text);
        return {
          status: 'copied-text',
          message: 'Summary text & link copied to clipboard!',
        };
      } catch {
        return {
          status: 'error',
          message: 'Clipboard access blocked. Use Save PNG instead.',
        };
      }
    }

    return {
      status: 'error',
      message: 'Clipboard API unavailable. Use Save PNG instead.',
    };
  }

  /**
   * Shares via native Web Share API (including PNG file when supported),
   * falling back cleanly to clipboard copy or PNG download on desktop browsers.
   */
  public static async share(
    summary: SessionSummary,
    snapshot?: ShareCardSnapshot
  ): Promise<ShareOutcome> {
    const url = snapshot?.url ?? (typeof window !== 'undefined' ? window.location.href : undefined);
    const text = this.buildShareText(summary, url);
    const title = 'Perfect Sine';
    const canvas = this.renderShareCard(summary, snapshot);
    const blob = await this.canvasToBlob(canvas);

    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      const baseData: ShareData = url ? { title, text, url } : { title, text };

      if (blob && typeof File !== 'undefined' && typeof nav.canShare === 'function') {
        const file = new File([blob], 'perfect-sine-summary.png', { type: 'image/png' });
        const fileData: ShareData = { ...baseData, files: [file] };
        try {
          if (nav.canShare(fileData)) {
            await nav.share(fileData);
            return { status: 'shared', message: 'Wave card shared!' };
          }
        } catch (err) {
          if (this.isAbortError(err)) {
            return { status: 'cancelled', message: 'Share cancelled.' };
          }
          // Fall back to text/link-only Web Share if file sharing rejects
        }
      }

      try {
        await nav.share(baseData);
        return { status: 'shared', message: 'Wave summary shared!' };
      } catch (err) {
        if (this.isAbortError(err)) {
          return { status: 'cancelled', message: 'Share cancelled.' };
        }
      }
    }

    // Desktop fallback when Web Share API is unavailable: copy image/text, or download PNG
    const copyResult = await this.copyShareCard(summary, { ...snapshot, url });
    if (copyResult.status === 'copied-image' || copyResult.status === 'copied-text') {
      return copyResult;
    }

    if (this.downloadShareCard(summary, snapshot)) {
      return {
        status: 'downloaded',
        message: 'Web Share unavailable — downloaded PNG share card!',
      };
    }

    return {
      status: 'error',
      message: 'Could not share in this browser.',
    };
  }

  private static isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
  }

  private static drawCardBackground(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Subtle full-card graph paper grid
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    const step = 36;
    for (let x = 0; x <= CARD_WIDTH; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CARD_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= CARD_HEIGHT; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CARD_WIDTH, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private static drawHeader(
    ctx: CanvasRenderingContext2D,
    summary: SessionSummary,
    snapshot?: ShareCardSnapshot
  ): void {
    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 28px Inter, system-ui, -apple-system, sans-serif';
    ctx.fillText('Perfect Sine', 36, 60);

    // Optional top-right metric badge when numeric score exists
    const evalData = snapshot?.stroke?.evaluation;
    const badgeLabel = evalData
      ? `Last · ${evalData.accuracy.toFixed(1)}% (${evalData.score.toLocaleString()} pts)`
      : summary.highscore > 0
        ? `Personal Best · ${summary.highscore.toLocaleString()} pts`
        : null;

    if (badgeLabel) {
      ctx.font = '700 13px Inter, system-ui, -apple-system, sans-serif';
      const badgeWidth = Math.min(340, ctx.measureText(badgeLabel).width + 32);
      const badgeX = CARD_WIDTH - 36 - badgeWidth;
      this.drawRoundedRect(ctx, badgeX, 34, badgeWidth, 34, 10);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.fillText(badgeLabel, badgeX + 16, 56);
    }
    ctx.restore();
  }

  private static drawWaveViewport(
    ctx: CanvasRenderingContext2D,
    snapshot?: ShareCardSnapshot
  ): void {
    ctx.save();
    this.drawRoundedRect(ctx, PREVIEW_BOX.x, PREVIEW_BOX.y, PREVIEW_BOX.w, PREVIEW_BOX.h, 16);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.clip();

    // Fine grid inside wave viewport
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    const step = 32;
    for (let x = PREVIEW_BOX.x; x <= PREVIEW_BOX.x + PREVIEW_BOX.w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, PREVIEW_BOX.y);
      ctx.lineTo(x + 0.5, PREVIEW_BOX.y + PREVIEW_BOX.h);
      ctx.stroke();
    }
    for (let y = PREVIEW_BOX.y; y <= PREVIEW_BOX.y + PREVIEW_BOX.h; y += step) {
      ctx.beginPath();
      ctx.moveTo(PREVIEW_BOX.x, y + 0.5);
      ctx.lineTo(PREVIEW_BOX.x + PREVIEW_BOX.w, y + 0.5);
      ctx.stroke();
    }

    const stroke = snapshot?.stroke;
    if (stroke && stroke.points.length >= 2) {
      this.drawCapturedStroke(ctx, stroke);
    } else if (
      snapshot?.sourceCanvas &&
      snapshot.sourceCanvas.width > 0 &&
      snapshot.sourceCanvas.height > 0
    ) {
      this.drawLiveCanvasSnapshot(ctx, snapshot.sourceCanvas);
    } else {
      this.drawFallbackShowcaseWave(ctx);
    }

    ctx.restore();
  }

  private static drawCapturedStroke(
    ctx: CanvasRenderingContext2D,
    stroke: ShareStrokeSnapshot
  ): void {
    const pad = 32;
    const innerW = PREVIEW_BOX.w - pad * 2;
    const innerH = PREVIEW_BOX.h - pad * 2;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const spanX = Math.max(maxX - minX, 20);
    const spanY = Math.max(maxY - minY, 20);
    const scale = Math.min(innerW / spanX, innerH / spanY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const targetCx = PREVIEW_BOX.x + PREVIEW_BOX.w / 2;
    const targetCy = PREVIEW_BOX.y + PREVIEW_BOX.h / 2;

    const mapPt = (p: Point): Point => ({
      x: targetCx + (p.x - cx) * scale,
      y: targetCy + (p.y - cy) * scale,
    });

    // Optional reference ideal sine curve
    const fit = stroke.evaluation?.fittedSine;
    if (fit) {
      const localPoints = TiltDetector.transformPoints(stroke.points, fit.tilt);
      let lMinX = Infinity;
      let lMaxX = -Infinity;
      for (const lp of localPoints) {
        if (lp.x < lMinX) lMinX = lp.x;
        if (lp.x > lMaxX) lMaxX = lp.x;
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      const samples = 90;
      for (let i = 0; i <= samples; i++) {
        const lx = lMinX + ((lMaxX - lMinX) * i) / samples;
        const ly = fit.amplitude * Math.sin(fit.frequency * lx + fit.phase) + fit.offset;
        const sp = mapPt(TiltDetector.inverseTransformPoint({ x: lx, y: ly }, fit.tilt));
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Color-coded user stroke if evaluated, else crisp cyan line
    const deviations: readonly PointDeviation[] | undefined = stroke.evaluation?.deviations;
    if (deviations && deviations.length === stroke.points.length) {
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < deviations.length; i++) {
        const a = mapPt(deviations[i - 1].point);
        const b = mapPt(deviations[i].point);
        ctx.strokeStyle = `hsl(${Math.round(deviations[i].hue)}, 90%, 56%)`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach((pt, idx) => {
        const mapped = mapPt(pt);
        if (idx === 0) ctx.moveTo(mapped.x, mapped.y);
        else ctx.lineTo(mapped.x, mapped.y);
      });
      ctx.stroke();
    }
  }

  private static drawLiveCanvasSnapshot(
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement
  ): void {
    try {
      const ratio = Math.min(
        PREVIEW_BOX.w / sourceCanvas.width,
        PREVIEW_BOX.h / sourceCanvas.height
      );
      const drawW = sourceCanvas.width * ratio;
      const drawH = sourceCanvas.height * ratio;
      const dx = PREVIEW_BOX.x + (PREVIEW_BOX.w - drawW) / 2;
      const dy = PREVIEW_BOX.y + (PREVIEW_BOX.h - drawH) / 2;
      ctx.drawImage(sourceCanvas, dx, dy, drawW, drawH);
    } catch {
      this.drawFallbackShowcaseWave(ctx);
    }
  }

  private static drawFallbackShowcaseWave(ctx: CanvasRenderingContext2D): void {
    const startX = PREVIEW_BOX.x + 48;
    const endX = PREVIEW_BOX.x + PREVIEW_BOX.w - 48;
    const midY = PREVIEW_BOX.y + PREVIEW_BOX.h / 2;
    const amp = 82;

    const grad = ctx.createLinearGradient(startX, midY, endX, midY);
    grad.addColorStop(0, '#22c55e');
    grad.addColorStop(0.5, '#38bdf8');
    grad.addColorStop(1, '#22c55e');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = startX + (endX - startX) * t;
      const y = midY - Math.sin(t * Math.PI * 3) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private static drawStatsGrid(ctx: CanvasRenderingContext2D, summary: SessionSummary): void {
    const startX = 574;
    const startY = 92;
    const gap = 14;
    const cardW = 168;
    const cardH = (PREVIEW_BOX.h - gap * 2) / 3;

    const items: ReadonlyArray<{ label: string; value: string; highlight?: boolean }> = [
      { label: 'PERSONAL BEST', value: `${summary.highscore.toLocaleString()} pts`, highlight: true },
      { label: 'AVG ACCURACY', value: `${summary.averageAccuracy}%` },
      { label: 'TOTAL ATTEMPTS', value: `${summary.totalAttempts}` },
      { label: 'TOTAL CYCLES', value: `${summary.totalCyclesDrawn.toFixed(1)} waves` },
      { label: 'CONSISTENCY', value: `${summary.consistencyScore} / 100` },
      { label: 'BEST STREAK (≥80%)', value: `${summary.streakCount} 🔥` },
    ];

    items.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);

      this.drawRoundedRect(ctx, x, y, cardW, cardH, 12);
      ctx.fillStyle = item.highlight ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.03)';
      ctx.fill();
      ctx.strokeStyle = item.highlight
        ? 'rgba(56, 189, 248, 0.38)'
        : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.25;
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 10px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(item.label, x + 14, y + 32);

      ctx.fillStyle = item.highlight ? '#38bdf8' : '#f8fafc';
      ctx.font = '800 22px Inter, system-ui, -apple-system, sans-serif';
      ctx.fillText(this.truncate(item.value, 14), x + 14, y + 74);
    });
  }

  private static drawFooter(ctx: CanvasRenderingContext2D, url?: string): void {
    if (!url) return;
    ctx.save();
    const displayUrl = this.formatDisplayUrl(url);
    ctx.font = '600 12px Inter, system-ui, -apple-system, sans-serif';
    const textWidth = ctx.measureText(displayUrl).width;
    ctx.fillStyle = '#64748b';
    ctx.fillText(displayUrl, CARD_WIDTH - 36 - textWidth, 536);
    ctx.restore();
  }

  private static drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private static truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  }

  private static formatDisplayUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      const compact = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
      return this.truncate(compact, 46);
    } catch {
      return this.truncate(rawUrl, 46);
    }
  }
}

