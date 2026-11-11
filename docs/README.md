# Perfect Sine — Documentation Hub

Welcome to the central technical documentation for **Perfect Sine**. Everything related to system architecture, UML design diagrams, mathematical curve fitting, scoring algorithms, autonomous demo generation, development tooling, testing standards, and deployment is collected here.

---

## Documentation Index

| Document | Audience | Contents |
| :--- | :--- | :--- |
| **[Architecture & UML Diagrams](./ARCHITECTURE.md)** | Developers, Architects, Reviewers | Strict MVC layer rules, runtime bootstrap (`src/main.ts`), `VITE_DEV_TOOLS` isolation boundary, **UML Class Diagrams** (Core MVC, Math & Scoring Strategy Pattern, Session/Share/Dev), **UML State Machine Diagram**, and **UML Sequence Diagram**. |
| **[Mathematics, Scoring & Demo Bot](./MATHEMATICS_AND_SCORING.md)** | Algorithm & Game-Feel Engineers | `TiltDetector` PCA + chord snapping, `CoordinateSystem`, `SineFitter` OLS regression & terminal hook trimming, `PeriodValidator` + `isZigzagWave`, `DeviationCalculator` ($\pm T/8$ Newton-Raphson), all 7 scoring classes (`UnifiedEnsembleScoreStrategy` & `ScoreStrategyManager`), and human-learned `DemoBot` kinematics. |
| **[Development, Dev Isolation & Deployment](./DEVELOPMENT_AND_DEPLOYMENT.md)** | Maintainers, QA & DevOps | `.env.development` vs `.env.production`, Vite dynamic import stripping, VS Code one-click tasks, Curve Recorder & Image Exporter, Share Card & screenshot detection pipeline, Vitest V-Model `>= 80%` coverage gates, and GitHub Actions CI/CD. |
| **[Engineering Guidelines](./AGENTS.md)** | Contributors & Coding Agents | Golden rules (English on GitHub, strict MVC DOM isolation, GoF design patterns, Kanban/PR workflow, V-Model coverage enforcement). |
| **[Software Engineering Lecture Guide](./SOFTWARE_ENGINEERING_GUIDE.md)** | Students & Learners | Conceptual guide linking project practices to software engineering principles. |
| **[Initial Domain Specification](./implementation.md)** | Historical Reference | Original early German specification outlining canvas layout, drawing constraints, highscore persistence, and initial scoring concepts. |

---

## System Overview at a Glance

```text
+-------------------------------------------------------------------+
|                           index.html                              |
|  Canvas (#sine-canvas)   +   Minimal HUD Overlay & Share Modal    |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                      src/main.ts (Bootstrap)                      |
|  Instantiates Model & Views -> Evaluates VITE_DEV_TOOLS === true  |
|  - Production: mounts core gameplay + HudView only                |
|  - Development: dynamically imports src/dev/setupDevTools.ts      |
+-----------------+---------------------------------+---------------+
                  |                                 |
                  v                                 v
+---------------------------------+   +-----------------------------+
|     Controller & View Layer     |   |   Pure Domain Model Layer   |
|  - DrawingController            |-->|  - GameStateMachine         |
|  - CanvasView                   |   |  - StrokeBuffer             |
|  - ScoreCalculationAnimator     |   |  - TiltDetector             |
|  - HudView & ShareCardGenerator |   |  - CoordinateSystem         |
|  - Dev Views (dev builds only)  |   |  - SineFitter               |
+---------------------------------+   |  - PeriodValidator          |
                                      |  - DeviationCalculator      |
                                      |  - HitboxDetector           |
                                      |  - DemoBot                  |
                                      |  - scoring/* (Strategies)   |
                                      |  - SessionHistoryService    |
                                      +-----------------------------+
```

---

## Key Design Decisions

1. **Zero-DOM Model Layer (`src/model/**`):** All geometry fitting, state transitions, validation, persistence abstractions (`IStorageAdapter`), and scoring algorithms execute purely in Node/Vitest without DOM dependencies.
2. **Design Patterns in Production:**
   - **MVC:** Strict separation across `src/model`, `src/view`, and `src/controller`.
   - **State Pattern:** `GameStateMachine` enforces deterministic lifecycle transitions (`IDLE -> DRAWING -> EVALUATING -> LOCKED -> IDLE`).
   - **Strategy Pattern:** `IScoreStrategy` decouples curve evaluation formulas (`UnifiedEnsembleScoreStrategy`, `RmseScoreStrategy`, etc.) from `DrawingController`.
   - **Observer Pattern:** Reactive subscriptions in `GameStateMachine`, `SessionHistoryService`, `CurveRecorderService`, and `ScoreStrategyManager`.
3. **Compile-Time Dev/Prod Separation:** `import.meta.env.VITE_DEV_TOOLS === 'true'` ensures Vite tree-shakes `src/dev/setupDevTools.ts`, `CurveRecorderService`, `CurveRecorderView`, and `dev-tools.css` completely out of production GitHub Pages builds.
