import { GameState, StateChangeListener } from './types';

/**
 * GameStateMachine
 * Pure, decoupled state machine governing the game flow.
 * Complies with V-Model verification standards with zero DOM dependency.
 */
export class GameStateMachine {
  private currentState: GameState = 'IDLE';
  private readonly listeners = new Set<StateChangeListener>();

  public getState(): GameState {
    return this.currentState;
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public startDrawing(): boolean {
    if (this.currentState === 'IDLE') {
      this.transitionTo('DRAWING');
      return true;
    }
    return false;
  }

  public finishDrawing(): boolean {
    if (this.currentState === 'DRAWING') {
      this.transitionTo('EVALUATING');
      return true;
    }
    return false;
  }

  public setEvaluated(): boolean {
    if (this.currentState === 'EVALUATING') {
      this.transitionTo('LOCKED');
      return true;
    }
    return false;
  }

  public reset(): boolean {
    if (this.currentState === 'LOCKED' || this.currentState === 'EVALUATING') {
      this.transitionTo('IDLE');
      return true;
    }
    return false;
  }

  private transitionTo(nextState: GameState): void {
    const oldState = this.currentState;
    this.currentState = nextState;
    this.listeners.forEach((listener) => {
      try {
        listener(nextState, oldState);
      } catch (err) {
        console.error('Error in state change listener:', err);
      }
    });
  }
}
