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

export interface DemoHistoricalWave {
  readonly deviations: PointDeviation[];
  fromAlpha: number;
  toAlpha: number;
  alpha: number;
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
  private readonly onEvaluationComplete?: (evaluation: StrokeEvaluation) => void;
  private readonly onMultiEvaluationComplete?: (evaluations: ScorerEvaluationItem[]) => void;
  private readonly onReset?: () => void;
  private demoAnimationId: number | null = null;
  private demoTimeoutId: number | null = null;
  private scoreAnimId: number | null = null;
  private isDemoActive = false;
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
      window.addEventListener('keydown', () => {
        if (this.isDemoActive) {
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

      // Transition the completed demo wave into history with smooth decay
      if (this.currentDemoDeviations.length >= 2) {
        for (const item of this.demoHistory) {
          item.fromAlpha = item.toAlpha;
          item.toAlpha = item.fromAlpha * 0.40;
          item.alpha = item.fromAlpha;
        }
        this.demoHistory = this.demoHistory.filter((item) => item.toAlpha >= 0.04);
        this.demoHistory.push({
          deviations: [...this.currentDemoDeviations],
          fromAlpha: 0.85,
          toAlpha: 0.42,
          alpha: 0.85,
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

    const topSafeMargin = 95;
    const bottomSafeMargin = 60;
    const usableHeight = Math.max(160, height - topSafeMargin - bottomSafeMargin);

    // Filter visible historical waves that must never be overlapped
    let visiblePointsList = this.demoHistory
      .filter((w) => w.alpha >= 0.08 && w.deviations.length >= 2)
      .map((w) => w.deviations.map((d) => d.point));

    // Imperfection Profile: diverse mix of qualities across demo cycles
    // pristine (~35% green), wobbly (~30% lime/yellow), uneven (~20% yellow/orange), runaway (~15% red)
    let defaultProfile: 'pristine' | 'wobbly' | 'uneven' | 'runaway';
    if (
      customOptions?.jitterLevel !== undefined &&
      customOptions.jitterLevel <= 2.0 &&
      (!customOptions.runawayDrift || customOptions.runawayDrift === 0)
    ) {
      defaultProfile = 'pristine';
    } else {
      const profileDice = Math.random();
      defaultProfile =
        profileDice < 0.35
          ? 'pristine'
          : profileDice < 0.65
          ? 'wobbly'
          : profileDice < 0.85
          ? 'uneven'
          : 'runaway';
    }
    const profile: 'pristine' | 'wobbly' | 'uneven' | 'runaway' = customOptions?.profile ?? defaultProfile;

    const speedDice = Math.random();
    const speedPxPerSec = customOptions?.speedPxPerSec ?? (
      speedDice < 0.40
        ? 580 + Math.random() * 320 // Fast brisk stroke
        : speedDice < 0.75
        ? 360 + Math.random() * 180 // Fluid medium stroke
        : 240 + Math.random() * 100 // Deliberate smooth stroke
    );

    // Collision-free placement search: dynamically re-roll slot, cycles, and geometry
    let selectedResult: DemoWaveResult | null = null;
    const maxAttempts = customOptions?.centerY !== undefined ? 1 : 24;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // If historical waves are taking up too much room, progressively prune oldest
      if (attempt === 12 && this.demoHistory.length > 1) {
        this.demoHistory.shift();
        visiblePointsList = this.demoHistory
          .filter((w) => w.alpha >= 0.08 && w.deviations.length >= 2)
          .map((w) => w.deviations.map((d) => d.point));
      } else if (attempt === 18 && this.demoHistory.length > 0) {
        this.demoHistory = [];
        visiblePointsList = [];
      }

      const hasHistory = visiblePointsList.length > 0;

      // 1. Amplitude a: vary between 22px and 52px (more compact when canvas is occupied)
      const amplitude = customOptions?.amplitude ?? (
        hasHistory ? 22 + Math.random() * 24 : 24 + Math.random() * 32
      );

      // 2. Frequency / Wavelength b: 100px to 240px
      const wavelength = customOptions?.wavelength ?? (
        hasHistory ? 100 + Math.random() * 120 : 110 + Math.random() * 150
      );

      // 3. Initial phase c: [0, 2*PI]
      const phase = customOptions?.phase ?? Math.random() * Math.PI * 2;

      // 4. Tilt: ~40% tilted
      const hasTilt = customOptions?.tiltAngle !== undefined ? true : Math.random() < 0.40;
      const tiltSign = Math.random() < 0.5 ? 1 : -1;
      const defaultTiltAngle = hasTilt
        ? tiltSign * (hasHistory ? 0.08 + Math.random() * 0.12 : 0.12 + Math.random() * 0.18)
        : (Math.random() - 0.5) * 0.04;
      const tiltAngle = customOptions?.tiltAngle ?? defaultTiltAngle;

      // 5. Cycles: more compact (1.3 - 2.2) when historical waves exist, up to 3.6 on open canvas
      let cycles: number;
      if (customOptions?.cycles !== undefined) {
        cycles = customOptions.cycles;
      } else if (hasHistory) {
        cycles = 1.3 + Math.random() * 0.9; // 1.3 - 2.2 cycles
      } else {
        const cDice = Math.random();
        cycles = cDice < 0.35
          ? 1.4 + Math.random() * 0.8 // short
          : cDice < 0.70
          ? 2.2 + Math.random() * 0.9 // medium
          : 3.1 + Math.random() * 0.8; // long
      }

      // 6. Center coordinates: cycle through spatial sectors
      let candidateCenterX = width * 0.50;
      let candidateCenterY = topSafeMargin + usableHeight * 0.50;

      if (customOptions?.centerX !== undefined) {
        candidateCenterX = customOptions.centerX;
      }
      if (customOptions?.centerY !== undefined) {
        candidateCenterY = customOptions.centerY;
      } else if (hasHistory) {
        const slot = attempt % 6;
        if (slot === 0) {
          candidateCenterX = width * (0.32 + Math.random() * 0.10);
          candidateCenterY = topSafeMargin + usableHeight * (0.20 + Math.random() * 0.10);
        } else if (slot === 1) {
          candidateCenterX = width * (0.58 + Math.random() * 0.10);
          candidateCenterY = topSafeMargin + usableHeight * (0.70 + Math.random() * 0.10);
        } else if (slot === 2) {
          candidateCenterX = width * (0.58 + Math.random() * 0.10);
          candidateCenterY = topSafeMargin + usableHeight * (0.20 + Math.random() * 0.10);
        } else if (slot === 3) {
          candidateCenterX = width * (0.32 + Math.random() * 0.10);
          candidateCenterY = topSafeMargin + usableHeight * (0.70 + Math.random() * 0.10);
        } else if (slot === 4) {
          candidateCenterX = width * 0.50;
          candidateCenterY = topSafeMargin + usableHeight * (0.18 + Math.random() * 0.08);
        } else {
          candidateCenterX = width * 0.50;
          candidateCenterY = topSafeMargin + usableHeight * (0.80 + Math.random() * 0.08);
        }
      } else {
        candidateCenterX = width * (0.44 + (Math.random() - 0.5) * 0.14);
        candidateCenterY = topSafeMargin + usableHeight * (0.30 + Math.random() * 0.40);
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

      // Verify zero overlap against all visible historical waves
      let overlaps = false;
      for (const histPoints of visiblePointsList) {
        if (this.checkWavesOverlap(candidateResult.points, histPoints, 35)) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        selectedResult = candidateResult;
        break;
      }
    }

    if (!selectedResult || selectedResult.points.length === 0) return;
    this.demoPoints = selectedResult.points;
    this.demoDeviations = selectedResult.deviations;
    this.currentDemoDeviations = [];

    let pointIndex = 0;
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const duration = this.demoPoints[this.demoPoints.length - 1].time || 1500;

    const animateStroke = (timestamp: number) => {
      if (!this.isDemoActive) return;

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const targetCount = Math.floor(progress * this.demoPoints.length);

      while (pointIndex < targetCount && pointIndex < this.demoPoints.length) {
        this.strokeBuffer.addPoint(this.demoPoints[pointIndex].x, this.demoPoints[pointIndex].y);
        pointIndex++;
      }

      this.currentDemoDeviations = this.demoDeviations.slice(0, pointIndex);

      // Smoothly interpolate the alpha of historical waves as the new wave is drawn
      for (const item of this.demoHistory) {
        item.alpha = item.fromAlpha + (item.toAlpha - item.fromAlpha) * progress;
      }

      this.render();

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.demoAnimationId = requestAnimationFrame(animateStroke);
        }
      } else {
        // Complete demo stroke: do NOT score and do NOT display any results.
        // Pause briefly, then draw another sine wave with historical waves smoothly fading out.
        if (typeof setTimeout !== 'undefined') {
          this.demoTimeoutId = setTimeout(() => {
            if (this.isDemoActive) {
              this.startDemo(undefined, true);
            }
          }, 600) as unknown as number;
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
    this.demoPoints = [];
    this.demoDeviations = [];
    this.currentDemoDeviations = [];
    this.demoHistory = [];
  }

  public getDemoHistory(): readonly DemoHistoricalWave[] {
    return this.demoHistory;
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

    const stepA = Math.max(1, Math.floor(candidatePoints.length / 35));
    const stepB = Math.max(1, Math.floor(existingPoints.length / 35));
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
      // Demo mode: render historical fading waves and the active wave, NO scoring/results banner
      for (const hist of this.demoHistory) {
        if (hist.alpha > 0.01 && hist.deviations.length >= 2) {
          this.view.renderEvaluatedStroke(hist.deviations, 3.5, hist.alpha);
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
