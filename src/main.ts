import { GameStateMachine } from './model/GameStateMachine';
import { StrokeBuffer } from './model/StrokeBuffer';
import { CanvasView } from './view/CanvasView';
import { DrawingController } from './controller/DrawingController';
import { SessionHistoryService } from './model/SessionHistoryService';
import { HudView } from './view/HudView';
import { UnifiedEnsembleScoreStrategy } from './model/scoring/UnifiedEnsembleScoreStrategy';
import { CurveRecorderService } from './model/CurveRecorderService';
import { CurveRecorderView } from './view/CurveRecorderView';

function initializeApp(): void {
  const canvas = document.getElementById('sine-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #sine-canvas not found');
  }

  const sessionService = new SessionHistoryService();
  const hudView = new HudView(sessionService);
  const finalStrategy = new UnifiedEnsembleScoreStrategy();
  const recorderService = new CurveRecorderService();

  const stateMachine = new GameStateMachine();
  const strokeBuffer = new StrokeBuffer(2.0);
  const view = new CanvasView(canvas);

  const controller = new DrawingController(canvas, view, stateMachine, strokeBuffer, {
    scoreStrategy: finalStrategy,
    onEvaluationComplete: (evaluation) => {
      sessionService.addAttempt({
        score: evaluation.score,
        accuracy: evaluation.accuracy,
        cycles: evaluation.fittedSine.fullCycles,
        r2: evaluation.fittedSine.r2,
        amplitude: evaluation.fittedSine.amplitude,
        strategyId: finalStrategy.id,
      });
    },
    onStrokeComplete: (stroke) => {
      if (recorderService.isAutoRecordEnabled() && stroke.points.length >= 2) {
        recorderService.addCurve({
          points: stroke.points,
          evaluation: stroke.evaluation,
          validationMessage: stroke.validationMessage,
        });
      }
    },
  });

  const recorderView = new CurveRecorderView(recorderService, {
    onReplayRequested: (points) => {
      controller.replayStroke(points, true);
    },
    onRecordCurrentRequested: () => {
      return controller.getLastDrawnStroke();
    },
  });

  // Debug log state transitions
  stateMachine.subscribe((next, old) => {
    console.log(`[GameStateMachine] ${old} -> ${next} (Points: ${strokeBuffer.getLength()})`);
  });

  // Expose controller & services for test hooks if needed
  (window as unknown as { __perfectSine?: unknown }).__perfectSine = {
    controller,
    sessionService,
    hudView,
    recorderService,
    recorderView,
  };

  // Start demo mode immediately on launch (user requirement)
  controller.startDemo();

  // Idle timer: restart demo after 15s of user inactivity on empty canvas
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      if (!controller.isDemoPlaying() && strokeBuffer.getLength() === 0) {
        controller.startDemo();
      }
    }, 15000);
  };

  window.addEventListener('pointerdown', () => {
    resetIdleTimer();
  });
}

window.addEventListener('DOMContentLoaded', initializeApp);
