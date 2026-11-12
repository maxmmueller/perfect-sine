# Mathematics, Scoring & Demo Bot

This document specifies the mathematical pipeline that turns raw 2D canvas pointer coordinates into a tilt-invariant sine fit, anti-cheese validation verdict, orthogonal deviation heatmap, composite score, and autonomous human-like demo animation.

---

## 1. End-to-End Evaluation Pipeline

Every completed user stroke (`>= 8` sampled points in `StrokeBuffer`, minimum Euclidean spacing `2.0 px`) passes through five stages:

```text
Raw Canvas Points
   │
   ├─► 1. TiltDetector        (PCA covariance eigenvector + 10° axis snap)
   ├─► 2. SineFitter          (Hook trim, 0.5..6.5 cycle scan, 3x3 harmonic OLS)
   ├─► 3. PeriodValidator     (Min amplitude, >= 0.88 cycles, zigzag cusp rejection)
   ├─► 4. DeviationCalculator (Orthogonal distance via bounded Newton-Raphson)
   └─► 5. IScoreStrategy      (Accuracy & cycle-weighted final score + HSL colors)
```

During active drawing (`handlePointerMove`), `DrawingController` computes a lightweight live preview evaluation once `points.length >= 15` and the stroke bounding-box half-height is at least `15 px` (displaying live heatmap coloring whenever fitted `amplitude >= 18` and `fullCycles >= 0.4`).

---

## 2. Tilt Detection & Local Coordinate Frame

### 2.1 `TiltDetector` (`src/model/TiltDetector.ts`)

Players can draw horizontally, vertically, or along arbitrary diagonal baselines. `TiltDetector.computePCATilt` computes the mean centroid $(\bar{x}, \bar{y})$ and the $2 \times 2$ covariance terms ($\text{cov}_{XX}, \text{cov}_{YY}, \text{cov}_{XY}$):

$$\theta_{\text{PCA}} = \frac{1}{2} \operatorname{atan2}\left(2\,\text{cov}_{XY},\; \text{cov}_{XX} - \text{cov}_{YY}\right)$$

To ensure forward stroke travel along $+u$, if the dot product between the start-to-end vector and $(\cos\theta_{\text{PCA}}, \sin\theta_{\text{PCA}})$ is negative, $\theta_{\text{PCA}}$ is rotated by $\pm \pi$.

Because endpoint chord angles alone can suffer a `15°–20°` slant when a wave starts at a trough and ends at a peak, `TiltDetector.detectTilt` applies **cardinal baseline snapping**:
- If the chord distance is `< 15 px`, `pcaTheta` is used; otherwise `chordTheta` is the candidate `rawAngle`.
- If **either** `chordTheta` or `pcaTheta` lies within `10°` of `0` (left-to-right), `±π` (right-to-left), or `±π/2` (vertical), `detectTilt` snaps cleanly to exact `0`, `±π`, or `±π/2`.
- `transformPoints(points, tilt)` translates by `-centroid` and rotates by `-tilt.angle` into the baseline-aligned $(u, v)$ frame; `inverseTransformPoint` maps back to canvas coordinates.

### 2.2 `CoordinateSystem` (`src/model/CoordinateSystem.ts`)

Computes a `CoordinateFrame` centered on the fitted sine's $y$-offset and rotated by `fit.tilt.angle`, automatically padding axis lengths by `axisPadding` (default `25 px`) around all transformed stroke points for canvas axis rendering.

---

## 3. Harmonic Sine Fitting (`SineFitter`)

`SineFitter` (`src/model/SineFitter.ts`) models the rotated stroke as:

$$f(u) = A \sin(\omega u + \phi) + C$$

1. **Terminal Hook Trimming (`trimTerminalHook`):** Inspects the trailing points in $(u, v)$ space for pen-liftoff artifacts where horizontal progression is tiny (`du <= 0.8`) while vertical movement spikes (`dv >= 2.5`), removing hooks before regression.
2. **Monotonic Baseline Filtering:** Sorts aligned points along $+u$ with minimum spacing `> 0.5 px`.
3. **Frequency Scan & Closed-Form Harmonic OLS (`fitWithTilt` / `solveHarmonicOLS`):**
   - For each candidate angular frequency $\omega$ across `[0.5, 6.5]` expected cycles (step `0.03`), the non-linear phase problem is linearized via the trigonometric identity:
     $$A \sin(\omega u + \phi) + C = c_1 \sin(\omega u) + c_2 \cos(\omega u) + c_3$$
   - `solveHarmonicOLS` solves the exact $3 \times 3$ symmetric normal equations via determinant / Cramer's rule inversion to obtain $(c_1, c_2, c_3)$, recovering $A = \sqrt{c_1^2 + c_2^2}$, $\phi = \operatorname{atan2}(c_2, c_1)$, and $C = c_3$.
   - The candidate maximizing coefficient of determination $R^2 = 1 - \frac{\text{RSS}}{\text{TSS}}$ is selected, and `FittedSine` reports `amplitude`, `frequency` ($\omega$), `phase` ($\phi$), `offset` ($C$), `period` ($2\pi/\omega$), `fullCycles`, and `r2`.

---

## 4. Period & Anti-Cheese Validation (`PeriodValidator`)

Before scoring on `pointerup`, `DrawingController` rejects:
- Too few points (`< 8` points in `StrokeBuffer`)
- Fitted amplitude `< 20 px` (`fit.amplitude < 20`)
- Invalid period or non-sinusoidal waveform from `PeriodValidator.validate(aligned, fit.frequency, minCycles = 0.88, minAmplitude = 25, fit.amplitude)`:

1. **Cycle Coverage (`minCycles = 0.88`):** Combines zero-crossing counts around the mean with peak/trough phase span fallback to confirm nearly a full $2\pi$ period (`>= 0.88` cycles) and sufficient amplitude (`>= 25 px`).
2. **Zigzag / Triangle Rejection (`isZigzagWave`):** Prevents triangle or sawtooth waves from masquerading as sines using velocity-invariant checks:
   - Compares mean-absolute-deviation ratio (`meanAbsRatio < 0.46`) and fitted-to-peak amplitude ratio (`fitToPeakRatio < 0.78`).
   - Uniformly resamples the curve at `3 px` arc-length steps and measures directional turn angles across a `win = 3` step (`9 px`) window to detect sharp apex cusps (`>= 135°` turns).

---

## 5. Orthogonal Deviation & Color Heatmap (`DeviationCalculator`)

Vertical distance $|v_i - f(u_i)|$ unfairly punishes steep regions of a sine wave. Instead, `DeviationCalculator.calculateOrthogonalDistance(u, v, fit)` (`src/model/DeviationCalculator.ts`) finds the true perpendicular distance to the curve by minimizing:

$$D^2(x) = (x - u)^2 + \big(f(x) - v\big)^2$$

- Runs **4 Newton-Raphson iterations** starting from $x_0 = u$, using the exact first and second derivatives $f'(x) = A\omega\cos(\omega x + \phi)$ and $f''(x) = -A\omega^2\sin(\omega x + \phi)$.
- Clamps the search step strictly within $\pm T/8 = \frac{\pi}{4\omega}$ of $u$ so iterates stay locked onto the nearest wave lobe.
- Returns $\min\big(\text{verticalDist}, \sqrt{(x - u)^2 + (f(x) - v)^2}\big)$.

**Color Mapping (`mapDistanceToColor`):**
Normalizes error against `maxTolerance` (default `30 px`) and maps linearly across HSL hues from **`120` (emerald green, $0\text{ px}$ error)** through yellow/orange down to **`0` (red, $\ge 30\text{ px}$ error)**.

---

## 6. Scoring Strategies (`src/model/scoring/`)

All scorers implement `IScoreStrategy` and convert normalized accuracy (`0..100%`), cycle count, and spatial period size into points using shared helpers in `DeviationCalculator` (`calculateScaleMultiplier` & `calculateFinalScore`, with `baseScoreScale = 1000`):

$$\text{Score} = \operatorname{round}\!\left(\text{baseScoreScale} \cdot \left(\frac{\text{accuracy}}{100}\right)^{2.5} \cdot \sqrt{\max(0.1,\; \text{fullCycles})} \cdot \text{scaleMultiplier}\right)$$

Because accuracy is raised to the exponent $2.5$ while length grows as $\sqrt{\text{fullCycles}}$, precision dominates roughly $5\times$ more strongly than simply drawing longer waves.

### Spatial Tolerance & Scale Multiplier (`calculateEffectiveTolerance` & `calculateScaleMultiplier`)

A tiny one-period sine wave covers minimal pixel span, making fixed pixel tolerances (`baseTolerance = 30 px`) disproportionately forgiving for small strokes while unfairly penalizing slight hand tremor or cornering curvature on physically large, fast strokes. To keep both accuracy and points proportional across wave sizes, `DeviationCalculator` computes a 2D spatial size ratio relative to a canonical **`40 px` amplitude × `200 px` wavelength** reference wave:

$$\text{rawRatio} = \frac{\sqrt{\max(1, |A|) \cdot \max(1, T)}}{\sqrt{40 \cdot 200}}$$

1. **Scale-Proportional Tolerance (`calculateEffectiveTolerance`):**
   $$\text{effectiveTolerance} = \max(1,\; \text{baseTolerance}) \cdot \operatorname{clamp}\!\left(\text{rawRatio}^{0.75},\; 0.55,\; 1.85\right)$$
   Sub-linear scaling tightens precision on miniature scribbles (`0.55x` floor, e.g., `16.5 px`), preserves `1.0x` (`30 px`) at the canonical `40 × 200` wave, and widens gently up to `1.85x` (`55.5 px`) for large sweeping strokes across all scoring strategies (`analyzeStroke`).

2. **Super-Linear Scale Multiplier (`calculateScaleMultiplier`):**
   $$\text{scaleMultiplier} = \operatorname{clamp}\!\left(\text{rawRatio}^{1.35},\; 0.2,\; 2.5\right)$$
   - Tiny waves (e.g., $20\text{ px} \times 80\text{ px}$) receive `0.337x` (clamped at `0.2x` floor), preventing small easy strokes from outscoring large waves.
   - Reference waves ($40\text{ px} \times 200\text{ px}$) receive exact `1.0x`.
   - Large sweeping waves (e.g., $85\text{ px} \times 320\text{ px}$) earn up to `2.5x` (`2.28x` at $85 \times 320$), exposed on `StrokeEvaluation.scaleMultiplier`.

| Class | Strategy ID | Mathematical Basis | Primary Sensitivity |
| :--- | :--- | :--- | :--- |
| **`UnifiedEnsembleScoreStrategy`** *(Production Default)* | `unified_ensemble` | Weighted composite: `0.50 * RmseScore` + `0.30 * HarmonicSymmetry` + `0.20 * CurvatureFlow` (point heatmaps follow RMSE orthogonal distances). | Balanced human fairness: rewards smooth, symmetric waves while penalizing severe outliers. |
| **`RmseScoreStrategy`** | `rmse_l2` | Delegates to `DeviationCalculator.evaluate`: `0.65 * (1 - RMSE / tol) + 0.35 * R²`. | Penalizes isolated spikes/twitches quadratically ($L^2$). |
| **`AreaDeviationScoreStrategy`** | `area_l1` | Mean Absolute Error (MAE): `0.70 * (1 - MAE / tol) + 0.30 * R²`. | Forgiving of uniform high-frequency hand tremor around the true curve ($L^1$). |
| **`HarmonicSymmetryScoreStrategy`** | `harmonic_symmetry` | `0.50 * rawAccuracy + 0.30 * amplitudeSymmetry + 0.20 * R²`, where `amplitudeSymmetry = min(crest, trough) / max(crest, trough)`. | Rewards balanced crest/trough heights around the baseline offset. |
| **`CurvatureFlowScoreStrategy`** | `curvature_flow` | `0.50 * distAccuracy + 0.35 * meanCosineSim + 0.15 * R²`, comparing drawn tangent unit vectors against $(1, A\omega\cos(\omega x + \phi))$. | Rewards continuous smooth flow aligned with theoretical curve slope. |
| **`ChebyshevStrictScoreStrategy`** | `chebyshev_linf` | `0.60 * (1 - maxDist / tol) + 0.25 * rmseAccuracy + 0.15 * R²`. | Unforgiving worst-case single slip detector ($L^\infty$). |

`ScoreStrategyManager` manages A/B comparison evaluation across the 5 canonical comparison strategies (`evaluateAll`) and persists multi-rank user preferences in `localStorage` (`perfect_sine_ab_scorer_votes_v1`) aggregated by **Borda Count** (Rank 1 = 5 pts through Rank 5 = 1 pt).

---

## 7. Autonomous Human-Inspired Demo (`DemoBot` & `DrawingController`)

When idle on launch (or after `15 s` of post-draw inactivity on an empty canvas), `DemoBot` (`src/model/DemoBot.ts`) synthesizes realistic hand-drawn sine waves modeled on empirical human kinematics:

- **Empirical Parameter Sampling (`sampleHumanParameters`):**
  - Amplitude: center-weighted triangular distribution clamped around human desktop proportions (`28–96 px` scaled to canvas height).
  - Cycles: bimodal mix (~55% compact `1.15–1.70` cycles, ~45% flowing `1.85–3.15` cycles).
  - Phase & Tilt: ~59% initially move upward, ~75% start near zero-crossings; ~80% nearly horizontal (`±3.7°` wrist slant) and ~20% gentle diagonal sweeps (`8°–25°`).
  - Sweep Speed: brisk (`580–860 px/s`), moderate (`390–580 px/s`), or deliberate (`260–390 px/s`).
- **Imperfection Profiles (`generateStrokeWithDeviations`):** Supports `'pristine'`, `'wobbly'`, `'uneven'`, `'runaway'`, and `'mixed'` error profiles with analytical deviations from the intended nominal sine so color gradients always match true accuracy.
- **Spatial Non-Overlap & Center-Weighted Placement (`DrawingController.generatePlacedDemoWave`):** Samples candidate centers weighted toward the screen center (`(Math.random() + Math.random()) * 0.5`), tests clearance (`minDistance = 34 px`) against visible points of still-fading waves over up to `42` attempts, shrinking geometry after attempt `20` or retiring the oldest faded wave at attempt `36`.
- **Reverse-Wipe Fade Continuity:** Completed demo waves move into `demoHistory` (capped at `2` historical waves) and fade progressively from start point to end point (`eraseProgress` driven smoothly by frame `dt`), continuing seamlessly even during the `600 ms` pause between consecutive waves (`animatePause`).

