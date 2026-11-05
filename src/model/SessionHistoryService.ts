export interface AttemptRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly score: number;
  readonly accuracy: number;
  readonly cycles: number;
  readonly r2: number;
  readonly amplitude: number;
  readonly strategyId?: string;
}

export interface SessionSummary {
  readonly totalAttempts: number;
  readonly highscore: number;
  readonly latestScore: number;
  readonly averageScore: number;
  readonly averageAccuracy: number;
  readonly bestAccuracy: number;
  readonly standardDeviation: number;
  readonly consistencyScore: number;
  readonly totalCyclesDrawn: number;
  readonly streakCount: number;
}

export interface IStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * In-memory fallback adapter when localStorage is unavailable.
 */
export class MemoryStorageAdapter implements IStorageAdapter {
  private data = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  public removeItem(key: string): void {
    this.data.delete(key);
  }
}

/**
 * SessionHistoryService
 * Manages player session statistics, attempt history, and persistence.
 * Zero DOM dependency for headless verification.
 */
export class SessionHistoryService {
  private static readonly STORAGE_KEY = 'perfect_sine_session_history_v1';
  private attempts: AttemptRecord[] = [];
  private readonly storage: IStorageAdapter;
  private readonly listeners = new Set<(summary: SessionSummary) => void>();

  constructor(storageAdapter?: IStorageAdapter) {
    this.storage = storageAdapter ?? this.createDefaultStorage();
    this.loadFromStorage();
  }

  private createDefaultStorage(): IStorageAdapter {
    if (typeof window !== 'undefined' && window.localStorage) {
      return {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
        removeItem: (k) => window.localStorage.removeItem(k),
      };
    }
    return new MemoryStorageAdapter();
  }

  private loadFromStorage(): void {
    try {
      const raw = this.storage.getItem(SessionHistoryService.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.attempts = parsed;
        }
      }
    } catch {
      this.attempts = [];
    }
  }

  private saveToStorage(): void {
    try {
      this.storage.setItem(SessionHistoryService.STORAGE_KEY, JSON.stringify(this.attempts));
    } catch {
      // quota or security error ignored gracefully
    }
  }

  public addAttempt(
    data: Omit<AttemptRecord, 'id' | 'timestamp'> & { timestamp?: number }
  ): AttemptRecord {
    const record: AttemptRecord = {
      id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: data.timestamp ?? Date.now(),
      score: Math.round(data.score),
      accuracy: Math.round(data.accuracy * 10) / 10,
      cycles: Math.round(data.cycles * 10) / 10,
      r2: Math.round(data.r2 * 100) / 100,
      amplitude: Math.round(data.amplitude * 10) / 10,
      strategyId: data.strategyId,
    };

    this.attempts.push(record);
    this.saveToStorage();
    this.notifyListeners();
    return record;
  }

  public getAttempts(): readonly AttemptRecord[] {
    return this.attempts;
  }

  public getHighscore(): number {
    if (this.attempts.length === 0) return 0;
    return this.attempts.reduce((max, a) => Math.max(max, a.score), 0);
  }

  public getSummary(): SessionSummary {
    const n = this.attempts.length;
    if (n === 0) {
      return {
        totalAttempts: 0,
        highscore: 0,
        latestScore: 0,
        averageScore: 0,
        averageAccuracy: 0,
        bestAccuracy: 0,
        standardDeviation: 0,
        consistencyScore: 100,
        totalCyclesDrawn: 0,
        streakCount: 0,
      };
    }

    let sumScore = 0;
    let sumAccuracy = 0;
    let highscore = 0;
    let bestAccuracy = 0;
    let totalCycles = 0;

    for (const att of this.attempts) {
      sumScore += att.score;
      sumAccuracy += att.accuracy;
      if (att.score > highscore) highscore = att.score;
      if (att.accuracy > bestAccuracy) bestAccuracy = att.accuracy;
      totalCycles += att.cycles;
    }

    const averageScore = Math.round(sumScore / n);
    const averageAccuracy = Math.round((sumAccuracy / n) * 10) / 10;

    // Population standard deviation of accuracy: sqrt(sum((acc - mean)^2) / n)
    let varianceSum = 0;
    for (const att of this.attempts) {
      const diff = att.accuracy - averageAccuracy;
      varianceSum += diff * diff;
    }
    const standardDeviation = Math.round(Math.sqrt(varianceSum / n) * 10) / 10;
    const consistencyScore = Math.max(0, Math.min(100, Math.round(100 - standardDeviation * 2.5)));

    // Active streak: consecutive attempts with accuracy >= 80% from the end
    let streakCount = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (this.attempts[i].accuracy >= 80) {
        streakCount++;
      } else {
        break;
      }
    }

    return {
      totalAttempts: n,
      highscore,
      latestScore: this.attempts[n - 1].score,
      averageScore,
      averageAccuracy,
      bestAccuracy,
      standardDeviation,
      consistencyScore,
      totalCyclesDrawn: Math.round(totalCycles * 10) / 10,
      streakCount,
    };
  }

  public clear(): void {
    this.attempts = [];
    try {
      this.storage.removeItem(SessionHistoryService.STORAGE_KEY);
    } catch {
      // safe fallback
    }
    this.notifyListeners();
  }

  public subscribe(listener: (summary: SessionSummary) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const summary = this.getSummary();
    this.listeners.forEach((listener) => {
      try {
        listener(summary);
      } catch {
        // ignore subscriber errors
      }
    });
  }
}
