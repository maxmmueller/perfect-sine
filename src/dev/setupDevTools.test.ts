import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectRecorderDom, setupDevTools, DevToolsContext } from './setupDevTools';
import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { SessionHistoryService, MemoryStorageAdapter } from '../model/SessionHistoryService';
import { HudView } from '../view/HudView';
import { DrawingController } from '../controller/DrawingController';

interface MockEl {
  tagName: string;
  id: string;
  className: string;
  innerHTML: string;
  textContent: string;
  value?: string;
  type?: string;
  checked?: boolean;
  attributes: Record<string, string>;
  children: MockEl[];
  style: Record<string, string>;
  classList: {
    classes: Set<string>;
    add: (cls: string) => void;
    remove: (cls: string) => void;
    toggle: (cls: string) => boolean;
    contains: (cls: string) => boolean;
  };
  listeners: Record<string, Array<(e?: unknown) => void>>;
  addEventListener: (event: string, handler: (e?: unknown) => void) => void;
  setAttribute: (key: string, val: string) => void;
  getAttribute: (key: string) => string | null;
  appendChild: (child: MockEl) => MockEl;
}

function createMockDomEnvironment() {
  const byId = new Map<string, MockEl>();
  const bySelector = new Map<string, MockEl>();

  const makeEl = (tagName: string, id = '', initialClasses: string[] = []): MockEl => {
    const classes = new Set<string>(initialClasses);
    const attributes: Record<string, string> = {};
    const children: MockEl[] = [];
    const listeners: Record<string, Array<(e?: unknown) => void>> = {};
    let html = '';

    const el: MockEl = {
      tagName: tagName.toUpperCase(),
      id,
      className: initialClasses.join(' '),
      get innerHTML() {
        return html;
      },
      set innerHTML(val: string) {
        html = val;
        // Parse id="..." attributes from static markup so injected controls resolve by ID
        const idMatches = val.matchAll(/\bid="([^"]+)"/g);
        for (const match of idMatches) {
          const childId = match[1];
          if (childId && !byId.has(childId)) {
            const child = makeEl(childId === 'recorder-autorecord-toggle' ? 'input' : 'div', childId);
            if (childId === 'recorder-autorecord-toggle') {
              child.checked = true;
            }
            byId.set(childId, child);
          }
        }
      },
      textContent: '',
      attributes,
      children,
      style: {},
      classList: {
        classes,
        add: (cls: string) => {
          classes.add(cls);
        },
        remove: (cls: string) => {
          classes.delete(cls);
        },
        toggle: (cls: string) => {
          if (classes.has(cls)) {
            classes.delete(cls);
            return false;
          }
          classes.add(cls);
          return true;
        },
        contains: (cls: string) => classes.has(cls),
      },
      listeners,
      addEventListener: (event: string, handler: (e?: unknown) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      setAttribute: (key: string, val: string) => {
        attributes[key] = val;
      },
      getAttribute: (key: string) => attributes[key] ?? null,
      appendChild: (child: MockEl) => {
        if (child.id) {
          byId.set(child.id, child);
        }
        children.push(child);
        return child;
      },
    };

    if (id) {
      byId.set(id, el);
    }
    return el;
  };

  const appRoot = makeEl('div', 'app');
  const hudMetrics = makeEl('div', '', ['hud-metrics']);
  const body = makeEl('body');
  bySelector.set('.hud-metrics', hudMetrics);

  const mockDocument = {
    body,
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelector: (selector: string) => bySelector.get(selector) ?? null,
    createElement: (tag: string) => makeEl(tag),
  } as unknown as Document;

  return { mockDocument, appRoot, hudMetrics, byId, bySelector };
}

describe('setupDevTools & injectRecorderDom', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  let storageData: Record<string, string> = {};

  beforeEach(() => {
    storageData = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageData[k] ?? null,
      setItem: (k: string, v: string) => {
        storageData[k] = v;
      },
      removeItem: (k: string) => {
        delete storageData[k];
      },
      clear: () => {
        storageData = {};
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalDocument !== undefined) {
      globalThis.document = originalDocument;
    }
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    }
    if (originalLocalStorage !== undefined) {
      globalThis.localStorage = originalLocalStorage;
    }
  });

  it('injects #record-panel-btn into .hud-metrics and #recorder-panel into #app once (idempotent)', () => {
    const { mockDocument, appRoot, hudMetrics, byId } = createMockDomEnvironment();

    injectRecorderDom(mockDocument);

    expect(hudMetrics.children).toHaveLength(1);
    expect(hudMetrics.children[0].id).toBe('record-panel-btn');
    expect(appRoot.children).toHaveLength(1);
    expect(appRoot.children[0].id).toBe('recorder-panel');
    expect(byId.has('record-badge')).toBe(true);
    expect(byId.has('recorder-curve-list')).toBe(true);

    // Calling twice should not duplicate elements
    injectRecorderDom(mockDocument);

    expect(hudMetrics.children).toHaveLength(1);
    expect(appRoot.children).toHaveLength(1);
  });

  it('handles missing .hud-metrics gracefully and falls back to document.body when #app is absent', () => {
    const { mockDocument, byId, bySelector } = createMockDomEnvironment();
    byId.delete('app');
    bySelector.delete('.hud-metrics');

    expect(() => injectRecorderDom(mockDocument)).not.toThrow();
    expect(byId.get('record-panel-btn')).toBeUndefined();
    expect(byId.get('recorder-panel')).toBeDefined();
    expect((mockDocument.body as unknown as MockEl).children).toHaveLength(1);
  });

  it('wires CurveRecorder, logs GameStateMachine transitions, exposes window.__perfectSine, and auto-records strokes', () => {
    const { mockDocument } = createMockDomEnvironment();
    const mockWin: Record<string, unknown> = {};
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWin);

    const stateMachine = new GameStateMachine();
    const strokeBuffer = new StrokeBuffer(2.0);
    const sessionService = new SessionHistoryService(new MemoryStorageAdapter());
    const hudView = {} as unknown as HudView;
    const replayStroke = vi.fn();
    const getLastDrawnStroke = vi.fn().mockReturnValue(null);
    const controller = {
      replayStroke,
      getLastDrawnStroke,
    } as unknown as DrawingController;

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ctx: DevToolsContext = {
      controller,
      stateMachine,
      strokeBuffer,
      sessionService,
      hudView,
    };

    const handle = setupDevTools(ctx);

    // Debug global attached
    const debugHandle = mockWin.__perfectSine as Record<string, unknown>;
    expect(debugHandle).toBeDefined();
    expect(debugHandle.controller).toBe(controller);
    expect(debugHandle.recorderService).toBe(handle.recorderService);
    expect(debugHandle.recorderView).toBe(handle.recorderView);

    // Logs state machine transitions
    strokeBuffer.addPoint(10, 20, 1000);
    stateMachine.startDrawing();
    expect(consoleSpy).toHaveBeenCalledWith('[GameStateMachine] IDLE -> DRAWING (Points: 1)');

    // Ignores single-point strokes
    handle.onStrokeComplete({
      points: [{ x: 0, y: 0, time: 1 }],
      evaluation: null,
      validationMessage: null,
    });
    expect(handle.recorderService.getCurves()).toHaveLength(0);

    // Records multi-point strokes when auto-record is active
    handle.onStrokeComplete({
      points: [
        { x: 0, y: 0, time: 1 },
        { x: 10, y: 10, time: 2 },
      ],
      evaluation: null,
      validationMessage: 'Incomplete wave',
    });
    expect(handle.recorderService.getCurves()).toHaveLength(1);

    // Respects disabled auto-record
    handle.recorderService.setAutoRecordEnabled(false);
    handle.onStrokeComplete({
      points: [
        { x: 0, y: 0, time: 3 },
        { x: 10, y: 10, time: 4 },
      ],
      evaluation: null,
      validationMessage: null,
    });
    expect(handle.recorderService.getCurves()).toHaveLength(1);

    handle.unsubscribeStateLogger();
  });
});
