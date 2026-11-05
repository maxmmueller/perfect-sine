import { describe, it, expect, vi } from 'vitest';
import { GameStateMachine } from './GameStateMachine';

describe('GameStateMachine (V-Model State Machine Verification)', () => {
  it('should initialize in IDLE state', () => {
    const sm = new GameStateMachine();
    expect(sm.getState()).toBe('IDLE');
  });

  it('should transition from IDLE to DRAWING when startDrawing is called', () => {
    const sm = new GameStateMachine();
    const result = sm.startDrawing();
    expect(result).toBe(true);
    expect(sm.getState()).toBe('DRAWING');
  });

  it('should reject startDrawing when not in IDLE state', () => {
    const sm = new GameStateMachine();
    sm.startDrawing(); // now DRAWING
    const result = sm.startDrawing();
    expect(result).toBe(false);
    expect(sm.getState()).toBe('DRAWING');
  });

  it('should transition from DRAWING to EVALUATING when finishDrawing is called', () => {
    const sm = new GameStateMachine();
    sm.startDrawing();
    const result = sm.finishDrawing();
    expect(result).toBe(true);
    expect(sm.getState()).toBe('EVALUATING');
  });

  it('should reject finishDrawing when not in DRAWING state', () => {
    const sm = new GameStateMachine();
    const result = sm.finishDrawing();
    expect(result).toBe(false);
    expect(sm.getState()).toBe('IDLE');
  });

  it('should transition from EVALUATING to LOCKED via setEvaluated', () => {
    const sm = new GameStateMachine();
    sm.startDrawing();
    sm.finishDrawing();
    const result = sm.setEvaluated();
    expect(result).toBe(true);
    expect(sm.getState()).toBe('LOCKED');
  });

  it('should reject setEvaluated when not in EVALUATING state', () => {
    const sm = new GameStateMachine();
    expect(sm.setEvaluated()).toBe(false);
  });

  it('should transition to IDLE when reset is called from LOCKED or EVALUATING', () => {
    const sm = new GameStateMachine();
    sm.startDrawing();
    sm.finishDrawing();
    sm.setEvaluated();
    expect(sm.getState()).toBe('LOCKED');

    const result = sm.reset();
    expect(result).toBe(true);
    expect(sm.getState()).toBe('IDLE');
  });

  it('should allow reset directly from EVALUATING state', () => {
    const sm = new GameStateMachine();
    sm.startDrawing();
    sm.finishDrawing();
    expect(sm.getState()).toBe('EVALUATING');

    expect(sm.reset()).toBe(true);
    expect(sm.getState()).toBe('IDLE');
  });

  it('should reject reset when in IDLE or DRAWING state', () => {
    const sm = new GameStateMachine();
    expect(sm.reset()).toBe(false);

    sm.startDrawing();
    expect(sm.reset()).toBe(false);
  });

  it('should notify subscribers upon state transition and support unsubscribe', () => {
    const sm = new GameStateMachine();
    const listener = vi.fn();
    const unsubscribe = sm.subscribe(listener);

    sm.startDrawing();
    expect(listener).toHaveBeenCalledWith('DRAWING', 'IDLE');

    unsubscribe();
    sm.finishDrawing();
    expect(listener).toHaveBeenCalledTimes(1); // not called again after unsubscribe
  });

  it('should handle throwing listeners gracefully without crashing state machine', () => {
    const sm = new GameStateMachine();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    sm.subscribe(() => {
      throw new Error('Listener error');
    });

    expect(() => sm.startDrawing()).not.toThrow();
    expect(sm.getState()).toBe('DRAWING');
    consoleSpy.mockRestore();
  });
});
