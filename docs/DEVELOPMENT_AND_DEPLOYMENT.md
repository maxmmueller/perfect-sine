# Development, Dev Isolation & Deployment

This guide covers environment separation (`VITE_DEV_TOOLS`), developer utilities, testing & coverage enforcement, sharing workflows, and CI/CD deployment.

---

## 1. Environment Modes & Dev Tooling Isolation

Internal dataset-capture and diagnostic tools are **completely stripped from production bundles** using Vite's compile-time environment replacement (`import.meta.env.VITE_DEV_TOOLS`). No separate Git branch is required; both development and production behaviors live in `main` and can be tested side-by-side locally.

### Environment Configuration Files

| File | Mode | `VITE_DEV_TOOLS` | Behavior |
| :--- | :--- | :--- | :--- |
| `.env.development` | `npm run dev` | `true` | Dynamically imports [`src/dev/setupDevTools.ts`](../src/dev/setupDevTools.ts), injects the Curve Recorder HUD button & drawer, loads [`src/dev/dev-tools.css`](../src/dev/dev-tools.css), logs state transitions, and attaches `window.__perfectSine`. |
| `.env.production` | `npm run dev:prod` / `npm run build` | `false` | Eliminates `setupDevTools` and dev CSS/views from the production Rollup bundle; `index.html` ships clean without dev buttons or banners. |

### IDE One-Click Launch (`.vscode/tasks.json`)

The repository provides preconfigured VS Code / Antigravity workspace tasks:
- **`Perfect Sine: Start Dev Mode (with Recorder & Debug)`** — runs `npm run dev` (`VITE_DEV_TOOLS=true`).
- **`Perfect Sine: Start Prod Mode (No Dev Tools, Instant)`** — runs `npm run dev:prod` (`vite --mode production --port 3001`) for instant hot-reload testing of the clean player UI.
- **`Perfect Sine: Build & Preview Real Prod Bundle`** — runs `npm run preview:prod` (`tsc && vite build && vite preview --port 4173 --open`) to inspect the minified Rollup output locally.

---

## 2. Developer & Data Capture Tools

When `VITE_DEV_TOOLS === 'true'`, [`setupDevTools`](../src/dev/setupDevTools.ts) mounts the following utilities:

1. **Curve Recorder (`CurveRecorderService` & `CurveRecorderView`):**
   - Automatically or manually records every drawn stroke alongside timestamps, evaluation metrics (`score`, `accuracy`, `fullCycles`, `amplitude`, `wavelength`, `r2`, `tiltAngle`), validation messages, and SVG/PNG thumbnails.
   - Persists recordings in `localStorage` (`perfect_sine_recorded_curves_v1`) and supports custom labels, replay on canvas, **Copy for AI** / JSON export, and JSON import (`CurveRecorderService.importFromJson`).
2. **Batch SVG Curve Exporter (`CurveImageExporter` & `scripts/export_curve_images.ts`):**
   - `CurveImageExporter.renderToSvg` renders recorded curves headlessly into standalone SVG visuals (e.g. `recorded_curves/images/curve_sample_*.svg`).
   - Run via `npm run export-curves` (`vite-node scripts/export_curve_images.ts`) using `recorded_curves/example_curves.json`.
3. **A/B Scorer Comparison View (`AbComparisonView`):**
   - Companion debug drawer capable of displaying side-by-side results from `ScoreStrategyManager.evaluateAll` and capturing ranked human preferences using Borda Count aggregation.

---

## 3. Current-Wave Sharing & Screenshot Triggers

Available in all builds, after an own drawing has been completed:

- **Eligibility:** `main.ts` supplies a snapshot only in `LOCKED` state while the
  demo is stopped. It refreshes `HudView.updateShareAvailability()` on state
  changes. The `LOCKED` refresh runs in a microtask because the controller captures
  `lastDrawnStroke` immediately after that transition. Idle, a running demo,
  in-progress drawings, reset and reload cannot expose an older or synthetic wave.
  Session history never unlocks sharing. A single-point click is not shareable.
- **Dialog:** One preview with Share, Save PNG and Copy. Close with the X, Escape
  or the backdrop. Native button disabling and guards on `openModal()` and all
  export handlers prevent shortcut/programmatic bypasses.
- **Card:** `ShareCardGenerator` accepts only `ShareCardSnapshot`, with no
  `SessionSummary` or source-canvas input. Its `960 x 960` PNG contains the actual
  stroke, its current accuracy and score. The footer groups the link directly beside the
  small wave mark; cycle counts are omitted from image and text exports. The drawing region
  is `{ x: 60, y: 320, w: 840, h: 420 }`. Invalid completed attempts display their
  validation message without invented accuracy or score. No demo/example
  fallback exists. Live/evaluated strokes and share images use the same
  `GradientStrokeRenderer.drawGradientStroke()` for exact point colors, smooth
  per-segment gradients and matching round outer end caps. Export only maps
  coordinates into the card; it never rounds hues or replaces color saturation.
  `canShare()` requires at least two captured points; direct
  render calls reject missing drawings and share/copy/download APIs return errors
  or false before browser side effects.
- **Native share and fallbacks:** File sharing uses `perfect-sine-wave.png`.
  Clipboard text and native text/URL fallbacks contain only the same current-wave
  results and link. Session statistics never enter any export path.
- **Shortcuts:** Bare `S`, supported screenshot chords, PrintScreen keyup and
  `beforeprint` open the dialog only when the current completed drawing is
  shareable. Typing in editable fields and browser Ctrl+S remain unaffected.

---

### Fixed dark appearance

The root CSS palette and native browser color scheme are always dark.
[`ThemeView.ts`](../src/view/ThemeView.ts) returns the same immutable dark colors
for the canvas and share exports without accessing the DOM, system preference or
storage. The theme switch and saved-theme initialization have been removed;
older `perfect-sine-theme` values cannot change the appearance. Session history
storage is unaffected.

### Typography

All UI text, scores, numerical metrics, canvas messages and share-card labels
use the platform system sans-serif. Only the brand logo retains outlined Kalam
lettering. [`Typography.ts`](../src/view/Typography.ts) supplies the native canvas
font stacks, matching the CSS body and metric styles; gameplay loads no web font.
Live percentages with decimal separators and final accuracy use one shared
`CanvasView.renderAccuracy()` renderer, keeping family, size, position and color
thresholds consistent while drawing and after release. Decimal values are
preserved. This changes presentation without changing scoring or controls.

### Shared logos and browser icons

[`BrandView.ts`](../src/view/BrandView.ts) renders both brand variants from
[`brandGeometry.json`](../src/view/brandGeometry.json). `mountBrandLogos()` fills
`[data-brand]` placeholders in the header and summary. `drawBrandLogo()` draws
the same vector paths synchronously on the share card: the full logo in the
header and the small wave mark in the footer. This avoids font or image-loading
races during the first PNG, clipboard or native share export.

The full logo uses pale blue ink on dark paper, a seven-degree wave tilt and 82% wave opacity.
Its outlined lettering preserves the compact handwritten layout: a four-degree
lean, tightly tracked `Sine` lettering and slightly overlapping word lines.
The small mark is an opaque, imperfect sine with red ends and a green center.
`public/brand/` contains the dark SVG wordmark, an SVG favicon, transparent
32px/512px PNG marks and a 180px touch icon on dark paper. Run
`npm run export-brand` to regenerate SVGs; update the PNG counterparts from the
same mark when its geometry changes. `BrandView.test.ts` checks that the SVG
exports match runtime artwork. No game rules or share triggers change.

---

### Mobile share control

The header is fixed to the viewport with safe-area-aware left/right/top insets.
The HUD controls cannot shrink, and the share button uses custom CSS appearance
and 60% opacity when disabled so its 44px touch target remains discoverable.
Browser checks cover Chromium and WebKit in phone/tablet sizes, tablet rotation,
desktop user agents, idle/drawing/finished states and opening the dialog by touch.
The header uses the game-specific `wave-export-trigger` class instead of the
generic `share-btn`; its content uses `wave-export-content` instead of `share-section`.
Both previous names match cosmetic selectors in
[EasyList Social](https://github.com/easylist/easylist/blob/master/fanboy-addon/fanboy_social_general_hide.txt).
A cosmetic-filter regression check injects `.share-btn, .share-section { display: none !important; }`
and verifies that the actual export control remains visible and touch-operable.
This reproduces one possible cause of the iPad report; device settings are unconfirmed.

### Mobile input regression checks

The first primary pointer owns each drawing until release/cancellation. Controller
tests interleave multiple pointer IDs and verify that secondary moves, releases,
cancels and capture-loss events cannot affect the stroke. They also cover reset,
ID zero, capture API failures and a new gesture after remaining fingers lift.
Browser smoke tests exercise actual multi-touch events, not only mouse emulation.
Demo color-distribution tests use a seeded RNG; the controller runaway-rendering
test uses fixed geometry and a fixed RNG to keep CI assertions reproducible.

## 4. Testing, V-Model Verification & Coverage Gates

Automated verification uses **Vitest** (`vitest.config.ts`) configured with `environment: 'node'`, matching V-Model isolation requirements:

- **Run suite:** `npm test` (`vitest run`)
- **Watch mode:** `npm run test:watch`
- **Coverage check:** `npm run test:coverage` (`vitest run --coverage` using `@vitest/coverage-v8`)
- **Enforced Coverage Thresholds (`vitest.config.ts`):**
  - **Scope:** `src/model/**` (excluding pure type declarations `src/model/types.ts` and `src/model/scoring/IScoreStrategy.ts`)
  - **Minimum gates:** `lines: 80%`, `functions: 80%`, `branches: 80%`, `statements: 80%`
- **Type safety:** `npm run typecheck` runs `tsc --noEmit` with strict TypeScript flags (`strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`).

---

## 5. CI/CD & GitHub Pages Deployment

Two workflows under `.github/workflows/` automate quality checks and hosting:

1. **Continuous Integration ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):**
   - **Triggers:** `push` and `pull_request` targeting `main`.
   - **Pipeline (`ubuntu-latest`, Node 20):** `npm ci` -> `npm run typecheck` -> `npm run test:coverage` -> `npm run build`.
2. **GitHub Pages Deployment ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)):**
   - **Triggers:** `push` to `main` or manual `workflow_dispatch`.
   - **Pipeline:** `npm ci` -> `npm run build` (using `.env.production` with `VITE_DEV_TOOLS=false`, outputting `./dist` with relative `base: './'` from `vite.config.ts`) -> `actions/configure-pages@v5` -> `actions/upload-pages-artifact@v3` -> `actions/deploy-pages@v4`.
