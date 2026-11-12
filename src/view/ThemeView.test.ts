import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNotebookPalette } from './ThemeView';

afterEach(() => vi.unstubAllGlobals());

describe('fixed dark notebook appearance', () => {
  it.each(['light', 'dark', null])('ignores the legacy saved theme %s and a light system preference', (saved) => {
    const storage = { getItem: vi.fn(() => saved) };
    const matchMedia = vi.fn(() => ({ matches: false }));
    vi.stubGlobal('document', { documentElement: { dataset: { theme: saved } } });
    vi.stubGlobal('window', { localStorage: storage, matchMedia });
    const palette = getNotebookPalette();
    expect(palette.paper).toBe('#1c252c');
    expect(palette.ink).toBe('#a4c4ef');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('uses the same dark colors without browser globals for offscreen rendering tests', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    expect(getNotebookPalette().paper).toBe('#1c252c');
    expect(Object.isFrozen(getNotebookPalette())).toBe(true);
  });
});
