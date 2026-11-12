import type { PointDeviation } from '../model/types';

/** Preserve the exact on-canvas colors, interpolation and end caps in every output. */
export function drawGradientStroke(
  ctx: CanvasRenderingContext2D,
  deviations: readonly PointDeviation[],
  lineWidth: number
): void {
  if (deviations.length < 2) return;
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 0;

  const cap = (deviation: PointDeviation) => {
    ctx.fillStyle = deviation.color;
    ctx.beginPath();
    ctx.arc(deviation.point.x, deviation.point.y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  cap(deviations[0]);
  for (let i = 1; i < deviations.length; i++) {
    const start = deviations[i - 1];
    const end = deviations[i];
    const gradient = ctx.createLinearGradient(start.point.x, start.point.y, end.point.x, end.point.y);
    gradient.addColorStop(0, start.color);
    gradient.addColorStop(1, end.color);
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(start.point.x, start.point.y);
    ctx.lineTo(end.point.x, end.point.y);
    ctx.stroke();
  }
  cap(deviations[deviations.length - 1]);
  ctx.restore();
}
