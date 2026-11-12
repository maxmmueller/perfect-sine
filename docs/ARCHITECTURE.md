# Architecture & UML Diagrams

**Perfect Sine** follows a strict **Model-View-Controller (MVC)** architecture written in strict TypeScript (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`). The pure domain model has zero browser/DOM imports so every mathematical and stateful invariant is verifiable headlessly in Vitest.

---

## 1. Layer Boundaries & Runtime Bootstrap

The presentation uses one fixed dark palette (`ThemeView.getNotebookPalette()`)
for DOM styling, game canvas and share exports. There is no theme switch or
system/storage-driven theme initialization.

| Layer | Directory | Responsibilities | Forbidden Dependencies |
| :--- | :--- | :--- | :--- |
| **Model** | `src/model/`, `src/model/scoring/` | State machine, point sampling buffer, PCA tilt alignment, OLS sine fitting, period/zigzag validation, orthogonal distance, scoring strategies, demo trajectory synthesis, session & recorder persistence abstractions. | `window`, `document`, `HTMLCanvasElement`, CSS |
| **View** | `src/view/` | Retina-aware Canvas 2D rendering, live/evaluated heatmaps, fitted reference curves, axes, calculation particle/tracer animations, HUD/Share modal DOM updates, PNG Share Card generation, Dev UI drawers. | Mutating state machine directly; fitting math |
| **Controller** | `src/controller/` | Pointer event translation, origin hitbox detection, demo scheduling & overlap avoidance, continuous animation loops, orchestrating Model evaluation -> View rendering -> Session callbacks. | Embedding raw scoring equations |
| **Dev Isolation** | `src/dev/` | Dynamically imported dev-only wrapper (`setupDevTools.ts`) injecting Curve Recorder button/drawer DOM markup, `dev-tools.css`, and `window.__perfectSine` debug handle. | Bundled into `VITE_DEV_TOOLS=false` production builds |

### Bootstrap Flow (`src/main.ts`)

On `DOMContentLoaded`, [`initializeApp`](../src/main.ts) first mounts shared SVG
logos through `BrandView.mountBrandLogos()`, then wires:
1. `SessionHistoryService` (reading/writing `localStorage` via `IStorageAdapter` fallback)
2. `UnifiedEnsembleScoreStrategy` (`id = 'unified_ensemble'`)
3. `GameStateMachine`, `StrokeBuffer(2.0)`, and `CanvasView`
4. `DrawingController` with `onEvaluationComplete` -> `sessionService.addAttempt(...)`
5. `HudView` with a `getWaveSnapshot` callback restricted to a completed own
   drawing (`LOCKED`, demo stopped). State changes refresh share availability;
   the `LOCKED` update is deferred to a microtask so the captured stroke is ready.
   Session history cannot populate or enable sharing.
6. **Conditional Dev Tools:** Only when `import.meta.env.VITE_DEV_TOOLS === 'true'` does `main.ts` call `import('./dev/setupDevTools')`. Vite statically replaces `import.meta.env.VITE_DEV_TOOLS` during `vite build`, allowing Rollup to tree-shake all dev code and stylesheets from production artifacts.
7. Launches `controller.startDemo()` immediately and arms a 15-second idle timeout to resume the demo if the canvas remains empty after user interaction stops.

---

## 2. UML Class Diagrams

To preserve legibility, the full object model is organized into three cohesive UML class diagrams:
1. [Core MVC, Canvas & Demo Architecture](#21-core-mvc-canvas--demo-architecture)
2. [Mathematical Pipeline & Scoring Strategy Pattern](#22-mathematical-pipeline--scoring-strategy-pattern)
3. [Session Persistence, Sharing & Dev Tooling](#23-session-persistence-sharing--dev-tooling)

### 2.1 Core MVC, Canvas & Demo Architecture

```mermaid
classDiagram
    class GameState {
        <<enumeration>>
        IDLE
        DRAWING
        EVALUATING
        LOCKED
    }

    class GameStateMachine {
        -GameState currentState
        -Set~StateChangeListener~ listeners
        +getState() GameState
        +subscribe(listener) Function
        +startDrawing() boolean
        +finishDrawing() boolean
        +setEvaluated() boolean
        +reset() boolean
    }

    class StrokeBuffer {
        -Point[] points
        -number minDistanceSquared
        +addPoint(x, y, time) boolean
        +getPoints() Point[]
        +getLength() number
        +clear() void
        +getBoundingBox() BoundingBox
    }

    class HitboxDetector {
        +number MIN_ACCESSIBLE_RADIUS$
        +distance(p1, p2)$ number
        +isPointInCircle(point, center, radius)$ boolean
        +isOriginHit(pointer, origin, customRadius)$ boolean
        +isPointInRect(point, rect)$ boolean
    }

    class DrawingController {
        -HTMLCanvasElement canvas
        -CanvasView view
        -GameStateMachine stateMachine
        -StrokeBuffer strokeBuffer
        -ScoreCalculationAnimator scoreAnimator
        -IScoreStrategy scoreStrategy
        -DemoHistoricalWave[] demoHistory
        +handlePointerDown(e) void
        +handlePointerMove(e) void
        +handlePointerUp(e) void
        +setScoreStrategy(strategy) void
        +startDemo(customOptions, preserveHistory) void
        +stopDemo() void
        +checkWavesOverlap(newDeviations, boxes, padding) boolean
        +replayStroke(points, animated) void
        +reset() void
        +render() void
    }

    class CanvasView {
        -renderAccuracy(accuracy) void
        +handleResize() void
        +clear() void
        +drawBackgroundGrid() void
        +renderStroke(points, color, width) void
        +renderEvaluatedStroke(deviations, width, progress) void
        +renderFittedSineGuideline(fit, frame) void
        +renderCoordinateAxes(frame) void
        +renderOriginMarker(origin, radius, isHovering) void
        +renderCalculationBanner(animState, x, y) void
        +renderWaveTracer(deviations, animState) void
        +getDimensions() Dimensions
    }

    class ScoreCalculationAnimator {
        -boolean active
        -ScoreAnimationTier tier
        -CalculationParticle[] particles
        +start(evaluation, originX, originY) void
        +reset() void
        +isActive() boolean
        +getTier() ScoreAnimationTier
        +getTracerDuration() number
        +getTotalDuration() number
        +getPathLength() number
        +update(now) ScoreAnimationState
    }

    class DemoBot {
        +sampleHumanParameters(width, height, rng)$ HumanDemoWaveParams
        +generateStroke(options)$ DemoWaveResult
        +generateStrokeWithDeviations(options)$ DemoWaveResult
    }

    DrawingController *-- ScoreCalculationAnimator : owns
    DrawingController --> GameStateMachine : transitions
    DrawingController --> StrokeBuffer : buffers points
    DrawingController --> CanvasView : renders to
    DrawingController ..> DemoBot : synthesizes idle waves
    GameStateMachine --> GameState : currentState
```

### 2.2 Mathematical Pipeline & Scoring Strategy Pattern

```mermaid
classDiagram
    class Point {
        <<interface>>
        +number x
        +number y
        +number time
    }

    class TiltResult {
        <<interface>>
        +number angle
        +Point centroid
    }

    class FittedSine {
        <<interface>>
        +number amplitude
        +number frequency
        +number phase
        +number offset
        +TiltResult tilt
        +number period
        +number fullCycles
        +number r2
    }

    class StrokeEvaluation {
        <<interface>>
        +FittedSine fittedSine
        +PointDeviation[] deviations
        +number meanDeviation
        +number maxDeviation
        +number rmse
        +number accuracy
        +number score
    }

    class TiltDetector {
        +computePCATilt(points)$ TiltResult
        +detectTilt(points)$ TiltResult
        +transformPoints(points, tilt)$ Point[]
        +inverseTransformPoint(point, tilt)$ Point
    }

    class CoordinateSystem {
        +computeFrame(fit, points, axisPadding)$ CoordinateFrame
    }

    class SineFitter {
        +trimTerminalHook(points)$ Point[]
        +solveHarmonicOLS(pts, omega)$ OlsSolution
        +fitWithTilt(rawPoints, tilt)$ FittedSine
        +fit(rawPoints)$ FittedSine
        +evaluateAligned(x, fit)$ number
        +generateFittedCurve(fit, minX, maxX, step)$ Point[]
    }

    class PeriodValidator {
        +validate(points, overrideFreq, minCycles, minAmp, fitAmp)$ PeriodValidationResult
        +isZigzagWave(points, amplitude, freq, meanY, fitAmp)$ boolean
    }

    class DeviationCalculator {
        +calculateOrthogonalDistance(u, v, fit)$ number
        +mapDistanceToColor(distance, maxTolerance)$ ColorMapping
        +evaluate(points, fit, maxTolerance, baseScoreScale)$ StrokeEvaluation
    }

    class IScoreStrategy {
        <<interface>>
        +string id
        +string name
        +string description
        +evaluate(points, fit, maxTolerance, baseScoreScale) StrokeEvaluation
    }

    class RmseScoreStrategy {
        +string id = "rmse_l2"
        +evaluate(...) StrokeEvaluation
    }

    class AreaDeviationScoreStrategy {
        +string id = "area_l1"
        +evaluate(...) StrokeEvaluation
    }

    class HarmonicSymmetryScoreStrategy {
        +string id = "harmonic_symmetry"
        +evaluate(...) StrokeEvaluation
    }

    class CurvatureFlowScoreStrategy {
        +string id = "curvature_flow"
        +evaluate(...) StrokeEvaluation
    }

    class ChebyshevStrictScoreStrategy {
        +string id = "chebyshev_linf"
        +evaluate(...) StrokeEvaluation
    }

    class UnifiedEnsembleScoreStrategy {
        +string id = "unified_ensemble"
        -RmseScoreStrategy rmseStrategy
        -HarmonicSymmetryScoreStrategy symmetryStrategy
        -CurvatureFlowScoreStrategy curvatureStrategy
        +evaluate(...) StrokeEvaluation
    }

    class ScoreStrategyManager {
        -Map~string, IScoreStrategy~ strategies
        -IStorageAdapter storage
        -string activeStrategyId
        +register(strategy) void
        +getStrategy(id) IScoreStrategy
        +getAllStrategies() IScoreStrategy[]
        +getActiveStrategy() IScoreStrategy
        +setActiveStrategy(id) boolean
        +evaluateAll(points, fit, maxTolerance, baseScoreScale) ScorerEvaluationItem[]
        +recordRanking(rankedIds) ScorerRankingSummary
        +getRankingSummary() ScorerRankingSummary
    }

    IScoreStrategy <|.. RmseScoreStrategy
    IScoreStrategy <|.. AreaDeviationScoreStrategy
    IScoreStrategy <|.. HarmonicSymmetryScoreStrategy
    IScoreStrategy <|.. CurvatureFlowScoreStrategy
    IScoreStrategy <|.. ChebyshevStrictScoreStrategy
    IScoreStrategy <|.. UnifiedEnsembleScoreStrategy

    UnifiedEnsembleScoreStrategy *-- RmseScoreStrategy : 50%
    UnifiedEnsembleScoreStrategy *-- HarmonicSymmetryScoreStrategy : 30%
    UnifiedEnsembleScoreStrategy *-- CurvatureFlowScoreStrategy : 20%
    ScoreStrategyManager o-- IScoreStrategy : manages

    SineFitter ..> TiltDetector : uses
    DeviationCalculator ..> TiltDetector : aligns points
    RmseScoreStrategy ..> DeviationCalculator : delegates
    FittedSine --> TiltResult
    StrokeEvaluation --> FittedSine
```

### 2.3 Session Persistence, Sharing & Dev Tooling

```mermaid
classDiagram
    class IStorageAdapter {
        <<interface>>
        +getItem(key) string
        +setItem(key, value) void
        +removeItem(key) void
    }

    class MemoryStorageAdapter {
        -Map~string, string~ data
        +getItem(key) string
        +setItem(key, value) void
        +removeItem(key) void
    }

    class SessionHistoryService {
        -AttemptRecord[] attempts
        -IStorageAdapter storage
        +addAttempt(data) AttemptRecord
        +getAttempts() AttemptRecord[]
        +getHighscore() number
        +getSummary() SessionSummary
        +calculatePersona(consistency, accuracy)$ PersonaRating
        +clear() void
        +subscribe(listener) Function
    }

    class HudView {
        -Function getWaveSnapshot
        +isScreenshotShortcut(e)$ boolean
        +isInAppShareShortcut(e)$ boolean
        +handleShare() Promise~void~
        +handleDownloadScreenshot() void
        +handleCopy() Promise~void~
        +update(summary) void
        +updateShareAvailability() void
        +openModal(initialStatus) void
        +closeModal() void
        +isModalOpen() boolean
    }

    class BrandView {
        <<module>>
        +createBrandSvg(variant, ink, id)$ string
        +mountBrandLogos()$ void
        +drawBrandLogo(ctx, variant, x, y, width, ink)$ void
    }

    class ShareCardGenerator {
        +number WIDTH$ = 960
        +number HEIGHT$ = 960
        +canShare(snapshot)$ boolean
        +buildShareText(snapshot)$ string
        +renderShareCard(snapshot)$ HTMLCanvasElement
        +toDataUrl(snapshot)$ string
        +canvasToBlob(canvas)$ Promise~Blob~
        +downloadShareCard(snapshot, filename)$ boolean
        +copyShareCard(snapshot)$ Promise~ShareOutcome~
        +share(snapshot)$ Promise~ShareOutcome~
    }

    class setupDevTools {
        <<module>>
        +injectRecorderDom(doc)$ void
        +setupDevTools(ctx)$ DevToolsHandle
    }

    class CurveRecorderService {
        -RecordedCurve[] curves
        -boolean autoRecordEnabled
        +addCurve(input) RecordedCurve
        +getCurves() RecordedCurve[]
        +updateLabel(id, newLabel) boolean
        +deleteCurve(id) boolean
        +clearAll() void
        +exportAsJson() string
        +importFromJson(jsonStr) ImportResult
        +subscribe(listener) Function
    }

    class CurveRecorderView {
        +open() void
        +close() void
        +toggle() void
        +showToast(message) void
        +render() void
    }

    class AbComparisonView {
        +showEvaluations(items) void
        +moveRank(fromIndex, toIndex) void
        +handleSaveRanking() void
        +updateVoteSummary(summary) void
        +open() void
        +close() void
    }

    class CurveImageExporter {
        +renderToCanvas(curve, width, height)$ HTMLCanvasElement
        +toDataUrl(curve, width, height)$ string
        +renderThumbnailDataUrl(curve)$ string
        +downloadImage(curve)$ void
        +renderToSvg(curve, width, height)$ string
    }

    IStorageAdapter <|.. MemoryStorageAdapter
    SessionHistoryService o-- IStorageAdapter : persists via
    HudView --> SessionHistoryService : observes
    HudView ..> ShareCardGenerator : guards and exports current drawing
    ShareCardGenerator ..> BrandView : draws shared vector logos
    setupDevTools ..> CurveRecorderService : creates
    setupDevTools ..> CurveRecorderView : creates
    CurveRecorderView --> CurveRecorderService : observes
    CurveRecorderView ..> CurveImageExporter : renders thumbnails
```

---

## 3. UML State Machine Diagram (`GameStateMachine`)

`GameStateMachine` (`src/model/GameStateMachine.ts`) guarantees deterministic gameplay transitions and invalid-action guarding without any UI knowledge:

```mermaid
stateDiagram-v2
    [*] --> IDLE : Initial Launch / Canvas Empty

    IDLE --> DRAWING : startDrawing() on PointerDown
    DRAWING --> EVALUATING : finishDrawing() on PointerUp
    EVALUATING --> LOCKED : setEvaluated() after fit & scoring
    EVALUATING --> IDLE : reset() on abort / clear
    LOCKED --> IDLE : reset() before new stroke

    note right of IDLE
        Origin marker displayed (or DemoBot running).
        Starting a human stroke stops demo and enters DRAWING.
    end note

    note right of DRAWING
        StrokeBuffer samples points (min 2px apart).
        Live preview heatmap activates once amplitude & cycles threshold met.
    end note

    note right of LOCKED
        ScoreCalculationAnimator sweeps tracer & particles.
        Fitted reference curve + axes stay visible until next reset.
    end note
```

---

## 4. UML Sequence Diagram — End-to-End User Stroke Evaluation

```mermaid
sequenceDiagram
    actor Player
    participant DC as DrawingController
    participant GSM as GameStateMachine
    participant SB as StrokeBuffer
    participant SF as SineFitter
    participant TD as TiltDetector
    participant PV as PeriodValidator
    participant CS as CoordinateSystem
    participant Strat as IScoreStrategy
    participant Anim as ScoreCalculationAnimator
    participant CV as CanvasView
    participant SH as SessionHistoryService
    participant HV as HudView
    participant Dev as DevTools / CurveRecorder

    Player->>DC: pointerdown
    opt DemoBot currently active
        DC->>DC: stopDemo()
    end
    alt state == LOCKED
        DC->>GSM: reset()
        DC->>SB: clear()
    end
    DC->>GSM: startDrawing()
    DC->>SB: addPoint(x, y)

    loop pointermove
        Player->>DC: pointermove
        DC->>SB: addPoint(x, y)
        opt points >= 15 and liveAmp >= 15
            DC->>SF: fit(points)
            DC->>Strat: evaluate(points, liveFit, 30)
            DC->>CV: renderEvaluatedStroke(liveEvaluation)
        end
    end

    Player->>DC: pointerup
    DC->>GSM: finishDrawing()
    DC->>SF: fit(points)
    SF-->>DC: FittedSine
    DC->>TD: transformPoints(points, fit.tilt)
    TD-->>DC: aligned points
    DC->>PV: validate(aligned, fit.frequency, ..., fit.amplitude)
    PV-->>DC: PeriodValidationResult

    alt PeriodValidationResult.isValid == true
        DC->>Strat: evaluate(points, fit, 30)
        Strat-->>DC: StrokeEvaluation
        DC->>CS: computeFrame(fit, points)
        CS-->>DC: CoordinateFrame
        DC->>Anim: start(evaluation, originX, originY)
        DC->>SH: addAttempt(score, accuracy, cycles, r2, amplitude)
        SH-->>HV: notify(SessionSummary)
        HV->>HV: update DOM HUD & Share Preview
    else Invalid / Zigzag / Too Small
        DC->>DC: store lastValidationMessage
    end

    DC->>GSM: setEvaluated()
    opt VITE_DEV_TOOLS == true
        DC-->>Dev: onStrokeComplete -> CurveRecorderService.addCurve(...)
    end
    DC->>CV: render() + animation loop
```
