import { describe, it, expect, vi } from 'vitest';
import {
  SessionHistoryService,
  MemoryStorageAdapter,
  IStorageAdapter,
} from './SessionHistoryService';

describe('SessionHistoryService (Statistical Verification & Persistence - Task 6.1 & 6.4)', () => {
  it('should initialize with empty history when storage is empty', () => {
    const service = new SessionHistoryService(new MemoryStorageAdapter());
    const summary = service.getSummary();

    expect(summary.totalAttempts).toBe(0);
    expect(summary.highscore).toBe(0);
    expect(summary.latestScore).toBe(0);
    expect(summary.averageScore).toBe(0);
    expect(summary.averageAccuracy).toBe(0);
    expect(summary.consistencyScore).toBe(100);
    expect(service.getAttempts()).toHaveLength(0);
  });

  it('should restore previous attempts from storage', () => {
    const storage = new MemoryStorageAdapter();
    storage.setItem(
      'perfect_sine_session_history_v1',
      JSON.stringify([
        {
          id: 'att_1',
          timestamp: 1000,
          score: 850,
          accuracy: 92,
          cycles: 1.5,
          r2: 0.96,
          amplitude: 45,
        },
      ])
    );

    const service = new SessionHistoryService(storage);
    expect(service.getAttempts()).toHaveLength(1);
    expect(service.getHighscore()).toBe(850);
  });

  it('should recover gracefully when storage contains corrupted JSON', () => {
    const storage = new MemoryStorageAdapter();
    storage.setItem('perfect_sine_session_history_v1', '{corrupt json');

    const service = new SessionHistoryService(storage);
    expect(service.getAttempts()).toHaveLength(0);
    expect(service.getHighscore()).toBe(0);
  });

  it('should calculate exact statistical metrics (mean, std dev, consistency, streak)', () => {
    const service = new SessionHistoryService(new MemoryStorageAdapter());

    // Attempt 1: accuracy 80, score 700
    service.addAttempt({
      score: 700,
      accuracy: 80,
      cycles: 1.0,
      r2: 0.90,
      amplitude: 40,
    });

    // Attempt 2: accuracy 90, score 900
    service.addAttempt({
      score: 900,
      accuracy: 90,
      cycles: 2.0,
      r2: 0.95,
      amplitude: 50,
    });

    // Attempt 3: accuracy 100, score 1000
    service.addAttempt({
      score: 1000,
      accuracy: 100,
      cycles: 1.5,
      r2: 0.99,
      amplitude: 60,
    });

    const summary = service.getSummary();

    // 1. Total attempts
    expect(summary.totalAttempts).toBe(3);

    // 2. Highscore & Latest
    expect(summary.highscore).toBe(1000);
    expect(summary.latestScore).toBe(1000);

    // 3. Averages:
    // avgScore = (700 + 900 + 1000) / 3 = 866.666... => 867
    expect(summary.averageScore).toBe(867);
    // avgAccuracy = (80 + 90 + 100) / 3 = 90.0
    expect(summary.averageAccuracy).toBe(90);
    expect(summary.bestAccuracy).toBe(100);

    // 4. Standard Deviation:
    // variances = (80-90)^2 + (90-90)^2 + (100-90)^2 = 100 + 0 + 100 = 200
    // population variance = 200 / 3 = 66.666...
    // stdDev = sqrt(66.666...) ≈ 8.16 => 8.2
    expect(summary.standardDeviation).toBe(8.2);

    // 5. Consistency score = 100 - (8.2 * 2.5) = 100 - 20.5 = 80
    expect(summary.consistencyScore).toBe(80);

    // 6. Total cycles = 1.0 + 2.0 + 1.5 = 4.5
    expect(summary.totalCyclesDrawn).toBe(4.5);

    // 7. Streak count: all 3 attempts have accuracy >= 80% => streak = 3
    expect(summary.streakCount).toBe(3);

    // 8. Persona
    expect(summary.persona.title).toBe('Rhythmic Wave Rider');
  });

  it('should categorize player personas across all score tiers', () => {
    expect(SessionHistoryService.calculatePersona(90, 95).title).toBe('Laser Harmonic Synthesizer');
    expect(SessionHistoryService.calculatePersona(75, 85).title).toBe('Rhythmic Wave Rider');
    expect(SessionHistoryService.calculatePersona(50, 70).title).toBe('Analog Freehander');
    expect(SessionHistoryService.calculatePersona(30, 40).title).toBe('Chaos Oscillator');
  });

  it('should reset streak count when recent attempt accuracy falls below 80%', () => {
    const service = new SessionHistoryService(new MemoryStorageAdapter());

    service.addAttempt({ score: 900, accuracy: 95, cycles: 1.0, r2: 0.9, amplitude: 40 });
    service.addAttempt({ score: 900, accuracy: 85, cycles: 1.0, r2: 0.9, amplitude: 40 });
    expect(service.getSummary().streakCount).toBe(2);

    // Streak broken by low accuracy attempt
    service.addAttempt({ score: 300, accuracy: 65, cycles: 1.0, r2: 0.5, amplitude: 40 });
    expect(service.getSummary().streakCount).toBe(0);

    // New streak begins
    service.addAttempt({ score: 850, accuracy: 88, cycles: 1.0, r2: 0.9, amplitude: 40 });
    expect(service.getSummary().streakCount).toBe(1);
  });

  it('should clear all session records and notify subscribers', () => {
    const service = new SessionHistoryService(new MemoryStorageAdapter());
    const listener = vi.fn();
    service.subscribe(listener);

    service.addAttempt({ score: 800, accuracy: 85, cycles: 1.0, r2: 0.9, amplitude: 40 });
    expect(service.getAttempts()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    service.clear();
    expect(service.getAttempts()).toHaveLength(0);
    expect(service.getHighscore()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should support unsubscribing from session changes', () => {
    const service = new SessionHistoryService(new MemoryStorageAdapter());
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    service.addAttempt({ score: 800, accuracy: 85, cycles: 1.0, r2: 0.9, amplitude: 40 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    service.addAttempt({ score: 900, accuracy: 95, cycles: 1.0, r2: 0.95, amplitude: 40 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should handle throwing subscribers gracefully without breaking service', () => {
    const service = new SessionHistoryService(new MemoryStorageAdapter());
    service.subscribe(() => {
      throw new Error('Subscriber exploded');
    });

    expect(() => {
      service.addAttempt({ score: 800, accuracy: 85, cycles: 1.0, r2: 0.9, amplitude: 40 });
    }).not.toThrow();
  });

  it('should handle storage errors gracefully when writing or removing', () => {
    const failingStorage: IStorageAdapter = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    const service = new SessionHistoryService(failingStorage);
    expect(() => {
      service.addAttempt({ score: 800, accuracy: 85, cycles: 1.0, r2: 0.9, amplitude: 40 });
      service.clear();
    }).not.toThrow();
  });

  it('should instantiate using default storage adapter fallback in node environment', () => {
    const service = new SessionHistoryService();
    expect(service.getHighscore()).toBe(0);
  });

  it('should use window.localStorage when available in browser environment', () => {
    const mockStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: mockStorage });

    const service = new SessionHistoryService();
    service.addAttempt({ score: 500, accuracy: 75, cycles: 1.0, r2: 0.8, amplitude: 30 });
    expect(mockStorage.setItem).toHaveBeenCalled();
    service.clear();
    expect(mockStorage.removeItem).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
