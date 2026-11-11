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

## 3. Session Summary, Share Card & Screenshot Triggers

Available in **all** builds (development and production):

- **HUD & Share Modal (`HudView`):** Displays live Current Score, Highscore (`localStorage` key `perfect_sine_session_history_v1`), and opens the **Wave Summary** modal showing clean numeric metrics (Highscore, Avg Accuracy, Attempts, Total Cycles, Consistency Score, and Active Streak for attempts $\ge 80\%$) without extraneous copy.
- **Offscreen Share Card Pipeline (`ShareCardGenerator`):** Renders a `960 x 560` PNG card (`PREVIEW_BOX = { x: 36, y: 92, w: 516, h: 416 }`) containing a crisp preview of the player's last drawn/evaluated wave alongside session values and the `Perfect Sine` title.
- **Native Share & Fallbacks (`ShareCardGenerator.share`):**
  1. Uses `navigator.share({ files, title, text })` when Web Share with image files is supported.
  2. Falls back to Web Share text/URL or clipboard image (`ClipboardItem` PNG) / clipboard text, or direct PNG download (`handleDownloadScreenshot`).
- **Screenshot & Shortcut Triggers (`HudView.isScreenshotShortcut` / `isInAppShareShortcut`):**
  - Pressing `S` (outside text inputs) opens the Wave Summary share modal.
  - Best-effort detection of browser/OS screenshot chords (`PrintScreen`, `Ctrl/Cmd+Shift+S`, `Cmd+Shift+3/4/5`) automatically opens the Share modal so players immediately see a shareable card ready to copy, download, or dispatch.

---

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
