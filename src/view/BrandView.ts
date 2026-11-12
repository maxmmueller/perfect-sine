import geometry from './brandGeometry.json';

export type BrandVariant = 'full' | 'mark';
const stops: ReadonlyArray<readonly [number, string]> = [
  [0, '#e45c5c'], [0.12, '#dcba49'], [0.28, '#39b965'],
  [0.72, '#39b965'], [0.88, '#dcba49'], [1, '#e45c5c'],
];

function spec(variant: BrandVariant) {
  return variant === 'full'
    ? { box: [40, 32, 240, 108], path: geometry.wave, start: 53, end: 267, stroke: 5, opacity: 0.82 }
    : { box: [0, 0, 64, 64], path: geometry.mark, start: 6, end: 58, stroke: 5, opacity: 1 };
}

/** Outlined lettering keeps the same logo in the DOM, exports and small icons. */
export function createBrandSvg(variant: BrandVariant, ink = 'currentColor', id = 'brand-wave'): string {
  const s = spec(variant);
  const gradient = stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('');
  const lettering = variant === 'full'
    ? geometry.lettering.map(d => `<path d="${d}" fill="${ink}"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.box.join(' ')}" role="img" aria-label="Perfect Sine" focusable="false"><defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${s.start}" y1="0" x2="${s.end}" y2="0">${gradient}</linearGradient></defs><path d="${s.path}" fill="none" stroke="url(#${id})" stroke-width="${s.stroke}" stroke-linecap="round" stroke-linejoin="round" opacity="${s.opacity}"/>${lettering}</svg>`;
}

export function mountBrandLogos(): void {
  document.querySelectorAll<HTMLElement>('[data-brand]').forEach((element, index) => {
    const variant = element.dataset.brand === 'mark' ? 'mark' : 'full';
    element.innerHTML = createBrandSvg(variant, 'currentColor', `brand-wave-${index}`);
  });
}

/** Synchronous vector drawing makes the very first PNG/clipboard export complete. */
export function drawBrandLogo(
  ctx: CanvasRenderingContext2D, variant: BrandVariant,
  x: number, y: number, width: number, ink: string
): void {
  const s = spec(variant);
  const [bx, by, bw] = s.box;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / bw, width / bw);
  ctx.translate(-bx, -by);
  const gradient = ctx.createLinearGradient(s.start, 0, s.end, 0);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.strokeStyle = gradient;
  ctx.lineWidth = s.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = s.opacity;
  ctx.stroke(new Path2D(s.path));
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  if (variant === 'full') geometry.lettering.forEach(d => ctx.fill(new Path2D(d)));
  ctx.restore();
}
