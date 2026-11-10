import { Point, PointDeviation } from '../model/types';
import { ScoreAnimationState, ScoreAnimationTier } from './ScoreCalculationAnimator';

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
   * Renders the dynamic score calculation banner:
   * 1. Top: Hero Accuracy (prominent, bold, color-coded)
   * 2. Bottom: Animated calculation showing how the Score is derived from the sine wave length (cycles).
   * Conspicuous celebration particles and ripple animations scale up with higher scores.
   */
  public renderCalculationBanner(state: ScoreAnimationState): void {
    this.ctx.save();
    this.ctx.shadowBlur = 0;
    const cx = this.width / 2;
    const isMobile = this.width < 520;
    const heroFontSize = isMobile ? 38 : 52;
    const subFontSize = isMobile ? 15 : 20;

    // 1. Groß oben: Hero Headline ONLY Accuracy
    let accColor = '#22c55e'; // green
    if (state.accuracy < 50) {
      accColor = '#ef4444'; // red
    } else if (state.accuracy < 80) {
      accColor = '#f59e0b'; // amber
    }

    this.ctx.textAlign = 'center';
    this.ctx.font = `800 ${heroFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    this.ctx.fillStyle = accColor;
    this.ctx.fillText(`Accuracy: ${state.accuracy}%`, cx, isMobile ? 54 : 66);

    // 2. Unten drunter: Animated calculation from sine length to Score (no cycles text, no overlapping mini-wave)
    const calcY = isMobile ? 92 : 110;

    // Optional celebratory ripple for high & legendary tiers
    if (state.rippleRadius > 0 && state.rippleAlpha > 0) {
      this.ctx.beginPath();
      this.ctx.arc(cx, calcY, state.rippleRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle =
        state.tier === 'legendary'
          ? `rgba(250, 204, 21, ${state.rippleAlpha})`
          : `rgba(34, 197, 94, ${state.rippleAlpha})`;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    // Calculation text formatting based on animation phase (clean, no cycles count)
    let scoreColor = '#38bdf8';
    if (state.targetScore < 300) scoreColor = '#ef4444';
    else if (state.targetScore < 700) scoreColor = '#f59e0b';
    else if (state.targetScore < 1000) scoreColor = '#22c55e';
    else scoreColor = '#facc15';

    if (state.phase === 'measuring') {
      this.ctx.font = `600 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = '#94a3b8';
      this.ctx.fillText('Measuring Wave Length...', cx, calcY);
    } else if (state.phase === 'multiplying') {
      this.ctx.font = `600 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = '#cbd5e1';
      this.ctx.fillText(`Length Bonus ➔ Score: ${state.currentScore.toLocaleString()} pts`, cx, calcY);
    } else {
      // Celebrating or settled: highlight score with scale bounce
      const finalFontSize = Math.round(subFontSize * state.scaleFactor);
      this.ctx.font = `800 ${finalFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = scoreColor;

      let calcText = '';
      if (state.tier === 'legendary') {
        calcText = `★  Score: ${state.targetScore.toLocaleString()} pts  ★`;
      } else {
        calcText = `Score: ${state.targetScore.toLocaleString()} pts`;
      }
      this.ctx.fillText(calcText, cx, calcY);
    }

    // Render celebratory particles
    if (state.particles.length > 0) {
      for (const p of state.particles) {
        if (p.alpha <= 0.01) continue;
        this.ctx.save();
        this.ctx.globalAlpha = p.alpha;
        this.ctx.fillStyle = p.color;

        if (p.shape === 'star') {
          const r = p.size;
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y - r);
          this.ctx.lineTo(p.x + r * 0.3, p.y - r * 0.3);
          this.ctx.lineTo(p.x + r, p.y);
          this.ctx.lineTo(p.x + r * 0.3, p.y + r * 0.3);
          this.ctx.lineTo(p.x, p.y + r);
          this.ctx.lineTo(p.x - r * 0.3, p.y + r * 0.3);
          this.ctx.lineTo(p.x - r, p.y);
          this.ctx.lineTo(p.x - r * 0.3, p.y - r * 0.3);
          this.ctx.closePath();
          this.ctx.fill();
        } else {
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          this.ctx.fill();
        }
        this.ctx.restore();
      }
    }

    this.ctx.restore();
  }

  /**
   * Renders a traveling tracer bead along the actual drawn canvas wave during length measurement.
   */
  public renderWaveTracer(
    deviations: readonly PointDeviation[],
    progress: number,
    tier: ScoreAnimationTier
  ): void {
    if (deviations.length < 2 || progress <= 0 || progress > 1.0) return;
    if (tier === 'low') return;

    this.ctx.save();
    this.ctx.shadowBlur = 0;

    const idx = Math.min(deviations.length - 1, Math.floor(progress * (deviations.length - 1)));
    const pt = deviations[idx].point;

    const radius = tier === 'legendary' ? 6 : tier === 'high' ? 5 : 4;
    const ringColor = tier === 'legendary' ? '#facc15' : tier === 'high' ? '#22c55e' : '#38bdf8';

    // Outer ring
    this.ctx.beginPath();
    this.ctx.arc(pt.x, pt.y, radius + 3, 0, Math.PI * 2);
    this.ctx.strokeStyle = ringColor;
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // Central core
    this.ctx.beginPath();
    this.ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fill();

    // Trailing sparks for legendary tier
    if (tier === 'legendary' && idx > 4) {
      for (let trail = 1; trail <= 3; trail++) {
        const trailPt = deviations[idx - trail * 2]?.point;
        if (trailPt) {
          this.ctx.beginPath();
          this.ctx.arc(trailPt.x, trailPt.y, 2.5 - trail * 0.6, 0, Math.PI * 2);
          this.ctx.fillStyle = `rgba(250, 204, 21, ${0.8 - trail * 0.25})`;
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
  }

  /**
   * Renders a transient notification or fallback banner directly on canvas.
   * School notebook style: crisp typography, large accuracy on top, zero glow.
   */
  public renderBanner(
    title: string,
    subtitle?: string,
    isError: boolean = false
  ): void {
    this.ctx.save();
    this.ctx.shadowBlur = 0;
    const cx = this.width / 2;
    const isMobile = this.width < 520;
    const bannerFontSize = isMobile ? 32 : 48;

    if (isError) {
      // Uniform headline font size and positioning, zero extra info
      this.ctx.textAlign = 'center';
      this.ctx.font = `800 ${bannerFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = '#ef4444';
      this.ctx.fillText(title, cx, isMobile ? 54 : 66);
      this.ctx.restore();
      return;
    }

    // If title starts with Accuracy:
    const accMatch = title.match(/^Accuracy:\s*(\d+%?)/i);
    if (accMatch) {
      const accVal = parseInt(accMatch[1].replace('%', ''), 10);
      let accColor = '#22c55e';
      if (!isNaN(accVal)) {
        if (accVal < 50) accColor = '#ef4444';
        else if (accVal < 80) accColor = '#f59e0b';
      }

      this.ctx.textAlign = 'center';
      this.ctx.font = `800 ${bannerFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = accColor;
      this.ctx.fillText(title, cx, isMobile ? 54 : 66);

      if (subtitle) {
        const subFontSize = isMobile ? 16 : 20;
        this.ctx.font = `600 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        this.ctx.fillStyle = '#cbd5e1';
        this.ctx.fillText(subtitle, cx, isMobile ? 82 : 98);
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

      this.ctx.font = `800 ${bannerFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = scoreColor;
      const displayScore = title.startsWith('Demo') ? `Demo: ${scoreText}` : `Score: ${scoreText}`;
      this.ctx.fillText(displayScore, cx, isMobile ? 54 : 66);

      if (subtitle) {
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
      this.ctx.font = `800 ${bannerFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = '#38bdf8';
      this.ctx.fillText(title, cx, isMobile ? 54 : 66);

      if (subtitle) {
        const subFontSize = isMobile ? 18 : 22;
        this.ctx.font = `600 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        this.ctx.fillStyle = '#94a3b8';
        this.ctx.fillText(subtitle, cx, isMobile ? 82 : 98);
      }
    }

    this.ctx.restore();
  }

  public getDimensions(): { width: number; height: number; dpr: number } {
    return { width: this.width, height: this.height, dpr: this.dpr };
  }
}
