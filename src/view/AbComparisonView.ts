import {
  ScoreStrategyManager,
  ScorerEvaluationItem,
  ScorerRankingSummary,
} from '../model/scoring/ScoreStrategyManager';
import { IScoreStrategy } from '../model/scoring/IScoreStrategy';

export interface AbComparisonViewOptions {
  readonly onSelectStrategy?: (strategy: IScoreStrategy) => void;
}

function getStrategyBadge(id: string): string {
  switch (id) {
    case 'rmse_l2':
      return 'L2';
    case 'area_l1':
      return 'L1';
    case 'harmonic_symmetry':
      return 'SYM';
    case 'curvature_flow':
      return 'FLOW';
    case 'chebyshev_linf':
      return 'LINF';
    default:
      return id.substring(0, 4).toUpperCase();
  }
}

/**
 * AbComparisonView
 * Manages the comparative A/B Scorer Ranking drawer.
 * Supports full 1-to-5 rank allocation via HTML5 Drag & Drop and quick reorder controls,
 * with prominent visual focus on Score and Accuracy metrics.
 */
export class AbComparisonView {
  private readonly strategyManager: ScoreStrategyManager;
  private readonly options?: AbComparisonViewOptions;
  private readonly panelEl: HTMLElement | null;
  private readonly listContainerEl: HTMLElement | null;
  private readonly toggleBtnEl: HTMLElement | null;
  private readonly closeBtnEl: HTMLElement | null;
  private readonly saveRankingBtnEl: HTMLElement | null;
  private readonly clearVotesBtnEl: HTMLElement | null;
  private readonly totalVotesBadgeEl: HTMLElement | null;
  private readonly leadingBadgeEl: HTMLElement | null;

  private currentEvaluations: Map<string, ScorerEvaluationItem> = new Map();
  private draggedIndex: number | null = null;
  private saveTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(strategyManager: ScoreStrategyManager, options?: AbComparisonViewOptions) {
    this.strategyManager = strategyManager;
    this.options = options;

    this.panelEl = document.getElementById('ab-panel');
    this.listContainerEl = document.getElementById('ab-scorer-list');
    this.toggleBtnEl = document.getElementById('ab-toggle-btn');
    this.closeBtnEl = document.getElementById('ab-close-btn');
    this.saveRankingBtnEl = document.getElementById('ab-save-ranking-btn');
    this.clearVotesBtnEl = document.getElementById('ab-clear-votes-btn');
    this.totalVotesBadgeEl = document.getElementById('ab-total-votes');
    this.leadingBadgeEl = document.getElementById('ab-leading-name');

    this.bindEvents();
    this.strategyManager.subscribeVotes((summary) => this.updateVoteSummary(summary));
    this.updateVoteSummary(this.strategyManager.getRankingSummary());
  }

  private bindEvents(): void {
    if (this.toggleBtnEl) {
      this.toggleBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    if (this.closeBtnEl) {
      this.closeBtnEl.addEventListener('click', () => {
        this.close();
      });
    }

    if (this.saveRankingBtnEl) {
      this.saveRankingBtnEl.addEventListener('click', () => {
        this.handleSaveRanking();
      });
    }

    if (this.clearVotesBtnEl) {
      this.clearVotesBtnEl.addEventListener('click', () => {
        this.strategyManager.clearVotes();
        this.renderList();
      });
    }
  }

  public showEvaluations(items: ScorerEvaluationItem[]): void {
    this.currentEvaluations.clear();
    for (const item of items) {
      this.currentEvaluations.set(item.strategy.id, item);
    }
    this.renderList();
    this.open();
  }

  public moveRank(fromIndex: number, toIndex: number): void {
    this.strategyManager.moveStrategyRank(fromIndex, toIndex);
    this.renderList();
  }

  public handleSaveRanking(): void {
    const order = this.strategyManager.getUserRankingOrder();
    this.strategyManager.recordRanking(order);

    if (this.saveRankingBtnEl) {
      this.saveRankingBtnEl.textContent = '✓ Ranking Saved!';
      this.saveRankingBtnEl.classList.add('saved');

      if (this.saveTimeoutId) {
        clearTimeout(this.saveTimeoutId);
      }
      this.saveTimeoutId = setTimeout(() => {
        if (this.saveRankingBtnEl) {
          this.saveRankingBtnEl.textContent = 'Save Ranking (1-5)';
          this.saveRankingBtnEl.classList.remove('saved');
        }
      }, 1600);
    }
  }

  public renderList(): void {
    const container = this.listContainerEl;
    if (!container) return;

    const summary = this.strategyManager.getRankingSummary();
    const activeStrategy = this.strategyManager.getActiveStrategy();
    const orderedIds = this.strategyManager.getUserRankingOrder();

    container.innerHTML = '';

    orderedIds.forEach((strategyId, index) => {
      const strategy = this.strategyManager.getStrategy(strategyId);
      const evalItem = this.currentEvaluations.get(strategy.id);
      const rank = index + 1;

      const score = evalItem?.evaluation.score;
      const accuracy = evalItem?.evaluation.accuracy;
      const scoreDisplay = score !== undefined ? `${score.toLocaleString()} pts` : '-';
      const accuracyDisplay = accuracy !== undefined ? `${accuracy.toFixed(1)}%` : '-';

      const avgRank = summary.averageRank[strategy.id] ?? 0;
      const borda = summary.bordaScore[strategy.id] ?? 0;
      const isSelected = strategy.id === activeStrategy.id;
      const isLeading = strategy.id === summary.leadingStrategyId && summary.totalRankings > 0;

      const row = document.createElement('div');
      row.className = `ab-scorer-row rank-item rank-${rank} ${isSelected ? 'active-strategy' : ''} ${isLeading ? 'is-leading' : ''}`;
      row.setAttribute('data-strategy-id', strategy.id);
      row.setAttribute('data-rank-index', index.toString());
      row.draggable = true;

      const rankBadge =
        rank === 1
          ? '🥇 #1'
          : rank === 2
          ? '🥈 #2'
          : rank === 3
          ? '🥉 #3'
          : `#${rank}`;

      const badgeText = getStrategyBadge(strategy.id);
      const statsText =
        summary.totalRankings > 0 && avgRank > 0
          ? `Avg Rank #${avgRank.toFixed(1)} · ${borda} pts`
          : 'Drag to reorder';

      row.innerHTML = `
        <div class="ab-row-main">
          <div class="ab-rank-col">
            <span class="ab-drag-handle" title="Drag to reorder rank">⋮⋮</span>
            <span class="ab-rank-badge rank-badge-${rank}">${rankBadge}</span>
          </div>

          <div class="ab-info-col">
            <div class="ab-name-line">
              <span class="ab-badge">${badgeText}</span>
              <span class="ab-name">${strategy.name}</span>
              ${isLeading ? '<span class="ab-leading-pill">👑 Top Scorer</span>' : ''}
            </div>
            <span class="ab-desc">${strategy.description}</span>
          </div>

          <!-- Highlighted High-Visibility Metrics Block -->
          <div class="ab-metrics-focus">
            <div class="ab-metric-chip ab-metric-score">
              <span class="ab-metric-lbl">SCORE</span>
              <span class="ab-metric-num">${scoreDisplay}</span>
            </div>
            <div class="ab-metric-chip ab-metric-accuracy">
              <span class="ab-metric-lbl">ACCURACY</span>
              <span class="ab-metric-num">${accuracyDisplay}</span>
            </div>
          </div>

          <!-- Quick Move Controls for Touch / Keyboard -->
          <div class="ab-reorder-group">
            <button class="ab-rank-btn ab-rank-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>▲</button>
            <button class="ab-rank-btn ab-rank-down" title="Move Down" ${index === orderedIds.length - 1 ? 'disabled' : ''}>▼</button>
          </div>
        </div>

        <div class="ab-row-meta">
          <span class="ab-rank-stats">${statsText}</span>
          <span class="ab-rank-hint">Click row to preview algorithm</span>
        </div>
      `;

      // Drag and Drop Events
      row.addEventListener('dragstart', (e) => {
        this.draggedIndex = index;
        row.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', index.toString());
        }
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (this.draggedIndex !== null && this.draggedIndex !== index) {
          this.moveRank(this.draggedIndex, index);
        }
        this.draggedIndex = null;
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        row.classList.remove('drag-over');
        this.draggedIndex = null;
      });

      // Quick Reorder Button Clicks
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target && target.classList.contains('ab-rank-up')) {
          e.stopPropagation();
          if (index > 0) this.moveRank(index, index - 1);
        } else if (target && target.classList.contains('ab-rank-down')) {
          e.stopPropagation();
          if (index < orderedIds.length - 1) this.moveRank(index, index + 1);
        } else {
          this.handleSelect(strategy);
        }
      });

      container.appendChild(row);
    });
  }

  private handleSelect(strategy: IScoreStrategy): void {
    this.strategyManager.setActiveStrategy(strategy.id);
    this.options?.onSelectStrategy?.(strategy);
    this.renderList();
  }

  public updateVoteSummary(summary: ScorerRankingSummary): void {
    if (this.totalVotesBadgeEl) {
      this.totalVotesBadgeEl.textContent = `${summary.totalRankings} rankings`;
    }

    if (this.leadingBadgeEl) {
      if (summary.totalRankings > 0 && summary.leadingStrategyId) {
        const leading = this.strategyManager.getStrategy(summary.leadingStrategyId);
        const avg = summary.averageRank[leading.id]?.toFixed(1) ?? '1.0';
        const borda = summary.bordaScore[leading.id] ?? 0;
        this.leadingBadgeEl.textContent = `${leading.name} (Avg #${avg} · ${borda} pts)`;
      } else {
        this.leadingBadgeEl.textContent = 'None yet (Rank below!)';
      }
    }

    if (this.listContainerEl && this.listContainerEl.children.length > 0) {
      this.renderList();
    }
  }

  public open(): void {
    if (this.panelEl) {
      this.panelEl.classList.remove('hidden');
    }
  }

  public close(): void {
    if (this.panelEl) {
      this.panelEl.classList.add('hidden');
    }
  }

  public toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.renderList();
      this.open();
    }
  }

  public isOpen(): boolean {
    return this.panelEl !== null && !this.panelEl.classList.contains('hidden');
  }
}
