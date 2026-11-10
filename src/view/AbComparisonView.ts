import { ScoreStrategyManager, ScorerEvaluationItem, ScorerVoteSummary } from '../model/scoring/ScoreStrategyManager';
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
 * Manages the comparative A/B Scorer list panel, displaying all 5 mathematical scoring
 * algorithms simultaneously for each drawn curve and collecting empirical user preference votes.
 */
export class AbComparisonView {
  private readonly strategyManager: ScoreStrategyManager;
  private readonly options?: AbComparisonViewOptions;
  private readonly panelEl: HTMLElement | null;
  private readonly listContainerEl: HTMLElement | null;
  private readonly toggleBtnEl: HTMLElement | null;
  private readonly closeBtnEl: HTMLElement | null;
  private readonly clearVotesBtnEl: HTMLElement | null;
  private readonly totalVotesBadgeEl: HTMLElement | null;
  private readonly leadingBadgeEl: HTMLElement | null;

  private currentEvaluations: ScorerEvaluationItem[] = [];
  private votedStrategyId: string | null = null;

  constructor(strategyManager: ScoreStrategyManager, options?: AbComparisonViewOptions) {
    this.strategyManager = strategyManager;
    this.options = options;

    this.panelEl = document.getElementById('ab-panel');
    this.listContainerEl = document.getElementById('ab-scorer-list');
    this.toggleBtnEl = document.getElementById('ab-toggle-btn');
    this.closeBtnEl = document.getElementById('ab-close-btn');
    this.clearVotesBtnEl = document.getElementById('ab-clear-votes-btn');
    this.totalVotesBadgeEl = document.getElementById('ab-total-votes');
    this.leadingBadgeEl = document.getElementById('ab-leading-name');

    this.bindEvents();
    this.strategyManager.subscribeVotes((summary) => this.updateVoteSummary(summary));
    this.updateVoteSummary(this.strategyManager.getVoteSummary());
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

    if (this.clearVotesBtnEl) {
      this.clearVotesBtnEl.addEventListener('click', () => {
        this.strategyManager.clearVotes();
        this.votedStrategyId = null;
        this.renderList();
      });
    }
  }

  public showEvaluations(items: ScorerEvaluationItem[]): void {
    this.currentEvaluations = items;
    this.votedStrategyId = null; // reset vote for current new wave attempt
    this.renderList();
    this.open();
  }

  public renderList(): void {
    const container = this.listContainerEl;
    if (!container) return;

    const summary = this.strategyManager.getVoteSummary();
    const activeStrategy = this.strategyManager.getActiveStrategy();

    // If no wave evaluations yet, display initial registry view
    const items: {
      strategy: IScoreStrategy;
      score?: number;
      accuracy?: number;
    }[] =
      this.currentEvaluations.length > 0
        ? this.currentEvaluations.map((item) => ({
            strategy: item.strategy,
            score: item.evaluation.score,
            accuracy: item.evaluation.accuracy,
          }))
        : this.strategyManager.getAllStrategies().map((strategy) => ({
            strategy,
          }));

    container.innerHTML = '';

    items.forEach((item) => {
      const { strategy, score, accuracy } = item;
      const votes = summary.votesPerStrategy[strategy.id] ?? 0;
      const percentage = summary.percentages[strategy.id] ?? 0;
      const isSelected = strategy.id === activeStrategy.id;
      const isVoted = strategy.id === this.votedStrategyId;
      const isLeading = strategy.id === summary.leadingStrategyId && summary.totalVotes > 0;

      const row = document.createElement('div');
      row.className = `ab-scorer-row ${isSelected ? 'active-strategy' : ''} ${isVoted ? 'voted-best' : ''}`;
      row.setAttribute('data-strategy-id', strategy.id);

      const badgeText = getStrategyBadge(strategy.id);
      const scoreDisplay = score !== undefined ? `${score.toLocaleString()} pts` : '-';
      const accuracyDisplay = accuracy !== undefined ? `${accuracy.toFixed(1)}%` : '-';

      row.innerHTML = `
        <div class="ab-row-top">
          <span class="ab-badge">${badgeText}</span>
          <div class="ab-info">
            <div class="ab-name-line">
              <span class="ab-name">${strategy.name}</span>
              ${isLeading ? '<span class="ab-leading-pill">👑 Leading</span>' : ''}
            </div>
            <span class="ab-desc">${strategy.description}</span>
          </div>
          <div class="ab-scores">
            <span class="ab-score-val">${scoreDisplay}</span>
            <span class="ab-accuracy-val">${accuracyDisplay}</span>
          </div>
        </div>
        <div class="ab-vote-bar-wrap">
          <div class="ab-vote-bar" style="width: ${percentage}%"></div>
        </div>
        <div class="ab-row-actions">
          <span class="ab-vote-stats">${votes} votes (${percentage}%)</span>
          <button class="ab-vote-btn ${isVoted ? 'voted' : ''}" data-strategy-id="${strategy.id}">
            ${isVoted ? '✓ Voted Best' : 'Vote as Best'}
          </button>
        </div>
      `;

      // Click row to activate strategy on canvas
      row.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target && target.classList.contains('ab-vote-btn')) {
          this.handleVote(strategy.id);
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

  private handleVote(strategyId: string): void {
    this.votedStrategyId = strategyId;
    this.strategyManager.recordVote(strategyId);
    const strategy = this.strategyManager.getStrategy(strategyId);
    this.handleSelect(strategy);
  }

  public updateVoteSummary(summary: ScorerVoteSummary): void {
    if (this.totalVotesBadgeEl) {
      this.totalVotesBadgeEl.textContent = `${summary.totalVotes} votes`;
    }

    if (this.leadingBadgeEl) {
      if (summary.totalVotes > 0 && summary.leadingStrategyId) {
        const leading = this.strategyManager.getStrategy(summary.leadingStrategyId);
        this.leadingBadgeEl.textContent = `${leading.name} (${summary.percentages[leading.id]}%)`;
      } else {
        this.leadingBadgeEl.textContent = 'None yet (Vote below!)';
      }
    }

    // Refresh row progress bars without wiping user selection if list is populated
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
