import './dev-tools.css';
import { GameStateMachine } from '../model/GameStateMachine';
import { StrokeBuffer } from '../model/StrokeBuffer';
import { DrawingController } from '../controller/DrawingController';
import { SessionHistoryService } from '../model/SessionHistoryService';
import { HudView } from '../view/HudView';
import { CurveRecorderService } from '../model/CurveRecorderService';
import { CurveRecorderView } from '../view/CurveRecorderView';
import { Point, StrokeEvaluation } from '../model/types';

export interface DevStrokePayload {
  readonly points: readonly Point[];
  readonly evaluation: StrokeEvaluation | null;
  readonly validationMessage: string | null;
}

export interface DevToolsContext {
  readonly controller: DrawingController;
  readonly stateMachine: GameStateMachine;
  readonly strokeBuffer: StrokeBuffer;
  readonly sessionService: SessionHistoryService;
  readonly hudView: HudView;
}

export interface DevToolsHandle {
  readonly recorderService: CurveRecorderService;
  readonly recorderView: CurveRecorderView;
  readonly onStrokeComplete: (stroke: DevStrokePayload) => void;
  readonly unsubscribeStateLogger: () => void;
}

interface DebugWindow extends Window {
  __perfectSine?: {
    controller: DrawingController;
    sessionService: SessionHistoryService;
    hudView: HudView;
    recorderService: CurveRecorderService;
    recorderView: CurveRecorderView;
  };
}

const RECORDER_BUTTON_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <circle cx="12" cy="12" r="4" fill="currentColor"></circle>
  </svg>
  <span id="record-badge" class="record-count-badge" style="display: none;">0</span>
`;

const RECORDER_PANEL_INNER_HTML = `
  <div class="recorder-drawer-header">
    <div class="recorder-title-group">
      <span class="recorder-tag">DATASET CAPTURE</span>
      <h3>Curve Recorder</h3>
      <p class="recorder-subtitle">Record your hand-drawn curves as reference dataset & export standalone example images.</p>
    </div>
    <button id="recorder-close-btn" class="recorder-close-btn" aria-label="Close Recorder">✕</button>
  </div>

  <div class="recorder-controls-strip">
    <button id="record-current-btn" class="btn-primary btn-sm">⏺ Record Last Stroke</button>
    <label class="recorder-toggle-label" title="Automatically record every curve you draw">
      <input type="checkbox" id="recorder-autorecord-toggle" checked />
      <span class="toggle-slider"></span>
      <span>Auto-Record</span>
    </label>
  </div>

  <div class="recorder-actions-bar">
    <button id="recorder-copy-ai-btn" class="btn-secondary btn-sm" title="Copy formatted JSON of all curves for AI / Antigravity">📋 Copy for AI</button>
    <button id="recorder-export-json-btn" class="btn-secondary btn-sm" title="Download all curves as JSON file">💾 Export JSON</button>
    <button id="recorder-import-json-btn" class="btn-secondary btn-sm" title="Import curves from JSON">📥 Import</button>
    <button id="recorder-clear-btn" class="btn-secondary btn-sm btn-danger-subtle" title="Clear recorded list">🗑 Clear</button>
  </div>

  <div class="recorder-summary-strip">
    <span class="recorder-strip-label">📁 Recorded Curves:</span>
    <span id="recorder-count" class="recorder-strip-val">0 curves</span>
  </div>

  <div id="recorder-curve-list" class="recorder-curve-list"></div>
`;

/**
 * Dynamically injects the Curve Recorder trigger button and drawer markup
 * into the DOM so production HTML stays free of dev UI elements.
 */
export function injectRecorderDom(doc: Document = document): void {
  if (!doc.getElementById('record-panel-btn')) {
    const hudMetrics = doc.querySelector('.hud-metrics');
    if (hudMetrics) {
      const btn = doc.createElement('button');
      btn.id = 'record-panel-btn';
      btn.className = 'record-btn';
      btn.setAttribute('aria-label', 'Record human curves');
      btn.setAttribute('title', 'Record Human Curves & Examples');
      btn.innerHTML = RECORDER_BUTTON_SVG.trim();
      hudMetrics.appendChild(btn);
    }
  }

  if (!doc.getElementById('recorder-panel')) {
    const appRoot = doc.getElementById('app') ?? doc.body;
    if (appRoot) {
      const panel = doc.createElement('aside');
      panel.id = 'recorder-panel';
      panel.className = 'recorder-drawer hidden';
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', 'Human Curve Recorder');
      panel.innerHTML = RECORDER_PANEL_INNER_HTML.trim();
      appRoot.appendChild(panel);
    }
  }
}

/**
 * Bootstraps all development-only helpers:
 * - Curve Recorder UI & auto-recording hook
 * - GameStateMachine console transition logger
 * - window.__perfectSine debug inspection handle
 */
export function setupDevTools(ctx: DevToolsContext): DevToolsHandle {
  injectRecorderDom();

  const recorderService = new CurveRecorderService();
  const recorderView = new CurveRecorderView(recorderService, {
    onReplayRequested: (points) => {
      ctx.controller.replayStroke(points, true);
    },
    onRecordCurrentRequested: () => {
      return ctx.controller.getLastDrawnStroke();
    },
  });

  const unsubscribeStateLogger = ctx.stateMachine.subscribe((next, old) => {
    console.log(`[GameStateMachine] ${old} -> ${next} (Points: ${ctx.strokeBuffer.getLength()})`);
  });

  if (typeof window !== 'undefined') {
    (window as DebugWindow).__perfectSine = {
      controller: ctx.controller,
      sessionService: ctx.sessionService,
      hudView: ctx.hudView,
      recorderService,
      recorderView,
    };
  }

  const onStrokeComplete = (stroke: DevStrokePayload): void => {
    if (recorderService.isAutoRecordEnabled() && stroke.points.length >= 2) {
      recorderService.addCurve({
        points: stroke.points,
        evaluation: stroke.evaluation,
        validationMessage: stroke.validationMessage,
      });
    }
  };

  return {
    recorderService,
    recorderView,
    onStrokeComplete,
    unsubscribeStateLogger,
  };
}
