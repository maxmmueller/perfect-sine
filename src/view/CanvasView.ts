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
   * Renders coordinate axes (baseline and vertical axis) for the fitted reference sine curve.
   */
  public renderCoordinateAxes(
    baselineAxis: { start: Point; end: Point },
    verticalAxis: { start: Point; end: Point },
    color: string = 'rgba(148, 163, 184, 0.35)'
  ): void {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([5, 5]);

    // Baseline axis (y' = 0)
    this.ctx.beginPath();
    this.ctx.moveTo(baselineAxis.start.x, baselineAxis.start.y);
    this.ctx.lineTo(baselineAxis.end.x, baselineAxis.end.y);
    this.ctx.stroke();

    // Vertical axis at origin (x' = minX)
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    this.ctx.setLineDash([3, 3]);
    this.ctx.beginPath();
    this.ctx.moveTo(verticalAxis.start.x, verticalAxis.start.y);
    this.ctx.lineTo(verticalAxis.end.x, verticalAxis.end.y);
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * Renders the interactive pulsing target marker at the coordinate origin.
   *
   * @param origin Screen position of the coordinate origin.
   * @param pulseFactor Animated pulse factor between 0.0 and 1.0 (sinusoidal breathing).
   * @param hitRadius Accessible hitbox radius (e.g. 24px for 48x48px target >= 44x44px).
   */
  public renderOriginMarker(
    origin: Point,
    pulseFactor: number = 0.5,
    hitRadius: number = 24
  ): void {
    this.ctx.save();

    // 1. Outer pulsing halo ring
    const outerRadius = hitRadius + 4 + pulseFactor * 8;
    const outerAlpha = 0.4 * (1 - pulseFactor * 0.5);
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, outerRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(0, 240, 255, ${outerAlpha})`;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // 2. Interactive hitbox ring (>= 44x44px clickable target)
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, hitRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
    this.ctx.fill();
    this.ctx.strokeStyle = '#00f0ff';
    this.ctx.lineWidth = 2;
    this.ctx.shadowColor = '#00f0ff';
    this.ctx.shadowBlur = 10;
    this.ctx.stroke();

    // 3. Central target bullseye
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = '#ffffff';
    this.ctx.shadowBlur = 6;
    this.ctx.fill();

    // 4. "RESET" micro-label badge
    this.ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#00f0ff';
    this.ctx.shadowBlur = 0;
    this.ctx.fillText('RESET', origin.x, origin.y + hitRadius + 15);

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
