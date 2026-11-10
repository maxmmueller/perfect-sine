import { Point, RecordedCurve, PointDeviation } from '../model/types';

export interface ImageExportOptions {
  width?: number;
  height?: number;
  includeHud?: boolean;
  includeGrid?: boolean;
  includeReference?: boolean;
  watermark?: string;
}

/**
 * CurveImageExporter
 * Generates high-definition standalone example images (PNG / SVG) and compact thumbnails
 * from human-drawn RecordedCurve data, preserving mathematical curves, gradients, and HUD scoring.
 */
export class CurveImageExporter {
  public static readonly DEFAULT_WIDTH = 900;
  public static readonly DEFAULT_HEIGHT = 560;

  /**
   * Renders a RecordedCurve to an offscreen HTMLCanvasElement.
   */
  public static renderToCanvas(
    curve: RecordedCurve,
    options: ImageExportOptions = {}
  ): HTMLCanvasElement {
    const width = options.width ?? this.DEFAULT_WIDTH;
    const height = options.height ?? this.DEFAULT_HEIGHT;
    const includeHud = options.includeHud ?? true;
    const includeGrid = options.includeGrid ?? true;
    const includeReference = options.includeReference ?? true;
    const watermark = options.watermark ?? 'PERFECT SINE • HUMAN SAMPLE';

    let canvas: HTMLCanvasElement;
    if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    } else {
      throw new Error('Canvas rendering requires a DOM environment');
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not obtain 2D canvas context');

    // 1. Sleek dark background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle coordinate grid
    if (includeGrid) {
      this.drawGrid(ctx, width, height);
    }

    // 3. Compute framing transform: center and fit curve nicely into the canvas
    const transform = this.computeFramingTransform(curve.points, width, height, includeHud);

    // 4. Render ideal reference sine wave if available
    if (includeReference && curve.evaluation?.fittedSine) {
      this.drawReferenceSine(ctx, curve, transform);
    }

    // 5. Render human drawn stroke with evaluated gradient colors
    this.drawStroke(ctx, curve, transform);

    // 6. Render HUD Score & Label Banner
    if (includeHud) {
      this.drawHud(ctx, curve, width, height, watermark);
    }

    return canvas;
  }

  /**
   * Generates a PNG Data URL of the curve for instant previewing or downloading.
   */
  public static toDataUrl(curve: RecordedCurve, options: ImageExportOptions = {}): string {
    const canvas = this.renderToCanvas(curve, options);
    return canvas.toDataURL('image/png');
  }

  /**
   * Generates a compact thumbnail (280x160) for gallery cards.
   */
  public static renderThumbnailDataUrl(curve: RecordedCurve): string {
    return this.toDataUrl(curve, {
      width: 280,
      height: 160,
      includeHud: false,
      includeGrid: true,
      includeReference: true,
    });
  }

  /**
   * Triggers an immediate browser download of the curve as a PNG image file.
   */
  public static downloadImage(curve: RecordedCurve, filename?: string): void {
    if (typeof document === 'undefined') return;

    const dataUrl = this.toDataUrl(curve);
    const safeName = (filename || `${curve.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${curve.id}`) + '.png';

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Generates a crisp vector SVG string representation of the curve.
   * Zero DOM dependencies (can run headlessly in Node.js scripts).
   */
  public static renderToSvg(curve: RecordedCurve, options: ImageExportOptions = {}): string {
    const width = options.width ?? this.DEFAULT_WIDTH;
    const height = options.height ?? this.DEFAULT_HEIGHT;
    const includeHud = options.includeHud ?? true;
    const includeGrid = options.includeGrid ?? true;
    const includeReference = options.includeReference ?? true;
    const watermark = options.watermark ?? 'PERFECT SINE • HUMAN SAMPLE';

    const transform = this.computeFramingTransform(curve.points, width, height, includeHud);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;
    svg += `  <rect width="100%" height="100%" fill="#090d16" />\n`;

    if (includeGrid) {
      svg += `  <g stroke="rgba(148, 163, 184, 0.07)" stroke-width="1">\n`;
      for (let x = 0; x <= width; x += 36) {
        svg += `    <line x1="${x}" y1="0" x2="${x}" y2="${height}" />\n`;
      }
      for (let y = 0; y <= height; y += 36) {
        svg += `    <line x1="0" y1="${y}" x2="${width}" y2="${y}" />\n`;
      }
      svg += `  </g>\n`;
    }

    // Reference Sine
    if (includeReference && curve.evaluation?.fittedSine && curve.points.length >= 2) {
      const fit = curve.evaluation.fittedSine;
      const refPath: string[] = [];
      const numSteps = 120;
      const firstX = curve.points[0].x;
      const lastX = curve.points[curve.points.length - 1].x;
      for (let i = 0; i <= numSteps; i++) {
        const origX = firstX + (i / numSteps) * (lastX - firstX);
        const u = origX - fit.tilt.centroid.x;
        const v = fit.amplitude * Math.sin(fit.frequency * u + fit.phase) + fit.offset;
        const cosT = Math.cos(fit.tilt.angle);
        const sinT = Math.sin(fit.tilt.angle);
        const screenX = fit.tilt.centroid.x + u * cosT - v * sinT;
        const screenY = fit.tilt.centroid.y + u * sinT + v * cosT;
        const tx = screenX * transform.scale + transform.dx;
        const ty = screenY * transform.scale + transform.dy;
        refPath.push(`${i === 0 ? 'M' : 'L'} ${tx.toFixed(1)} ${ty.toFixed(1)}`);
      }
      svg += `  <path d="${refPath.join(' ')}" fill="none" stroke="rgba(239, 68, 68, 0.85)" stroke-width="2" stroke-dasharray="6,6" />\n`;
    }

    // Stroke Segments
    if (curve.evaluation?.deviations && curve.evaluation.deviations.length >= 2) {
      svg += `  <g stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5">\n`;
      for (let i = 0; i < curve.evaluation.deviations.length - 1; i++) {
        const d1 = curve.evaluation.deviations[i];
        const d2 = curve.evaluation.deviations[i + 1];
        const x1 = (d1.point.x * transform.scale + transform.dx).toFixed(1);
        const y1 = (d1.point.y * transform.scale + transform.dy).toFixed(1);
        const x2 = (d2.point.x * transform.scale + transform.dx).toFixed(1);
        const y2 = (d2.point.y * transform.scale + transform.dy).toFixed(1);
        svg += `    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${d1.color}" />\n`;
      }
      svg += `  </g>\n`;
    } else if (curve.points.length >= 2) {
      const strokeColor = curve.validationMessage ? '#ef4444' : '#22c55e';
      const pts = curve.points.map((p) => `${(p.x * transform.scale + transform.dx).toFixed(1)},${(p.y * transform.scale + transform.dy).toFixed(1)}`).join(' ');
      svg += `  <polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />\n`;
    }

    // Header & Watermark
    if (includeHud) {
      const title = curve.evaluation ? `${curve.evaluation.accuracy.toFixed(1)}%` : (curve.validationMessage || 'Recorded Stroke');
      const titleColor = curve.evaluation ? (curve.evaluation.accuracy >= 80 ? '#22c55e' : curve.evaluation.accuracy >= 60 ? '#eab308' : '#ef4444') : '#f87171';
      svg += `  <text x="${width / 2}" y="56" fill="${titleColor}" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="900" text-anchor="middle">${title}</text>\n`;

      if (curve.metrics) {
        const sub = `★ Score: ${curve.metrics.score.toLocaleString()} pts • ${curve.metrics.fullCycles} Cycles • Amp: ${curve.metrics.amplitude}px • R² ${curve.metrics.r2} ★`;
        svg += `  <text x="${width / 2}" y="82" fill="#fbbf24" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" text-anchor="middle">${sub}</text>\n`;
      }

      svg += `  <text x="24" y="${height - 20}" fill="rgba(148, 163, 184, 0.55)" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="1">${watermark}</text>\n`;
      svg += `  <text x="${width - 24}" y="${height - 20}" fill="rgba(255, 255, 255, 0.85)" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="600" text-anchor="end">${curve.label}</text>\n`;
    }

    svg += `</svg>`;
    return svg;
  }

  // --- Private Helpers ---

  private static drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gridSize = 36;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= width; x += gridSize) {
      const px = Math.floor(x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      const py = Math.floor(y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  private static computeFramingTransform(
    points: readonly Point[],
    width: number,
    height: number,
    includeHud: boolean
  ): { scale: number; dx: number; dy: number } {
    if (points.length === 0) return { scale: 1, dx: 0, dy: 0 };

    let minX = points[0].x, maxX = points[0].x;
    let minY = points[0].y, maxY = points[0].y;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const topMargin = includeHud ? 110 : 30;
    const bottomMargin = includeHud ? 50 : 30;
    const horizMargin = 50;

    const availableW = Math.max(100, width - horizMargin * 2);
    const availableH = Math.max(100, height - topMargin - bottomMargin);

    const scaleX = availableW / bboxW;
    const scaleY = availableH / bboxH;
    const scale = Math.min(1.2, Math.min(scaleX, scaleY));

    const targetCenterX = width / 2;
    const targetCenterY = topMargin + availableH / 2;

    const dx = targetCenterX - midX * scale;
    const dy = targetCenterY - midY * scale;

    return { scale, dx, dy };
  }

  private static drawReferenceSine(
    ctx: CanvasRenderingContext2D,
    curve: RecordedCurve,
    transform: { scale: number; dx: number; dy: number }
  ): void {
    const fit = curve.evaluation?.fittedSine;
    if (!fit || curve.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);

    const numSteps = 140;
    const firstX = curve.points[0].x;
    const lastX = curve.points[curve.points.length - 1].x;

    ctx.beginPath();
    for (let i = 0; i <= numSteps; i++) {
      const origX = firstX + (i / numSteps) * (lastX - firstX);
      const u = origX - fit.tilt.centroid.x;
      const v = fit.amplitude * Math.sin(fit.frequency * u + fit.phase) + fit.offset;
      const cosT = Math.cos(fit.tilt.angle);
      const sinT = Math.sin(fit.tilt.angle);
      const screenX = fit.tilt.centroid.x + u * cosT - v * sinT;
      const screenY = fit.tilt.centroid.y + u * sinT + v * cosT;

      const tx = screenX * transform.scale + transform.dx;
      const ty = screenY * transform.scale + transform.dy;

      if (i === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    }
    ctx.stroke();
    ctx.restore();
  }

  private static drawStroke(
    ctx: CanvasRenderingContext2D,
    curve: RecordedCurve,
    transform: { scale: number; dx: number; dy: number }
  ): void {
    const devs: readonly PointDeviation[] = curve.evaluation?.deviations ?? [];

    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (devs.length >= 2) {
      for (let i = 0; i < devs.length - 1; i++) {
        const d1 = devs[i];
        const d2 = devs[i + 1];

        const x1 = d1.point.x * transform.scale + transform.dx;
        const y1 = d1.point.y * transform.scale + transform.dy;
        const x2 = d2.point.x * transform.scale + transform.dx;
        const y2 = d2.point.y * transform.scale + transform.dy;

        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, d1.color);
        grad.addColorStop(1, d2.color);
        ctx.strokeStyle = grad;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else if (curve.points.length >= 2) {
      ctx.strokeStyle = curve.validationMessage ? '#ef4444' : '#22c55e';
      ctx.beginPath();
      for (let i = 0; i < curve.points.length; i++) {
        const p = curve.points[i];
        const x = p.x * transform.scale + transform.dx;
        const y = p.y * transform.scale + transform.dy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private static drawHud(
    ctx: CanvasRenderingContext2D,
    curve: RecordedCurve,
    width: number,
    height: number,
    watermark: string
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (curve.evaluation) {
      const acc = curve.evaluation.accuracy;
      const hue = acc >= 80 ? '#22c55e' : acc >= 60 ? '#eab308' : '#ef4444';
      ctx.fillStyle = hue;
      ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${acc.toFixed(1)}%`, width / 2, 48);

      if (curve.metrics) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 13px system-ui, -apple-system, sans-serif';
        const sub = `★ Score: ${curve.metrics.score.toLocaleString()} pts • ${curve.metrics.fullCycles} Cycles • Amp: ${curve.metrics.amplitude}px • R² ${curve.metrics.r2} ★`;
        ctx.fillText(sub, width / 2, 78);
      }
    } else if (curve.validationMessage) {
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
      ctx.fillText(`⚠️ ${curve.validationMessage}`, width / 2, 54);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
      ctx.fillText(curve.label, width / 2, 54);
    }

    // Watermark & Label
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.fillText(watermark, 24, height - 24);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(curve.label, width - 24, height - 24);

    ctx.restore();
  }
}
