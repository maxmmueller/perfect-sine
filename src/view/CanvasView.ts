import { Point, PointDeviation } from '../model/types';

/**
 * CanvasView
 * Presentation layer responsible for HTML5 Canvas rendering, DPR scaling,
 * multi-color segmented stroke gradients, reference guideline overlays, and visual HUD feedback.
 */
export class CanvasView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is not available');
    }
    this.ctx = context;
    this.handleResize();
  }

  public handleResize(): { width: number; height: number } {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || window.innerWidth;
    this.height = rect.height || window.innerHeight;

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);

    this.ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
    this.ctx.scale(this.dpr, this.dpr);

    return { width: this.width, height: this.height };
  }

  public clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackgroundGrid();
  }

  public drawBackgroundGrid(): void {
    const gridSize = 40;
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    this.ctx.lineWidth = 1;

    for (let x = 0; x < this.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.height);
      this.ctx.stroke();
    }

    for (let y = 0; y < this.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.width, y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Renders the real-time active user stroke in cyan neon.
   */
  public renderStroke(
    points: readonly Point[],
    strokeColor: string = '#00f2fe',
    lineWidth: number = 3.5
  ): void {
    if (points.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowColor = strokeColor;
    this.ctx.shadowBlur = 8;

    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      this.ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }

    const last = points[points.length - 1];
    this.ctx.lineTo(last.x, last.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Renders the evaluated stroke where segments dynamically transition color
   * based on orthogonal distance deviation (120° Green -> 60° Yellow -> 0° Red).
   */
  public renderEvaluatedStroke(
    deviations: readonly PointDeviation[],
    lineWidth: number = 4
  ): void {
    if (deviations.length < 2) return;

    this.ctx.save();
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    for (let i = 0; i < deviations.length - 1; i++) {
      const d1 = deviations[i];
      const d2 = deviations[i + 1];

      const grad = this.ctx.createLinearGradient(d1.point.x, d1.point.y, d2.point.x, d2.point.y);
      grad.addColorStop(0, d1.color);
      grad.addColorStop(1, d2.color);

      this.ctx.strokeStyle = grad;
      this.ctx.shadowColor = d2.color;
      this.ctx.shadowBlur = 6;

      this.ctx.beginPath();
      this.ctx.moveTo(d1.point.x, d1.point.y);
      this.ctx.lineTo(d2.point.x, d2.point.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Renders the fitted ideal reference sine curve as a clean, translucent guideline.
   */
  public renderFittedSineGuideline(
    curvePoints: readonly Point[],
    strokeColor: string = 'rgba(243, 85, 218, 0.7)',
    lineWidth: number = 2.5
  ): void {
    if (curvePoints.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowColor = strokeColor;
    this.ctx.shadowBlur = 10;
    this.ctx.setLineDash([4, 4]);

    this.ctx.beginPath();
    this.ctx.moveTo(curvePoints[0].x, curvePoints[0].y);

    for (let i = 1; i < curvePoints.length; i++) {
      this.ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
    }

    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  /**
   * Renders a transient notification or score banner directly on canvas.
   */
  public renderBanner(
    title: string,
    subtitle?: string,
    isError: boolean = false
  ): void {
    this.ctx.save();
    const cx = this.width / 2;
    const cy = 60;

    this.ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = isError ? '#ff3366' : '#00ff88';
    this.ctx.shadowColor = isError ? '#ff3366' : '#00ff88';
    this.ctx.shadowBlur = 12;
    this.ctx.fillText(title, cx, cy);

    if (subtitle) {
      this.ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      this.ctx.fillStyle = '#94a3b8';
      this.ctx.shadowBlur = 0;
      this.ctx.fillText(subtitle, cx, cy + 24);
    }

    this.ctx.restore();
  }

  public getDimensions(): { width: number; height: number; dpr: number } {
    return { width: this.width, height: this.height, dpr: this.dpr };
  }
}
