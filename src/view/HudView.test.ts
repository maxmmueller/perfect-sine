import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HudView } from './HudView';
import { ShareCardGenerator } from './ShareCardGenerator';
import { SessionHistoryService, MemoryStorageAdapter } from '../model/SessionHistoryService';

interface MockElement {
  id: string;
  textContent: string;
  src?: string;
  classList: {
    classes: Set<string>;
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
  };
  listeners: Record<string, ((e?: any) => void)[]>;
  addEventListener: (event: string, handler: (e?: any) => void) => void;
  click: (event?: any) => void;
}

const createMockElement = (id: string, initialClasses: string[] = []): MockElement => {
  const classes = new Set<string>(initialClasses);
  const listeners: Record<string, ((e?: any) => void)[]> = {};

  const el: MockElement = {
    id,
    textContent: '',
    classList: {
      classes,
      add: (cls: string) => classes.add(cls),
      remove: (cls: string) => classes.delete(cls),
      contains: (cls: string) => classes.has(cls),
    },
    listeners,
    addEventListener: (event: string, handler: (e?: any) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    click: (event?: any) => {
      const handlers = listeners['click'] || [];
      handlers.forEach((h) => h(event ?? { target: el, stopPropagation: vi.fn() }));
    },
  };

  return el;
};

describe('HudView (HUD Overlay & Spotify-Wrapped Modal - Tasks 6.2 & 6.3)', () => {
  let sessionService: SessionHistoryService;
  let hudView: HudView;
  let elementMap: Map<string, MockElement>;
  let windowListeners: Record<string, ((e?: any) => void)[]>;

  beforeEach(() => {
    elementMap = new Map();
    windowListeners = {};

    const ids = [
      'hud-current-score',
      'hud-highscore',
      'wrapped-btn',
      'wrapped-modal',
      'modal-close-x',
      'modal-persona-title',
      'modal-persona-subtitle',
      'stat-highscore',
      'stat-avg-accuracy',
      'stat-attempts',
      'stat-cycles',
      'stat-consistency',
      'stat-streak',
      'modal-resume-btn',
      'modal-reset-btn',
      'modal-share-btn',
      'modal-screenshot-btn',
      'modal-copy-btn',
      'modal-share-status',
      'modal-share-preview',
      'modal-share-preview-wrap',
    ];

    ids.forEach((id) => {
      const initialClasses =
        id === 'wrapped-modal' || id === 'modal-share-preview-wrap' ? ['hidden'] : [];
      elementMap.set(id, createMockElement(id, initialClasses));
    });

    vi.stubGlobal('document', {
      getElementById: (id: string) => elementMap.get(id) ?? null,
    });

    vi.stubGlobal('window', {
      location: { href: 'https://perfect-sine.test/' },
      addEventListener: (event: string, handler: (e?: any) => void) => {
        if (!windowListeners[event]) windowListeners[event] = [];
        windowListeners[event].push(handler);
      },
    });

    sessionService = new SessionHistoryService(new MemoryStorageAdapter());
    hudView = new HudView(sessionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should initialize with default zeroed HUD values', () => {
    expect(elementMap.get('hud-current-score')!.textContent).toBe('-');
    expect(elementMap.get('hud-highscore')!.textContent).toBe('0 pts');
    expect(hudView.isModalOpen()).toBe(false);
  });

  it('should update HUD and modal content reactively when an attempt is added', () => {
    sessionService.addAttempt({
      score: 920,
      accuracy: 94.5,
      cycles: 1.8,
      r2: 0.98,
      amplitude: 50,
    });

    expect(elementMap.get('hud-current-score')!.textContent).toBe('920 pts');
    expect(elementMap.get('hud-highscore')!.textContent).toBe('920 pts');
    expect(elementMap.get('stat-highscore')!.textContent).toBe('920 pts');
    expect(elementMap.get('stat-avg-accuracy')!.textContent).toBe('94.5%');
    expect(elementMap.get('stat-attempts')!.textContent).toBe('1');
    expect(elementMap.get('stat-streak')!.textContent).toBe('1 🔥');
  });

  it('should open and close the Wrapped modal', () => {
    expect(hudView.isModalOpen()).toBe(false);

    hudView.openModal();
    expect(hudView.isModalOpen()).toBe(true);

    hudView.closeModal();
    expect(hudView.isModalOpen()).toBe(false);
  });

  it('should open modal when wrapped-btn is clicked', () => {
    const wrappedBtn = elementMap.get('wrapped-btn')!;
    wrappedBtn.click();
    expect(hudView.isModalOpen()).toBe(true);
  });

  it('should close modal when close button (✕) or resume button is clicked', () => {
    hudView.openModal();
    expect(hudView.isModalOpen()).toBe(true);

    const closeBtn = elementMap.get('modal-close-x')!;
    closeBtn.click();
    expect(hudView.isModalOpen()).toBe(false);

    hudView.openModal();
    const resumeBtn = elementMap.get('modal-resume-btn')!;
    resumeBtn.click();
    expect(hudView.isModalOpen()).toBe(false);
  });

  it('should close modal when clicking the backdrop', () => {
    hudView.openModal();
    const modal = elementMap.get('wrapped-modal')!;
    // Backdrop click simulation
    modal.click({ target: modal });
    expect(hudView.isModalOpen()).toBe(false);
  });

  it('should close modal on Escape key press', () => {
    hudView.openModal();
    expect(hudView.isModalOpen()).toBe(true);

    const keydownHandlers = windowListeners['keydown'] || [];
    keydownHandlers.forEach((h) => h({ key: 'Escape' }));
    expect(hudView.isModalOpen()).toBe(false);
  });

  it('should reset session stats when reset button is clicked', () => {
    sessionService.addAttempt({
      score: 800,
      accuracy: 85,
      cycles: 1.0,
      r2: 0.9,
      amplitude: 40,
    });
    expect(sessionService.getHighscore()).toBe(800);

    const resetBtn = elementMap.get('modal-reset-btn')!;
    resetBtn.click();

    expect(sessionService.getAttempts()).toHaveLength(0);
    expect(sessionService.getHighscore()).toBe(0);
    expect(elementMap.get('hud-highscore')!.textContent).toBe('0 pts');
  });

  it('opens share modal on screenshot shortcuts (PrintScreen, Ctrl+Shift+S, Cmd+Shift+4) and beforeprint', () => {
    const keydownHandlers = windowListeners['keydown'] || [];
    const keyupHandlers = windowListeners['keyup'] || [];
    const beforeprintHandlers = windowListeners['beforeprint'] || [];

    // PrintScreen on keydown
    keydownHandlers.forEach((h) => h({ key: 'PrintScreen', code: 'PrintScreen' }));
    expect(hudView.isModalOpen()).toBe(true);
    expect(elementMap.get('modal-share-status')!.textContent).toContain('screenshot trigger');
    hudView.closeModal();

    // PrintScreen on keyup
    keyupHandlers.forEach((h) => h({ key: 'PrintScreen', code: 'PrintScreen' }));
    expect(hudView.isModalOpen()).toBe(true);
    hudView.closeModal();

    // Ctrl+Shift+S (Firefox/Edge screenshot)
    keydownHandlers.forEach((h) => h({ key: 'S', ctrlKey: true, shiftKey: true }));
    expect(hudView.isModalOpen()).toBe(true);
    hudView.closeModal();

    // Cmd+Shift+4 (macOS screenshot chord when forwarded)
    keydownHandlers.forEach((h) => h({ key: '4', code: 'Digit4', metaKey: true, shiftKey: true }));
    expect(hudView.isModalOpen()).toBe(true);
    hudView.closeModal();

    // beforeprint
    beforeprintHandlers.forEach((h) => h({}));
    expect(hudView.isModalOpen()).toBe(true);
  });

  it('opens share modal on bare S shortcut unless typing in an editable element', () => {
    const keydownHandlers = windowListeners['keydown'] || [];

    // Should ignore typing 's' inside input / textarea / contentEditable
    keydownHandlers.forEach((h) => h({ key: 's', target: { tagName: 'INPUT' } }));
    expect(hudView.isModalOpen()).toBe(false);

    keydownHandlers.forEach((h) => h({ key: 's', target: { isContentEditable: true } }));
    expect(hudView.isModalOpen()).toBe(false);

    // Should NOT intercept Ctrl+S (browser Save Page)
    keydownHandlers.forEach((h) => h({ key: 's', ctrlKey: true }));
    expect(hudView.isModalOpen()).toBe(false);

    // Bare 's' opens modal & prevents default
    const preventDefault = vi.fn();
    keydownHandlers.forEach((h) => h({ key: 's', preventDefault }));
    expect(hudView.isModalOpen()).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('renders share preview on open and executes real share, PNG save, and clipboard copy actions', async () => {
    const previewSpy = vi
      .spyOn(ShareCardGenerator, 'toDataUrl')
      .mockReturnValue('data:image/png;base64,previewMock');
    const shareSpy = vi
      .spyOn(ShareCardGenerator, 'share')
      .mockResolvedValue({ status: 'shared', message: 'Wave card shared!' });
    const downloadSpy = vi
      .spyOn(ShareCardGenerator, 'downloadShareCard')
      .mockReturnValue(true);
    const copySpy = vi
      .spyOn(ShareCardGenerator, 'copyShareCard')
      .mockResolvedValue({ status: 'copied-image', message: 'Share card image copied to clipboard!' });

    hudView.openModal();

    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(elementMap.get('modal-share-preview')!.src).toBe('data:image/png;base64,previewMock');
    expect(elementMap.get('modal-share-preview-wrap')!.classList.contains('hidden')).toBe(false);

    elementMap.get('modal-share-btn')!.click();
    await Promise.resolve();
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(elementMap.get('modal-share-status')!.textContent).toBe('Wave card shared!');

    elementMap.get('modal-screenshot-btn')!.click();
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(elementMap.get('modal-share-status')!.textContent).toBe('Saved Share Card PNG!');

    elementMap.get('modal-copy-btn')!.click();
    await Promise.resolve();
    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(elementMap.get('modal-share-status')!.textContent).toBe(
      'Share card image copied to clipboard!'
    );
  });
});
