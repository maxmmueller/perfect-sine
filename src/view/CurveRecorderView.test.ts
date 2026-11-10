import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CurveRecorderView } from './CurveRecorderView';
import { CurveRecorderService } from '../model/CurveRecorderService';
import { RecordedCurve } from '../model/types';

interface MockDOMElement {
  id: string;
  className: string;
  textContent: string;
  innerHTML: string;
  value?: string;
  type?: string;
  checked?: boolean;
  title?: string;
  placeholder?: string;
  attributes: Record<string, string>;
  children: MockDOMElement[];
  style: Record<string, string>;
  classList: {
    classes: Set<string>;
    add: (cls: string) => void;
    remove: (cls: string) => void;
    toggle: (cls: string) => boolean;
    contains: (cls: string) => boolean;
  };
  listeners: Record<string, ((e?: any) => void)[]>;
  addEventListener: (event: string, handler: (e?: any) => void) => void;
  setAttribute: (key: string, val: string) => void;
  getAttribute: (key: string) => string | null;
  appendChild: (child: MockDOMElement) => void;
  click: (event?: any) => void;
  dispatchEvent: (event: { type: string }) => boolean;
}

const createMockDOMElement = (id: string = '', initialClasses: string[] = []): MockDOMElement => {
  const classes = new Set<string>(initialClasses);
  const listeners: Record<string, ((e?: any) => void)[]> = {};
  const attributes: Record<string, string> = {};
  const children: MockDOMElement[] = [];
  const style: Record<string, string> = {};

  let innerHTMLVal = '';
  const el: MockDOMElement = {
    id,
    className: initialClasses.join(' '),
    textContent: '',
    get innerHTML() {
      return innerHTMLVal;
    },
    set innerHTML(val: string) {
      innerHTMLVal = val;
      if (val === '') {
        children.length = 0;
      }
    },
    attributes,
    children,
    style,
    classList: {
      classes,
      add: (cls: string) => classes.add(cls),
      remove: (cls: string) => classes.delete(cls),
      toggle: (cls: string) => {
        if (classes.has(cls)) {
          classes.delete(cls);
          return false;
        } else {
          classes.add(cls);
          return true;
        }
      },
      contains: (cls: string) => classes.has(cls),
    },
    listeners,
    addEventListener: (event: string, handler: (e?: any) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    setAttribute: (k: string, v: string) => {
      attributes[k] = v;
    },
    getAttribute: (k: string) => attributes[k] ?? null,
    appendChild: (child: MockDOMElement) => {
      children.push(child);
    },
    click: (event?: any) => {
      const handlers = listeners['click'] || [];
      handlers.forEach((h) => h(event ?? { target: el, stopPropagation: vi.fn() }));
    },
    dispatchEvent: (event: { type: string }) => {
      const handlers = listeners[event.type] || [];
      handlers.forEach((h) => h({ target: el, stopPropagation: vi.fn() }));
      return true;
    },
  };

  return el;
};

describe('CurveRecorderView', () => {
  let service: CurveRecorderService;
  let elementMap: Record<string, MockDOMElement>;

  const dummyCurve: RecordedCurve = {
    id: 'test_c_1',
    timestamp: 1700000000000,
    label: 'Hand Sine #1',
    points: [
      { x: 10, y: 20 },
      { x: 20, y: 30 },
      { x: 30, y: 20 },
    ],
    evaluation: null,
    validationMessage: null,
    metrics: null,
  };

  beforeEach(() => {
    service = new CurveRecorderService([dummyCurve]);

    elementMap = {
      'record-panel-btn': createMockDOMElement('record-panel-btn'),
      'record-badge': createMockDOMElement('record-badge'),
      'recorder-panel': createMockDOMElement('recorder-panel', ['hidden']),
      'recorder-close-btn': createMockDOMElement('recorder-close-btn'),
      'record-current-btn': createMockDOMElement('record-current-btn'),
      'recorder-autorecord-toggle': createMockDOMElement('recorder-autorecord-toggle'),
      'recorder-copy-ai-btn': createMockDOMElement('recorder-copy-ai-btn'),
      'recorder-export-json-btn': createMockDOMElement('recorder-export-json-btn'),
      'recorder-import-json-btn': createMockDOMElement('recorder-import-json-btn'),
      'recorder-clear-btn': createMockDOMElement('recorder-clear-btn'),
      'recorder-count': createMockDOMElement('recorder-count'),
      'recorder-curve-list': createMockDOMElement('recorder-curve-list'),
    };

    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => elementMap[id] ?? null),
      createElement: vi.fn((tag: string) => createMockDOMElement(`created-${tag}`)),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should initialize and render recorded curves in the list', () => {
    new CurveRecorderView(service);
    const listEl = elementMap['recorder-curve-list'];
    const badgeEl = elementMap['record-badge'];
    const countEl = elementMap['recorder-count'];

    expect(badgeEl.textContent).toBe('1');
    expect(countEl.textContent).toContain('1 curve');
    expect(listEl.children.length).toBe(1);
  });

  it('should open, close, and toggle the recorder drawer', () => {
    const view = new CurveRecorderView(service);
    const panelEl = elementMap['recorder-panel'];

    expect(panelEl.classList.contains('hidden')).toBe(true);

    view.open();
    expect(panelEl.classList.contains('hidden')).toBe(false);

    view.close();
    expect(panelEl.classList.contains('hidden')).toBe(true);

    view.toggle();
    expect(panelEl.classList.contains('hidden')).toBe(false);
  });

  it('should record current stroke when recordCurrentBtn is clicked', () => {
    const onRecordCurrent = vi.fn(() => ({
      points: [
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ],
      evaluation: null,
      validationMessage: null,
    }));

    new CurveRecorderView(service, { onRecordCurrentRequested: onRecordCurrent });

    elementMap['record-current-btn'].click();

    expect(onRecordCurrent).toHaveBeenCalled();
    expect(service.getCurves().length).toBe(2);
  });

  it('should copy all curves to clipboard for AI when copyAiBtn is clicked', async () => {
    new CurveRecorderView(service);

    elementMap['recorder-copy-ai-btn'].click();

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const copiedText = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(copiedText).toContain('"version": "1.0.0"');
    expect(copiedText).toContain('Hand Sine #1');
  });

  it('should render empty state when all curves are cleared', () => {
    new CurveRecorderView(service);
    service.clearAll();

    const listEl = elementMap['recorder-curve-list'];
    expect(listEl.children.length).toBe(1);
    expect(listEl.children[0].className).toBe('recorder-empty-state');
  });
});
