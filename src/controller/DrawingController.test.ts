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
      'Incomplete Sine Wave',
      undefined,
      true
    );
  });

  it('should reject stroke with insufficient amplitude (< 20px) upon pointer up', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));

    // Simulate 2 periods with only 5px amplitude (flat line exploit)
    const L = 150;
    for (let x = 4; x <= 300; x += 4) {
      const y = 200 + 5 * Math.sin((x / L) * 2 * Math.PI);
      controller.handlePointerMove(createPointerEvent('pointermove', x, y));
    }

    controller.handlePointerUp(createPointerEvent('pointerup', 300, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    expect(controller.getLastEvaluation()).toBeNull();
    expect(mockView.renderBanner).toHaveBeenCalledWith(
      'Sine Wave Too Flat',
      undefined,
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

    // Fitted reference guideline (dashed red) and evaluated stroke rendered without axes or reset marker
    expect(mockView.renderFittedSineGuideline).toHaveBeenCalled();
    expect(mockView.renderEvaluatedStroke).toHaveBeenCalled();
    expect(mockView.renderOriginMarker).not.toHaveBeenCalled();
    expect(mockView.renderCoordinateAxes).not.toHaveBeenCalled();
  });

  it('should reset previous evaluation and seamlessly start a new stroke on pointerdown when in LOCKED state', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
      onReset,
    });
    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));

    const L = 200;
    for (let x = 4; x <= 250; x += 5) {
      const y = 200 + 40 * Math.sin((x / L) * 2 * Math.PI);
      controller.handlePointerMove(createPointerEvent('pointermove', x, y));
    }
    controller.handlePointerUp(createPointerEvent('pointerup', 250, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    expect(controller.getLastEvaluation()).not.toBeNull();

    // Clicking anywhere in LOCKED state resets previous evaluation and starts a new stroke
    controller.handlePointerDown(createPointerEvent('pointerdown', 100, 100));
    expect(onReset).toHaveBeenCalled();
    expect(stateMachine.getState()).toBe('DRAWING');
    expect(controller.getLastEvaluation()).toBeNull();
    expect(strokeBuffer.getLength()).toBe(1);
  });

  it('should support explicit controller.reset() cleanly returning to IDLE', () => {
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

    controller.reset();

    expect(stateMachine.getState()).toBe('IDLE');
    expect(strokeBuffer.getLength()).toBe(0);
    expect(controller.getLastEvaluation()).toBeNull();
    expect(onReset).toHaveBeenCalled();
  });

  describe('Demo Bot Simulation & User Interruption (US05)', () => {
    it('should start demo animation and set isDemoPlaying to true', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      expect(controller.isDemoPlaying()).toBe(false);

      controller.startDemo();
      expect(controller.isDemoPlaying()).toBe(true);
      expect(stateMachine.getState()).toBe('DRAWING');
    });

    it('should stop demo animation cleanly when stopDemo is called', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.startDemo();
      expect(controller.isDemoPlaying()).toBe(true);

      controller.stopDemo();
      expect(controller.isDemoPlaying()).toBe(false);
    });

    it('should immediately interrupt demo and yield control to user on pointer down', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
        onReset,
      });
      controller.startDemo();
      expect(controller.isDemoPlaying()).toBe(true);

      // User interrupts by clicking/touching canvas
      controller.handlePointerDown(createPointerEvent('pointerdown', 120, 250));

      expect(controller.isDemoPlaying()).toBe(false);
      expect(stateMachine.getState()).toBe('DRAWING');
      expect(strokeBuffer.getLength()).toBe(1);
      expect(strokeBuffer.getPoints()[0]).toEqual({ x: 120, y: 250, time: expect.any(Number) });
    });

    it('should handle repeated stopDemo calls gracefully without errors (clean teardown)', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.startDemo();
      controller.stopDemo();
      controller.stopDemo();
      expect(controller.isDemoPlaying()).toBe(false);
    });
  });
});
