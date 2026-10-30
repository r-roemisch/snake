import type { Direction } from './game/game';

export interface Controls {
  direction(direction: Direction): void;
  /** Space, Enter or a tap: start again, or resume. */
  confirm(): void;
  pause(): void;
  mute(): void;
  /** Any user gesture; audio may only start after one. */
  gesture(): void;
}

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const SWIPE_PX = 22;
const TAP_PX = 10;

export function listen(controls: Controls): void {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    controls.gesture();
    const direction = KEYS[e.code];
    if (direction) {
      e.preventDefault();
      controls.direction(direction);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      controls.confirm();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      controls.pause();
    } else if (e.code === 'KeyM') {
      controls.mute();
    }
  });

  // Swipes steer; one long touch can chain several swipes. A short touch that barely moves is a tap.
  let origin: { x: number; y: number } | null = null;
  let start: { x: number; y: number } | null = null;
  let swiped = false;
  const onButton = (e: TouchEvent) => e.target instanceof Element && e.target.closest('button') !== null;

  window.addEventListener(
    'touchstart',
    (e) => {
      if (onButton(e)) return;
      e.preventDefault();
      controls.gesture();
      const t = e.changedTouches[0];
      origin = start = { x: t.clientX, y: t.clientY };
      swiped = false;
    },
    { passive: false },
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!origin) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      const dx = t.clientX - origin.x;
      const dy = t.clientY - origin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      controls.direction(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
      origin = { x: t.clientX, y: t.clientY };
      swiped = true;
    },
    { passive: false },
  );

  window.addEventListener('touchend', (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y);
    if (!swiped && moved < TAP_PX) controls.confirm();
    origin = start = null;
  });
}
