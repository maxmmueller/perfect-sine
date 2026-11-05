export interface Point {
  readonly x: number;
  readonly y: number;
  readonly time?: number;
}

export interface BoundingBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface TiltResult {
  readonly angle: number;
  readonly centroid: Point;
}

export interface PeriodValidationResult {
  readonly isValid: boolean;
  readonly fullCycles: number;
  readonly totalSpan: number;
  readonly zeroCrossingsCount: number;
  readonly message?: string;
}

export interface FittedSine {
  readonly amplitude: number;
  readonly frequency: number;
  readonly phase: number;
  readonly offset: number;
  readonly tilt: TiltResult;
  readonly period: number;
  readonly fullCycles: number;
  readonly r2: number;
}

export type GameState = 'IDLE' | 'DRAWING' | 'EVALUATING' | 'LOCKED';

export type StateChangeListener = (newState: GameState, oldState: GameState) => void;
export type StrokeChangeListener = (points: readonly Point[]) => void;
