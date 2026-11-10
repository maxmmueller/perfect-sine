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
    const gridSize = 36;
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    this.ctx.lineWidth = 1;

    for (let x = 0; x <= this.width; x += gridSize) {
      const px = Math.floor(x) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(px, 0);
      this.ctx.lineTo(px, this.height);
      this.ctx.stroke();
    }

    for (let y = 0; y <= this.height; y += gridSize) {
      const py = Math.floor(y) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, py);
      this.ctx.lineTo(this.width, py);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Renders the real-time active user stroke in clean notebook ink style (no glow).
   */
  public renderStroke(
    points: readonly Point[],
    strokeColor: string = '#38bdf8',
    lineWidth: number = 3.5
  ): void {
    if (points.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowBlur = 0;

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
   * Clean ink transitions without blurry glow.
   */
  public renderEvaluatedStroke(
    deviations: readonly PointDeviation[],
    lineWidth: number = 3.5
  ): void {
    if (deviations.length < 2) return;

    this.ctx.save();
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowBlur = 0;

    for (let i = 0; i < deviations.length - 1; i++) {
      const d1 = deviations[i];
      const d2 = deviations[i + 1];

      const grad = this.ctx.createLinearGradient(d1.point.x, d1.point.y, d2.point.x, d2.point.y);
      grad.addColorStop(0, d1.color);
      grad.addColorStop(1, d2.color);

      this.ctx.strokeStyle = grad;

      this.ctx.beginPath();
      this.ctx.moveTo(d1.point.x, d1.point.y);
      this.ctx.lineTo(d2.point.x, d2.point.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Renders the fitted ideal reference sine curve as a dashed red teacher's pen guideline.
   */
  public renderFittedSineGuideline(
    curvePoints: readonly Point[],
    strokeColor: string = 'rgba(239, 68, 68, 0.9)',
    lineWidth: number = 2
  ): void {
    if (curvePoints.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowBlur = 0;
    this.ctx.setLineDash([6, 6]);

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
    this.ctx.shadowBlur = 0;

    // 1. Outer pulsing halo ring
    const outerRadius = hitRadius + 4 + pulseFactor * 8;
    const outerAlpha = 0.3 * (1 - pulseFactor * 0.5);
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, outerRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(56, 189, 248, ${outerAlpha})`;
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // 2. Interactive hitbox ring (>= 44x44px clickable target)
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, hitRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // 3. Central target bullseye
    this.ctx.beginPath();
    this.ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fill();

    // 4. "RESET" micro-label badge
    this.ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.fillText('RESET', origin.x, origin.y + hitRadius + 15);

    this.ctx.restore();
  }

  /**
   * Renders a transient notification or prominent score & accuracy banner directly on canvas.
   * School notebook style: crisp typography, large score, smaller accuracy, zero glow.
   */
  public renderBanner(
    title: string,
    subtitle?: string,
    isError: boolean = false
  ): void {
    this.ctx.save();
    this.ctx.shadowBlur = 0;
    const cx = this.width / 2;
    const isMobile = this.width < 480;

    if (isError) {
      this.ctx.textAlign = 'center';
      this.ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      this.ctx.fillStyle = '#ef4444';
      this.ctx.fillText(title, cx, isMobile ? 52 : 62);

      if (subtitle) {
        this.ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        this.ctx.fillStyle = '#94a3b8';
        this.ctx.fillText(subtitle, cx, isMobile ? 78 : 90);
      }
      this.ctx.restore();
      return;
    }

    const scoreMatch = title.match(/^(?:Score|Demo):\s*(.+)$/i);

    if (scoreMatch) {
      const scoreText = scoreMatch[1];
      this.ctx.textAlign = 'center';

      const numericVal = parseInt(scoreText.replace(/\D/g, ''), 10);
      let scoreColor = '#22c55e';
      if (!isNaN(numericVal)) {
        if (numericVal < 400) {
          scoreColor = '#ef4444';
        } else if (numericVal < 700) {
          scoreColor = '#f59e0b';
        }
      }

      const scoreFontSize = isMobile ? 38 : 50;
      this.ctx.font = `800 ${scoreFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = scoreColor;
      const displayScore = title.startsWith('Demo') ? `Demo: ${scoreText}` : `Score: ${scoreText}`;
      this.ctx.fillText(displayScore, cx, isMobile ? 54 : 66);

      if (subtitle) {
        // Only show Accuracy; completely omit cycles, R^2, and retry hints
        let accuracyText = subtitle.split('|')[0].trim();
        if (!accuracyText.toLowerCase().startsWith('accuracy') && !accuracyText.toLowerCase().startsWith('bot accuracy')) {
          accuracyText = `Accuracy: ${accuracyText}`;
        }
        const accFontSize = isMobile ? 18 : 22;
        this.ctx.font = `600 ${accFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        this.ctx.fillStyle = '#f1f5f9';
        this.ctx.fillText(accuracyText, cx, isMobile ? 82 : 98);
      }
    } else {
      this.ctx.textAlign = 'center';
      this.ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      this.ctx.fillStyle = '#38bdf8';
      this.ctx.fillText(title, cx, isMobile ? 52 : 62);

      if (subtitle) {
        this.ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        this.ctx.fillStyle = '#94a3b8';
        this.ctx.fillText(subtitle, cx, isMobile ? 78 : 90);
      }
    }

    this.ctx.restore();
  }

  public getDimensions(): { width: number; height: number; dpr: number } {
    return { width: this.width, height: this.height, dpr: this.dpr };
  }
}
