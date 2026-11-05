import { GameStateMachine } from './model/GameStateMachine';
import { StrokeBuffer } from './model/StrokeBuffer';
import { CanvasView } from './view/CanvasView';
import { DrawingController } from './controller/DrawingController';
import { SessionHistoryService } from './model/SessionHistoryService';
import { HudView } from './view/HudView';

function initializeApp(): void {
  const canvas = document.getElementById('sine-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #sine-canvas not found');
  }

  const sessionService = new SessionHistoryService();
  const hudView = new HudView(sessionService);

  const stateMachine = new GameStateMachine();
  const strokeBuffer = new StrokeBuffer(2.0);
  const view = new CanvasView(canvas);

  const controller = new DrawingController(canvas, view, stateMachine, strokeBuffer, {
    onEvaluationComplete: (evaluation) => {
      sessionService.addAttempt({
        score: evaluation.score,
        accuracy: evaluation.accuracy,
        cycles: evaluation.fittedSine.fullCycles,
        r2: evaluation.fittedSine.r2,
        amplitude: evaluation.fittedSine.amplitude,
      });
    },
  });

  // Debug log state transitions
  stateMachine.subscribe((next, old) => {
    console.log(`[GameStateMachine] ${old} -> ${next} (Points: ${strokeBuffer.getLength()})`);
  });

  // Expose controller & services for test hooks if needed
  (window as unknown as {
    __appController: DrawingController;
    __sessionService: SessionHistoryService;
    __hudView: HudView;
  }).__appController = controller;
  (window as unknown as { __sessionService: SessionHistoryService }).__sessionService = sessionService;
  (window as unknown as { __hudView: HudView }).__hudView = hudView;

  // Start idle demo bot after brief initial delay if player hasn't interacted
  let idleTimer: number | null = window.setTimeout(() => {
    if (stateMachine.getState() === 'IDLE' && strokeBuffer.getLength() === 0 && !controller.isDemoPlaying()) {
      controller.startDemo();
    }
  }, 1200);

  const cancelIdleTimer = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  window.addEventListener('pointerdown', cancelIdleTimer, { once: true });
  window.addEventListener('keydown', cancelIdleTimer, { once: true });
}

window.addEventListener('DOMContentLoaded', initializeApp);
