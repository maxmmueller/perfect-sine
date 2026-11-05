import { SessionHistoryService, SessionSummary } from '../model/SessionHistoryService';

/**
 * HudView
 * Coordinates the DOM-based Score/Highscore HUD overlay and the Spotify-Wrapped summary modal.
 */
export class HudView {
  private readonly sessionService: SessionHistoryService;
  private readonly currentScoreEl: HTMLElement | null;
  private readonly highscoreEl: HTMLElement | null;
  private readonly wrappedBtn: HTMLElement | null;
  private readonly modalEl: HTMLElement | null;
  private readonly closeBtn: HTMLElement | null;
  private readonly resumeBtn: HTMLElement | null;
  private readonly resetBtn: HTMLElement | null;

  // Modal Stat Elements
  private readonly personaTitleEl: HTMLElement | null;
  private readonly personaSubtitleEl: HTMLElement | null;
  private readonly statHighscoreEl: HTMLElement | null;
  private readonly statAvgAccuracyEl: HTMLElement | null;
  private readonly statAttemptsEl: HTMLElement | null;
  private readonly statCyclesEl: HTMLElement | null;
  private readonly statConsistencyEl: HTMLElement | null;
  private readonly statStreakEl: HTMLElement | null;

  constructor(sessionService: SessionHistoryService) {
    this.sessionService = sessionService;

    // Cache HUD DOM references
    this.currentScoreEl = document.getElementById('hud-current-score');
    this.highscoreEl = document.getElementById('hud-highscore');
    this.wrappedBtn = document.getElementById('wrapped-btn');
    this.modalEl = document.getElementById('wrapped-modal');
    this.closeBtn = document.getElementById('modal-close-x');
    this.resumeBtn = document.getElementById('modal-resume-btn');
    this.resetBtn = document.getElementById('modal-reset-btn');

    // Cache Modal Stat Elements
    this.personaTitleEl = document.getElementById('modal-persona-title');
    this.personaSubtitleEl = document.getElementById('modal-persona-subtitle');
    this.statHighscoreEl = document.getElementById('stat-highscore');
    this.statAvgAccuracyEl = document.getElementById('stat-avg-accuracy');
    this.statAttemptsEl = document.getElementById('stat-attempts');
    this.statCyclesEl = document.getElementById('stat-cycles');
    this.statConsistencyEl = document.getElementById('stat-consistency');
    this.statStreakEl = document.getElementById('stat-streak');

    this.bindEvents();
    this.update(this.sessionService.getSummary());

    // Subscribe to reactive session history updates
    this.sessionService.subscribe((summary) => this.update(summary));
  }

  private bindEvents(): void {
    if (this.wrappedBtn) {
      this.wrappedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openModal();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closeModal());
    }

    if (this.resumeBtn) {
      this.resumeBtn.addEventListener('click', () => this.closeModal());
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => {
        this.sessionService.clear();
      });
    }

    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl || (e.target as HTMLElement).classList.contains('modal-backdrop')) {
          this.closeModal();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isModalOpen()) {
        this.closeModal();
      }
    });
  }

  public update(summary: SessionSummary): void {
    if (this.currentScoreEl) {
      this.currentScoreEl.textContent =
        summary.latestScore > 0 ? `${summary.latestScore.toLocaleString()} pts` : '-';
    }

    if (this.highscoreEl) {
      this.highscoreEl.textContent = `${summary.highscore.toLocaleString()} pts`;
    }

    if (this.personaTitleEl) {
      this.personaTitleEl.textContent = summary.persona.title;
    }

    if (this.personaSubtitleEl) {
      this.personaSubtitleEl.textContent = summary.persona.subtitle;
    }

    if (this.statHighscoreEl) {
      this.statHighscoreEl.textContent = `${summary.highscore.toLocaleString()} pts`;
    }

    if (this.statAvgAccuracyEl) {
      this.statAvgAccuracyEl.textContent = `${summary.averageAccuracy}%`;
    }

    if (this.statAttemptsEl) {
      this.statAttemptsEl.textContent = `${summary.totalAttempts}`;
    }

    if (this.statCyclesEl) {
      this.statCyclesEl.textContent = `${summary.totalCyclesDrawn.toFixed(1)} waves`;
    }

    if (this.statConsistencyEl) {
      this.statConsistencyEl.textContent = `${summary.consistencyScore} / 100`;
    }

    if (this.statStreakEl) {
      this.statStreakEl.textContent = `${summary.streakCount} 🔥`;
    }
  }

  public openModal(): void {
    if (this.modalEl) {
      this.update(this.sessionService.getSummary());
      this.modalEl.classList.remove('hidden');
    }
  }

  public closeModal(): void {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
  }

  public isModalOpen(): boolean {
    return this.modalEl !== null && !this.modalEl.classList.contains('hidden');
  }
}
