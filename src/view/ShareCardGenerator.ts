import { drawGradientStroke } from './GradientStrokeRenderer';
import { TEXT_FONT, METRIC_FONT } from './Typography';
import { drawBrandLogo } from './BrandView';
import { getNotebookPalette } from './ThemeView';
import { Point, PointDeviation, StrokeEvaluation } from '../model/types';

export interface ShareStrokeSnapshot {
  readonly points: readonly Point[];
  readonly evaluation: StrokeEvaluation | null;
  readonly validationMessage?: string | null;
}

export interface ShareCardSnapshot {
  readonly stroke?: ShareStrokeSnapshot | null;
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
const CARD_HEIGHT = 960;
const PREVIEW_BOX: RectBox = { x: 60, y: 320, w: 840, h: 420 };
const NO_WAVE_MESSAGE = 'Draw a wave before sharing.';
type ShareableSnapshot = ShareCardSnapshot & { readonly stroke: ShareStrokeSnapshot };

/**
 * Generates shareable Perfect Sine PNG cards and dispatches Web Share API,
 * clipboard image/text copy, and PNG download fallbacks cleanly.
 */
export class ShareCardGenerator {
  public static readonly WIDTH = CARD_WIDTH;
  public static readonly HEIGHT = CARD_HEIGHT;

  public static canShare(snapshot: ShareCardSnapshot | null | undefined): snapshot is ShareableSnapshot {
    return Boolean(snapshot?.stroke && snapshot.stroke.points.length >= 2);
  }

  /** Share text contains only the captured wave's result and its link. */
  public static buildShareText(snapshot: ShareCardSnapshot): string {
    if (!this.canShare(snapshot)) throw new Error(NO_WAVE_MESSAGE);
    const evaluation = snapshot.stroke.evaluation;
    const result = evaluation
      ? `Perfect Sine — ${evaluation.accuracy.toFixed(1)}% | ${evaluation.score.toLocaleString()} pts`
      : `Perfect Sine${snapshot.stroke.validationMessage ? ` — ${snapshot.stroke.validationMessage}` : ''}`;
    const url = snapshot.url?.trim();
    return url ? `${result}\n${url}` : result;
  }

  /**
   * Renders a current wave PNG card to an offscreen canvas.
   */
  public static renderShareCard(
    snapshot: ShareCardSnapshot
  ): HTMLCanvasElement {
    if (!this.canShare(snapshot)) throw new Error(NO_WAVE_MESSAGE);
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
    this.drawHeader(ctx, snapshot);
    this.drawWaveViewport(ctx, snapshot);
    this.drawFooter(ctx, snapshot?.url);

    return canvas;
  }

  public static toDataUrl(snapshot: ShareCardSnapshot): string {
    const canvas = this.renderShareCard(snapshot);
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
   * Triggers an immediate PNG download of the rendered wave card.
   */
  public static downloadShareCard(
    snapshot: ShareCardSnapshot,
    filename: string = 'perfect-sine-wave.png'
  ): boolean {
    if (!this.canShare(snapshot) || typeof document === 'undefined') return false;

    const dataUrl = this.toDataUrl(snapshot);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  }

  /**
   * Copies the current wave card image (when ClipboardItem is supported)
   * or falls back to copying current wave result + URL.
   */
  public static async copyShareCard(
    snapshot: ShareCardSnapshot
  ): Promise<ShareOutcome> {
    if (!this.canShare(snapshot)) return { status: 'error', message: NO_WAVE_MESSAGE };
    const text = this.buildShareText(snapshot);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

    if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
      try {
        const canvas = this.renderShareCard(snapshot);
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
          message: 'Wave result & link copied to clipboard!',
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
    snapshot: ShareCardSnapshot
  ): Promise<ShareOutcome> {
    if (!this.canShare(snapshot)) return { status: 'error', message: NO_WAVE_MESSAGE };
    const url = snapshot?.url ?? (typeof window !== 'undefined' ? window.location.href : undefined);
    const text = this.buildShareText({ ...snapshot, url });
    const title = 'Perfect Sine';
    const canvas = this.renderShareCard(snapshot);
    const blob = await this.canvasToBlob(canvas);

    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      const baseData: ShareData = url ? { title, text, url } : { title, text };

      if (blob && typeof File !== 'undefined' && typeof nav.canShare === 'function') {
        const file = new File([blob], 'perfect-sine-wave.png', { type: 'image/png' });
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
        return { status: 'shared', message: 'Wave shared!' };
      } catch (err) {
        if (this.isAbortError(err)) {
          return { status: 'cancelled', message: 'Share cancelled.' };
        }
      }
    }

    // Desktop fallback when Web Share API is unavailable: copy image/text, or download PNG
    const copyResult = await this.copyShareCard({ ...snapshot, url });
    if (copyResult.status === 'copied-image' || copyResult.status === 'copied-text') {
      return copyResult;
    }

    if (this.downloadShareCard(snapshot)) {
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
    ctx.fillStyle = getNotebookPalette().paper;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  private static drawHeader(
    ctx: CanvasRenderingContext2D,
    snapshot: ShareableSnapshot
  ): void {
    ctx.save();
    drawBrandLogo(ctx, 'full', 48, 32, 152, getNotebookPalette().ink);
    ctx.textAlign = 'center';
    const evaluation = snapshot?.stroke?.evaluation;
    if (evaluation) {
      const color = evaluation.accuracy >= 80 ? getNotebookPalette().green
        : evaluation.accuracy >= 50 ? getNotebookPalette().amber : getNotebookPalette().red;
      ctx.font = `600 136px ${METRIC_FONT}`;
      ctx.fillStyle = color;
      ctx.fillText(`${evaluation.accuracy.toFixed(1)}%`, CARD_WIDTH / 2, 224);
      ctx.font = `600 32px ${METRIC_FONT}`;
      ctx.fillStyle = getNotebookPalette().text;
      ctx.fillText(`${evaluation.score.toLocaleString()} pts`, CARD_WIDTH / 2, 270);
    } else if (snapshot?.stroke?.validationMessage) {
      ctx.font = `500 32px ${TEXT_FONT}`;
      ctx.fillStyle = getNotebookPalette().red;
      ctx.fillText(snapshot.stroke.validationMessage, CARD_WIDTH / 2, 220, CARD_WIDTH - 120);
    }
    ctx.restore();
  }

  private static drawWaveViewport(
    ctx: CanvasRenderingContext2D,
    snapshot: ShareableSnapshot
  ): void {
    ctx.save();
    this.drawRoundedRect(ctx, PREVIEW_BOX.x, PREVIEW_BOX.y, PREVIEW_BOX.w, PREVIEW_BOX.h, 0);
    ctx.clip();

    this.drawCapturedStroke(ctx, snapshot.stroke);

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

    // Preserve the evaluated stroke colors; keep the share image free of fitting overlays.
    const deviations: readonly PointDeviation[] | undefined = stroke.evaluation?.deviations;
    if (deviations && deviations.length === stroke.points.length) {
      drawGradientStroke(ctx, deviations.map(deviation => ({
        ...deviation, point: mapPt(deviation.point),
      })), 5);
    } else {
      ctx.strokeStyle = getNotebookPalette().ink;
      ctx.lineWidth = 5;
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

  private static drawFooter(ctx: CanvasRenderingContext2D, url?: string): void {
    drawBrandLogo(ctx, 'mark', 48, 894, 32, getNotebookPalette().ink);
    if (!url) return;
    ctx.save();
    const displayUrl = this.formatDisplayUrl(url);
    ctx.font = `400 20px ${TEXT_FONT}`;
    ctx.fillStyle = getNotebookPalette().muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayUrl, 92, 910);
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

