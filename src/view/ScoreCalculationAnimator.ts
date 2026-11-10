import { StrokeEvaluation } from '../model/types';

export type ScoreAnimationTier = 'low' | 'medium' | 'high' | 'legendary';
export type ScoreAnimationPhase = 'measuring' | 'multiplying' | 'celebrating' | 'settled';

export interface CalculationParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  maxLife: number;
  life: number;
  shape?: 'circle' | 'star';
}

export interface ScoreAnimationState {
  readonly isActive: boolean;
  readonly accuracy: number;
  readonly fullCycles: number;
  readonly targetScore: number;
  readonly currentScore: number;
  readonly currentCycles: number;
  readonly progress: number; // 0.0 to 1.0
  readonly scaleFactor: number;
  readonly tier: ScoreAnimationTier;
  readonly particles: readonly CalculationParticle[];
  readonly waveTracerProgress: number;
  readonly phase: ScoreAnimationPhase;
  readonly rippleRadius: number;
  readonly rippleAlpha: number;
}

/**
 * ScoreCalculationAnimator
 * Manages the multi-phase animation that displays Accuracy prominently at the top,
 * and animates how the final Score is calculated from the length (cycles) of the sine wave.
 * High-tier scores trigger eye-catching celebrations with particles, wave ripples, and spring bounces.
 */
export class ScoreCalculationAnimator {
  private active = false;
  private accuracy = 0;
  private fullCycles = 0;
  private targetScore = 0;
  private startTime = 0;
  private readonly duration = 1600; // 1.6s total animation
  private tier: ScoreAnimationTier = 'low';
  private particles: CalculationParticle[] = [];
  private particlesSpawned = false;
  private originX = 0;
  private originY = 0;

  public start(evaluation: StrokeEvaluation, originX: number = 0, originY: number = 0): void {
    this.active = true;
    this.accuracy = evaluation.accuracy;
    this.fullCycles = evaluation.fittedSine.fullCycles;
    this.targetScore = evaluation.score;
    this.startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.particles = [];
    this.particlesSpawned = false;
    this.originX = originX;
    this.originY = originY;

    // Determine celebration tier based on score magnitude
    if (this.targetScore < 300) {
      this.tier = 'low';
    } else if (this.targetScore < 700) {
      this.tier = 'medium';
    } else if (this.targetScore < 1000) {
      this.tier = 'high';
    } else {
      this.tier = 'legendary';
    }
  }

  public reset(): void {
    this.active = false;
    this.particles = [];
    this.particlesSpawned = false;
  }

  public isActive(): boolean {
    return this.active;
  }

  public getTier(): ScoreAnimationTier {
    return this.tier;
  }

  public update(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): ScoreAnimationState {
    if (!this.active) {
      return {
        isActive: false,
        accuracy: this.accuracy,
        fullCycles: this.fullCycles,
        targetScore: this.targetScore,
        currentScore: this.targetScore,
        currentCycles: this.fullCycles,
        progress: 1.0,
        scaleFactor: 1.0,
        tier: this.tier,
        particles: [],
        waveTracerProgress: 1.0,
        phase: 'settled',
        rippleRadius: 0,
        rippleAlpha: 0,
      };
    }

    const elapsed = Math.max(0, now - this.startTime);
    const progress = Math.min(1.0, elapsed / this.duration);

    let phase: ScoreAnimationPhase = 'measuring';
    let currentCycles = 0;
    let currentScore = 0;
    let waveTracerProgress = 0;
    let scaleFactor = 1.0;
    let rippleRadius = 0;
    let rippleAlpha = 0;

    // Phase 1: Measuring Length (0.0 to 0.4)
    if (progress < 0.4) {
      phase = 'measuring';
      const p1 = progress / 0.4;
      waveTracerProgress = p1;
      currentCycles = this.fullCycles * p1;
      currentScore = Math.round(this.targetScore * 0.15 * p1);
    }
    // Phase 2: Multiplying Accuracy x Length (0.4 to 0.8)
    else if (progress < 0.8) {
      phase = 'multiplying';
      const p2 = (progress - 0.4) / 0.4;
      waveTracerProgress = 1.0;
      currentCycles = this.fullCycles;
      // Exponential ease-out counting up
      currentScore = Math.round(this.targetScore * (0.15 + 0.85 * (1 - Math.pow(1 - p2, 2))));
    }
    // Phase 3: Impact & Celebration (0.8 to 1.0+)
    else {
      phase = progress < 1.0 ? 'celebrating' : 'settled';
      currentCycles = this.fullCycles;
      currentScore = this.targetScore;
      waveTracerProgress = 1.0;

      const p3 = Math.min(1.0, (progress - 0.8) / 0.2);

      // Spawn celebratory particles once upon reaching impact
      if (!this.particlesSpawned) {
        this.spawnParticles();
        this.particlesSpawned = true;
      }

      if (progress < 1.0) {
        // Dynamic scale bounce based on tier
        const bounceIntensity =
          this.tier === 'legendary' ? 0.38 : this.tier === 'high' ? 0.24 : this.tier === 'medium' ? 0.12 : 0.04;
        scaleFactor = 1.0 + bounceIntensity * Math.sin(p3 * Math.PI) * (1 - p3 * 0.4);

        // Expanding ripple for high and legendary tiers
        if (this.tier === 'high' || this.tier === 'legendary') {
          rippleRadius = p3 * (this.tier === 'legendary' ? 140 : 80);
          rippleAlpha = Math.max(0, (1 - p3) * (this.tier === 'legendary' ? 0.8 : 0.5));
        }
      } else {
        scaleFactor = 1.0;
        rippleRadius = 0;
        rippleAlpha = 0;
      }
    }

    // Update existing particles physics & fadeout
    this.updateParticles();

    // End active animation once progress reached 1.0 and all particles have faded away
    // Failsafe: elapsed >= duration + 800ms forces termination even if frame rate stuttered
    if ((progress >= 1.0 && this.particles.length === 0) || elapsed >= this.duration + 800) {
      this.particles = [];
      this.active = false;
    }

    return {
      isActive: this.active,
      accuracy: this.accuracy,
      fullCycles: this.fullCycles,
      targetScore: this.targetScore,
      currentScore,
      currentCycles,
      progress,
      scaleFactor,
      tier: this.tier,
      particles: this.particles,
      waveTracerProgress,
      phase,
      rippleRadius,
      rippleAlpha,
    };
  }

  private spawnParticles(): void {
    const count =
      this.tier === 'legendary' ? 32 : this.tier === 'high' ? 16 : this.tier === 'medium' ? 6 : 0;
    if (count === 0) return;

    const colors =
      this.tier === 'legendary'
        ? ['#facc15', '#10b981', '#38bdf8', '#f43f5e', '#ffffff']
        : this.tier === 'high'
        ? ['#22c55e', '#38bdf8', '#ffffff']
        : ['#f59e0b', '#38bdf8'];

    this.particles = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
      const speed = (this.tier === 'legendary' ? 3.0 : 2.0) + Math.random() * (this.tier === 'legendary' ? 3.5 : 2.0);
      const color = colors[i % colors.length];
      const maxLife = 24 + Math.floor(Math.random() * 12); // ~400ms to 600ms lifetime

      this.particles.push({
        x: this.originX,
        y: this.originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.0,
        size: this.tier === 'legendary' ? 3.5 + Math.random() * 2.0 : 2.5 + Math.random() * 1.5,
        color,
        alpha: 1.0,
        maxLife,
        life: 0,
        shape: this.tier === 'legendary' && i % 3 === 0 ? 'star' : 'circle',
      });
    }
  }

  private updateParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08; // subtle gravity
      p.vx *= 0.95; // drag
      p.vy *= 0.95;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);

      if (p.life >= p.maxLife || p.alpha <= 0.01) {
        this.particles.splice(i, 1);
      }
    }
  }
}

