import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HudView } from './HudView';
import { ShareCardGenerator, type ShareCardSnapshot } from './ShareCardGenerator';
import { SessionHistoryService, MemoryStorageAdapter } from '../model/SessionHistoryService';
import { drawnWave } from './share.test-fixtures';

type TestEvent = {
  key?: string; code?: string; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean;
  altKey?: boolean; repeat?: boolean; target?: MockElement | { tagName?: string; isContentEditable?: boolean };
  preventDefault?: () => void; stopPropagation?: () => void;
};
class MockElement {
  textContent = ''; src = ''; alt = ''; disabled = false;
  private classes: Set<string>;
  readonly listeners: Record<string, Array<(event: TestEvent) => void>> = {};
  readonly classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
  };
  constructor(classes: string[] = []) { this.classes = new Set(classes); }
  addEventListener(type: string, listener: (event: TestEvent) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  click(event: TestEvent = { target: this, stopPropagation: () => {} }) {
    if (!this.disabled) this.listeners.click?.forEach(handler => handler(event));
  }
}

describe('HudView: sharing eligibility and current-wave actions', () => {
  let session: SessionHistoryService;
  let hud: HudView;
  let elements: Map<string, MockElement>;
  let listeners: Record<string, Array<(event: TestEvent) => void>>;
  let snapshot: ShareCardSnapshot | null;

  const element = (id: string) => elements.get(id)!;
  const emit = (type: string, event: TestEvent = {}) => listeners[type]?.forEach(handler => handler(event));
  const finishDrawing = () => { snapshot = drawnWave; hud.updateShareAvailability(); };

  beforeEach(() => {
    snapshot = null; listeners = {}; elements = new Map();
    for (const id of ['hud-current-score', 'hud-highscore', 'wrapped-btn', 'wrapped-modal',
      'modal-close-x', 'modal-share-btn', 'modal-screenshot-btn', 'modal-copy-btn',
      'modal-share-status', 'modal-share-preview', 'modal-share-preview-wrap']) {
      elements.set(id, new MockElement(id === 'wrapped-modal' || id === 'modal-share-preview-wrap' ? ['hidden'] : []));
    }
    vi.stubGlobal('document', { getElementById: (id: string) => elements.get(id) ?? null });
    vi.stubGlobal('window', {
      location: { href: 'https://perfect-sine.test/' },
      addEventListener: (type: string, callback: (event: TestEvent) => void) => { (listeners[type] ??= []).push(callback); },
    });
    vi.spyOn(ShareCardGenerator, 'toDataUrl').mockReturnValue('data:image/png;base64,currentWave');
    session = new SessionHistoryService(new MemoryStorageAdapter());
    hud = new HudView(session, { getWaveSnapshot: () => snapshot });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('disables sharing on idle even when session history contains earlier attempts', () => {
    session.addAttempt({ score: 9000, accuracy: 99, cycles: 8, r2: .99, amplitude: 70 });
    expect(element('hud-highscore').textContent).toBe('9,000 pts');
    expect(element('wrapped-btn').disabled).toBe(true);
    element('wrapped-btn').click(); hud.openModal();
    expect(hud.isModalOpen()).toBe(false);
    expect(ShareCardGenerator.toDataUrl).not.toHaveBeenCalled();
  });

  it('blocks S, screenshot shortcuts, keyup and beforeprint without an own completed drawing', () => {
    for (const event of [{ key: 's' }, { key: 'PrintScreen' }, { key: 'S', ctrlKey: true, shiftKey: true },
      { key: '4', code: 'Digit4', metaKey: true, shiftKey: true }]) emit('keydown', event);
    emit('keyup', { key: 'PrintScreen' }); emit('beforeprint');
    expect(hud.isModalOpen()).toBe(false);
    expect(ShareCardGenerator.toDataUrl).not.toHaveBeenCalled();
  });

  it('guards direct export handlers as well as the disabled button', async () => {
    const share = vi.spyOn(ShareCardGenerator, 'share');
    const copy = vi.spyOn(ShareCardGenerator, 'copyShareCard');
    const download = vi.spyOn(ShareCardGenerator, 'downloadShareCard');
    await hud.handleShare(); await hud.handleCopy(); hud.handleDownloadScreenshot();
    expect(share).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });

  it('enables sharing only after a drawing and previews precisely that snapshot', () => {
    finishDrawing(); expect(element('wrapped-btn').disabled).toBe(false);
    element('wrapped-btn').click();
    expect(hud.isModalOpen()).toBe(true);
    expect(ShareCardGenerator.toDataUrl).toHaveBeenCalledWith(drawnWave);
    expect(element('modal-share-preview').src).toBe('data:image/png;base64,currentWave');
    expect(element('modal-share-preview').alt).toContain('94.6%');
  });

  it('disables sharing and closes a stale dialog when the current drawing is cleared or a new one begins', () => {
    finishDrawing(); hud.openModal(); snapshot = null; hud.updateShareAvailability();
    expect(element('wrapped-btn').disabled).toBe(true);
    expect(hud.isModalOpen()).toBe(false);
    emit('keydown', { key: 's' }); expect(hud.isModalOpen()).toBe(false);
  });

  it('does not make a single-point click shareable', () => {
    snapshot = { stroke: { points: [{ x: 10, y: 10 }], evaluation: null } };
    hud.updateShareAvailability(); hud.openModal();
    expect(element('wrapped-btn').disabled).toBe(true);
    expect(hud.isModalOpen()).toBe(false);
  });

  it('can share an invalid completed attempt with its validation message', () => {
    snapshot = { stroke: { points: [{ x: 10, y: 10 }, { x: 50, y: 10 }], evaluation: null, validationMessage: 'Sine Wave Too Flat' } };
    hud.updateShareAvailability(); element('wrapped-btn').click();
    expect(hud.isModalOpen()).toBe(true);
    expect(ShareCardGenerator.toDataUrl).toHaveBeenCalledWith(expect.objectContaining({ stroke: snapshot.stroke }));
  });

  it('keeps normal shortcut behavior once a completed drawing exists', () => {
    finishDrawing();
    for (const event of [{ key: 'PrintScreen' }, { key: 'S', ctrlKey: true, shiftKey: true },
      { key: '4', code: 'Digit4', metaKey: true, shiftKey: true }]) {
      emit('keydown', event); expect(hud.isModalOpen()).toBe(true); hud.closeModal();
    }
    emit('keyup', { key: 'PrintScreen' }); expect(hud.isModalOpen()).toBe(true); hud.closeModal();
    emit('beforeprint'); expect(hud.isModalOpen()).toBe(true); hud.closeModal();
    const preventDefault = vi.fn(); emit('keydown', { key: 's', preventDefault });
    expect(hud.isModalOpen()).toBe(true); expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('ignores shortcuts while editing and preserves browser Ctrl+S', () => {
    finishDrawing(); emit('keydown', { key: 's', target: { tagName: 'INPUT' } });
    emit('keydown', { key: 's', target: { isContentEditable: true } });
    emit('keydown', { key: 's', ctrlKey: true });
    expect(hud.isModalOpen()).toBe(false);
  });

  it('supports closing with X, Escape and the backdrop', () => {
    finishDrawing();
    for (const id of ['modal-close-x', 'wrapped-modal']) {
      hud.openModal(); element(id).click(); expect(hud.isModalOpen()).toBe(false);
    }
    hud.openModal(); emit('keydown', { key: 'Escape' }); expect(hud.isModalOpen()).toBe(false);
  });

  it('uses only the current snapshot for native sharing, PNG saving and clipboard copying', async () => {
    finishDrawing(); session.addAttempt({ score: 9000, accuracy: 99, cycles: 8, r2: .99, amplitude: 70 });
    const share = vi.spyOn(ShareCardGenerator, 'share').mockResolvedValue({ status: 'shared', message: 'Wave shared!' });
    const copy = vi.spyOn(ShareCardGenerator, 'copyShareCard').mockResolvedValue({ status: 'copied-image', message: 'Copied' });
    const download = vi.spyOn(ShareCardGenerator, 'downloadShareCard').mockReturnValue(true);
    hud.openModal();
    await hud.handleShare(); await hud.handleCopy(); hud.handleDownloadScreenshot();
    expect(share).toHaveBeenCalledWith(drawnWave); expect(copy).toHaveBeenCalledWith(drawnWave);
    expect(download).toHaveBeenCalledWith(drawnWave);
    expect(element('modal-share-status').textContent).toBe('Saved Share Card PNG!');
  });
});
