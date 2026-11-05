import { GameStateMachine } from './model/GameStateMachine';
import { StrokeBuffer } from './model/StrokeBuffer';
import { CanvasView } from './view/CanvasView';
import { DrawingController } from './controller/DrawingController';

function initializeApp(): void {
  const canvas = document.getElementById('sine-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #sine-canvas not found');
  }

  const stateMachine = new GameStateMachine();
  const strokeBuffer = new StrokeBuffer(2.0);
  const view = new CanvasView(canvas);
  const controller = new DrawingController(canvas, view, stateMachine, strokeBuffer);

  // Debug log state transitions
  stateMachine.subscribe((next, old) => {
    console.log(`[GameStateMachine] ${old} -> ${next} (Points: ${strokeBuffer.getLength()})`);
  });

  // Expose controller for e2e test hooks if needed
  (window as unknown as { __appController: DrawingController }).__appController = controller;

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
