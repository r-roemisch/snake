import type { Game, GameEvent } from './game/game';
import { multiplierHue } from './render/renderer';

export interface RunSummary {
  perfect: boolean;
  score: number;
  newHighScore: boolean;
  length: number;
  maxCombo: number;
  goldenEaten: number;
}

interface Options {
  touch: boolean;
  onPause(): void;
  onMute(): void;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (el: HTMLElement, visible: boolean) => el.classList.toggle('is-visible', visible);
const POP: Keyframe[] = [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }];
const POP_TIMING: KeyframeAnimationOptions = { duration: 260, easing: 'cubic-bezier(.2, 1.6, .4, 1)' };

/** The HUD and overlays around the arena. Plain DOM, so text stays crisp and accessible. */
export class Ui {
  private readonly score = byId('score');
  private readonly best = byId('best');
  private readonly combo = byId('combo');
  private readonly comboMult = byId('combo-mult');
  private readonly comboFill = byId('combo-fill');
  private readonly title = byId('title');
  private readonly hint = byId('hint');
  private readonly paused = byId('paused');
  private readonly over = byId('over');
  private readonly pauseButton = byId<HTMLButtonElement>('pause-btn');
  private readonly muteButton = byId<HTMLButtonElement>('mute-btn');

  private shownScore = 0;
  private targetScore = 0;
  private highScore = 0;
  private comboBreakTimer = 0;

  constructor(options: Options) {
    this.pauseButton.addEventListener('click', options.onPause);
    this.muteButton.addEventListener('click', options.onMute);
    const { touch } = options;
    byId('title-prompt').textContent = touch ? 'Swipe to start' : 'Press an arrow key to start';
    byId('hint-prompt').textContent = touch ? 'Swipe to go' : 'Choose a direction';
    byId('paused-prompt').textContent = touch ? 'Tap to resume' : 'Press P to resume';
    byId('over-prompt').textContent = touch ? 'Tap to play again' : 'Press Space to play again';
    byId('controls').innerHTML = touch
      ? 'Swipe to steer'
      : '<kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> or <kbd>WASD</kbd> steer · <kbd>P</kbd> pause · <kbd>M</kbd> mute';
  }

  /** Prepare for a new run. The big title only shows before the very first one. */
  reset(highScore: number, first: boolean): void {
    this.shownScore = this.targetScore = 0;
    this.highScore = highScore;
    this.score.textContent = '0';
    this.best.textContent = String(highScore);
    this.best.classList.remove('is-beaten');
    this.setCombo(0);
    show(this.over, false);
    show(this.paused, false);
    show(this.title, first);
    show(this.hint, !first);
  }

  started(): void {
    show(this.title, false);
    show(this.hint, false);
  }

  apply(event: GameEvent, game: Game): void {
    switch (event.type) {
      case 'eat':
        this.targetScore += event.points;
        this.score.animate(POP, POP_TIMING);
        // Show what the *next* food is worth if it is eaten in time.
        this.setCombo(Math.min(event.combo + 1, game.config.maxMultiplier));
        break;
      case 'perfect':
        this.targetScore += event.bonus;
        this.setCombo(0);
        break;
      case 'comboBreak':
        this.breakCombo();
        break;
      case 'death':
        this.setCombo(0);
        break;
    }
  }

  frame(game: Game, alpha: number, dtMs: number): void {
    if (this.shownScore !== this.targetScore) {
      const step = Math.max(1, (this.targetScore - this.shownScore) * Math.min(1, (dtMs / 1000) * 10));
      this.shownScore = Math.min(this.targetScore, this.shownScore + step);
      const text = String(Math.round(this.shownScore));
      this.score.textContent = text;
      if (this.shownScore > this.highScore) {
        this.best.textContent = text;
        this.best.classList.add('is-beaten');
      }
    }
    if (game.status === 'playing' && game.combo > 0) {
      const left = Math.max(0, (game.comboTicksLeft - alpha) / game.comboWindowTicks);
      this.comboFill.style.transform = `scaleX(${left})`;
    }
  }

  setPaused(paused: boolean): void {
    show(this.paused, paused);
    this.pauseButton.classList.toggle('is-paused', paused);
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  }

  setMuted(muted: boolean): void {
    this.muteButton.classList.toggle('is-muted', muted);
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  showGameOver(run: RunSummary): void {
    byId('over-title').textContent = run.perfect ? 'Perfect!' : 'Game over';
    byId('over-score').textContent = String(run.score);
    byId('over-length').textContent = String(run.length);
    byId('over-combo').textContent = String(run.maxCombo);
    byId('over-golden').textContent = String(run.goldenEaten);
    this.over.classList.toggle('is-perfect', run.perfect);
    this.over.classList.toggle('has-new-best', run.newHighScore);
    show(this.over, true);
  }

  private setCombo(next: number): void {
    window.clearTimeout(this.comboBreakTimer);
    this.combo.classList.remove('is-broken');
    if (next < 2) {
      this.combo.classList.remove('is-active');
      return;
    }
    const changed = this.comboMult.textContent !== `×${next}` || !this.combo.classList.contains('is-active');
    this.comboMult.textContent = `×${next}`;
    this.combo.style.setProperty('--hue', String(multiplierHue(next)));
    this.combo.classList.add('is-active');
    this.comboFill.style.transform = 'scaleX(1)';
    if (changed) this.comboMult.animate(POP, POP_TIMING);
  }

  private breakCombo(): void {
    this.combo.classList.add('is-broken');
    this.comboBreakTimer = window.setTimeout(() => this.setCombo(0), 520);
  }
}
