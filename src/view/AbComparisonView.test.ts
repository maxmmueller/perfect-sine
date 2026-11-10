import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AbComparisonView } from './AbComparisonView';
import { ScoreStrategyManager } from '../model/scoring/ScoreStrategyManager';
import { MemoryStorageAdapter } from '../model/SessionHistoryService';
import { DemoBot } from '../model/DemoBot';
import { SineFitter } from '../model/SineFitter';

interface MockDOMElement {
  id: string;
  className: string;
  textContent: string;
  innerHTML: string;
  attributes: Record<string, string>;
  children: MockDOMElement[];
  classList: {
    classes: Set<string>;
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
  };
  listeners: Record<string, ((e?: any) => void)[]>;
  addEventListener: (event: string, handler: (e?: any) => void) => void;
  setAttribute: (key: string, val: string) => void;
  getAttribute: (key: string) => string | null;
  appendChild: (child: MockDOMElement) => void;
  click: (event?: any) => void;
}

const createMockDOMElement = (id: string = '', initialClasses: string[] = []): MockDOMElement => {
  const classes = new Set<string>(initialClasses);
  const listeners: Record<string, ((e?: any) => void)[]> = {};
  const attributes: Record<string, string> = {};
  const children: MockDOMElement[] = [];

  const el: MockDOMElement = {
    id,
    className: initialClasses.join(' '),
    textContent: '',
    innerHTML: '',
    attributes,
    children,
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
  };

  return el;
};

describe('AbComparisonView (A/B Scorer List & Voting - Task 7.8)', () => {
  let strategyManager: ScoreStrategyManager;
  let elementMap: Map<string, MockDOMElement>;
  let abView: AbComparisonView;
  let selectedStrategyId: string | null = null;

  beforeEach(() => {
    elementMap = new Map();

    const ids = [
      'ab-panel',
      'ab-scorer-list',
      'ab-toggle-btn',
      'ab-close-btn',
      'ab-clear-votes-btn',
      'ab-total-votes',
      'ab-leading-name',
    ];

    ids.forEach((id) => {
      const initialClasses = id === 'ab-panel' ? ['modal-drawer', 'hidden'] : [];
      elementMap.set(id, createMockDOMElement(id, initialClasses));
    });

    vi.stubGlobal('document', {
      getElementById: (id: string) => elementMap.get(id) ?? null,
      createElement: (tag: string) => createMockDOMElement(tag),
    });

    strategyManager = new ScoreStrategyManager('rmse_l2', new MemoryStorageAdapter());
    strategyManager.clearVotes();

    abView = new AbComparisonView(strategyManager, {
      onSelectStrategy: (strategy) => {
        selectedStrategyId = strategy.id;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    selectedStrategyId = null;
  });

  it('should initialize closed with 0 votes and default leading badge', () => {
    expect(abView.isOpen()).toBe(false);
    expect(elementMap.get('ab-total-votes')!.textContent).toBe('0 votes');
    expect(elementMap.get('ab-leading-name')!.textContent).toContain('None yet');
  });

  it('should toggle, open, and close the A/B comparison panel', () => {
    expect(abView.isOpen()).toBe(false);

    abView.open();
    expect(abView.isOpen()).toBe(true);

    abView.close();
    expect(abView.isOpen()).toBe(false);

    abView.toggle();
    expect(abView.isOpen()).toBe(true);

    abView.toggle();
    expect(abView.isOpen()).toBe(false);
  });

  it('should render all 5 scoring strategies when showEvaluations is called', () => {
    const points = DemoBot.generateStroke({
      amplitude: 50,
      wavelength: 200,
      cycles: 1.5,
      jitterLevel: 0,
      stepPx: 2,
    });
    const fit = SineFitter.fit(points)!;
    const evaluations = strategyManager.evaluateAll(points, fit);

    abView.showEvaluations(evaluations);

    expect(abView.isOpen()).toBe(true);
    const list = elementMap.get('ab-scorer-list')!;
    expect(list.children).toHaveLength(5);
  });

  it('should record vote, notify callback, and update vote summary when row is clicked', () => {
    const points = DemoBot.generateStroke({ amplitude: 50, wavelength: 200, cycles: 1.5 });
    const fit = SineFitter.fit(points)!;
    const evaluations = strategyManager.evaluateAll(points, fit);

    abView.showEvaluations(evaluations);
    const list = elementMap.get('ab-scorer-list')!;
    const firstRow = list.children[0];

    // Click on vote button within the row
    const voteBtn = createMockDOMElement('vote-btn', ['ab-vote-btn']);
    firstRow.click({ target: voteBtn, stopPropagation: vi.fn() });

    const summary = strategyManager.getVoteSummary();
    expect(summary.totalVotes).toBe(1);
    expect(summary.leadingStrategyId).toBe('rmse_l2');
    expect(elementMap.get('ab-total-votes')!.textContent).toBe('1 votes');
    expect(elementMap.get('ab-leading-name')!.textContent).toContain('RMSE / L2 Quadratic Distance');
    expect(selectedStrategyId).toBe('rmse_l2');
  });

  it('should select strategy and update active canvas without voting when clicking row body', () => {
    abView.renderList();
    const list = elementMap.get('ab-scorer-list')!;
    const secondRow = list.children[1]; // Area L1

    secondRow.click({ target: secondRow, stopPropagation: vi.fn() });

    expect(strategyManager.getVoteSummary().totalVotes).toBe(0); // no vote cast
    expect(selectedStrategyId).toBe('area_l1');
    expect(strategyManager.getActiveStrategy().id).toBe('area_l1');
  });

  it('should clear all votes when clear votes button is clicked', () => {
    strategyManager.recordVote('rmse_l2');
    strategyManager.recordVote('area_l1');
    expect(strategyManager.getVoteSummary().totalVotes).toBe(2);

    const clearBtn = elementMap.get('ab-clear-votes-btn')!;
    clearBtn.click();

    expect(strategyManager.getVoteSummary().totalVotes).toBe(0);
    expect(elementMap.get('ab-total-votes')!.textContent).toBe('0 votes');
    expect(elementMap.get('ab-leading-name')!.textContent).toContain('None yet');
  });
});
