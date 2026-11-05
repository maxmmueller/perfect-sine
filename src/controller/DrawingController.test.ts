import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrawingController } from './DrawingController';
import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { CanvasView } from '../view/CanvasView';

describe('DrawingController (Game Loop & Reset Transition)', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockView: CanvasView;
  let stateMachine: GameStateMachine;
  let strokeBuffer: StrokeBuffer;
  let onEvaluationComplete: ReturnType<typeof vi.fn>;
  let onReset: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCanvas = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      addEventListener: vi.fn(),
      style: { cursor: 'default' },
    } as unknown as HTMLCanvasElement;

    mockView = {
      clear: vi.fn(),
      renderStroke: vi.fn(),
      renderEvaluatedStroke: vi.fn(),
      renderFittedSineGuideline: vi.fn(),
      renderCoordinateAxes: vi.fn(),
      renderOriginMarker: vi.fn(),
      renderBanner: vi.fn(),
      handleResize: vi.fn(),
      getDimensions: () => ({ width: 800, height: 600, dpr: 1 }),
    } as unknown as CanvasView;

    stateMachine = new GameStateMachine();
    strokeBuffer = new StrokeBuffer();
    onEvaluationComplete = vi.fn();
    onReset = vi.fn();
  });

  const createPointerEvent = (type: string, clientX: number, clientY: number, pointerId: number = 1): PointerEvent => {
    return {
      type,
      clientX,
      clientY,
      pointerId,
    } as unknown as PointerEvent;
  };

  it('should initialize cleanly in IDLE state and perform initial render', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    expect(stateMachine.getState()).toBe('IDLE');
    expect(mockView.clear).toHaveBeenCalled();
    expect(controller.getLastEvaluation()).toBeNull();
  });

  it('should start drawing on pointer down and transition state to DRAWING', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    controller.handlePointerDown(createPointerEvent('pointerdown', 50, 100));

    expect(stateMachine.getState()).toBe('DRAWING');
    expect(strokeBuffer.getLength()).toBe(1);
    expect(mockCanvas.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('should buffer points on pointer move while drawing', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    controller.handlePointerDown(createPointerEvent('pointerdown', 50, 100));
    controller.handlePointerMove(createPointerEvent('pointermove', 55, 105));
    controller.handlePointerMove(createPointerEvent('pointermove', 60, 110));

    expect(strokeBuffer.getLength()).toBe(3);
  });

  it('should handle stroke too short upon pointer up', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    controller.handlePointerDown(createPointerEvent('pointerdown', 50, 100));
    controller.handlePointerMove(createPointerEvent('pointermove', 55, 100));
    controller.handlePointerUp(createPointerEvent('pointerup', 60, 100));

    expect(stateMachine.getState()).toBe('LOCKED');
    expect(controller.getLastEvaluation()).toBeNull();
    expect(mockView.renderBanner).toHaveBeenCalledWith(
      'Incomplete Wave',
      expect.stringContaining('Stroke too short'),
      true
    );
  });

  it('should evaluate a valid full-cycle sine wave and notify callback', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
      onEvaluationComplete,
      onReset,
    });

    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));

    // Simulate 1.5 periods with amplitude 40px
    const L = 200;
    for (let x = 4; x <= 300; x += 4) {
      const y = 200 + 40 * Math.sin((x / L) * 2 * Math.PI);
      controller.handlePointerMove(createPointerEvent('pointermove', x, y));
    }

    controller.handlePointerUp(createPointerEvent('pointerup', 300, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    const evaluation = controller.getLastEvaluation();
    expect(evaluation).not.toBeNull();
    expect(evaluation!.score).toBeGreaterThan(0);
    expect(onEvaluationComplete).toHaveBeenCalledWith(evaluation);

    // Coordinate frame should be computed and origin marker rendered
    expect(controller.getCoordinateFrame()).not.toBeNull();
    expect(mockView.renderOriginMarker).toHaveBeenCalled();
    expect(mockView.renderCoordinateAxes).toHaveBeenCalled();
  });

  it('should update cursor to pointer when hovering over origin marker in LOCKED state', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));

    const L = 200;
    for (let x = 4; x <= 250; x += 5) {
      const y = 200 + 40 * Math.sin((x / L) * 2 * Math.PI);
      controller.handlePointerMove(createPointerEvent('pointermove', x, y));
    }
    controller.handlePointerUp(createPointerEvent('pointerup', 250, 200));

    const frame = controller.getCoordinateFrame();
    expect(frame).not.toBeNull();

    // Hover right over the origin
    controller.handlePointerMove(createPointerEvent('pointermove', frame!.origin.x, frame!.origin.y));
    expect(mockCanvas.style.cursor).toBe('pointer');

    // Hover far away from origin
    controller.handlePointerMove(createPointerEvent('pointermove', frame!.origin.x + 100, frame!.origin.y + 100));
    expect(mockCanvas.style.cursor).toBe('default');
  });

  it('should reset cleanly to IDLE when clicking the origin reset marker', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
      onReset,
    });

    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));
    for (let x = 5; x <= 250; x += 5) {
      const y = 200 + 40 * Math.sin((x / 200) * 2 * Math.PI);
      controller.handlePointerMove(createPointerEvent('pointermove', x, y));
    }
    controller.handlePointerUp(createPointerEvent('pointerup', 250, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    const frame = controller.getCoordinateFrame();
    expect(frame).not.toBeNull();

    // Click exactly on the origin marker
    controller.handlePointerDown(createPointerEvent('pointerdown', frame!.origin.x, frame!.origin.y));

    // Must reset to IDLE and not start a new stroke
    expect(stateMachine.getState()).toBe('IDLE');
    expect(strokeBuffer.getLength()).toBe(0);
    expect(controller.getLastEvaluation()).toBeNull();
    expect(controller.getCoordinateFrame()).toBeNull();
    expect(onReset).toHaveBeenCalled();
  });

  it('should reset and immediately start drawing when clicking outside origin marker in LOCKED state', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
      onReset,
    });

    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));
    for (let x = 5; x <= 250; x += 5) {
      const y = 200 + 40 * Math.sin((x / 200) * 2 * Math.PI);
      controller.handlePointerMove(createPointerEvent('pointermove', x, y));
    }
    controller.handlePointerUp(createPointerEvent('pointerup', 250, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    const frame = controller.getCoordinateFrame();

    // Click far outside origin marker (e.g. at x + 200, y + 200)
    controller.handlePointerDown(createPointerEvent('pointerdown', frame!.origin.x + 200, frame!.origin.y + 200));

    // Must transition through reset to DRAWING with first point added
    expect(stateMachine.getState()).toBe('DRAWING');
    expect(strokeBuffer.getLength()).toBe(1);
    expect(onReset).toHaveBeenCalled();
  });

  it('should support explicit controller.reset()', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
      onReset,
    });

    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));
    controller.handlePointerMove(createPointerEvent('pointermove', 50, 200));
    controller.handlePointerUp(createPointerEvent('pointerup', 50, 200));
    expect(stateMachine.getState()).toBe('LOCKED');

    controller.reset();
    expect(stateMachine.getState()).toBe('IDLE');
    expect(strokeBuffer.getLength()).toBe(0);
    expect(onReset).toHaveBeenCalled();
  });
});
