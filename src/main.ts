import '@fontsource/tilt-neon/400.css';
import '@fontsource/oxanium/500.css';
import '@fontsource/oxanium/700.css';
import './style.css';

import { Sound } from './audio';
import { Game, type GameEvent } from './game/game';
import { listen } from './input';
import { Renderer } from './render/renderer';
import { loadHighScore, loadMuted, saveHighScore, saveMuted } from './storage';
import { Ui } from './ui';

/** Moments that happen where the head is going; they are shown when it gets there. */
const ON_ARRIVAL = new Set<GameEvent['type']>(['eat', 'foodSpawn', 'goldenSpawn', 'perfect']);
/** Stops a key pressed in the heat of death from skipping the game over screen. */
const RESTART_LOCK_MS = 450;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;

const stage = document.getElementById('stage')!;
const renderer = new Renderer(document.getElementById('scene') as HTMLCanvasElement, stage, reducedMotion);
const sound = new Sound(loadMuted());
const ui = new Ui({
  touch,
  onPause: () => {
    sound.unlock();
    togglePause();
  },
  onMute: () => {
    sound.unlock();
    toggleMute();
  },
});

let game = new Game();
let highScore = loadHighScore();
/** How far into the current tick we are, in ms. */
let elapsed = 0;
let paused = false;
let overShownAt: number | null = null;
let pending: { at: number; event: GameEvent }[] = [];

function newRun(first = false): void {
  game = new Game();
  elapsed = 0;
  paused = false;
  overShownAt = null;
  pending = [];
  renderer.reset(game);
  ui.reset(highScore, first);
  ui.setPaused(false);
}

function present(event: GameEvent): void {
  renderer.apply(event, game);
  ui.apply(event, game);
  sound.play(event);
}

function flushDue(all = false): void {
  while (pending.length > 0 && (all || pending[0].at <= renderer.time)) present(pending.shift()!.event);
}

function dispatch(events: GameEvent[]): void {
  // The game decides the moment the head *starts* moving into a cell, but the
  // head only gets there visually at the end of the tick.
  const arrival = game.status === 'playing' ? game.tickMs - elapsed : 0;
  for (const event of events) {
    if (ON_ARRIVAL.has(event.type) && arrival > 0) {
      pending.push({ at: renderer.time + arrival, event });
    } else {
      flushDue(true);
      present(event);
    }
  }
}

function finishRun(): void {
  const newHighScore = game.score > highScore;
  if (newHighScore) {
    highScore = game.score;
    saveHighScore(highScore);
    renderer.celebrate();
    sound.highScore();
  }
  ui.showGameOver({
    perfect: game.status === 'perfect',
    score: game.score,
    newHighScore,
    length: game.snake.length,
    maxCombo: game.maxCombo,
    goldenEaten: game.goldenEaten,
  });
  overShownAt = renderer.time;
}

function canRestart(): boolean {
  return overShownAt !== null && renderer.time - overShownAt > RESTART_LOCK_MS;
}

function togglePause(): void {
  if (game.status !== 'playing') return;
  paused = !paused;
  ui.setPaused(paused);
}

function toggleMute(): void {
  sound.setMuted(!sound.muted);
  saveMuted(sound.muted);
  ui.setMuted(sound.muted);
}

listen({
  gesture: () => sound.unlock(),
  direction(direction) {
    if (paused) return;
    if (game.isOver) {
      if (!canRestart()) return;
      newRun();
    }
    if (game.status === 'ready') {
      game.turn(direction);
      elapsed = game.tickMs; // take the first step right away
      ui.started();
      sound.start();
      return;
    }
    game.turn(direction);
  },
  confirm() {
    if (paused) togglePause();
    else if (game.isOver && canRestart()) newRun();
  },
  pause: togglePause,
  mute: toggleMute,
});

const pauseIfPlaying = () => {
  if (game.status === 'playing' && !paused) togglePause();
};
document.addEventListener('visibilitychange', () => document.hidden && pauseIfPlaying());
window.addEventListener('blur', pauseIfPlaying);
window.addEventListener('resize', () => renderer.resize());
new ResizeObserver(() => renderer.resize()).observe(stage);

let last = performance.now();
function frame(now: number): void {
  // Ask for the next frame first so one bad frame can never stop the game loop.
  requestAnimationFrame(frame);
  const dt = Math.min(now - last, 100);
  last = now;

  if (!paused) {
    renderer.update(dt, game);
    flushDue();
    if (game.status === 'playing') {
      elapsed += dt;
      while (game.status === 'playing' && elapsed >= game.tickMs) {
        elapsed -= game.tickMs;
        dispatch(game.tick());
      }
    }
    if (game.isOver && overShownAt === null && renderer.sceneDone) finishRun();
  }

  const alpha = game.status === 'playing' ? Math.min(elapsed / game.tickMs, 1) : 1;
  renderer.draw(game, alpha);
  ui.frame(game, alpha, paused ? 0 : dt);
}

if (import.meta.env.DEV) {
  // Lets automated checks inspect the running game during development.
  Object.assign(window, { snake: { get game() { return game; } } });
}

newRun(true);
ui.setMuted(sound.muted);
void document.fonts?.load('700 20px Oxanium');
requestAnimationFrame(frame);
