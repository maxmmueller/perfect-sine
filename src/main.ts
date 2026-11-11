import { GameStateMachine } from './model/GameStateMachine';
import { StrokeBuffer } from './model/StrokeBuffer';
import { CanvasView } from './view/CanvasView';
import { DrawingController } from './controller/DrawingController';
import { SessionHistoryService } from './model/SessionHistoryService';
import { HudView } from './view/HudView';
import { UnifiedEnsembleScoreStrategy } from './model/scoring/UnifiedEnsembleScoreStrategy';
import type { DevStrokePayload } from './dev/setupDevTools';

function initializeApp(): void {
  const canvas = document.getElementById('sine-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #sine-canvas not found');
  }

  const sessionService = new SessionHistoryService();
  const finalStrategy = new UnifiedEnsembleScoreStrategy();

  const stateMachine = new GameStateMachine();
  const strokeBuffer = new StrokeBuffer(2.0);
  const view = new CanvasView(canvas);

  let devStrokeHandler: ((stroke: DevStrokePayload) => void) | null = null;

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
    ...(import.meta.env.VITE_DEV_TOOLS === 'true'
      ? {
          onStrokeComplete: (stroke: DevStrokePayload) => {
            devStrokeHandler?.(stroke);
          },
        }
      : {}),
  });

  const hudView = new HudView(sessionService, {
    getWaveSnapshot: () => ({
      stroke: controller.getLastDrawnStroke(),
      sourceCanvas: canvas,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    }),
  });

  // Load Curve Recorder and debug hooks only in dev-tools-enabled builds
  if (import.meta.env.VITE_DEV_TOOLS === 'true') {
    void import('./dev/setupDevTools')
      .then(({ setupDevTools }) => {
        const devTools = setupDevTools({
          controller,
          stateMachine,
          strokeBuffer,
          sessionService,
          hudView,
        });
        devStrokeHandler = devTools.onStrokeComplete;
      })
      .catch((err) => {
        console.error('[DevTools] Failed to load dev tools:', err);
      });
  }

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
