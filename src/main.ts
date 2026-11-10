import { GameStateMachine } from './model/GameStateMachine';
import { StrokeBuffer } from './model/StrokeBuffer';
import { CanvasView } from './view/CanvasView';
import { DrawingController } from './controller/DrawingController';
import { SessionHistoryService } from './model/SessionHistoryService';
import { HudView } from './view/HudView';
import { ScoreStrategyManager } from './model/scoring/ScoreStrategyManager';
import { AbComparisonView } from './view/AbComparisonView';

function getStrategyBadge(id: string): string {
  switch (id) {
    case 'rmse_l2':
      return 'L2';
    case 'area_l1':
      return 'L1';
    case 'harmonic_sym':
    case 'harmonic_symmetry':
      return 'SYM';
    case 'curvature_flow':
      return 'FLOW';
    case 'chebyshev_linf':
      return 'LINF';
    default:
      return id.substring(0, 4).toUpperCase();
  }
}

function initializeApp(): void {
  const canvas = document.getElementById('sine-canvas') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #sine-canvas not found');
  }

  const sessionService = new SessionHistoryService();
  const hudView = new HudView(sessionService);
  const strategyManager = new ScoreStrategyManager();

  // Deterministic A/B/n assignment or session-cached strategy
  const activeStrategy = strategyManager.getActiveStrategy();

  const stateMachine = new GameStateMachine();
  const strokeBuffer = new StrokeBuffer(2.0);
  const view = new CanvasView(canvas);

  // Wire Strategy Switcher Pill UI updater
  const strategyPill = document.getElementById('strategy-pill');
  const strategyLabel = document.getElementById('hud-strategy-name');

  let controller: DrawingController;

  const updateStrategyUI = () => {
    const current = controller?.getScoreStrategy() ?? activeStrategy;
    if (strategyLabel) {
      strategyLabel.textContent = getStrategyBadge(current.id);
    }
    if (strategyPill) {
      strategyPill.setAttribute(
        'title',
        `Current: ${current.name} - ${current.description}. Click to switch algorithm.`
      );
    }
  };

  const abView = new AbComparisonView(strategyManager, {
    onSelectStrategy: (strategy) => {
      controller.setScoreStrategy(strategy);
      updateStrategyUI();
    },
  });

  controller = new DrawingController(canvas, view, stateMachine, strokeBuffer, {
    scoreStrategy: activeStrategy,
    strategyManager,
    onMultiEvaluationComplete: (evaluations) => {
      abView.showEvaluations(evaluations);
    },
    onEvaluationComplete: (evaluation) => {
      sessionService.addAttempt({
        score: evaluation.score,
        accuracy: evaluation.accuracy,
        cycles: evaluation.fittedSine.fullCycles,
        r2: evaluation.fittedSine.r2,
        amplitude: evaluation.fittedSine.amplitude,
        strategyId: controller.getScoreStrategy().id,
      });
    },
  });

  if (strategyPill) {
    strategyPill.addEventListener('click', () => {
      const all = strategyManager.getAllStrategies();
      const current = controller.getScoreStrategy();
      const currentIndex = all.findIndex((s) => s.id === current.id);
      const nextIndex = (currentIndex + 1) % all.length;
      const nextStrategy = all[nextIndex];
      strategyManager.setActiveStrategy(nextStrategy.id);
      controller.setScoreStrategy(nextStrategy);
      updateStrategyUI();
    });
  }

  updateStrategyUI();

  // Debug log state transitions
  stateMachine.subscribe((next, old) => {
    console.log(`[GameStateMachine] ${old} -> ${next} (Points: ${strokeBuffer.getLength()})`);
  });

  // Expose controller & services for test hooks if needed
  (window as unknown as {
    __appController: DrawingController;
    __sessionService: SessionHistoryService;
    __hudView: HudView;
    __strategyManager: ScoreStrategyManager;
    __abView: AbComparisonView;
  }).__appController = controller;
  (window as unknown as { __sessionService: SessionHistoryService }).__sessionService = sessionService;
  (window as unknown as { __hudView: HudView }).__hudView = hudView;
  (window as unknown as { __strategyManager: ScoreStrategyManager }).__strategyManager = strategyManager;
  (window as unknown as { __abView: AbComparisonView }).__abView = abView;

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
