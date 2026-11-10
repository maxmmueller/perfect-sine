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

      // Start demo with runaway drift
      controller.startDemo({
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
  });
});
