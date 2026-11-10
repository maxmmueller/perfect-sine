import { CurveRecorderService } from '../model/CurveRecorderService';
import { CurveImageExporter } from './CurveImageExporter';
import { Point, RecordedCurve } from '../model/types';

export interface CurveRecorderViewOptions {
  onReplayRequested?: (points: readonly Point[]) => void;
  onRecordCurrentRequested?: () => {
    points: readonly Point[];
    evaluation: RecordedCurve['evaluation'];
    validationMessage?: string | null;
  } | null;
}

/**
 * CurveRecorderView
 * Manages the UI panel for human curve recording, gallery thumbnails,
 * label annotations, AI JSON copy, and standalone PNG image downloads.
 */
export class CurveRecorderView {
  private readonly service: CurveRecorderService;
  private readonly options: CurveRecorderViewOptions;

  private readonly panelBtn: HTMLElement | null;
  private readonly badgeEl: HTMLElement | null;
  private readonly panelEl: HTMLElement | null;
  private readonly closeBtn: HTMLElement | null;
  private readonly recordCurrentBtn: HTMLElement | null;
  private readonly autoRecordToggle: HTMLInputElement | null;
  private readonly copyAiBtn: HTMLElement | null;
  private readonly exportJsonBtn: HTMLElement | null;
  private readonly importJsonBtn: HTMLElement | null;
  private readonly clearBtn: HTMLElement | null;
  private readonly listEl: HTMLElement | null;
  private readonly countEl: HTMLElement | null;
  private toastEl: HTMLElement | null = null;

  constructor(service: CurveRecorderService, options: CurveRecorderViewOptions = {}) {
    this.service = service;
    this.options = options;

    this.panelBtn = document.getElementById('record-panel-btn');
    this.badgeEl = document.getElementById('record-badge');
    this.panelEl = document.getElementById('recorder-panel');
    this.closeBtn = document.getElementById('recorder-close-btn');
    this.recordCurrentBtn = document.getElementById('record-current-btn');
    this.autoRecordToggle = document.getElementById('recorder-autorecord-toggle') as HTMLInputElement | null;
    this.copyAiBtn = document.getElementById('recorder-copy-ai-btn');
    this.exportJsonBtn = document.getElementById('recorder-export-json-btn');
    this.importJsonBtn = document.getElementById('recorder-import-json-btn');
    this.clearBtn = document.getElementById('recorder-clear-btn');
    this.listEl = document.getElementById('recorder-curve-list');
    this.countEl = document.getElementById('recorder-count');

    this.createToastElement();
    this.bindEvents();
    this.render();

    this.service.subscribe(() => {
      this.render();
    });
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
    if (this.panelEl) {
      this.panelEl.classList.toggle('hidden');
    }
  }

  public showToast(message: string, durationMs: number = 3000): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');
    setTimeout(() => {
      if (this.toastEl) this.toastEl.classList.remove('visible');
    }, durationMs);
  }

  private createToastElement(): void {
    if (typeof document === 'undefined') return;
    let toast = document.getElementById('recorder-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'recorder-toast';
      toast.className = 'recorder-toast';
      document.body.appendChild(toast);
    }
    this.toastEl = toast;
  }

  private bindEvents(): void {
    if (this.panelBtn) {
      this.panelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
    }

    if (this.autoRecordToggle) {
      this.autoRecordToggle.checked = this.service.isAutoRecordEnabled();
      this.autoRecordToggle.addEventListener('change', () => {
        if (this.autoRecordToggle) {
          this.service.setAutoRecordEnabled(this.autoRecordToggle.checked);
          this.showToast(`Auto-Record ${this.autoRecordToggle.checked ? 'Enabled' : 'Disabled'}`);
        }
      });
    }

    if (this.recordCurrentBtn) {
      this.recordCurrentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const strokeData = this.options.onRecordCurrentRequested?.();
        if (!strokeData || strokeData.points.length < 2) {
          this.showToast('⚠️ No curve drawn on canvas yet!');
          return;
        }

        const recorded = this.service.addCurve({
          points: strokeData.points,
          evaluation: strokeData.evaluation,
          validationMessage: strokeData.validationMessage,
        });
        this.showToast(`✅ Recorded "${recorded.label}"!`);
      });
    }

    if (this.copyAiBtn) {
      this.copyAiBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const curves = this.service.getCurves();
        if (curves.length === 0) {
          this.showToast('No curves to copy. Draw and record one first!');
          return;
        }

        const json = this.service.exportAsJson();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(json);
            this.showToast(`📋 Copied ${curves.length} curves to clipboard! Paste into Antigravity.`);
          } else {
            prompt('Copy curves JSON below:', json);
          }
        } catch {
          prompt('Copy curves JSON below:', json);
        }
      });
    }

    if (this.exportJsonBtn) {
      this.exportJsonBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const curves = this.service.getCurves();
        if (curves.length === 0) {
          this.showToast('No curves to export.');
          return;
        }

        const json = this.service.exportAsJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `perfect-sine-human-curves-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showToast(`💾 Downloaded ${curves.length} curves as JSON!`);
      });
    }

    if (this.importJsonBtn) {
      this.importJsonBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = prompt('Paste Recorded Curves JSON here:');
        if (!input || input.trim().length === 0) return;

        const res = this.service.importFromJson(input);
        if (res.imported > 0) {
          this.showToast(`📥 Successfully imported ${res.imported} curves!`);
        } else {
          this.showToast(`⚠️ Import failed: ${res.errors[0] || 'Invalid format'}`);
        }
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Clear all recorded human curves?')) {
          this.service.clearAll();
          this.showToast('Cleared all recorded curves.');
        }
      });
    }
  }

  public render(): void {
    const curves = this.service.getCurves();

    // Update Badge
    if (this.badgeEl) {
      this.badgeEl.textContent = String(curves.length);
      this.badgeEl.style.display = curves.length > 0 ? 'inline-flex' : 'none';
    }

    // Update Count
    if (this.countEl) {
      this.countEl.textContent = `${curves.length} ${curves.length === 1 ? 'curve' : 'curves'}`;
    }

    // Update List
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (curves.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'recorder-empty-state';
      emptyEl.innerHTML = `
        <div class="recorder-empty-icon">🎨</div>
        <h4>No curves recorded yet</h4>
        <p>Draw a sine wave on the canvas with your hand, then click <b>"Record Current Stroke"</b> or turn on <b>Auto-Record</b>.</p>
      `;
      this.listEl.appendChild(emptyEl);
      return;
    }

    for (const curve of curves) {
      const card = this.createCurveCard(curve);
      this.listEl.appendChild(card);
    }
  }

  private createCurveCard(curve: RecordedCurve): HTMLElement {
    const card = document.createElement('div');
    card.className = 'recorder-card';
    card.setAttribute('data-id', curve.id);

    // 1. Thumbnail Image
    const thumbWrapper = document.createElement('div');
    thumbWrapper.className = 'recorder-thumb-wrapper';

    let thumbUrl: string;
    try {
      thumbUrl = curve.thumbnailDataUrl || CurveImageExporter.renderThumbnailDataUrl(curve);
    } catch {
      thumbUrl = '';
    }

    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = curve.label;
      img.className = 'recorder-thumb-img';
      thumbWrapper.appendChild(img);
    } else {
      thumbWrapper.textContent = 'Curve Preview';
    }

    // 2. Info / Meta Area
    const info = document.createElement('div');
    info.className = 'recorder-card-info';

    // Editable Label
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'recorder-card-label-input';
    labelInput.value = curve.label;
    labelInput.placeholder = 'Label this curve...';
    labelInput.addEventListener('change', () => {
      this.service.updateLabel(curve.id, labelInput.value);
    });
    info.appendChild(labelInput);

    // Stats Chips
    const chips = document.createElement('div');
    chips.className = 'recorder-card-chips';

    if (curve.evaluation) {
      const acc = curve.evaluation.accuracy.toFixed(1);
      const accClass = curve.evaluation.accuracy >= 80 ? 'chip-green' : curve.evaluation.accuracy >= 60 ? 'chip-yellow' : 'chip-red';
      chips.innerHTML += `<span class="recorder-chip ${accClass}">${acc}%</span>`;
      chips.innerHTML += `<span class="recorder-chip chip-gold">${curve.evaluation.score.toLocaleString()} pts</span>`;
      chips.innerHTML += `<span class="recorder-chip">${curve.evaluation.fittedSine.fullCycles.toFixed(1)} cyc</span>`;
      chips.innerHTML += `<span class="recorder-chip">${curve.evaluation.fittedSine.amplitude.toFixed(0)}px</span>`;
    } else if (curve.validationMessage) {
      chips.innerHTML += `<span class="recorder-chip chip-red">⚠️ ${curve.validationMessage.substring(0, 16)}</span>`;
    } else {
      chips.innerHTML += `<span class="recorder-chip">${curve.points.length} pts</span>`;
    }
    info.appendChild(chips);

    // 3. Card Action Buttons
    const actions = document.createElement('div');
    actions.className = 'recorder-card-actions';

    // Replay
    const replayBtn = document.createElement('button');
    replayBtn.className = 'btn-secondary btn-xs';
    replayBtn.title = 'Replay this curve on canvas';
    replayBtn.innerHTML = '▶ Replay';
    replayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.options.onReplayRequested?.(curve.points);
      this.close();
    });
    actions.appendChild(replayBtn);

    // Download Image
    const downloadImgBtn = document.createElement('button');
    downloadImgBtn.className = 'btn-secondary btn-xs';
    downloadImgBtn.title = 'Download standalone PNG example image';
    downloadImgBtn.innerHTML = '📥 Image';
    downloadImgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      CurveImageExporter.downloadImage(curve);
      this.showToast(`📥 Downloaded "${curve.label}.png"`);
    });
    actions.appendChild(downloadImgBtn);

    // Copy JSON
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary btn-xs';
    copyBtn.title = 'Copy curve JSON to clipboard for AI';
    copyBtn.innerHTML = '📋 Copy';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const singleJson = JSON.stringify(
        {
          label: curve.label,
          metrics: curve.metrics,
          validationMessage: curve.validationMessage,
          points: curve.points,
          evaluation: curve.evaluation,
        },
        null,
        2
      );
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(singleJson);
          this.showToast(`📋 Copied "${curve.label}" JSON! Paste into chat.`);
        } else {
          prompt('Copy curve JSON:', singleJson);
        }
      } catch {
        prompt('Copy curve JSON:', singleJson);
      }
    });
    actions.appendChild(copyBtn);

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-xs';
    deleteBtn.title = 'Delete curve';
    deleteBtn.innerHTML = '🗑';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.service.deleteCurve(curve.id);
      this.showToast('Deleted curve.');
    });
    actions.appendChild(deleteBtn);

    card.appendChild(thumbWrapper);
    card.appendChild(info);
    card.appendChild(actions);

    return card;
  }
}
