import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { CanvasView } from '../view/CanvasView';
import { SineFitter } from '../model/SineFitter';
import { PeriodValidator } from '../model/PeriodValidator';
import { TiltDetector } from '../model/TiltDetector';
import { CoordinateSystem, CoordinateFrame } from '../model/CoordinateSystem';
import { DemoBot, DemoWaveOptions, DemoWaveResult } from '../model/DemoBot';
import { IScoreStrategy } from '../model/scoring/IScoreStrategy';
import { UnifiedEnsembleScoreStrategy } from '../model/scoring/UnifiedEnsembleScoreStrategy';
import { ScoreStrategyManager, ScorerEvaluationItem } from '../model/scoring/ScoreStrategyManager';
import { StrokeEvaluation, Point, PointDeviation } from '../model/types';
import { ScoreCalculationAnimator } from '../view/ScoreCalculationAnimator';
import { HudView } from '../view/HudView';

export interface DemoHistoricalWave {
  readonly deviations: PointDeviation[];
  readonly arcProgress: number[];
  readonly fadeDurationMs: number;
  elapsedFadeMs: number;
  fromAlpha: number;
  toAlpha: number;
  alpha: number;
  fromErase: number;
  toErase: number;
  eraseProgress: number;
}

export class DrawingController {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: CanvasView;
  private readonly stateMachine: GameStateMachine;
  private readonly strokeBuffer: StrokeBuffer;
  private readonly strategyManager?: ScoreStrategyManager;
  private readonly scoreAnimator = new ScoreCalculationAnimator();
  private scoreStrategy: IScoreStrategy;
  private isPointerDown = false;
  private lastEvaluation: StrokeEvaluation | null = null;
  private allEvaluations: ScorerEvaluationItem[] = [];
  private liveEvaluation: StrokeEvaluation | null = null;
  private lastValidationMessage: string | null = null;
  private coordinateFrame: CoordinateFrame | null = null;
  private lastDrawnStroke: {
    readonly points: readonly Point[];
    readonly evaluation: StrokeEvaluation | null;
    readonly validationMessage: string | null;
  } | null = null;
  private readonly onEvaluationComplete?: (evaluation: StrokeEvaluation) => void;
  private readonly onMultiEvaluationComplete?: (evaluations: ScorerEvaluationItem[]) => void;
  private readonly onStrokeComplete?: (stroke: {
    readonly points: readonly Point[];
    readonly evaluation: StrokeEvaluation | null;
    readonly validationMessage: string | null;
  }) => void;
  private readonly onReset?: () => void;
  private demoAnimationId: number | null = null;
  private demoTimeoutId: number | null = null;
  private scoreAnimId: number | null = null;
  private isDemoActive = false;
  private lastDemoFadeTimestamp = 0;
  private demoPoints: Point[] = [];
  private demoDeviations: PointDeviation[] = [];
  private currentDemoDeviations: PointDeviation[] = [];
  private demoHistory: DemoHistoricalWave[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    view: CanvasView,
    stateMachine: GameStateMachine,
    strokeBuffer: StrokeBuffer,
    options?: {
      scoreStrategy?: IScoreStrategy;
      strategyManager?: ScoreStrategyManager;
      onEvaluationComplete?: (evaluation: StrokeEvaluation) => void;
      onMultiEvaluationComplete?: (evaluations: ScorerEvaluationItem[]) => void;
      onStrokeComplete?: (stroke: {
        readonly points: readonly Point[];
        readonly evaluation: StrokeEvaluation | null;
        readonly validationMessage: string | null;
      }) => void;
      onReset?: () => void;
    }
  ) {
    this.canvas = canvas;
    this.view = view;
    this.stateMachine = stateMachine;
    this.strokeBuffer = strokeBuffer;
    this.strategyManager = options?.strategyManager;
    this.scoreStrategy = options?.scoreStrategy ?? options?.strategyManager?.getActiveStrategy() ?? new UnifiedEnsembleScoreStrategy();
    this.onEvaluationComplete = options?.onEvaluationComplete;
    this.onMultiEvaluationComplete = options?.onMultiEvaluationComplete;
    this.onStrokeComplete = options?.onStrokeComplete;
    this.onReset = options?.onReset;

    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.view.handleResize();
        this.render();
      });
      window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (this.isDemoActive) {
          const modifierOnly =
            e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta';
          if (
            modifierOnly ||
            e.key === 'Escape' ||
            HudView.isScreenshotShortcut(e) ||
            HudView.isInAppShareShortcut(e)
          ) {
            return;
          }
          this.stopDemo();
          this.reset();
        }
      });
    }

    if (this.canvas && typeof this.canvas.addEventListener === 'function') {
      this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
      this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
      this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
      this.canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this));
    }
  }

  private getCanvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  public handlePointerDown(e: PointerEvent): void {
    // If bot demo is actively running, interrupt immediately and yield full control to user
    if (this.isDemoActive) {
      this.stopDemo();
      this.reset();
    }

    const pt = this.getCanvasPoint(e);

    // If state is locked after evaluation, touch or click anywhere resets immediately
    if (this.stateMachine.getState() === 'LOCKED') {
      this.reset();
    }

    if (this.stateMachine.getState() !== 'IDLE') {
      return;
    }

    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // safe fallback if pointer capture is unsupported
    }

    this.isPointerDown = true;
    this.stopCalculationAnimation();
    this.scoreAnimator.reset();
    this.strokeBuffer.clear();
    this.lastEvaluation = null;
    this.liveEvaluation = null;
    this.lastValidationMessage = null;
    this.coordinateFrame = null;

    this.strokeBuffer.addPoint(pt.x, pt.y);
    this.stateMachine.startDrawing();
    this.render();
  }

  public handlePointerMove(e: PointerEvent): void {
    if (this.stateMachine.getState() === 'LOCKED') {
      return;
    }

    const pt = this.getCanvasPoint(e);

    if (!this.isPointerDown || this.stateMachine.getState() !== 'DRAWING') {
      return;
    }

    const added = this.strokeBuffer.addPoint(pt.x, pt.y);
    if (added) {
      // Compute live dynamic fit and gradient coloring during active drawing (requires minimum amplitude)
      const points = this.strokeBuffer.getPoints();
      if (points.length >= 15) {
        const bbox = this.strokeBuffer.getBoundingBox();
        const liveAmp = bbox ? bbox.height / 2 : 0;
        if (liveAmp >= 15) {
          const liveFit = SineFitter.fit(points);
          if (liveFit && liveFit.amplitude >= 18 && liveFit.fullCycles >= 0.4) {
            this.liveEvaluation = this.scoreStrategy.evaluate(points, liveFit, 30);
          }
        } else {
          this.liveEvaluation = null;
        }
      }
      this.render();
    }
  }

  public handlePointerUp(e: PointerEvent): void {
    if (!this.isPointerDown) {
      return;
    }

    this.isPointerDown = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // safe fallback
    }

    if (this.stateMachine.getState() === 'DRAWING') {
      this.stateMachine.finishDrawing();
      this.evaluateStroke();
      this.stateMachine.setEvaluated();

      const points = this.strokeBuffer.getPoints();
      this.lastDrawnStroke = {
        points: [...points],
        evaluation: this.lastEvaluation,
        validationMessage: this.lastValidationMessage,
      };
      this.onStrokeComplete?.(this.lastDrawnStroke);

      this.render();
    }
  }

  private evaluateStroke(): void {
    const points = this.strokeBuffer.getPoints();
    if (points.length < 8) {
      this.lastValidationMessage = 'Stroke too short. Draw a continuous wave.';
      this.lastEvaluation = null;
      return;
    }

    const fit = SineFitter.fit(points);
    if (!fit) {
      this.lastValidationMessage = 'Could not resolve wave geometry.';
      this.lastEvaluation = null;
      return;
    }

    if (fit.amplitude < 20) {
      this.lastValidationMessage = 'Wave amplitude is too small (< 20px). Draw a larger wave with clear peaks and troughs.';
      this.lastEvaluation = null;
      return;
    }

    // Validate period coverage (at least 2*PI radians)
    const aligned = TiltDetector.transformPoints(points, fit.tilt);
    const periodCheck = PeriodValidator.validate(aligned, fit.frequency, undefined, undefined, fit.amplitude);

    if (!periodCheck.isValid) {
      this.lastValidationMessage = periodCheck.message ?? 'Incomplete wave. Spanning >= 2π required.';
      this.lastEvaluation = null;
      return;
    }

    // Valid wave: compute deviations and scoring via active pluggable strategy
    this.lastEvaluation = this.scoreStrategy.evaluate(points, fit, 30);
    this.coordinateFrame = CoordinateSystem.computeFrame(fit, points);
    this.liveEvaluation = null;
    this.lastValidationMessage = null;

    const dims = this.view.getDimensions();
    const originX = dims.width / 2;
    const originY = dims.width < 520 ? 90 : 106;
    this.scoreAnimator.start(this.lastEvaluation, originX, originY);
    this.startCalculationAnimation();

    if (this.strategyManager) {
      this.allEvaluations = this.strategyManager.evaluateAll(points, fit, 30);
      this.onMultiEvaluationComplete?.(this.allEvaluations);
    }

    if (this.onEvaluationComplete) {
      this.onEvaluationComplete(this.lastEvaluation);
    }
  }

  private startCalculationAnimation(): void {
    this.stopCalculationAnimation();
    const frame = () => {
      if (this.stateMachine.getState() !== 'LOCKED') return;
      this.render();
      if (this.scoreAnimator.isActive()) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.scoreAnimId = requestAnimationFrame(frame);
        }
      }
    };
    if (typeof requestAnimationFrame !== 'undefined') {
      this.scoreAnimId = requestAnimationFrame(frame);
    }
  }

  public stopCalculationAnimation(): void {
    if (this.scoreAnimId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.scoreAnimId);
      this.scoreAnimId = null;
    }
  }

  public getScoreStrategy(): IScoreStrategy {
    return this.scoreStrategy;
  }

  public getAllEvaluations(): readonly ScorerEvaluationItem[] {
    return this.allEvaluations;
  }

  public setScoreStrategy(strategy: IScoreStrategy): void {
    this.scoreStrategy = strategy;
    if (this.strategyManager) {
      this.strategyManager.setActiveStrategy(strategy.id);
    }
    if (this.lastEvaluation) {
      const points = this.strokeBuffer.getPoints();
      this.lastEvaluation = this.scoreStrategy.evaluate(points, this.lastEvaluation.fittedSine, 30);
      this.render();
    }
  }

  public reset(): void {
    this.stopDemo();
    this.stopCalculationAnimation();
    this.scoreAnimator.reset();
    if (this.stateMachine.getState() === 'DRAWING') {
      this.stateMachine.finishDrawing();
    }
    if (this.stateMachine.getState() === 'LOCKED' || this.stateMachine.getState() === 'EVALUATING') {
      this.stateMachine.reset();
    }
    this.strokeBuffer.clear();
    this.lastEvaluation = null;
    this.allEvaluations = [];
    this.liveEvaluation = null;
    this.lastValidationMessage = null;
    this.coordinateFrame = null;
    this.currentDemoDeviations = [];
    this.demoHistory = [];
    this.isPointerDown = false;
    this.canvas.style.cursor = 'default';
    this.onReset?.();
    this.render();
  }

  public startDemo(customOptions?: DemoWaveOptions, preserveHistory = false): void {
    if (!preserveHistory) {
      this.stopDemo();
      this.reset();
      this.demoHistory = [];
    } else {
      if (this.demoAnimationId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.demoAnimationId);
        this.demoAnimationId = null;
      }
      if (this.demoTimeoutId !== null && typeof clearTimeout !== 'undefined') {
        clearTimeout(this.demoTimeoutId);
        this.demoTimeoutId = null;
      }

      // Archive the just-completed demo wave into continuous time-driven history fade without
      // interrupting or resetting the fade progression of older waves already on canvas
      if (this.currentDemoDeviations.length >= 2) {
        this.demoHistory = this.demoHistory.filter(
          (item) => item.eraseProgress < 0.995 && item.alpha > 0.02
        );
        const archived = [...this.currentDemoDeviations];
        this.demoHistory.push({
          deviations: archived,
          arcProgress: DrawingController.computeArcProgress(archived),
          fadeDurationMs: DrawingController.DEMO_FADE_DURATION_MS,
          elapsedFadeMs: 0,
          fromAlpha: 0.85,
          toAlpha: 0.25,
          alpha: 0.85,
          fromErase: 0,
          toErase: 1.0,
          eraseProgress: 0,
        });
        // Keep at most 2 fading historical waves to ensure ample canvas room without crowding
        while (this.demoHistory.length > 2) {
          this.demoHistory.shift();
        }
      }
      this.strokeBuffer.clear();
      this.currentDemoDeviations = [];
    }

    this.isDemoActive = true;

    const dims = this.view.getDimensions();
    const width = dims.width > 0 ? dims.width : 800;
    const height = dims.height > 0 ? dims.height : 600;

    const selectedResult = this.generatePlacedDemoWave(width, height, customOptions);

    if (!selectedResult || selectedResult.points.length === 0) return;
    this.demoPoints = selectedResult.points;
    this.demoDeviations = selectedResult.deviations;
    this.currentDemoDeviations = [];

    let pointIndex = 0;
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.lastDemoFadeTimestamp = startTime;
    const duration = this.demoPoints[this.demoPoints.length - 1].time || 1500;

    const animatePause = (pauseTimestamp: number) => {
      if (!this.isDemoActive || this.demoTimeoutId === null) return;
      const dt = Math.max(0, pauseTimestamp - this.lastDemoFadeTimestamp);
      this.lastDemoFadeTimestamp = pauseTimestamp;
      this.advanceDemoHistory(dt);
      this.render();
      if (this.demoHistory.length > 0 && typeof requestAnimationFrame !== 'undefined') {
        this.demoAnimationId = requestAnimationFrame(animatePause);
      }
    };

    const animateStroke = (timestamp: number) => {
      if (!this.isDemoActive) return;

      const dt = Math.max(0, timestamp - this.lastDemoFadeTimestamp);
      this.lastDemoFadeTimestamp = timestamp;
      this.advanceDemoHistory(dt);

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const targetCount = Math.floor(progress * this.demoPoints.length);

      while (pointIndex < targetCount && pointIndex < this.demoPoints.length) {
        this.strokeBuffer.addPoint(this.demoPoints[pointIndex].x, this.demoPoints[pointIndex].y);
        pointIndex++;
      }

      this.currentDemoDeviations = this.demoDeviations.slice(0, pointIndex);
      this.render();

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.demoAnimationId = requestAnimationFrame(animateStroke);
        }
      } else {
        // Complete demo stroke: do NOT score and do NOT display any results.
        // Schedule the next wave while keeping older historical waves animating smoothly during the wait.
        if (typeof setTimeout !== 'undefined') {
          this.demoTimeoutId = setTimeout(() => {
            if (this.isDemoActive) {
              this.startDemo(undefined, true);
            }
          }, 600) as unknown as number;
        }
        if (this.demoHistory.length > 0 && typeof requestAnimationFrame !== 'undefined') {
          this.demoAnimationId = requestAnimationFrame(animatePause);
        }
      }
    };

    this.stateMachine.startDrawing();
    if (typeof requestAnimationFrame !== 'undefined') {
      this.demoAnimationId = requestAnimationFrame(animateStroke);
    }
  }

  public stopDemo(): void {
    if (this.demoAnimationId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.demoAnimationId);
      this.demoAnimationId = null;
    }
    if (this.demoTimeoutId !== null && typeof clearTimeout !== 'undefined') {
      clearTimeout(this.demoTimeoutId);
      this.demoTimeoutId = null;
    }
    this.isDemoActive = false;
    this.lastDemoFadeTimestamp = 0;
    this.demoPoints = [];
    this.demoDeviations = [];
    this.currentDemoDeviations = [];
    this.demoHistory = [];
  }

  private static readonly DEMO_FADE_SPAN = 0.34;
  private static readonly DEMO_FADE_DURATION_MS = 2600;

  private advanceDemoHistory(dtMs: number): void {
    if (dtMs <= 0 || this.demoHistory.length === 0) return;
    const clampedDt = Math.min(dtMs, 1300);

    for (const item of this.demoHistory) {
      item.elapsedFadeMs += clampedDt;
      const t = Math.min(1.0, item.elapsedFadeMs / Math.max(1, item.fadeDurationMs));
      item.alpha = item.fromAlpha + (item.toAlpha - item.fromAlpha) * t;
      item.eraseProgress = item.fromErase + (item.toErase - item.fromErase) * t;
    }

    this.demoHistory = this.demoHistory.filter(
      (item) => item.eraseProgress < 0.995 && item.alpha > 0.02
    );
  }

  public getDemoHistory(): readonly DemoHistoricalWave[] {
    return this.demoHistory;
  }

  /**
   * Computes cumulative normalized arc length [0..1] along a stroke for even sequential fading.
   */
  private static computeArcProgress(deviations: readonly PointDeviation[]): number[] {
    const n = deviations.length;
    if (n === 0) return [];
    if (n === 1) return [0];

    const cumDist = new Array<number>(n);
    cumDist[0] = 0;
    for (let i = 1; i < n; i++) {
      const a = deviations[i - 1].point;
      const b = deviations[i].point;
      cumDist[i] = cumDist[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
    }

    const totalLen = cumDist[n - 1];
    if (totalLen <= 0) {
      return cumDist.map((_, i) => i / (n - 1));
    }
    return cumDist.map((d) => d / totalLen);
  }

  /**
   * Extracts only the still-visible trailing points of a progressively erasing historical wave.
   */
  private static getVisibleHistoricalPoints(hist: DemoHistoricalWave): Point[] {
    const fadeWindow = {
      eraseProgress: hist.eraseProgress,
      fadeSpan: DrawingController.DEMO_FADE_SPAN,
      arcProgress: hist.arcProgress,
    };
    const visible: Point[] = [];
    for (let i = 0; i < hist.deviations.length; i++) {
      if (CanvasView.computePointFadeFactor(i, hist.deviations.length, fadeWindow) > 0.04) {
        visible.push(hist.deviations[i].point);
      }
    }
    return visible;
  }

  /**
   * Samples center-weighted candidate coordinates across safe bounds so new demo waves
   * cluster naturally toward the center while still appearing across the canvas without overlaps.
   */
  private static sampleCenterWeighted(minVal: number, maxVal: number, uniformMix: boolean): number {
    if (maxVal <= minVal) return minVal;
    const t = uniformMix ? Math.random() : (Math.random() + Math.random()) * 0.5;
    return minVal + t * (maxVal - minVal);
  }

  private generatePlacedDemoWave(
    width: number,
    height: number,
    customOptions?: DemoWaveOptions
  ): DemoWaveResult | null {
    let defaultProfile: 'pristine' | 'wobbly' | 'uneven' | 'runaway' | 'mixed' = 'mixed';
    if (customOptions?.runawayDrift && Math.abs(customOptions.runawayDrift) >= 20) {
      defaultProfile = 'runaway';
    } else if (
      customOptions?.jitterLevel !== undefined &&
      customOptions.jitterLevel <= 2.0 &&
      (!customOptions.runawayDrift || customOptions.runawayDrift === 0)
    ) {
      defaultProfile = 'pristine';
    }
    const profile = customOptions?.profile ?? defaultProfile;

    let visiblePointsList = this.demoHistory
      .map((w) => DrawingController.getVisibleHistoricalPoints(w))
      .filter((pts) => pts.length >= 2);

    const topSafeMargin = 95;
    const bottomSafeMargin = 60;
    const sideSafeMargin = 48;
    const midSafeY = topSafeMargin + Math.max(80, height - topSafeMargin - bottomSafeMargin) * 0.5;
    const hasFixedCenter = customOptions?.centerX !== undefined && customOptions?.centerY !== undefined;
    const maxAttempts = hasFixedCenter ? 1 : 42;
    const minDistance = 34;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt === 36 && this.demoHistory.length > 1) {
        this.demoHistory.shift();
        visiblePointsList = this.demoHistory
          .map((w) => DrawingController.getVisibleHistoricalPoints(w))
          .filter((pts) => pts.length >= 2);
      } else if (attempt === 40 && this.demoHistory.length > 0) {
        this.demoHistory = [];
        visiblePointsList = [];
      }

      const sampled = DemoBot.sampleHumanParameters(width, height);
      const isCompactFallback = attempt >= 20;
      const amplitude = customOptions?.amplitude ?? (
        isCompactFallback ? Math.max(30, Math.round(sampled.amplitude * 0.72)) : sampled.amplitude
      );
      const wavelength = customOptions?.wavelength ?? (
        isCompactFallback ? Math.min(sampled.wavelength, 185) : sampled.wavelength
      );
      const cycles = customOptions?.cycles ?? (
        isCompactFallback ? 1.15 : (attempt >= 16 ? Math.min(sampled.cycles, 1.45) : sampled.cycles)
      );
      const phase = customOptions?.phase ?? sampled.phase;
      const tiltAngle = customOptions?.tiltAngle ?? (isCompactFallback ? 0 : sampled.tiltAngle);
      const speedPxPerSec = customOptions?.speedPxPerSec ?? sampled.speedPxPerSec;

      const halfSpanX = (cycles * wavelength) * 0.5;
      const halfSpanY = amplitude + 34;
      const cosTilt = Math.abs(Math.cos(tiltAngle));
      const sinTilt = Math.abs(Math.sin(tiltAngle));
      const boundHalfW = halfSpanX * cosTilt + halfSpanY * sinTilt;
      const boundHalfH = halfSpanX * sinTilt + halfSpanY * cosTilt;

      const safeMinX = Math.min(width * 0.5, sideSafeMargin + boundHalfW);
      const safeMaxX = Math.max(width * 0.5, width - sideSafeMargin - boundHalfW);
      const safeMinY = Math.min(midSafeY, topSafeMargin + boundHalfH);
      const safeMaxY = Math.max(midSafeY, height - bottomSafeMargin - boundHalfH);

      const uniformMix = attempt >= 14 ? Math.random() < 0.65 : Math.random() < 0.20;
      let candidateCenterX: number;
      let candidateCenterY: number;

      if (attempt >= 20 && !hasFixedCenter) {
        // Systematic perimeter & quadrant sweep so any valid pocket is found before retiring history
        const gridIdx = attempt - 20;
        const tx = (gridIdx % 4) / 3;
        const ty = (Math.floor(gridIdx / 4) % 4) / 3;
        candidateCenterX = customOptions?.centerX ?? (safeMinX + tx * Math.max(0, safeMaxX - safeMinX));
        candidateCenterY = customOptions?.centerY ?? (safeMinY + ty * Math.max(0, safeMaxY - safeMinY));
      } else {
        candidateCenterX = customOptions?.centerX ??
          DrawingController.sampleCenterWeighted(safeMinX, safeMaxX, uniformMix);
        candidateCenterY = customOptions?.centerY ??
          DrawingController.sampleCenterWeighted(safeMinY, safeMaxY, uniformMix);
      }

      const candidateResult = DemoBot.generateStrokeWithDeviations({
        width,
        height,
        centerX: candidateCenterX,
        centerY: candidateCenterY,
        amplitude,
        wavelength,
        cycles,
        phase,
        tiltAngle,
        profile,
        speedPxPerSec,
        ...customOptions,
      });

      if (candidateResult.points.length === 0) continue;
      if (hasFixedCenter) return candidateResult;

      const effectiveMinDistance = attempt >= 26 ? 28 : minDistance;
      let overlaps = false;
      for (const histPoints of visiblePointsList) {
        if (this.checkWavesOverlap(candidateResult.points, histPoints, effectiveMinDistance)) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        return candidateResult;
      }
    }

    return null;
  }

  /**
   * Fast geometric collision check between a candidate wave and an existing wave.
   * Uses bounding box rejection followed by point-to-point proximity sampling.
   */
  public checkWavesOverlap(
    candidatePoints: readonly Point[],
    existingPoints: readonly Point[],
    minDistance: number = 32
  ): boolean {
    if (candidatePoints.length === 0 || existingPoints.length === 0) return false;

    let minXA = candidatePoints[0].x, maxXA = candidatePoints[0].x;
    let minYA = candidatePoints[0].y, maxYA = candidatePoints[0].y;
    for (let i = 1; i < candidatePoints.length; i++) {
      const p = candidatePoints[i];
      if (p.x < minXA) minXA = p.x;
      if (p.x > maxXA) maxXA = p.x;
      if (p.y < minYA) minYA = p.y;
      if (p.y > maxYA) maxYA = p.y;
    }

    let minXB = existingPoints[0].x, maxXB = existingPoints[0].x;
    let minYB = existingPoints[0].y, maxYB = existingPoints[0].y;
    for (let i = 1; i < existingPoints.length; i++) {
      const p = existingPoints[i];
      if (p.x < minXB) minXB = p.x;
      if (p.x > maxXB) maxXB = p.x;
      if (p.y < minYB) minYB = p.y;
      if (p.y > maxYB) maxYB = p.y;
    }

    if (
      maxXA + minDistance < minXB ||
      minXA - minDistance > maxXB ||
      maxYA + minDistance < minYB ||
      minYA - minDistance > maxYB
    ) {
      return false;
    }

    const stepA = Math.max(1, Math.floor(candidatePoints.length / 70));
    const stepB = Math.max(1, Math.floor(existingPoints.length / 70));
    for (let i = 0; i < candidatePoints.length; i += stepA) {
      const pa = candidatePoints[i];
      for (let j = 0; j < existingPoints.length; j += stepB) {
        const pb = existingPoints[j];
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < minDistance) {
          return true;
        }
      }
    }

    return false;
  }

  public isDemoPlaying(): boolean {
    return this.isDemoActive;
  }

  public getLastDrawnStroke(): {
    readonly points: readonly Point[];
    readonly evaluation: StrokeEvaluation | null;
    readonly validationMessage: string | null;
  } | null {
    return this.lastDrawnStroke;
  }

  public replayStroke(points: readonly Point[], animated: boolean = true): void {
    if (points.length < 2) return;
    this.stopDemo();
    this.reset();

    if (!animated) {
      this.stateMachine.startDrawing();
      for (const pt of points) {
        this.strokeBuffer.addPoint(pt.x, pt.y, pt.time);
      }
      this.stateMachine.finishDrawing();
      this.evaluateStroke();
      this.stateMachine.setEvaluated();
      this.lastDrawnStroke = {
        points: [...points],
        evaluation: this.lastEvaluation,
        validationMessage: this.lastValidationMessage,
      };
      this.render();
      return;
    }

    this.stateMachine.startDrawing();
    let index = 0;
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const duration = points[points.length - 1].time || 1200;

    const step = (timestamp: number) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const targetCount = Math.floor(progress * points.length);

      while (index < targetCount && index < points.length) {
        this.strokeBuffer.addPoint(points[index].x, points[index].y, points[index].time);
        index++;
      }
      this.render();

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(step);
        }
      } else {
        this.stateMachine.finishDrawing();
        this.evaluateStroke();
        this.stateMachine.setEvaluated();
        this.lastDrawnStroke = {
          points: [...points],
          evaluation: this.lastEvaluation,
          validationMessage: this.lastValidationMessage,
        };
        this.render();
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(step);
    }
  }

  public getLastEvaluation(): StrokeEvaluation | null {
    return this.lastEvaluation;
  }

  public getCoordinateFrame(): CoordinateFrame | null {
    return this.coordinateFrame;
  }

  public render(): void {
    this.view.clear();
    const points = this.strokeBuffer.getPoints();

    if (this.lastEvaluation) {
      // 1. Render fitted reference curve guideline (closest approximation in dashed red)
      const aligned = TiltDetector.transformPoints(points, this.lastEvaluation.fittedSine.tilt);
      let minX = aligned[0].x;
      let maxX = aligned[0].x;
      for (const p of aligned) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }

      const refCurve = SineFitter.generateFittedCurve(
        this.lastEvaluation.fittedSine,
        minX - 15,
        maxX + 15,
        3
      );
      this.view.renderFittedSineGuideline(refCurve, 'rgba(255, 51, 68, 0.85)');

      // 2. Render color-interpolated user stroke
      this.view.renderEvaluatedStroke(this.lastEvaluation.deviations);

      // 3. Render wave tracer along drawn wave during length measurement animation
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const animState = this.scoreAnimator.update(now);

      if (this.scoreAnimator.isActive() && this.lastEvaluation.deviations.length >= 2) {
        this.view.renderWaveTracer(
          this.lastEvaluation.deviations,
          animState.waveTracerProgress,
          this.scoreAnimator.getTier()
        );
      }

      // 4. Render Accuracy large on top & animated length-to-score calculation below it
      this.view.renderCalculationBanner(animState);
    } else if (this.isPointerDown && this.liveEvaluation) {
      // Live drawing in progress with real-time gradient coloring
      this.view.renderEvaluatedStroke(this.liveEvaluation.deviations);
      const liveAccuracy = this.liveEvaluation.accuracy;
      this.view.renderBanner(`${liveAccuracy}%`);
    } else if (this.isDemoActive) {
      // Demo mode: render historical waves fading progressively from start to end, plus the active wave
      for (const hist of this.demoHistory) {
        if (hist.alpha > 0.01 && hist.eraseProgress < 0.995 && hist.deviations.length >= 2) {
          this.view.renderEvaluatedStroke(hist.deviations, 3.5, hist.alpha, {
            eraseProgress: hist.eraseProgress,
            fadeSpan: DrawingController.DEMO_FADE_SPAN,
            arcProgress: hist.arcProgress,
          });
        }
      }
      if (this.currentDemoDeviations.length >= 2) {
        this.view.renderEvaluatedStroke(this.currentDemoDeviations, 3.5, 1.0);
      }
    } else if (this.lastValidationMessage) {
      // Incomplete or invalid wave feedback: clean, uniform, without additional info
      if (points.length > 0) {
        this.view.renderStroke(points, '#ef4444');
      }
      const isFlat =
        this.lastValidationMessage.toLowerCase().includes('flat') ||
        this.lastValidationMessage.toLowerCase().includes('amplitude');
      const isNotSine =
        this.lastValidationMessage.toLowerCase().includes('not a sine') ||
        this.lastValidationMessage.toLowerCase().includes('sharp') ||
        this.lastValidationMessage.toLowerCase().includes('zigzag');
      const title = isNotSine
        ? 'Not a Sine Wave'
        : isFlat
          ? 'Sine Wave Too Flat'
          : 'Incomplete Sine Wave';
      this.view.renderBanner(title, undefined, true);
    } else {
      // Initial active drawing, demo drawing, or idle state (no banner in demo mode)
      if (points.length > 0) {
        this.view.renderStroke(points);
      }
    }
  }
}
