// Browser storage can be missing or blocked (private windows, strict settings),
// so every access is guarded and falls back to defaults.

const HIGH_SCORE_KEY = 'snake.highScore';
const MUTED_KEY = 'snake.muted';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved; the game still works for this session.
  }
}

export function loadHighScore(): number {
  return Number(read(HIGH_SCORE_KEY)) || 0;
}

export function saveHighScore(score: number): void {
  write(HIGH_SCORE_KEY, String(score));
}

export function loadMuted(): boolean {
  return read(MUTED_KEY) === '1';
}

export function saveMuted(muted: boolean): void {
  write(MUTED_KEY, muted ? '1' : '0');
}
