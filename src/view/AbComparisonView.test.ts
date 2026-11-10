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
  draggable: boolean;
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
    draggable: false,
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

describe('AbComparisonView (Drag & Drop Ranking & Focused Metrics - Task 7.8)', () => {
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
      'ab-save-ranking-btn',
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

  it('should initialize closed with 0 rankings and default leading badge', () => {
    expect(abView.isOpen()).toBe(false);
    expect(elementMap.get('ab-total-votes')!.textContent).toBe('0 rankings');
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

  it('should render all 5 scoring strategies with prominent score and accuracy chips', () => {
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

    // Each row must be draggable and contain focused metrics chips
    list.children.forEach((row) => {
      expect(row.draggable).toBe(true);
      expect(row.innerHTML).toContain('ab-metric-chip ab-metric-score');
      expect(row.innerHTML).toContain('ab-metric-chip ab-metric-accuracy');
      expect(row.innerHTML).toContain('SCORE');
      expect(row.innerHTML).toContain('ACCURACY');
    });
  });

  it('should reorder ranks using ▲ / ▼ quick buttons and update ranking order', () => {
    abView.renderList();
    const list = elementMap.get('ab-scorer-list')!;

    // Initial order: index 0 is rmse_l2, index 1 is area_l1
    expect(strategyManager.getUserRankingOrder()[0]).toBe('rmse_l2');
    expect(strategyManager.getUserRankingOrder()[1]).toBe('area_l1');

    // Click down button on first row
    const firstRow = list.children[0];
    const downBtn = createMockDOMElement('down-btn', ['ab-rank-btn', 'ab-rank-down']);
    firstRow.click({ target: downBtn, stopPropagation: vi.fn() });

    // Order should now have area_l1 at #1 and rmse_l2 at #2
    expect(strategyManager.getUserRankingOrder()[0]).toBe('area_l1');
    expect(strategyManager.getUserRankingOrder()[1]).toBe('rmse_l2');

    // Click up button on new second row (rmse_l2)
    const updatedList = elementMap.get('ab-scorer-list')!;
    const secondRow = updatedList.children[1];
    const upBtn = createMockDOMElement('up-btn', ['ab-rank-btn', 'ab-rank-up']);
    secondRow.click({ target: upBtn, stopPropagation: vi.fn() });

    // Order restored
    expect(strategyManager.getUserRankingOrder()[0]).toBe('rmse_l2');
  });

  it('should save ranking via Save Ranking button and update Borda summary', () => {
    const points = DemoBot.generateStroke({ amplitude: 50, wavelength: 200, cycles: 1.5 });
    const fit = SineFitter.fit(points)!;
    abView.showEvaluations(strategyManager.evaluateAll(points, fit));

    const saveBtn = elementMap.get('ab-save-ranking-btn')!;
    saveBtn.click();

    const summary = strategyManager.getRankingSummary();
    expect(summary.totalRankings).toBe(1);
    expect(summary.leadingStrategyId).toBe('rmse_l2');
    expect(summary.bordaScore['rmse_l2']).toBe(5);
    expect(elementMap.get('ab-total-votes')!.textContent).toBe('1 rankings');
    expect(elementMap.get('ab-leading-name')!.textContent).toContain('RMSE / L2 Quadratic Distance');
    expect(saveBtn.textContent).toContain('Ranking Saved');
  });

  it('should select strategy and update active canvas without ranking when clicking row body', () => {
    abView.renderList();
    const list = elementMap.get('ab-scorer-list')!;
    const secondRow = list.children[1]; // Area L1

    secondRow.click({ target: secondRow, stopPropagation: vi.fn() });

    expect(strategyManager.getRankingSummary().totalRankings).toBe(0);
    expect(selectedStrategyId).toBe('area_l1');
    expect(strategyManager.getActiveStrategy().id).toBe('area_l1');
  });

  it('should support HTML5 drag and drop rank swap', () => {
    abView.renderList();
    const list = elementMap.get('ab-scorer-list')!;

    const firstRow = list.children[0];
    const thirdRow = list.children[2];

    // Trigger dragstart on first row
    const mockDataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => '0'),
    };

    const dragStartHandlers = firstRow.listeners['dragstart'] || [];
    dragStartHandlers.forEach((h) => h({ dataTransfer: mockDataTransfer }));

    // Trigger drop on third row
    const dropHandlers = thirdRow.listeners['drop'] || [];
    dropHandlers.forEach((h) => h({ preventDefault: vi.fn(), dataTransfer: mockDataTransfer }));

    // Item 0 (rmse_l2) should now be moved to index 2
    expect(strategyManager.getUserRankingOrder()[2]).toBe('rmse_l2');
  });

  it('should clear all rankings when reset button is clicked', () => {
    strategyManager.recordRanking(['rmse_l2', 'area_l1', 'harmonic_symmetry', 'curvature_flow', 'chebyshev_linf']);
    expect(strategyManager.getRankingSummary().totalRankings).toBe(1);

    const clearBtn = elementMap.get('ab-clear-votes-btn')!;
    clearBtn.click();

    expect(strategyManager.getRankingSummary().totalRankings).toBe(0);
    expect(elementMap.get('ab-total-votes')!.textContent).toBe('0 rankings');
    expect(elementMap.get('ab-leading-name')!.textContent).toContain('None yet');
  });
});
