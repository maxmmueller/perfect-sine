import { Point, StrokeEvaluation, RecordedCurve } from './types';

export interface AddCurveInput {
  readonly label?: string;
  readonly points: readonly Point[];
  readonly evaluation?: StrokeEvaluation | null;
  readonly validationMessage?: string | null;
  readonly thumbnailDataUrl?: string;
}

export interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly errors: readonly string[];
}

/**
 * CurveRecorderService
 * Manages human-drawn curve recordings, persistence in localStorage,
 * reactive notifications, auto-recording toggles, and JSON export/import.
 */
export class CurveRecorderService {
  private static readonly STORAGE_KEY = 'perfect_sine_recorded_curves_v1';
  private static readonly AUTO_RECORD_KEY = 'perfect_sine_auto_record_v1';

  private curves: RecordedCurve[] = [];
  private autoRecordEnabled: boolean = true;
  private readonly listeners: Set<(curves: readonly RecordedCurve[]) => void> = new Set();

  constructor(initialCurves?: readonly RecordedCurve[]) {
    if (initialCurves !== undefined) {
      this.curves = [...initialCurves];
    } else {
      this.loadFromStorage();
    }
    this.loadAutoRecordPreference();
  }

  /**
   * Adds a newly drawn human curve to the recording dataset.
   */
  public addCurve(input: AddCurveInput): RecordedCurve {
    if (!input.points || input.points.length === 0) {
      throw new Error('Cannot record an empty stroke');
    }

    const timestamp = Date.now();
    const id = `curve_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;
    const defaultLabel = input.evaluation
      ? `Human Sine (${input.evaluation.accuracy.toFixed(1)}%)`
      : input.validationMessage
      ? `Attempt (${input.validationMessage.substring(0, 18)})`
      : 'Human Stroke';

    const metrics = input.evaluation
      ? {
          score: input.evaluation.score,
          accuracy: input.evaluation.accuracy,
          fullCycles: Math.round(input.evaluation.fittedSine.fullCycles * 100) / 100,
          amplitude: Math.round(input.evaluation.fittedSine.amplitude * 10) / 10,
          wavelength: Math.round(input.evaluation.fittedSine.period * 10) / 10,
          r2: Math.round(input.evaluation.fittedSine.r2 * 1000) / 1000,
          tiltAngle: Math.round(input.evaluation.fittedSine.tilt.angle * 1000) / 1000,
        }
      : null;

    const recorded: RecordedCurve = {
      id,
      timestamp,
      label: input.label?.trim() || defaultLabel,
      points: input.points.map((p) => ({
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        time: p.time !== undefined ? Math.round(p.time) : undefined,
      })),
      evaluation: input.evaluation ?? null,
      validationMessage: input.validationMessage ?? null,
      metrics,
      thumbnailDataUrl: input.thumbnailDataUrl,
    };

    // Prepend so latest curves appear first
    this.curves.unshift(recorded);
    this.saveToStorage();
    this.notify();

    return recorded;
  }

  public getCurves(): readonly RecordedCurve[] {
    return this.curves;
  }

  public getCurveById(id: string): RecordedCurve | undefined {
    return this.curves.find((c) => c.id === id);
  }

  public updateLabel(id: string, newLabel: string): boolean {
    const curve = this.curves.find((c) => c.id === id);
    if (!curve) return false;

    curve.label = newLabel.trim() || 'Untitled Curve';
    this.saveToStorage();
    this.notify();
    return true;
  }

  public deleteCurve(id: string): boolean {
    const initialLen = this.curves.length;
    this.curves = this.curves.filter((c) => c.id !== id);
    if (this.curves.length !== initialLen) {
      this.saveToStorage();
      this.notify();
      return true;
    }
    return false;
  }

  public clearAll(): void {
    this.curves = [];
    this.saveToStorage();
    this.notify();
  }

  public isAutoRecordEnabled(): boolean {
    return this.autoRecordEnabled;
  }

  public setAutoRecordEnabled(enabled: boolean): void {
    this.autoRecordEnabled = enabled;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CurveRecorderService.AUTO_RECORD_KEY, JSON.stringify(enabled));
      }
    } catch {
      // Ignore storage errors in restricted sandboxes
    }
  }

  /**
   * Serializes recorded curves into a formatted JSON string for export to Antigravity / AI.
   */
  public exportAsJson(): string {
    return JSON.stringify(
      {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        count: this.curves.length,
        curves: this.curves.map((c) => ({
          id: c.id,
          timestamp: c.timestamp,
          label: c.label,
          metrics: c.metrics,
          validationMessage: c.validationMessage,
          pointsCount: c.points.length,
          points: c.points,
          evaluation: c.evaluation
            ? {
                accuracy: c.evaluation.accuracy,
                score: c.evaluation.score,
                rmse: c.evaluation.rmse,
                fittedSine: {
                  amplitude: c.evaluation.fittedSine.amplitude,
                  frequency: c.evaluation.fittedSine.frequency,
                  phase: c.evaluation.fittedSine.phase,
                  offset: c.evaluation.fittedSine.offset,
                  period: c.evaluation.fittedSine.period,
                  fullCycles: c.evaluation.fittedSine.fullCycles,
                  r2: c.evaluation.fittedSine.r2,
                  tilt: c.evaluation.fittedSine.tilt,
                },
              }
            : null,
        })),
      },
      null,
      2
    );
  }

  /**
   * Imports curves from a JSON string, handling both full export schemas and plain arrays of points.
   */
  public importFromJson(jsonStr: string): ImportResult {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      const parsed = JSON.parse(jsonStr);
      const candidates: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.curves)
        ? parsed.curves
        : [parsed];

      for (const item of candidates) {
        if (!item || typeof item !== 'object') {
          skipped++;
          continue;
        }

        const raw = item as Record<string, unknown>;
        let rawPoints = raw.points;

        // Fallback: if raw is itself an array of points
        if (!rawPoints && Array.isArray(raw) && raw.length > 0 && typeof (raw[0] as Point)?.x === 'number') {
          rawPoints = raw;
        }

        if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
          skipped++;
          errors.push(`Skipped invalid curve candidate: insufficient or missing points`);
          continue;
        }

        const validPoints: Point[] = [];
        for (const pt of rawPoints) {
          if (pt && typeof (pt as Point).x === 'number' && typeof (pt as Point).y === 'number') {
            validPoints.push({
              x: (pt as Point).x,
              y: (pt as Point).y,
              time: typeof (pt as Point).time === 'number' ? (pt as Point).time : undefined,
            });
          }
        }

        if (validPoints.length < 2) {
          skipped++;
          continue;
        }

        const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim() : 'Imported Human Curve';
        const evaluation = (raw.evaluation as StrokeEvaluation) || null;
        const validationMessage = typeof raw.validationMessage === 'string' ? raw.validationMessage : null;

        this.addCurve({
          label,
          points: validPoints,
          evaluation,
          validationMessage,
        });
        imported++;
      }
    } catch (err) {
      errors.push(`JSON Parse Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { imported, skipped, errors };
  }

  public subscribe(listener: (curves: readonly RecordedCurve[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = [...this.curves];
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[CurveRecorderService] Listener error:', err);
      }
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      // Store curves without large base64 thumbnails to avoid hitting quota limits
      const compactCurves = this.curves.map((c) => ({
        ...c,
        thumbnailDataUrl: undefined,
      }));
      localStorage.setItem(CurveRecorderService.STORAGE_KEY, JSON.stringify(compactCurves));
    } catch (err) {
      console.warn('[CurveRecorderService] Unable to save to localStorage:', err);
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(CurveRecorderService.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.curves = parsed;
      }
    } catch (err) {
      console.warn('[CurveRecorderService] Unable to load from localStorage:', err);
      this.curves = [];
    }
  }

  private loadAutoRecordPreference(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(CurveRecorderService.AUTO_RECORD_KEY);
      if (raw !== null) {
        this.autoRecordEnabled = JSON.parse(raw) === true;
      }
    } catch {
      this.autoRecordEnabled = true;
    }
  }
}
