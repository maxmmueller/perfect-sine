import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { CanvasView } from '../view/CanvasView';
import { SineFitter } from '../model/SineFitter';
import { PeriodValidator } from '../model/PeriodValidator';
import { TiltDetector } from '../model/TiltDetector';
import { CoordinateSystem, CoordinateFrame } from '../model/CoordinateSystem';
import { DemoBot, DemoWaveOptions } from '../model/DemoBot';
import { IScoreStrategy } from '../model/scoring/IScoreStrategy';
import { UnifiedEnsembleScoreStrategy } from '../model/scoring/UnifiedEnsembleScoreStrategy';
import { ScoreStrategyManager, ScorerEvaluationItem } from '../model/scoring/ScoreStrategyManager';
import { StrokeEvaluation, Point, PointDeviation } from '../model/types';
import { DeviationCalculator } from '../model/DeviationCalculator';
import { ScoreCalculationAnimator } from '../view/ScoreCalculationAnimator';

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
    const periodCheck = PeriodValidator.validate(aligned, fit.frequency);

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
    this.isPointerDown = false;
    this.canvas.style.cursor = 'default';
    this.onReset?.();
    this.render();
  }

  public startDemo(customOptions?: DemoWaveOptions): void {
    this.stopDemo();
    this.reset();
    this.isDemoActive = true;

    const dims = this.view.getDimensions();
    const width = dims.width > 0 ? dims.width : 800;
    const height = dims.height > 0 ? dims.height : 600;

    // 1. Variable Amplitude a: broad variation from subtle waves (~20px) to tall, deep waves (~78px)
    const amplitude = 20 + Math.random() * 58;

    // 2. Variable Frequency / Wavelength b: from tight compact waves (~95px) to wide sweeping waves (~290px)
    const wavelength = 95 + Math.random() * 195;

    // 3. Variable Initial Phase c: randomize start angle in [0, 2*PI] so waves start at peaks, troughs, or slopes
    const phase = Math.random() * Math.PI * 2;

    // 4. Baseline Tilt: ~50% of the time, apply a noticeable slant (~11° to ~24°)
    const hasTilt = customOptions?.tiltAngle !== undefined ? true : Math.random() < 0.50;
    const tiltSign = Math.random() < 0.5 ? 1 : -1;
    const defaultTiltAngle = hasTilt
      ? tiltSign * (0.20 + Math.random() * 0.22) // ~11° to 24° distinct tilt
      : (Math.random() - 0.5) * 0.05; // horizontal with subtle human variance
    const tiltAngle = customOptions?.tiltAngle ?? defaultTiltAngle;

    // 5. Variable Length / Cycles: vary from short (1.2 - 1.8), medium (2.0 - 3.1), to long waves spanning across the canvas (3.2 - 5.2)
    const maxCyclesForCanvas = Math.max(1.8, Math.min(5.2, (width * 0.86) / wavelength));
    const cycleDice = Math.random();
    let cycles: number;
    if (cycleDice < 0.28) {
      cycles = 1.2 + Math.random() * 0.6; // Short concise wave (1.2 - 1.8)
    } else if (cycleDice < 0.65) {
      cycles = Math.min(maxCyclesForCanvas, 2.0 + Math.random() * 1.1); // Medium wave (2.0 - 3.1)
    } else {
      cycles = Math.min(maxCyclesForCanvas, 3.2 + Math.random() * 2.0); // Long wave spanning across canvas (3.2 - 5.2)
    }

    // 6. Variable Vertical Offset d / Center Y: position across canvas (upper, middle, lower), safe from clipping
    const verticalSafetyMargin = amplitude + Math.abs(Math.sin(tiltAngle)) * (cycles * wavelength * 0.5) + 35;
    const minCenterY = Math.max(90, verticalSafetyMargin);
    const maxCenterY = Math.min(height - 60, height - verticalSafetyMargin);
    const centerY = minCenterY < maxCenterY
      ? minCenterY + Math.random() * (maxCenterY - minCenterY)
      : height / 2;

    const centerX = width * (0.42 + (Math.random() - 0.5) * 0.18);

    // 7. Variable Drawing Speed: dynamically vary from fast, brisk hand movements (~560-900 px/s) to deliberate waves
    const speedDice = Math.random();
    const speedPxPerSec = speedDice < 0.45
      ? 560 + Math.random() * 340 // Fast brisk stroke (completes in ~0.5s - 0.9s)
      : speedDice < 0.80
      ? 340 + Math.random() * 180 // Fluid medium hand stroke (~1.0s - 1.4s)
      : 220 + Math.random() * 100; // Calm deliberate stroke (~1.5s - 1.8s)

    const generatedPoints = DemoBot.generateStroke({
      width,
      height,
      centerX,
      centerY,
      amplitude,
      wavelength,
      cycles,
      phase,
      tiltAngle,
      jitterLevel: 1.8,
      speedPxPerSec,
      ...customOptions,
    });

    if (generatedPoints.length === 0) return;
    this.demoPoints = generatedPoints;

    // Precalculate realistic gradient deviations for the entire synthesized stroke
    const fit = SineFitter.fit(this.demoPoints);
    if (fit) {
      this.demoDeviations = [...DeviationCalculator.evaluate(this.demoPoints, fit, 30).deviations];
    } else {
      // Defensive fallback: map points to realistic tremor color deviations
      this.demoDeviations = this.demoPoints.map((pt, i) => {
        const dist = Math.abs(Math.sin(i * 0.35) * 2.2);
        const { hue, normalizedError, color } = DeviationCalculator.mapDistanceToColor(dist, 30);
        return { point: pt, distance: dist, normalizedError, hue, color };
      });
    }
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

      this.render();

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.demoAnimationId = requestAnimationFrame(animateStroke);
        }
      } else {
        // Complete demo stroke: do NOT score and do NOT display any results.
        // Pause briefly, then clear and draw another sine wave at a different position.
        if (typeof setTimeout !== 'undefined') {
          this.demoTimeoutId = setTimeout(() => {
            if (this.isDemoActive) {
              this.strokeBuffer.clear();
              this.currentDemoDeviations = [];
              this.render();
              this.startDemo();
            }
          }, 1200) as unknown as number;
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
    } else if (this.isDemoActive && this.currentDemoDeviations.length >= 2) {
      // Demo drawing in progress: render with dynamic color gradient, NO scoring/results banner
      this.view.renderEvaluatedStroke(this.currentDemoDeviations);
    } else if (this.lastValidationMessage) {
      // Incomplete wave feedback: clean, uniform, without additional info
      if (points.length > 0) {
        this.view.renderStroke(points, '#ef4444');
      }
      const isFlat =
        this.lastValidationMessage.toLowerCase().includes('flat') ||
        this.lastValidationMessage.toLowerCase().includes('amplitude');
      const title = isFlat ? 'Sine Wave Too Flat' : 'Incomplete Sine Wave';
      this.view.renderBanner(title, undefined, true);
    } else {
      // Initial active drawing, demo drawing, or idle state (no banner in demo mode)
      if (points.length > 0) {
        this.view.renderStroke(points);
      }
    }
  }
}
