import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { CanvasView } from '../view/CanvasView';
import { SineFitter } from '../model/SineFitter';
import { PeriodValidator } from '../model/PeriodValidator';
import { TiltDetector } from '../model/TiltDetector';
import { DeviationCalculator } from '../model/DeviationCalculator';
import { StrokeEvaluation } from '../model/types';

export class DrawingController {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: CanvasView;
  private readonly stateMachine: GameStateMachine;
  private readonly strokeBuffer: StrokeBuffer;
  private isPointerDown = false;
  private lastEvaluation: StrokeEvaluation | null = null;
  private liveEvaluation: StrokeEvaluation | null = null;
  private lastValidationMessage: string | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    view: CanvasView,
    stateMachine: GameStateMachine,
    strokeBuffer: StrokeBuffer
  ) {
    this.canvas = canvas;
    this.view = view;
    this.stateMachine = stateMachine;
    this.strokeBuffer = strokeBuffer;

    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.view.handleResize();
      this.render();
    });

    this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this));
  }

  private getCanvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  public handlePointerDown(e: PointerEvent): void {
    // If state is locked after evaluation, reset to IDLE on next interaction
    if (this.stateMachine.getState() === 'LOCKED') {
      this.stateMachine.reset();
      this.lastEvaluation = null;
      this.liveEvaluation = null;
      this.lastValidationMessage = null;
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

    const pt = this.getCanvasPoint(e);
    this.strokeBuffer.addPoint(pt.x, pt.y);
    this.stateMachine.startDrawing();
    this.render();
  }

  public handlePointerMove(e: PointerEvent): void {
    if (!this.isPointerDown || this.stateMachine.getState() !== 'DRAWING') {
      return;
    }

    const pt = this.getCanvasPoint(e);
    const added = this.strokeBuffer.addPoint(pt.x, pt.y);
    if (added) {
      // Compute live dynamic fit and gradient coloring during active drawing
      const points = this.strokeBuffer.getPoints();
      if (points.length >= 15) {
        const liveFit = SineFitter.fit(points);
        if (liveFit && liveFit.fullCycles >= 0.4) {
          this.liveEvaluation = DeviationCalculator.evaluate(points, liveFit, 30);
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

    // Valid wave: compute orthogonal deviations and scoring
    this.lastEvaluation = DeviationCalculator.evaluate(points, fit, 30);
    this.liveEvaluation = null;
    this.lastValidationMessage = null;
  }

  public getLastEvaluation(): StrokeEvaluation | null {
    return this.lastEvaluation;
  }

  public render(): void {
    this.view.clear();
    const points = this.strokeBuffer.getPoints();

    if (this.lastEvaluation) {
      // 1. Render fitted reference curve guideline
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
      this.view.renderFittedSineGuideline(refCurve);

      // 2. Render color-interpolated user stroke
      this.view.renderEvaluatedStroke(this.lastEvaluation.deviations);

      // 3. Render score HUD banner
      const score = this.lastEvaluation.score;
      const cycles = this.lastEvaluation.fittedSine.fullCycles.toFixed(1);
      const r2 = Math.round(this.lastEvaluation.fittedSine.r2 * 100);
      this.view.renderBanner(
        `Accuracy: ${score}%`,
        `Cycles: ${cycles} | R²: ${r2}% | Touch anywhere to retry`
      );
    } else if (this.isPointerDown && this.liveEvaluation) {
      // Live drawing in progress with real-time gradient coloring
      this.view.renderEvaluatedStroke(this.liveEvaluation.deviations);
      const cycles = this.liveEvaluation.fittedSine.fullCycles.toFixed(1);
      this.view.renderBanner(
        `Accuracy: ${this.liveEvaluation.score}%`,
        `Live Cycles: ${cycles} (Drawing...)`
      );
    } else if (this.lastValidationMessage) {
      // Incomplete wave feedback
      if (points.length > 0) {
        this.view.renderStroke(points, '#ff3366');
      }
      this.view.renderBanner('Incomplete Wave', `${this.lastValidationMessage} Touch to retry`, true);
    } else {
      // Initial active drawing or idle state
      if (points.length > 0) {
        this.view.renderStroke(points);
      }
    }
  }
}
