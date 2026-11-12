import type { StrokeEvaluation } from '../model/types';
import type { ShareCardSnapshot } from './ShareCardGenerator';

export const waveEvaluation: StrokeEvaluation = {
  score: 1840,
  accuracy: 94.6,
  rmse: 2.3,
  meanDeviation: 1.9,
  maxDeviation: 5.2,
  deviations: [
    {
      point: { x: 100, y: 300 },
      distance: 1.0,
      normalizedError: 0.03,
      hue: 118,
      color: 'hsl(118, 90%, 56%)',
    },
    {
      point: { x: 150, y: 240 },
      distance: 1.8,
      normalizedError: 0.06,
      hue: 110,
      color: 'hsl(110, 90%, 56%)',
    },
    {
      point: { x: 200, y: 300 },
      distance: 2.2,
      normalizedError: 0.08,
      hue: 102,
      color: 'hsl(102, 90%, 56%)',
    },
  ],
  fittedSine: {
    amplitude: 60,
    frequency: 0.04,
    phase: 0,
    offset: 300,
    period: 157,
    fullCycles: 1.8,
    r2: 0.96,
    tilt: { angle: 0, centroid: { x: 150, y: 300 } },
  },
};

export const drawnWave: ShareCardSnapshot = {
  stroke: { points: waveEvaluation.deviations.map(d => d.point), evaluation: waveEvaluation },
  url: 'https://perfect-sine.test/',
};
