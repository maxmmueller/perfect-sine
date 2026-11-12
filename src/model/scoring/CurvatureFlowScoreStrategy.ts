import { Point, FittedSine, StrokeEvaluation, PointDeviation } from '../types';
import { TiltDetector } from '../TiltDetector';
import { DeviationCalculator } from '../DeviationCalculator';
import { IScoreStrategy } from './IScoreStrategy';

/**
 * Scorer 4 (Tangent Direction & Curvature Flow Alignment)
 * Evaluates drawing smoothness and velocity vectors by comparing the cosine similarity
 * of the drawn trajectory's tangent vectors with the true mathematical sine curve derivative.
 */
export class CurvatureFlowScoreStrategy implements IScoreStrategy {
  public readonly id = 'curvature_flow';
  public readonly name = 'Tangent Velocity & Curvature Flow';
  public readonly description =
    'Rates drawing smoothness and direction flow by measuring tangent vector cosine similarity.';

  public evaluate(
    points: readonly Point[],
    fit: FittedSine,
    maxTolerance: number = 30,
    baseScoreScale: number = 1000
  ): StrokeEvaluation {
    if (points.length < 2) {
      return {
        fittedSine: fit,
        deviations: [],
        meanDeviation: 0,
        maxDeviation: 0,
        rmse: 0,
        accuracy: 0,
        score: 0,
        scaleMultiplier: 0,
      };
    }

    const aligned = TiltDetector.transformPoints(points, fit.tilt);
    const deviations: PointDeviation[] = [];

    let sumDist = 0;
    let sumSqDist = 0;
    let maxDist = 0;
    let sumCosineSim = 0;

    const { amplitude: a, frequency: omega, phase: phi } = fit;

    for (let i = 0; i < points.length; i++) {
      const orig = points[i];
      const al = aligned[i];
      const dist = DeviationCalculator.calculateOrthogonalDistance(al.x, al.y, fit);

      if (dist > maxDist) maxDist = dist;
      sumDist += dist;
      sumSqDist += dist * dist;

      // Calculate tangent vector of drawn stroke
      let dx = 1;
      let dy = 0;
      if (i < points.length - 1) {
        dx = aligned[i + 1].x - al.x;
        dy = aligned[i + 1].y - al.y;
      } else if (i > 0) {
        dx = al.x - aligned[i - 1].x;
        dy = al.y - aligned[i - 1].y;
      }
      const drawnLen = Math.hypot(dx, dy) || 1;
      const tDrawnX = dx / drawnLen;
      const tDrawnY = dy / drawnLen;

      // Calculate theoretical tangent of reference sine: dy/dx = a * omega * cos(omega * x + phi)
      const slope = a * omega * Math.cos(omega * al.x + phi);
      const refLen = Math.hypot(1, slope);
      const tRefX = 1 / refLen;
      const tRefY = slope / refLen;

      // Cosine similarity between drawn and reference tangent direction
      const cosSim = Math.max(-1, Math.min(1, tDrawnX * tRefX + tDrawnY * tRefY));
      sumCosineSim += Math.max(0, cosSim);

      const { hue, normalizedError, color } = DeviationCalculator.mapDistanceToColor(dist, maxTolerance);
      deviations.push({
        point: orig,
        distance: dist,
        normalizedError,
        hue,
        color,
      });
    }

    const meanDeviation = sumDist / points.length;
    const rmse = Math.sqrt(sumSqDist / points.length);
    const meanCosineSim = sumCosineSim / points.length;

    // Composite: 50% distance accuracy, 35% tangent curvature alignment, 15% R²
    const distAccuracy = Math.max(0, 1 - rmse / maxTolerance);
    const scoreNorm = 0.5 * distAccuracy + 0.35 * meanCosineSim + 0.15 * fit.r2;
    const accuracy = Math.round(Math.max(0, Math.min(100, scoreNorm * 100)));

    const { score, scaleMultiplier } = DeviationCalculator.calculateFinalScore(
      accuracy,
      fit,
      baseScoreScale
    );

    return {
      fittedSine: fit,
      deviations,
      meanDeviation,
      maxDeviation: maxDist,
      rmse,
      accuracy,
      score,
      scaleMultiplier,
    };
  }
}
