import { describe, it, expect } from 'vitest';
import { ScoreCalculationAnimator } from './ScoreCalculationAnimator';
import { StrokeEvaluation } from '../model/types';

const createMockEvaluation = (score: number, accuracy: number, fullCycles: number): StrokeEvaluation => ({
  fittedSine: {
    amplitude: 40,
    frequency: 0.03,
    phase: 0,
    offset: 200,
    tilt: { angle: 0, centroid: { x: 100, y: 200 } },
    period: 200,
    fullCycles,
    r2: 0.95,
  },
  deviations: [],
  meanDeviation: 2,
  maxDeviation: 5,
  rmse: 2.5,
  accuracy,
  score,
});

describe('ScoreCalculationAnimator', () => {
  it('should initialize and assign correct celebration tier based on score', () => {
    const animator = new ScoreCalculationAnimator();

    animator.start(createMockEvaluation(200, 45, 1.2), 200, 100);
    expect(animator.getTier()).toBe('low');
    expect(animator.isActive()).toBe(true);

    animator.start(createMockEvaluation(550, 75, 1.8), 200, 100);
    expect(animator.getTier()).toBe('medium');

    animator.start(createMockEvaluation(880, 92, 2.4), 200, 100);
    expect(animator.getTier()).toBe('high');

    animator.start(createMockEvaluation(1250, 98, 3.1), 200, 100);
    expect(animator.getTier()).toBe('legendary');
  });

  it('should progress through measuring, multiplying, and celebrating phases', () => {
    const animator = new ScoreCalculationAnimator();
    const evalData = createMockEvaluation(1000, 95, 2.5);
    animator.start(evalData, 300, 150);

    // Initial update at t = 0
    const state0 = animator.update(performance.now());
    expect(state0.phase).toBe('measuring');
    expect(state0.progress).toBeCloseTo(0, 1);
    expect(state0.currentCycles).toBeCloseTo(0, 1);

    // Mid measuring phase (t ~ 320ms, progress ~ 0.2)
    const tMeasuring = performance.now() + 320;
    const stateMeasuring = animator.update(tMeasuring);
    expect(stateMeasuring.phase).toBe('measuring');
    expect(stateMeasuring.currentCycles).toBeGreaterThan(0);
    expect(stateMeasuring.currentCycles).toBeLessThan(2.5);

    // Multiplying phase (t ~ 960ms, progress ~ 0.6)
    const tMultiplying = performance.now() + 960;
    const stateMultiplying = animator.update(tMultiplying);
    expect(stateMultiplying.phase).toBe('multiplying');
    expect(stateMultiplying.currentCycles).toBe(2.5);
    expect(stateMultiplying.currentScore).toBeGreaterThan(200);
    expect(stateMultiplying.currentScore).toBeLessThan(1000);

    // Celebrating phase (t ~ 1440ms, progress ~ 0.9)
    const tCelebrating = performance.now() + 1440;
    const stateCelebrating = animator.update(tCelebrating);
    expect(stateCelebrating.phase).toBe('celebrating');
    expect(stateCelebrating.currentScore).toBe(1000);
    expect(stateCelebrating.scaleFactor).toBeGreaterThan(1.0);
    expect(stateCelebrating.particles.length).toBeGreaterThan(0);
    expect(stateCelebrating.rippleRadius).toBeGreaterThan(0);

    // Settled phase (t >= 1600ms, progress = 1.0): score is settled, particles are fading out
    const tSettled = performance.now() + 1700;
    const stateSettled = animator.update(tSettled);
    expect(stateSettled.phase).toBe('settled');
    expect(stateSettled.currentScore).toBe(1000);
    expect(animator.isActive()).toBe(true);

    // After particle fadeout completes
    const tFinished = performance.now() + 2500;
    const stateFinished = animator.update(tFinished);
    expect(stateFinished.particles.length).toBe(0);
    expect(animator.isActive()).toBe(false);
  });

  it('should scale particle counts and ripple intensity with score tier', () => {
    // Low tier (<300 pts): 0 particles, 0 ripple, terminates immediately upon reaching 1.0 progress
    const lowAnim = new ScoreCalculationAnimator();
    lowAnim.start(createMockEvaluation(180, 40, 1.0), 100, 100);
    const lowState = lowAnim.update(performance.now() + 1400);
    expect(lowState.particles.length).toBe(0);
    expect(lowState.rippleRadius).toBe(0);
    const lowSettled = lowAnim.update(performance.now() + 1650);
    expect(lowSettled.phase).toBe('settled');
    expect(lowAnim.isActive()).toBe(false);

    // Medium tier (300-699 pts): 6 particles
    const medAnim = new ScoreCalculationAnimator();
    medAnim.start(createMockEvaluation(500, 70, 1.5), 100, 100);
    const medState = medAnim.update(performance.now() + 1400);
    expect(medState.particles.length).toBe(6);

    // High tier (700-999 pts): 16 particles, active ripple
    const highAnim = new ScoreCalculationAnimator();
    highAnim.start(createMockEvaluation(850, 90, 2.0), 100, 100);
    const highState = highAnim.update(performance.now() + 1400);
    expect(highState.particles.length).toBe(16);
    expect(highState.rippleRadius).toBeGreaterThan(0);

    // Legendary tier (>=1000 pts): 32 particles, prominent ripple and star particles
    const legAnim = new ScoreCalculationAnimator();
    legAnim.start(createMockEvaluation(1200, 98, 2.0), 100, 100);
    const legState = legAnim.update(performance.now() + 1400);
    expect(legState.particles.length).toBe(32);
    expect(legState.rippleRadius).toBeGreaterThan(highState.rippleRadius);
    expect(legState.particles.some((p) => p.shape === 'star')).toBe(true);
  });

  it('should scale tracer duration proportionally with curve path length at constant speed', () => {
    const animatorShort = new ScoreCalculationAnimator();
    const shortEval = createMockEvaluation(400, 80, 1.0);
    animatorShort.start(shortEval, 100, 100);

    const animatorLong = new ScoreCalculationAnimator();
    const longEval = createMockEvaluation(800, 80, 3.5);
    animatorLong.start(longEval, 100, 100);

    // Constant speed means long curves take strictly more time to trace than short curves
    expect(animatorShort.getTracerDuration()).toBeLessThan(animatorLong.getTracerDuration());
    expect(animatorLong.getTracerDuration()).toBeGreaterThan(animatorShort.getTracerDuration() * 2.5);

    // Test with actual point deviations
    const deviationsShort = [
      { point: { x: 0, y: 0 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
      { point: { x: 350, y: 0 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
    ];
    const deviationsLong = [
      { point: { x: 0, y: 0 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
      { point: { x: 950, y: 0 }, distance: 0, normalizedError: 0, hue: 120, color: 'green' },
    ];

    const shortWithDevs: StrokeEvaluation = {
      ...shortEval,
      deviations: deviationsShort,
    };
    const longWithDevs: StrokeEvaluation = {
      ...longEval,
      deviations: deviationsLong,
    };

    animatorShort.start(shortWithDevs, 100, 100);
    animatorLong.start(longWithDevs, 100, 100);

    expect(animatorShort.getTracerDuration()).toBeCloseTo((350 / 950) * 1000, 0);
    expect(animatorLong.getTracerDuration()).toBeCloseTo((950 / 950) * 1000, 0);
    expect(animatorShort.getTracerDuration()).toBeLessThan(animatorLong.getTracerDuration());
  });

  it('should reset properly when interrupted', () => {
    const animator = new ScoreCalculationAnimator();
    animator.start(createMockEvaluation(850, 90, 2.0), 100, 100);
    animator.update(performance.now() + 1400);
    expect(animator.isActive()).toBe(true);

    animator.reset();
    expect(animator.isActive()).toBe(false);
    const state = animator.update(performance.now());
    expect(state.isActive).toBe(false);
    expect(state.particles.length).toBe(0);
  });
});

