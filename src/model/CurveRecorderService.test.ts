import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurveRecorderService } from './CurveRecorderService';
import { StrokeEvaluation, Point } from './types';

describe('CurveRecorderService', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    });
  });

  const createDummyPoints = (): Point[] => [
    { x: 100, y: 200, time: 0 },
    { x: 150, y: 250, time: 50 },
    { x: 200, y: 200, time: 100 },
    { x: 250, y: 150, time: 150 },
    { x: 300, y: 200, time: 200 },
  ];

  const createDummyEvaluation = (): StrokeEvaluation => ({
    accuracy: 91.5,
    score: 1650,
    rmse: 3.2,
    meanDeviation: 2.8,
    maxDeviation: 8.4,
    deviations: [],
    fittedSine: {
      amplitude: 50,
      frequency: 0.0314,
      period: 200,
      phase: 0,
      offset: 0,
      fullCycles: 2.5,
      r2: 0.945,
      tilt: { angle: 0.04, centroid: { x: 200, y: 200 } },
    },
  });

  it('should initialize cleanly with empty state or storage', () => {
    const service = new CurveRecorderService();
    expect(service.getCurves().length).toBe(0);
    expect(service.isAutoRecordEnabled()).toBe(true);
  });

  it('should add a curve and compute metrics when evaluation is present', () => {
    const service = new CurveRecorderService();
    const points = createDummyPoints();
    const evaluation = createDummyEvaluation();

    const curve = service.addCurve({
      label: 'Human Pristine Wave',
      points,
      evaluation,
    });

    expect(curve.id).toBeDefined();
    expect(curve.label).toBe('Human Pristine Wave');
    expect(curve.points.length).toBe(5);
    expect(curve.metrics).not.toBeNull();
    expect(curve.metrics?.score).toBe(1650);
    expect(curve.metrics?.accuracy).toBe(91.5);
    expect(curve.metrics?.fullCycles).toBe(2.5);
    expect(curve.metrics?.r2).toBe(0.945);

    expect(service.getCurves().length).toBe(1);
    expect(service.getCurveById(curve.id)).toEqual(curve);
  });

  it('should add a curve without evaluation and store validation message', () => {
    const service = new CurveRecorderService();
    const points = createDummyPoints();

    const curve = service.addCurve({
      points,
      validationMessage: 'Wave amplitude is too small',
    });

    expect(curve.metrics).toBeNull();
    expect(curve.validationMessage).toBe('Wave amplitude is too small');
    expect(curve.label).toContain('Attempt');
  });

  it('should throw an error when attempting to record an empty stroke', () => {
    const service = new CurveRecorderService();
    expect(() => service.addCurve({ points: [] })).toThrow('empty stroke');
  });

  it('should update curve label and notify listeners', () => {
    const service = new CurveRecorderService();
    const curve = service.addCurve({ points: createDummyPoints() });

    let listenerCallCount = 0;
    service.subscribe(() => {
      listenerCallCount++;
    });

    const success = service.updateLabel(curve.id, 'Renamed Crest Overshoot');
    expect(success).toBe(true);
    expect(service.getCurveById(curve.id)?.label).toBe('Renamed Crest Overshoot');
    expect(listenerCallCount).toBe(1);

    expect(service.updateLabel('non_existent', 'Test')).toBe(false);
  });

  it('should delete a curve and clear all curves cleanly', () => {
    const service = new CurveRecorderService();
    const c1 = service.addCurve({ points: createDummyPoints(), label: 'Curve 1' });
    service.addCurve({ points: createDummyPoints(), label: 'Curve 2' });

    expect(service.getCurves().length).toBe(2);

    expect(service.deleteCurve(c1.id)).toBe(true);
    expect(service.getCurves().length).toBe(1);
    expect(service.getCurveById(c1.id)).toBeUndefined();
    expect(service.deleteCurve('non_existent')).toBe(false);

    service.clearAll();
    expect(service.getCurves().length).toBe(0);
  });

  it('should toggle auto-record preference and persist to storage', () => {
    const service = new CurveRecorderService();
    expect(service.isAutoRecordEnabled()).toBe(true);

    service.setAutoRecordEnabled(false);
    expect(service.isAutoRecordEnabled()).toBe(false);
    expect(mockStorage['perfect_sine_auto_record_v1']).toBe('false');

    const service2 = new CurveRecorderService();
    expect(service2.isAutoRecordEnabled()).toBe(false);
  });

  it('should export curves as JSON and import them back cleanly', () => {
    const service = new CurveRecorderService();
    service.addCurve({
      label: 'Sample 1',
      points: createDummyPoints(),
      evaluation: createDummyEvaluation(),
    });
    service.addCurve({
      label: 'Sample 2',
      points: createDummyPoints(),
    });

    const exportedJson = service.exportAsJson();
    expect(exportedJson).toContain('"version": "1.0.0"');
    expect(exportedJson).toContain('"Sample 1"');
    expect(exportedJson).toContain('"Sample 2"');

    // Create a new fresh service and import
    const newService = new CurveRecorderService([]);
    expect(newService.getCurves().length).toBe(0);

    const result = newService.importFromJson(exportedJson);
    expect(result.imported).toBe(2);
    expect(result.errors.length).toBe(0);
    expect(newService.getCurves().length).toBe(2);
  });

  it('should handle malformed JSON during import gracefully', () => {
    const service = new CurveRecorderService();
    const result = service.importFromJson('not-valid-json');
    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('JSON Parse Error');
  });

  it('should persist recorded curves across service instances via localStorage', () => {
    const service1 = new CurveRecorderService();
    service1.addCurve({
      label: 'Persistent Curve',
      points: createDummyPoints(),
      evaluation: createDummyEvaluation(),
    });

    const service2 = new CurveRecorderService();
    expect(service2.getCurves().length).toBe(1);
    expect(service2.getCurves()[0].label).toBe('Persistent Curve');
  });
});
