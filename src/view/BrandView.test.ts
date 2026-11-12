import darkLogo from '../../public/brand/perfect-sine-dark.svg?raw';
import smallLogo from '../../public/brand/sine-mark.svg?raw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrandSvg, mountBrandLogos } from './BrandView';
import geometry from './brandGeometry.json';

afterEach(() => vi.unstubAllGlobals());

describe('shared brand assets', () => {
  it.each([
    ['perfect-sine-dark.svg', 'full', '#a4c4ef', darkLogo],
    ['sine-mark.svg', 'mark', 'currentColor', smallLogo],
  ] as const)('keeps the exported %s identical to the runtime artwork', (_file, variant, ink, exported) => {
    expect(exported).toBe(createBrandSvg(variant, ink));
  });

  it('keeps the small mark free of lettering and external font dependencies', () => {
    const mark = createBrandSvg('mark');
    expect(mark).toContain('viewBox="0 0 64 64"');
    expect(mark).toContain(geometry.mark);
    geometry.lettering.forEach(path => expect(mark).not.toContain(path));
    expect(mark).not.toMatch(/<text|@font-face|href=/);
  });

  it('mounts matching full logos with independent gradient references', () => {
    const elements = [
      { dataset: { brand: 'full' }, innerHTML: '' },
      { dataset: { brand: 'full' }, innerHTML: '' },
      { dataset: { brand: 'mark' }, innerHTML: '' },
    ];
    vi.stubGlobal('document', { querySelectorAll: () => elements });
    mountBrandLogos();
    elements.forEach((element, index) => {
      expect(element.innerHTML).toContain(`id="brand-wave-${index}"`);
      expect(element.innerHTML).toContain(`url(#brand-wave-${index})`);
    });
    expect(elements[0].innerHTML.replaceAll('brand-wave-0', 'gradient'))
      .toBe(elements[1].innerHTML.replaceAll('brand-wave-1', 'gradient'));
  });
});
