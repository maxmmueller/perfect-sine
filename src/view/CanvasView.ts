import { Point, PointDeviation } from '../model/types';
import { ScoreAnimationState, ScoreAnimationTier } from './ScoreCalculationAnimator';

export interface StrokeFadeWindow {
  /** Normalized wipe progress [0..1] traveling from first-drawn start (0) to end (1). */
  readonly eraseProgress: number;
  /** Width of the smooth gradient ramp along normalized arc length (default 0.34). */
  readonly fadeSpan?: number;
  /** Optional precomputed normalized cumulative arc-length [0..1] per point. */
  readonly arcProgress?: readonly number[];
}

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
    this.dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || (typeof window !== 'undefined' ? window.innerWidth : 800);
    this.height = rect.height || (typeof window !== 'undefined' ? window.innerHeight : 600);

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
   * Computes normalized progressive opacity multiplier [0..1] along stroke progression
   * so the first-drawn start vanishes before the tail-drawn end.
   */
  public static computePointFadeFactor(
    index: number,
    totalPoints: number,
    fadeWindow?: StrokeFadeWindow
  ): number {
    if (!fadeWindow || fadeWindow.eraseProgress <= 0) return 1.0;
    if (fadeWindow.eraseProgress >= 1) return 0.0;

    const fadeSpan = Math.max(0.08, fadeWindow.fadeSpan ?? 0.34);
    const wipeFront = fadeWindow.eraseProgress * (1 + fadeSpan);
    const wipeTail = wipeFront - fadeSpan;

    const s =
      fadeWindow.arcProgress && fadeWindow.arcProgress.length === totalPoints
        ? fadeWindow.arcProgress[index]
        : totalPoints > 1
        ? index / (totalPoints - 1)
        : 0;

    if (s <= wipeTail) return 0.0;
    if (s >= wipeFront) return 1.0;

    const t = (s - wipeTail) / fadeSpan;
    return t * t * (3 - 2 * t);
  }

  /**
   * Renders the evaluated stroke where segments dynamically transition color
   * based on orthogonal distance deviation (120° Green -> 60° Yellow -> 0° Red).
   * Supports optional overall alpha and sequential head-to-tail progressive wipe fade.
   */
  public renderEvaluatedStroke(
    deviations: readonly PointDeviation[],
    lineWidth: number = 3.5,
    alpha: number = 1.0,
    fadeWindow?: StrokeFadeWindow
  ): void {
    const n = deviations.length;
    if (n < 2) return;
    const safeAlpha = Math.max(0, Math.min(1, alpha));
    if (safeAlpha <= 0.005) return;
    if (fadeWindow && fadeWindow.eraseProgress >= 1) return;

    const hasSequentialFade = Boolean(fadeWindow && fadeWindow.eraseProgress > 0);

    this.ctx.save();
    this.ctx.globalAlpha = safeAlpha;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'butt';
    this.ctx.lineJoin = 'round';
    this.ctx.shadowBlur = 0;

    // Draw round endcap at start if start point is still visible
    const startFactor = hasSequentialFade
      ? CanvasView.computePointFadeFactor(0, n, fadeWindow)
      : 1.0;
    const startAlpha = safeAlpha * startFactor;
    if (startAlpha > 0.005) {
      const first = deviations[0];
      if (hasSequentialFade) this.ctx.globalAlpha = startAlpha;
      this.ctx.fillStyle = first.color;
      this.ctx.beginPath();
      this.ctx.arc(first.point.x, first.point.y, lineWidth / 2, 0, Math.PI * 2);
      this.ctx.fill();
    }

    for (let i = 0; i < n - 1; i++) {
      let segAlpha = safeAlpha;
      if (hasSequentialFade) {
        const f1 = CanvasView.computePointFadeFactor(i, n, fadeWindow);
        const f2 = CanvasView.computePointFadeFactor(i + 1, n, fadeWindow);
        segAlpha = safeAlpha * ((f1 + f2) * 0.5);
        if (segAlpha <= 0.005) continue;
        this.ctx.globalAlpha = segAlpha;
      }

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

    // Draw round endcap at end
    const endFactor = hasSequentialFade
      ? CanvasView.computePointFadeFactor(n - 1, n, fadeWindow)
      : 1.0;
    const endAlpha = safeAlpha * endFactor;
    if (endAlpha > 0.005) {
      const last = deviations[n - 1];
      if (hasSequentialFade) this.ctx.globalAlpha = endAlpha;
      this.ctx.fillStyle = last.color;
      this.ctx.beginPath();
      this.ctx.arc(last.point.x, last.point.y, lineWidth / 2, 0, Math.PI * 2);
      this.ctx.fill();
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

    // 1. Groß oben: Hero Headline ONLY the percentage number (no "Accuracy:" label)
    let accColor = '#22c55e'; // green
    if (state.accuracy < 50) {
      accColor = '#ef4444'; // red
    } else if (state.accuracy < 80) {
      accColor = '#f59e0b'; // amber
    }

    this.ctx.textAlign = 'center';
    this.ctx.font = `800 ${heroFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    this.ctx.fillStyle = accColor;
    this.ctx.fillText(`${state.accuracy}%`, cx, isMobile ? 54 : 66);

    // 2. Unten drunter: Animated calculation from sine length to Score (clean, no extra labels or filler text)
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

    // Calculation text formatting: smooth count-up to target score (no filler words like "Measuring..." or "Length Bonus")
    let scoreColor = '#38bdf8';
    if (state.targetScore < 300) scoreColor = '#ef4444';
    else if (state.targetScore < 700) scoreColor = '#f59e0b';
    else if (state.targetScore < 1000) scoreColor = '#22c55e';
    else scoreColor = '#facc15';

    if (state.phase === 'measuring' || state.phase === 'multiplying') {
      this.ctx.font = `600 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      this.ctx.fillStyle = '#cbd5e1';
      this.ctx.fillText(`Score: ${state.currentScore.toLocaleString()} pts`, cx, calcY);
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
   * Arc-length parameterized for perfectly uniform speed and sub-pixel smoothness.
   * Features a vibrant glowing comet tail, pulsating energy aura, and radiant glints.
   * Consistently renders for all score tiers.
   */
  public renderWaveTracer(
    deviations: readonly PointDeviation[],
    progress: number,
    tier: ScoreAnimationTier
  ): void {
    if (deviations.length < 2 || progress <= 0 || progress > 1.0) return;

    this.ctx.save();
    this.ctx.shadowBlur = 0;

    // Arc-length parameterized interpolation for smooth, constant-speed movement
    let totalLength = 0;
    const segLengths: number[] = new Array(deviations.length - 1);
    for (let i = 0; i < deviations.length - 1; i++) {
      const p1 = deviations[i].point;
      const p2 = deviations[i + 1].point;
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      segLengths[i] = d;
      totalLength += d;
    }

    if (totalLength <= 0) {
      this.ctx.restore();
      return;
    }

    // Helper to compute sub-pixel point along the wave at any arc-length distance
    const getPointAtDist = (targetD: number): Point => {
      const clampedD = Math.max(0, Math.min(totalLength, targetD));
      let acc = 0;
      for (let i = 0; i < segLengths.length; i++) {
        const segLen = segLengths[i];
        if (acc + segLen >= clampedD || i === segLengths.length - 1) {
          if (segLen > 1e-4) {
            const t = Math.max(0, Math.min(1, (clampedD - acc) / segLen));
            const p1 = deviations[i].point;
            const p2 = deviations[i + 1].point;
            return {
              x: p1.x + (p2.x - p1.x) * t,
              y: p1.y + (p2.y - p1.y) * t,
            };
          }
          return deviations[i].point;
        }
        acc += segLen;
      }
      return deviations[deviations.length - 1].point;
    };

    const currentDist = Math.max(0, Math.min(1.0, progress)) * totalLength;
    const headPt = getPointAtDist(currentDist);

    // Dynamic style configuration per celebration tier
    const config = {
      legendary: {
        ringColor: '#facc15',
        trailColor: 'rgba(250, 204, 21, ',
        auraColor: 'rgba(250, 204, 21, 0.45)',
        radius: 6.5,
        auraRadius: 22,
        hasFlare: true,
      },
      high: {
        ringColor: '#22c55e',
        trailColor: 'rgba(74, 222, 128, ',
        auraColor: 'rgba(34, 197, 94, 0.40)',
        radius: 5.5,
        auraRadius: 18,
        hasFlare: true,
      },
      medium: {
        ringColor: '#38bdf8',
        trailColor: 'rgba(56, 189, 248, ',
        auraColor: 'rgba(56, 189, 248, 0.35)',
        radius: 4.5,
        auraRadius: 15,
        hasFlare: false,
      },
      low: {
        ringColor: '#f59e0b',
        trailColor: 'rgba(245, 158, 11, ',
        auraColor: 'rgba(245, 158, 11, 0.30)',
        radius: 4.0,
        auraRadius: 13,
        hasFlare: false,
      },
    }[tier];

    // 1. Dynamic glowing comet tail trailing behind the head along the actual wave curve
    const trailOffsets = [8, 18, 30, 44, 60];
    const trailPoints: Point[] = [];
    for (const offset of trailOffsets) {
      if (currentDist - offset >= 0) {
        trailPoints.push(getPointAtDist(currentDist - offset));
      }
    }

    if (trailPoints.length >= 1) {
      // Connecting glowing comet tail ribbon
      this.ctx.beginPath();
      this.ctx.moveTo(headPt.x, headPt.y);
      for (const tp of trailPoints) {
        this.ctx.lineTo(tp.x, tp.y);
      }
      this.ctx.strokeStyle = `${config.trailColor}0.40)`;
      this.ctx.lineWidth = Math.max(2, config.radius * 1.3);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();

      // Trailing spark embers along the tail
      for (let k = 0; k < trailPoints.length; k++) {
        const tp = trailPoints[k];
        const trailAlpha = Math.max(0.12, 0.75 - k * 0.14);
        const trailR = Math.max(1.2, config.radius * (0.75 - k * 0.12));

        this.ctx.beginPath();
        this.ctx.arc(tp.x, tp.y, trailR, 0, Math.PI * 2);
        this.ctx.fillStyle = `${config.trailColor}${trailAlpha})`;
        this.ctx.fill();
      }
    }

    // 2. Pulsing energy aura (radial glow bloom)
    const pulse = 1.0 + 0.18 * Math.sin(progress * Math.PI * 14);
    const dynamicAura = config.auraRadius * pulse;

    if (typeof this.ctx.createRadialGradient === 'function') {
      const radialGrad = this.ctx.createRadialGradient(
        headPt.x,
        headPt.y,
        config.radius * 0.3,
        headPt.x,
        headPt.y,
        dynamicAura
      );
      radialGrad.addColorStop(0, config.auraColor);
      radialGrad.addColorStop(0.6, `${config.trailColor}0.15)`);
      radialGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      this.ctx.fillStyle = radialGrad;
    } else {
      this.ctx.fillStyle = config.auraColor;
    }

    this.ctx.beginPath();
    this.ctx.arc(headPt.x, headPt.y, dynamicAura, 0, Math.PI * 2);
    this.ctx.fill();

    // 3. Crisp high-contrast energy ring
    this.ctx.beginPath();
    this.ctx.arc(headPt.x, headPt.y, config.radius + 2.5, 0, Math.PI * 2);
    this.ctx.strokeStyle = config.ringColor;
    this.ctx.lineWidth = 2.0;
    this.ctx.stroke();

    // 4. Brilliant white-hot core
    this.ctx.beginPath();
    this.ctx.arc(headPt.x, headPt.y, config.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fill();

    // 5. Radiant 4-point star glint for high and legendary tiers
    if (config.hasFlare) {
      const flareLen = config.radius * 2.2;
      const angle = progress * Math.PI * 8; // smooth rotation as it travels
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      this.ctx.beginPath();
      this.ctx.moveTo(headPt.x - flareLen * cosA, headPt.y - flareLen * sinA);
      this.ctx.lineTo(headPt.x + flareLen * cosA, headPt.y + flareLen * sinA);
      this.ctx.moveTo(headPt.x + flareLen * sinA, headPt.y - flareLen * cosA);
      this.ctx.lineTo(headPt.x - flareLen * sinA, headPt.y + flareLen * cosA);
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
    }

    // 6. Endpoint impact flash when reaching the end of the wave
    if (progress >= 0.95) {
      const impactP = (progress - 0.95) / 0.05;
      const impactRadius = config.radius + impactP * 16;
      const impactAlpha = Math.max(0, 1 - impactP);

      this.ctx.beginPath();
      this.ctx.arc(headPt.x, headPt.y, impactRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = `${config.trailColor}${impactAlpha})`;
      this.ctx.lineWidth = 2.0;
      this.ctx.stroke();
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

    // If title starts with Accuracy or is a percentage number:
    const accMatch = title.match(/^(?:Accuracy:\s*)?(\d+%?)$/i);
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
      this.ctx.fillText(`${accVal}%`, cx, isMobile ? 54 : 66);

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
