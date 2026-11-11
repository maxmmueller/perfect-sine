import { SessionHistoryService, SessionSummary } from '../model/SessionHistoryService';
import { ShareCardGenerator, ShareCardSnapshot } from './ShareCardGenerator';

export interface HudViewOptions {
  readonly getWaveSnapshot?: () => ShareCardSnapshot | null;
}

/**
 * HudView
 * Coordinates the DOM-based Score/Highscore HUD overlay, Spotify-Wrapped share modal,
 * real PNG/Web-Share actions, and browser screenshot/capture triggers.
 */
export class HudView {
  private readonly sessionService: SessionHistoryService;
  private readonly getWaveSnapshot?: () => ShareCardSnapshot | null;

  private readonly currentScoreEl: HTMLElement | null;
  private readonly highscoreEl: HTMLElement | null;
  private readonly wrappedBtn: HTMLElement | null;
  private readonly modalEl: HTMLElement | null;
  private readonly closeBtn: HTMLElement | null;
  private readonly resumeBtn: HTMLElement | null;
  private readonly resetBtn: HTMLElement | null;

  // Share Controls
  private readonly shareBtn: HTMLElement | null;
  private readonly screenshotBtn: HTMLElement | null;
  private readonly copyBtn: HTMLElement | null;
  private readonly shareStatusEl: HTMLElement | null;
  private readonly sharePreviewEl: HTMLImageElement | null;
  private readonly sharePreviewWrapEl: HTMLElement | null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  // Modal Stat Elements
  private readonly personaTitleEl: HTMLElement | null;
  private readonly personaSubtitleEl: HTMLElement | null;
  private readonly statHighscoreEl: HTMLElement | null;
  private readonly statAvgAccuracyEl: HTMLElement | null;
  private readonly statAttemptsEl: HTMLElement | null;
  private readonly statCyclesEl: HTMLElement | null;
  private readonly statConsistencyEl: HTMLElement | null;
  private readonly statStreakEl: HTMLElement | null;

  constructor(sessionService: SessionHistoryService, options: HudViewOptions = {}) {
    this.sessionService = sessionService;
    this.getWaveSnapshot = options.getWaveSnapshot;

    // Cache HUD DOM references
    this.currentScoreEl = document.getElementById('hud-current-score');
    this.highscoreEl = document.getElementById('hud-highscore');
    this.wrappedBtn = document.getElementById('wrapped-btn');
    this.modalEl = document.getElementById('wrapped-modal');
    this.closeBtn = document.getElementById('modal-close-x');
    this.resumeBtn = document.getElementById('modal-resume-btn');
    this.resetBtn = document.getElementById('modal-reset-btn');

    // Cache Share Controls
    this.shareBtn = document.getElementById('modal-share-btn');
    this.screenshotBtn = document.getElementById('modal-screenshot-btn');
    this.copyBtn = document.getElementById('modal-copy-btn');
    this.shareStatusEl = document.getElementById('modal-share-status');
    this.sharePreviewEl = document.getElementById('modal-share-preview') as HTMLImageElement | null;
    this.sharePreviewWrapEl = document.getElementById('modal-share-preview-wrap');

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
    this.sessionService.subscribe((summary) => {
      this.update(summary);
      if (this.isModalOpen()) {
        this.refreshSharePreview(summary);
      }
    });
  }

  /**
   * Detects best-effort browser/OS screenshot key combinations.
   * Note: OS-level shortcuts like macOS Cmd+Shift+3/4/5 may be intercepted by the OS before reaching JS.
   */
  public static isScreenshotShortcut(e: Partial<KeyboardEvent>): boolean {
    const key = typeof e.key === 'string' ? e.key : '';
    const code = typeof e.code === 'string' ? e.code : '';
    const keyLower = key.toLowerCase();

    if (key === 'PrintScreen' || code === 'PrintScreen') {
      return true;
    }

    // Firefox / Edge browser screenshot chords: Ctrl+Shift+S or Cmd+Shift+S
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && keyLower === 's') {
      return true;
    }

    // macOS screenshot chords (if passed through to the page)
    if (
      e.metaKey &&
      e.shiftKey &&
      (key === '3' ||
        key === '4' ||
        key === '5' ||
        code === 'Digit3' ||
        code === 'Digit4' ||
        code === 'Digit5')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detects the bare in-app Share / Capture shortcut key ('S').
   */
  public static isInAppShareShortcut(e: Partial<KeyboardEvent>): boolean {
    const keyLower = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    return keyLower === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat;
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object') return false;
    const el = target as { tagName?: string; isContentEditable?: boolean };
    if (el.isContentEditable) return true;
    const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
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
        this.setShareStatus('Session stats cleared.');
      });
    }

    if (this.shareBtn) {
      this.shareBtn.addEventListener('click', () => {
        void this.handleShare();
      });
    }

    if (this.screenshotBtn) {
      this.screenshotBtn.addEventListener('click', () => {
        this.handleDownloadScreenshot();
      });
    }

    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => {
        void this.handleCopy();
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
        return;
      }

      if (this.isEditableTarget(e.target)) {
        return;
      }

      if (HudView.isScreenshotShortcut(e) && !this.isModalOpen()) {
        this.openModal('Share card ready from screenshot trigger.');
        return;
      }

      if (HudView.isInAppShareShortcut(e) && !this.isModalOpen()) {
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        this.openModal('Share card ready.');
      }
    });

    // Some browsers emit PrintScreen exclusively on keyup
    window.addEventListener('keyup', (e) => {
      if (this.isEditableTarget(e.target)) return;
      if ((e.key === 'PrintScreen' || e.code === 'PrintScreen') && !this.isModalOpen()) {
        this.openModal('Share card ready from PrintScreen.');
      }
    });

    // Open share summary cleanly when user opens Print / Save-as-PDF
    window.addEventListener('beforeprint', () => {
      if (!this.isModalOpen()) {
        this.openModal('Share card ready.');
      }
    });
  }

  private getSnapshot(): ShareCardSnapshot {
    const base = this.getWaveSnapshot?.() ?? null;
    const defaultUrl = typeof window !== 'undefined' && window.location ? window.location.href : undefined;
    return {
      stroke: base?.stroke ?? null,
      sourceCanvas: base?.sourceCanvas ?? null,
      url: base?.url ?? defaultUrl,
    };
  }

  private refreshSharePreview(summary: SessionSummary): void {
    if (!this.sharePreviewEl || !this.sharePreviewWrapEl) return;

    try {
      const dataUrl = ShareCardGenerator.toDataUrl(summary, this.getSnapshot());
      if (dataUrl) {
        this.sharePreviewEl.src = dataUrl;
        this.sharePreviewWrapEl.classList.remove('hidden');
        return;
      }
    } catch {
      // Gracefully hide preview in headless/mock DOM environments without canvas
    }
    this.sharePreviewWrapEl.classList.add('hidden');
  }

  private setShareStatus(message: string, isError: boolean = false): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    if (!this.shareStatusEl) return;

    this.shareStatusEl.textContent = message;
    if (this.shareStatusEl.classList) {
      if (isError) {
        this.shareStatusEl.classList.add('is-error');
      } else {
        this.shareStatusEl.classList.remove('is-error');
      }
    }

    if (message) {
      this.statusTimer = setTimeout(() => {
        if (this.shareStatusEl) {
          this.shareStatusEl.textContent = '';
        }
      }, 3200);
    }
  }

  public async handleShare(): Promise<void> {
    const summary = this.sessionService.getSummary();
    const outcome = await ShareCardGenerator.share(summary, this.getSnapshot());
    this.setShareStatus(outcome.message, outcome.status === 'error');
  }

  public handleDownloadScreenshot(): void {
    const summary = this.sessionService.getSummary();
    const ok = ShareCardGenerator.downloadShareCard(summary, this.getSnapshot());
    this.setShareStatus(
      ok ? 'Saved Share Card PNG!' : 'Could not save PNG in this environment.',
      !ok
    );
  }

  public async handleCopy(): Promise<void> {
    const summary = this.sessionService.getSummary();
    const outcome = await ShareCardGenerator.copyShareCard(summary, this.getSnapshot());
    this.setShareStatus(outcome.message, outcome.status === 'error');
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

  public openModal(initialStatus?: string): void {
    if (this.modalEl) {
      const summary = this.sessionService.getSummary();
      this.update(summary);
      this.refreshSharePreview(summary);
      this.modalEl.classList.remove('hidden');
      this.setShareStatus(initialStatus ?? '');
    }
  }

  public closeModal(): void {
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
      this.setShareStatus('');
    }
  }

  public isModalOpen(): boolean {
    return this.modalEl !== null && !this.modalEl.classList.contains('hidden');
  }
}
