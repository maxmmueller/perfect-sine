import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { CanvasView } from '../view/CanvasView';
import { SineFitter } from '../model/SineFitter';
import { PeriodValidator } from '../model/PeriodValidator';
import { TiltDetector } from '../model/TiltDetector';
import { CoordinateSystem, CoordinateFrame } from '../model/CoordinateSystem';
import { DemoBot, DemoWaveOptions } from '../model/DemoBot';
import { IScoreStrategy } from '../model/scoring/IScoreStrategy';
import { RmseScoreStrategy } from '../model/scoring/RmseScoreStrategy';
import { ScoreStrategyManager, ScorerEvaluationItem } from '../model/scoring/ScoreStrategyManager';
import { StrokeEvaluation } from '../model/types';

export class DrawingController {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: CanvasView;
  private readonly stateMachine: GameStateMachine;
  private readonly strokeBuffer: StrokeBuffer;
  private readonly strategyManager?: ScoreStrategyManager;
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
  private isDemoActive = false;

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
    this.scoreStrategy = options?.scoreStrategy ?? options?.strategyManager?.getActiveStrategy() ?? new RmseScoreStrategy();
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

    if (this.strategyManager) {
      this.allEvaluations = this.strategyManager.evaluateAll(points, fit, 30);
      this.onMultiEvaluationComplete?.(this.allEvaluations);
    }

    if (this.onEvaluationComplete) {
      this.onEvaluationComplete(this.lastEvaluation);
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

    const demoPoints = DemoBot.generateStroke({
      width,
      height,
      amplitude: 45 + Math.random() * 25,
      wavelength: 200 + Math.random() * 60,
      cycles: 1.5 + Math.random() * 0.6,
      tiltAngle: (Math.random() - 0.5) * 0.2,
      jitterLevel: 2.0,
      ...customOptions,
    });

    if (demoPoints.length === 0) return;

    let pointIndex = 0;
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const duration = demoPoints[demoPoints.length - 1].time || 1500;

    const animateStroke = (timestamp: number) => {
      if (!this.isDemoActive) return;

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const targetCount = Math.floor(progress * demoPoints.length);

      while (pointIndex < targetCount && pointIndex < demoPoints.length) {
        this.strokeBuffer.addPoint(demoPoints[pointIndex].x, demoPoints[pointIndex].y);
        pointIndex++;
      }

      this.render();

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.demoAnimationId = requestAnimationFrame(animateStroke);
        }
      } else {
        // Complete demo stroke: evaluate and display
        this.evaluateStroke();
        if (this.stateMachine.getState() === 'DRAWING') {
          this.stateMachine.finishDrawing();
        }
        this.stateMachine.setEvaluated();
        this.render();

        if (typeof setTimeout !== 'undefined') {
          this.demoTimeoutId = setTimeout(() => {
            if (this.isDemoActive) {
              this.startDemo();
            }
          }, 3000) as unknown as number;
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

      // 3. Render score HUD banner
      const score = this.lastEvaluation.score;
      const accuracy = this.lastEvaluation.accuracy;
      const cycles = this.lastEvaluation.fittedSine.fullCycles.toFixed(1);
      const r2 = Math.round(this.lastEvaluation.fittedSine.r2 * 100);
      if (this.isDemoActive) {
        this.view.renderBanner(
          `Demo: ${score.toLocaleString()} pts`,
          `Bot Accuracy: ${accuracy}% | Cycles: ${cycles} | Touch anywhere to play!`
        );
      } else {
        this.view.renderBanner(
          `Score: ${score.toLocaleString()} pts`,
          `Accuracy: ${accuracy}% | Cycles: ${cycles} | R²: ${r2}% | Touch anywhere to retry`
        );
      }
    } else if (this.isPointerDown && this.liveEvaluation) {
      // Live drawing in progress with real-time gradient coloring
      this.view.renderEvaluatedStroke(this.liveEvaluation.deviations);
      const liveScore = this.liveEvaluation.score;
      const liveAccuracy = this.liveEvaluation.accuracy;
      const cycles = this.liveEvaluation.fittedSine.fullCycles.toFixed(1);
      this.view.renderBanner(
        `Score: ${liveScore.toLocaleString()} pts`,
        `Accuracy: ${liveAccuracy}% | Live Cycles: ${cycles}`
      );
    } else if (this.lastValidationMessage) {
      // Incomplete wave feedback
      if (points.length > 0) {
        this.view.renderStroke(points, '#ff3366');
      }
      const isFlat = this.lastValidationMessage.toLowerCase().includes('flat') || this.lastValidationMessage.toLowerCase().includes('amplitude');
      const title = isFlat ? 'Amplitude Too Flat' : 'Incomplete Wave';
      this.view.renderBanner(title, `${this.lastValidationMessage} Touch anywhere to retry`, true);
    } else {
      // Initial active drawing or idle state
      if (points.length > 0) {
        this.view.renderStroke(points);
      }
      if (this.isDemoActive) {
        this.view.renderBanner('Demo Mode', 'Touch or click anywhere to play!');
      }
    }
  }
}
