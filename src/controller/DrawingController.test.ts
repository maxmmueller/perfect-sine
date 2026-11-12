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
      renderCalculationBanner: vi.fn(),
      renderWaveTracer: vi.fn(),
      handleResize: vi.fn(),
      getDimensions: () => ({ width: 800, height: 600, dpr: 1 }),
    } as unknown as CanvasView;

    stateMachine = new GameStateMachine();
    strokeBuffer = new StrokeBuffer();
    onEvaluationComplete = vi.fn();
    onReset = vi.fn();
  });

  const createPointerEvent = (type: string, clientX: number, clientY: number, pointerId: number = 1, overrides: Partial<PointerEvent> = {}): PointerEvent => {
    return {
      type,
      clientX,
      clientY,
      pointerId,
      isPrimary: true,
      pointerType: 'mouse',
      ...overrides,
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

  describe('single-pointer ownership', () => {
    const touch = (type: string, x: number, y: number, id: number, primary = true) =>
      createPointerEvent(type, x, y, id, { pointerType: 'touch', isPrimary: primary });
    const dispatch = (type: string, event: PointerEvent) => {
      const listener = vi.mocked(mockCanvas.addEventListener).mock.calls.find(call => call[0] === type)?.[1];
      expect(listener).toBeTypeOf('function');
      (listener as EventListener)(event);
    };

    it('records only the first finger while other contacts move over the canvas', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.handlePointerDown(touch('pointerdown', 50, 100, 1));
      controller.handlePointerDown(touch('pointerdown', 700, 500, 2, false));
      controller.handlePointerMove(touch('pointermove', 60, 110, 1));
      controller.handlePointerMove(touch('pointermove', 710, 510, 2, false));
      controller.handlePointerMove(touch('pointermove', 70, 120, 1));
      expect(strokeBuffer.getPoints().map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 50, y: 100 }, { x: 60, y: 110 }, { x: 70, y: 120 },
      ]);
      expect(mockCanvas.setPointerCapture).toHaveBeenCalledTimes(1);
      expect(mockCanvas.setPointerCapture).toHaveBeenCalledWith(1);
    });

    it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
      'ignores another finger’s %s and finishes only when the owner ends', type => {
        const completed = vi.fn();
        const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, { onStrokeComplete: completed });
        controller.handlePointerDown(touch('pointerdown', 50, 100, 1));
        controller.handlePointerDown(touch('pointerdown', 700, 500, 2, false));
        dispatch(type, touch(type, 710, 510, 2, false));
        expect(stateMachine.getState()).toBe('DRAWING');
        expect(completed).not.toHaveBeenCalled();
        expect(mockCanvas.releasePointerCapture).not.toHaveBeenCalled();
        controller.handlePointerMove(touch('pointermove', 60, 110, 1));
        controller.handlePointerUp(touch('pointerup', 60, 110, 1));
        expect(stateMachine.getState()).toBe('LOCKED');
        expect(completed).toHaveBeenCalledTimes(1);
        expect(mockCanvas.releasePointerCapture).toHaveBeenCalledWith(1);
      }
    );

    it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
      'releases ownership on the owner’s %s without transferring to remaining fingers', type => {
        const completed = vi.fn();
        const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, { onStrokeComplete: completed });
        controller.handlePointerDown(touch('pointerdown', 50, 100, 1));
        controller.handlePointerMove(touch('pointermove', 60, 110, 1));
        controller.handlePointerDown(touch('pointerdown', 700, 500, 2, false));
        dispatch(type, touch(type, 60, 110, 1));
        const original = controller.getLastDrawnStroke();
        controller.handlePointerMove(touch('pointermove', 710, 510, 2, false));
        controller.handlePointerDown(touch('pointerdown', 720, 520, 3, false));
        controller.handlePointerUp(touch('pointerup', 710, 510, 2, false));
        expect(stateMachine.getState()).toBe('LOCKED');
        expect(controller.getLastDrawnStroke()).toBe(original);
        expect(completed).toHaveBeenCalledTimes(1);
        controller.handlePointerDown(touch('pointerdown', 80, 140, 4));
        expect(stateMachine.getState()).toBe('DRAWING');
        expect(strokeBuffer.getLength()).toBe(1);
        expect(mockCanvas.setPointerCapture).toHaveBeenLastCalledWith(4);
      }
    );

    it('does not let a non-primary finger interrupt the demo or start drawing', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.startDemo();
      const demoState = stateMachine.getState();
      controller.handlePointerDown(touch('pointerdown', 700, 500, 2, false));
      expect(controller.isDemoPlaying()).toBe(true);
      expect(stateMachine.getState()).toBe(demoState);
      expect(mockCanvas.setPointerCapture).not.toHaveBeenCalled();
      controller.stopDemo();
    });

    it('also ignores a second primary device while a finger owns the stroke', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.handlePointerDown(touch('pointerdown', 50, 100, 1));
      controller.handlePointerDown(createPointerEvent('pointerdown', 700, 500, 20, { pointerType: 'pen' }));
      controller.handlePointerMove(createPointerEvent('pointermove', 710, 510, 20, { pointerType: 'pen' }));
      controller.handlePointerUp(createPointerEvent('pointerup', 710, 510, 20, { pointerType: 'pen' }));
      expect(stateMachine.getState()).toBe('DRAWING');
      expect(strokeBuffer.getLength()).toBe(1);
      expect(mockCanvas.setPointerCapture).toHaveBeenCalledTimes(1);
    });

    it('supports pointer ID zero and ignores the normal capture-loss event after release', () => {
      const completed = vi.fn();
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, { onStrokeComplete: completed });
      controller.handlePointerDown(touch('pointerdown', 50, 100, 0));
      controller.handlePointerMove(touch('pointermove', 60, 110, 0));
      controller.handlePointerUp(touch('pointerup', 60, 110, 0));
      dispatch('lostpointercapture', touch('lostpointercapture', 60, 110, 0));
      expect(mockCanvas.releasePointerCapture).toHaveBeenCalledWith(0);
      expect(completed).toHaveBeenCalledTimes(1);
    });

    it('clears ownership and capture on reset, ignoring late events from that contact', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.handlePointerDown(touch('pointerdown', 50, 100, 1));
      controller.reset();
      controller.handlePointerMove(touch('pointermove', 60, 110, 1));
      controller.handlePointerUp(touch('pointerup', 60, 110, 1));
      expect(stateMachine.getState()).toBe('IDLE');
      expect(strokeBuffer.getLength()).toBe(0);
      expect(mockCanvas.releasePointerCapture).toHaveBeenCalledWith(1);
      controller.handlePointerDown(touch('pointerdown', 80, 140, 2));
      expect(stateMachine.getState()).toBe('DRAWING');
      expect(strokeBuffer.getLength()).toBe(1);
    });

    it('retains single-pointer ownership when browser pointer capture APIs fail', () => {
      vi.mocked(mockCanvas.setPointerCapture).mockImplementation(() => { throw new Error('Capture unavailable'); });
      vi.mocked(mockCanvas.releasePointerCapture).mockImplementation(() => { throw new Error('Already released'); });
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.handlePointerDown(touch('pointerdown', 50, 100, 1));
      controller.handlePointerMove(touch('pointermove', 700, 500, 2, false));
      controller.handlePointerMove(touch('pointermove', 60, 110, 1));
      controller.handlePointerUp(touch('pointerup', 60, 110, 1));
      expect(controller.getLastDrawnStroke()?.points).toHaveLength(2);
      controller.handlePointerDown(touch('pointerdown', 80, 140, 3));
      expect(stateMachine.getState()).toBe('DRAWING');
    });
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

  it('should reject a sharp zigzag wave and display "Not a Sine Wave" warning banner', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
      onEvaluationComplete,
      onReset,
    });

    controller.handlePointerDown(createPointerEvent('pointerdown', 0, 200));

    // Simulate 3-cycle zigzag wave with sharp cusps
    const period = 120;
    const cycles = 3;
    const A = 40;
    const totalPoints = 120;

    for (let i = 1; i < totalPoints; i++) {
      const x = (i / (totalPoints - 1)) * (period * cycles);
      const phase = ((x % period) + period) % period;
      let yOffset: number;
      if (phase < period / 4) {
        yOffset = (phase / (period / 4)) * A;
      } else if (phase < (3 * period) / 4) {
        yOffset = A - ((phase - period / 4) / (period / 4)) * 2 * A;
      } else {
        yOffset = -A + ((phase - (3 * period) / 4) / (period / 4)) * A;
      }
      controller.handlePointerMove(createPointerEvent('pointermove', x, 200 + yOffset));
    }

    controller.handlePointerUp(createPointerEvent('pointerup', period * cycles, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    expect(controller.getLastEvaluation()).toBeNull();
    expect(mockView.renderBanner).toHaveBeenCalledWith(
      'Not a Sine Wave',
      undefined,
      true
    );
    expect(mockView.renderStroke).toHaveBeenCalledWith(
      expect.any(Array),
      '#ef4444'
    );
  });

  it('should reject a 5-cycle triangle wave (user screenshot case) with "Not a Sine Wave"', () => {
    const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
    controller.handlePointerDown(createPointerEvent('pointerdown', 50, 200));

    const period = 80;
    const cycles = 5;
    const A = 60;
    const totalPoints = 120;

    for (let i = 1; i < totalPoints; i++) {
      const x = (i / (totalPoints - 1)) * (period * cycles);
      const phase = ((x % period) + period) % period;
      let yOffset: number;
      if (phase < period / 4) {
        yOffset = (phase / (period / 4)) * A;
      } else if (phase < (3 * period) / 4) {
        yOffset = A - ((phase - period / 4) / (period / 4)) * 2 * A;
      } else {
        yOffset = -A + ((phase - (3 * period) / 4) / (period / 4)) * A;
      }
      controller.handlePointerMove(createPointerEvent('pointermove', 50 + x, 200 + yOffset));
    }

    controller.handlePointerUp(createPointerEvent('pointerup', 50 + period * cycles, 200));

    expect(stateMachine.getState()).toBe('LOCKED');
    expect(controller.getLastEvaluation()).toBeNull();
    expect(mockView.renderBanner).toHaveBeenCalledWith(
      'Not a Sine Wave',
      undefined,
      true
    );
    expect(mockView.renderStroke).toHaveBeenCalledWith(
      expect.any(Array),
      '#ef4444'
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

    it('should not score or display results in demo mode, and should render with gradient deviations', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
        onEvaluationComplete,
      });

      controller.startDemo({ tiltAngle: 0.25 });
      expect(controller.isDemoPlaying()).toBe(true);

      // Trigger animation frame callback
      expect(rAFCallback).toBeDefined();
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 500);
      }

      expect(mockView.renderEvaluatedStroke).toHaveBeenCalled();
      const callArgs = vi.mocked(mockView.renderEvaluatedStroke).mock.calls;
      const lastCallDeviations = callArgs[callArgs.length - 1][0];
      expect(lastCallDeviations.length).toBeGreaterThan(2);
      expect(lastCallDeviations[0]).toHaveProperty('color');
      expect(lastCallDeviations[0].color).toMatch(/^hsl\(/);

      // Verify no banners rendered and no scoring evaluation produced
      expect(mockView.renderCalculationBanner).not.toHaveBeenCalled();
      expect(mockView.renderBanner).not.toHaveBeenCalled();
      expect(onEvaluationComplete).not.toHaveBeenCalled();
      expect(controller.getLastEvaluation()).toBeNull();

      controller.stopDemo();
      vi.unstubAllGlobals();
    });

    it('should support tilted sine waves in demo mode with predominantly green hues', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);

      // Start with explicit tilt on a pristine wave
      controller.startDemo({ tiltAngle: -0.32, runawayDrift: 0, jitterLevel: 1.5 });
      expect(controller.isDemoPlaying()).toBe(true);

      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 600);
      }
      expect(strokeBuffer.getLength()).toBeGreaterThan(5);

      const callArgs = vi.mocked(mockView.renderEvaluatedStroke).mock.calls;
      const lastCallDeviations = callArgs[callArgs.length - 1][0];
      const hues = lastCallDeviations.map((d) => d.hue);
      const avgHue = hues.reduce((a, b) => a + b, 0) / hues.length;
      expect(avgHue).toBeGreaterThan(95); // High green accuracy
      expect(hues.filter((h) => h < 50).length).toBe(0); // Zero red/orange points

      controller.stopDemo();
      vi.unstubAllGlobals();
    });

    it('should accumulate previous demo waves in history and smoothly fade their opacity', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      let timeoutCallback: (() => void) | null = null;

      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      vi.stubGlobal('setTimeout', vi.fn((cb: () => void) => {
        timeoutCallback = cb;
        return 456 as unknown as ReturnType<typeof setTimeout>;
      }));
      vi.stubGlobal('clearTimeout', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      controller.startDemo({ speedPxPerSec: 500 });
      expect(controller.getDemoHistory().length).toBe(0);

      // Finish wave 1 by advancing animation frame to duration
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 5000);
      }

      // Timeout should be set to transition to wave 2
      expect(timeoutCallback).not.toBeNull();
      if (timeoutCallback) {
        (timeoutCallback as () => void)();
      }

      // Wave 1 should now be preserved in demoHistory with initial alpha ~0.85
      const historyAfterWave1 = controller.getDemoHistory();
      expect(historyAfterWave1.length).toBe(1);
      expect(historyAfterWave1[0].alpha).toBeCloseTo(0.85, 1);

      // Animate wave 2 to half progress: wave 1 alpha should interpolate down
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 250);
      }
      expect(controller.getDemoHistory()[0].alpha).toBeLessThan(0.85);
      expect(controller.getDemoHistory()[0].alpha).toBeGreaterThan(0.40);

      // Finish wave 2 and trigger wave 3
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 5000);
      }
      if (timeoutCallback) {
        (timeoutCallback as () => void)();
      }

      // Should now have 2 waves in history, older wave faded more than newer wave
      const historyAfterWave2 = controller.getDemoHistory();
      expect(historyAfterWave2.length).toBe(2);
      expect(historyAfterWave2[0].alpha).toBeLessThan(historyAfterWave2[1].alpha);

      // Interruption should immediately clear history
      controller.handlePointerDown(createPointerEvent('pointerdown', 200, 200));
      expect(controller.getDemoHistory().length).toBe(0);
      expect(controller.isDemoPlaying()).toBe(false);

      vi.unstubAllGlobals();
    });

    it('should preserve active demo on screenshot/share/Escape/modifier keys while dismissing on other keys', () => {
      const winListeners: Record<string, Array<(e: unknown) => void>> = {};
      vi.stubGlobal('window', {
        addEventListener: (ev: string, cb: (e: unknown) => void) => {
          if (!winListeners[ev]) winListeners[ev] = [];
          winListeners[ev].push(cb);
        },
        requestAnimationFrame: vi.fn(() => 1),
        cancelAnimationFrame: vi.fn(),
      });

      const localController = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      localController.startDemo();
      expect(localController.isDemoPlaying()).toBe(true);

      const keyHandlers = winListeners['keydown'] || [];
      keyHandlers.forEach((h) => h({ key: 's' }));
      keyHandlers.forEach((h) => h({ key: 'PrintScreen', code: 'PrintScreen' }));
      keyHandlers.forEach((h) => h({ key: 'Escape' }));
      keyHandlers.forEach((h) => h({ key: 'Meta' }));
      expect(localController.isDemoPlaying()).toBe(true);

      keyHandlers.forEach((h) => h({ key: ' ' }));
      expect(localController.isDemoPlaying()).toBe(false);

      vi.unstubAllGlobals();
    });

    it('should detect wave overlaps correctly using checkWavesOverlap', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      const waveA = [
        { x: 100, y: 150 },
        { x: 200, y: 150 },
      ];
      // Wave B right on top of Wave A
      const waveBOverlap = [
        { x: 120, y: 160 },
        { x: 220, y: 160 },
      ];
      // Wave C separated far below Wave A
      const waveCSeparated = [
        { x: 100, y: 400 },
        { x: 200, y: 400 },
      ];

      expect(controller.checkWavesOverlap(waveA, waveBOverlap, 25)).toBe(true);
      expect(controller.checkWavesOverlap(waveA, waveCSeparated, 25)).toBe(false);
      expect(controller.checkWavesOverlap([], waveA)).toBe(false);
    });

    it('should place consecutive demo waves without overlapping visible historical waves', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      let timeoutCallback: (() => void) | null = null;

      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      vi.stubGlobal('setTimeout', vi.fn((cb: () => void) => {
        timeoutCallback = cb;
        return 456 as unknown as ReturnType<typeof setTimeout>;
      }));
      vi.stubGlobal('clearTimeout', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      // Wave 1 in upper zone
      controller.startDemo({ centerY: 180, amplitude: 30, speedPxPerSec: 600 });

      // Finish wave 1
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 5000);
      }
      if (timeoutCallback) {
        (timeoutCallback as () => void)();
      }

      // Wave 2 should automatically avoid overlapping Wave 1
      const history = controller.getDemoHistory();
      expect(history.length).toBe(1);
      const wave1Points = history[0].deviations.map((d) => d.point);

      // Trigger animation for wave 2
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 5000);
      }

      const callArgs = vi.mocked(mockView.renderEvaluatedStroke).mock.calls;
      const lastCall = callArgs[callArgs.length - 1][0];
      const wave2Points = lastCall.map((d) => d.point);

      // Verify that wave 2 does not overlap with wave 1
      expect(controller.checkWavesOverlap(wave2Points, wave1Points, 20)).toBe(false);

      controller.stopDemo();
      vi.unstubAllGlobals();
    });

    it('should support imperfect demo waves that run off course and turn red ("aus dem Ufer laufen")', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);

      // Fix geometry/profile so this tests runaway rendering, not random demo selection.
      controller.startDemo({
        centerX: 400, centerY: 300,
        amplitude: 45, wavelength: 180, cycles: 2, phase: 0, tiltAngle: 0,
        profile: 'runaway',
        rng: () => 0.5,
        runawayDrift: 32,
        runawayCenter: 0.6,
        speedPxPerSec: 500,
      });

      // Animate through full stroke
      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 3000);
      }

      const callArgs = vi.mocked(mockView.renderEvaluatedStroke).mock.calls;
      const lastCallDeviations = callArgs[callArgs.length - 1][0];
      const hues = lastCallDeviations.map((d) => d.hue);

      // Should have green points in normal regions
      expect(hues.filter((h) => h >= 90).length).toBeGreaterThan(20);

      // Should have orange/red points in the runaway slip region
      const redPoints = lastCallDeviations.filter((d) => d.hue <= 25);
      expect(redPoints.length).toBeGreaterThan(3);
      expect(redPoints[0].color).toMatch(/^hsl\(([0-9]|1[0-9]|2[0-5]),/);

      controller.stopDemo();
      vi.unstubAllGlobals();
    });

    it('should prune demo history so at most 2 historical waves remain', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);

      // Wave 1
      controller.startDemo({ cycles: 1.5, amplitude: 30 }, false);
      if (rAFCallback) (rAFCallback as (time: number) => void)(performance.now() + 4000);

      // Wave 2
      controller.startDemo({ cycles: 1.5, amplitude: 30 }, true);
      if (rAFCallback) (rAFCallback as (time: number) => void)(performance.now() + 8000);

      // Wave 3
      controller.startDemo({ cycles: 1.5, amplitude: 30 }, true);
      if (rAFCallback) (rAFCallback as (time: number) => void)(performance.now() + 12000);

      // Wave 4
      controller.startDemo({ cycles: 1.5, amplitude: 30 }, true);

      // History must be at most 2 waves
      expect(controller.getDemoHistory().length).toBeLessThanOrEqual(2);

      controller.stopDemo();
      vi.unstubAllGlobals();
    });

    it('should draw mixed human error curves by default in demo mode', () => {
      let rAFCallback: FrameRequestCallback | null = null;
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
        rAFCallback = cb;
        return 123;
      }));
      vi.stubGlobal('cancelAnimationFrame', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);

      // Default startDemo without custom options should use 'mixed'
      controller.startDemo();

      if (rAFCallback) {
        (rAFCallback as (time: number) => void)(performance.now() + 4000);
      }

      const callArgs = vi.mocked(mockView.renderEvaluatedStroke).mock.calls;
      const lastCallDeviations = callArgs[callArgs.length - 1][0];
      const hues = lastCallDeviations.map((d) => d.hue);

      // Verify that the stroke contains green regions (accurate) as well as warmer hues (imperfections)
      const greenCount = hues.filter((h) => h >= 90).length;
      const imperfectCount = hues.filter((h) => h < 90).length;
      expect(greenCount).toBeGreaterThan(5);
      expect(imperfectCount).toBeGreaterThan(5);

      controller.stopDemo();
      vi.unstubAllGlobals();
    });

    it('should notify onStrokeComplete and store lastDrawnStroke upon stroke finish', () => {
      let completedStrokeData: unknown = null;
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer, {
        onStrokeComplete: (data) => {
          completedStrokeData = data;
        },
      });

      // Draw a short wave
      controller.handlePointerDown(createPointerEvent('pointerdown', 50, 100));
      controller.handlePointerMove(createPointerEvent('pointermove', 80, 150));
      controller.handlePointerUp(createPointerEvent('pointerup', 100, 100));

      expect(completedStrokeData).not.toBeNull();
      expect(controller.getLastDrawnStroke()).toEqual(completedStrokeData);
      expect((completedStrokeData as { points: unknown[] }).points.length).toBeGreaterThan(0);
    });

    it('should support synchronous and animated replayStroke of recorded points', () => {
      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);
      const points = [
        { x: 100, y: 300, time: 0 },
        { x: 150, y: 220, time: 50 },
        { x: 200, y: 300, time: 100 },
        { x: 250, y: 380, time: 150 },
        { x: 300, y: 300, time: 200 },
        { x: 350, y: 220, time: 250 },
        { x: 400, y: 300, time: 300 },
        { x: 450, y: 380, time: 350 },
        { x: 500, y: 300, time: 400 },
      ];

      // Synchronous replay (animated: false)
      controller.replayStroke(points, false);
      expect(stateMachine.getState()).toBe('LOCKED');
      expect(strokeBuffer.getLength()).toBe(points.length);
      expect(controller.getLastDrawnStroke()).not.toBeNull();
    });

    it('erases historical demo curves continuously during both active drawing and inter-wave pauses', () => {
      let nowMs = 0;
      let nextRafId = 1;
      const activeRafs = new Map<number, (ts: number) => void>();

      vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
      vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
        const id = nextRafId++;
        activeRafs.set(id, cb);
        return id;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        activeRafs.delete(id);
      });
      vi.stubGlobal('setTimeout', vi.fn(() => 999));
      vi.stubGlobal('clearTimeout', vi.fn());

      const controller = new DrawingController(mockCanvas, mockView, stateMachine, strokeBuffer);

      const stepLatestRaf = (deltaMs: number) => {
        nowMs += deltaMs;
        const firstEntry = activeRafs.entries().next();
        expect(firstEntry.done).toBe(false);
        if (firstEntry.done) return;
        const [id, cb] = firstEntry.value;
        activeRafs.delete(id);
        cb(nowMs);
      };

      try {
        controller.startDemo({ speedPxPerSec: 800, cycles: 1.5, wavelength: 200 });
        stepLatestRaf(3000);

        // Start Wave 2 preserving Wave 1 in history
        controller.startDemo({ speedPxPerSec: 800, cycles: 1.5, wavelength: 200 }, true);
        const histAfterWave1 = controller.getDemoHistory();
        expect(histAfterWave1.length).toBe(1);
        expect(histAfterWave1[0].eraseProgress).toBe(0);

        // Advance Wave 2 mid-stroke: check continuous wipe progression and fadeWindow render args
        vi.mocked(mockView.renderEvaluatedStroke).mockClear();
        stepLatestRaf(350);

        expect(histAfterWave1[0].eraseProgress).toBeGreaterThan(0);
        expect(histAfterWave1[0].eraseProgress).toBeLessThan(0.5);

        const histRenderCall = vi.mocked(mockView.renderEvaluatedStroke).mock.calls.find(
          (args) => args.length >= 4 && args[3] !== undefined
        );
        expect(histRenderCall).toBeDefined();
        expect(histRenderCall![3]).toEqual(
          expect.objectContaining({
            eraseProgress: expect.any(Number),
            fadeSpan: expect.any(Number),
            arcProgress: expect.any(Array),
          })
        );

        // Complete Wave 2 and enter the 600ms inter-wave pause: older Wave 1 MUST keep fading continuously!
        stepLatestRaf(400);
        const beforePauseErase = histAfterWave1[0].eraseProgress;
        const beforePauseAlpha = histAfterWave1[0].alpha;

        for (let step = 0; step < 5; step++) {
          stepLatestRaf(100);
        }

        expect(histAfterWave1[0].eraseProgress).toBeGreaterThan(beforePauseErase);
        expect(histAfterWave1[0].alpha).toBeLessThan(beforePauseAlpha);

        // Starting Wave 3 cancels pause RAF cleanly and continues Wave 1 seamlessly alongside new Wave 2
        const eraseAtWave3Start = histAfterWave1[0].eraseProgress;
        controller.startDemo({ speedPxPerSec: 800, cycles: 1.5, wavelength: 200 }, true);
        const histAfterWave2 = controller.getDemoHistory();
        expect(histAfterWave2.length).toBe(2);
        expect(histAfterWave2[0].eraseProgress).toBeCloseTo(eraseAtWave3Start, 5);
        expect(histAfterWave2[1].eraseProgress).toBe(0);
      } finally {
        controller.stopDemo();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      }
    });

    it('places demo curves across varied center-weighted locations without visible overlap', () => {
      let nowMs = 0;
      let nextRafId = 1;
      const activeRafs = new Map<number, (ts: number) => void>();

      const desktopView = {
        ...mockView,
        getDimensions: () => ({ width: 1280, height: 800, dpr: 1 }),
      } as unknown as CanvasView;

      vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
      vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
        const id = nextRafId++;
        activeRafs.set(id, cb);
        return id;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        activeRafs.delete(id);
      });
      vi.stubGlobal('setTimeout', vi.fn(() => 999));
      vi.stubGlobal('clearTimeout', vi.fn());

      const controller = new DrawingController(mockCanvas, desktopView, stateMachine, strokeBuffer);
      const centroids: Array<{ x: number; y: number }> = [];

      try {
        for (let wave = 0; wave < 14; wave++) {
          controller.startDemo(undefined, wave > 0);

          // Advance stroke to completion so currentDemoDeviations populates active points
          nowMs += 3000;
          const firstEntry = activeRafs.entries().next();
          expect(firstEntry.done).toBe(false);
          if (firstEntry.done) break;
          const [id, drawCb] = firstEntry.value;
          activeRafs.delete(id);
          drawCb(nowMs);

          const activePoints = strokeBuffer.getPoints();
          expect(activePoints.length).toBeGreaterThan(20);

          const meanX = activePoints.reduce((s, p) => s + p.x, 0) / activePoints.length;
          const meanY = activePoints.reduce((s, p) => s + p.y, 0) / activePoints.length;
          centroids.push({ x: meanX, y: meanY });

          // Verify zero overlap between newly drawn curve and visible segments of every historical curve
          for (const hist of controller.getDemoHistory()) {
            const visibleHistPoints = hist.deviations
              .filter((_, idx) =>
                CanvasView.computePointFadeFactor(idx, hist.deviations.length, {
                  eraseProgress: hist.eraseProgress,
                  fadeSpan: 0.34,
                  arcProgress: hist.arcProgress,
                }) > 0.04
              )
              .map((d) => d.point);
            if (visibleHistPoints.length >= 2) {
              expect(controller.checkWavesOverlap(activePoints, visibleHistPoints, 28)).toBe(false);
            }
          }
        }

        const xs = centroids.map((c) => c.x);
        const ys = centroids.map((c) => c.y);
        const xSpread = Math.max(...xs) - Math.min(...xs);
        const ySpread = Math.max(...ys) - Math.min(...ys);
        expect(xSpread).toBeGreaterThan(60);
        expect(ySpread).toBeGreaterThan(60);

        const centralCount = centroids.filter(
          (c) => c.x >= 1280 * 0.25 && c.x <= 1280 * 0.75 && c.y >= 800 * 0.22 && c.y <= 800 * 0.78
        ).length;
        expect(centralCount).toBeGreaterThanOrEqual(7);
      } finally {
        controller.stopDemo();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      }
    });
  });
});
