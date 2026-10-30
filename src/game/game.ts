import { randomInt, type Rng } from './rng';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export type GameStatus = 'ready' | 'playing' | 'dead' | 'perfect';

export interface GoldenFood {
  readonly cell: Cell;
  readonly lifetimeMs: number;
  readonly msLeft: number;
}

export interface GameConfig {
  /** Arena size in cells. */
  width: number;
  height: number;
  startLength: number;
  /** Tick duration when a run starts; it shrinks by `tickMsPerSegment` per segment grown, down to `fastestTickMs`. */
  startTickMs: number;
  fastestTickMs: number;
  tickMsPerSegment: number;
  /** Ticks allowed on top of the direct distance to the nearest food before the combo breaks. */
  comboSlackTicks: number;
  maxMultiplier: number;
  foodPoints: number;
  goldenFoodPoints: number;
  goldenLifetimeMs: number;
  /** Golden food appears after a random number of regular food within this range. */
  goldenEveryMin: number;
  goldenEveryMax: number;
  perfectBonus: number;
  maxQueuedTurns: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  width: 20,
  height: 20,
  startLength: 3,
  startTickMs: 140,
  fastestTickMs: 65,
  tickMsPerSegment: 1.5,
  comboSlackTicks: 6,
  maxMultiplier: 8,
  foodPoints: 10,
  goldenFoodPoints: 50,
  goldenLifetimeMs: 6000,
  goldenEveryMin: 5,
  goldenEveryMax: 8,
  perfectBonus: 10000,
  maxQueuedTurns: 2,
};

export type GameEvent =
  | { type: 'eat'; cell: Cell; golden: boolean; points: number; combo: number; multiplier: number }
  | { type: 'foodSpawn'; cell: Cell }
  | { type: 'goldenSpawn'; cell: Cell }
  | { type: 'goldenExpire'; cell: Cell }
  | { type: 'comboBreak'; combo: number }
  | { type: 'death'; cause: 'wall' | 'self'; cell: Cell }
  | { type: 'perfect'; bonus: number };

const VECTORS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function distance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function neighbour(cell: Cell, direction: Direction): Cell {
  const v = VECTORS[direction];
  return { x: cell.x + v.x, y: cell.y + v.y };
}

/**
 * The rules of one run: the snake, the food, scoring and death.
 * Knows nothing about time passing on screen; it only advances when `tick` is called.
 */
export class Game {
  readonly config: GameConfig;
  private readonly rng: Rng;

  private _status: GameStatus = 'ready';
  private _snake: Cell[];
  private _previousSnake: Cell[];
  private _direction: Direction | null = null;
  private queue: Direction[] = [];
  private _food: Cell | null;
  private _golden: GoldenFood | null = null;
  private foodUntilGolden: number;

  private _score = 0;
  private _combo = 0;
  private _comboTicksLeft = 0;
  private _comboWindowTicks = 0;
  private _ticks = 0;

  private _maxCombo = 0;
  private _goldenEaten = 0;

  constructor(config: Partial<GameConfig> = {}, rng: Rng = Math.random) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = rng;
    const { width, height, startLength } = this.config;
    // The snake starts coiled up on a single cell, so the first turn may go any way.
    const start = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    this._snake = Array.from({ length: startLength }, () => start);
    this._previousSnake = this._snake;
    this._food = this.randomFreeCell(4);
    this.foodUntilGolden = this.rollGoldenCountdown();
  }

  get status(): GameStatus {
    return this._status;
  }
  /** Head first. */
  get snake(): readonly Cell[] {
    return this._snake;
  }
  /** The snake as it was before the last tick, for drawing motion between ticks. */
  get previousSnake(): readonly Cell[] {
    return this._previousSnake;
  }
  get head(): Cell {
    return this._snake[0];
  }
  get direction(): Direction | null {
    return this._direction;
  }
  get food(): Cell | null {
    return this._food;
  }
  get golden(): GoldenFood | null {
    return this._golden;
  }
  get score(): number {
    return this._score;
  }
  get combo(): number {
    return this._combo;
  }
  /** The multiplier the next food would be worth if the combo holds. */
  get multiplier(): number {
    return Math.min(Math.max(this._combo, 1), this.config.maxMultiplier);
  }
  get comboTicksLeft(): number {
    return this._comboTicksLeft;
  }
  get comboWindowTicks(): number {
    return this._comboWindowTicks;
  }
  get ticks(): number {
    return this._ticks;
  }
  get maxCombo(): number {
    return this._maxCombo;
  }
  get goldenEaten(): number {
    return this._goldenEaten;
  }
  get isOver(): boolean {
    return this._status === 'dead' || this._status === 'perfect';
  }

  /** How long the current tick lasts; the snake speeds up as it grows. */
  get tickMs(): number {
    const { startTickMs, fastestTickMs, tickMsPerSegment, startLength } = this.config;
    const grown = this._snake.length - startLength;
    return Math.max(fastestTickMs, startTickMs - grown * tickMsPerSegment);
  }

  /**
   * Ask the snake to turn. The first turn starts the run. Turns are queued so quick
   * key presses between ticks are not lost; reversing into the neck is ignored.
   */
  turn(direction: Direction): boolean {
    if (this._status === 'ready') {
      this._status = 'playing';
      this.queue = [direction];
      return true;
    }
    if (this._status !== 'playing') return false;
    const last = this.queue.at(-1) ?? this._direction;
    if (direction === last || (last && direction === OPPOSITE[last])) return false;
    if (this.queue.length >= this.config.maxQueuedTurns) return false;
    this.queue.push(direction);
    return true;
  }

  /** Advance the snake one cell. */
  tick(): GameEvent[] {
    if (this._status !== 'playing') return [];
    const events: GameEvent[] = [];
    const tickMs = this.tickMs;
    this._ticks++;
    this._direction = this.queue.shift() ?? this._direction;
    const next = neighbour(this.head, this._direction!);

    if (!this.inArena(next)) return this.die('wall', next);
    const eatsFood = this._food !== null && sameCell(next, this._food);
    const eatsGolden = this._golden !== null && sameCell(next, this._golden.cell);
    const grows = eatsFood || eatsGolden;
    // The tail moves out of the way this tick unless the snake is growing.
    const body = grows ? this._snake : this._snake.slice(0, -1);
    if (body.some((c) => sameCell(c, next))) return this.die('self', next);

    this._previousSnake = this._snake;
    this._snake = [next, ...body];
    this._comboTicksLeft = Math.max(0, this._comboTicksLeft - 1);

    if (grows) {
      this.eat(next, eatsGolden, events);
      if (this.isOver) return events;
    } else if (this._combo > 0 && this._comboTicksLeft <= 0) {
      events.push({ type: 'comboBreak', combo: this._combo });
      this._combo = 0;
    }

    if (this._golden) {
      const msLeft = this._golden.msLeft - tickMs;
      if (msLeft <= 0) {
        events.push({ type: 'goldenExpire', cell: this._golden.cell });
        this._golden = null;
        if (!this._food) this.spawnFood(events);
      } else {
        this._golden = { ...this._golden, msLeft };
      }
    }
    return events;
  }

  private eat(cell: Cell, golden: boolean, events: GameEvent[]): void {
    this._combo = this._combo > 0 ? this._combo + 1 : 1;
    this._maxCombo = Math.max(this._maxCombo, this._combo);
    const multiplier = this.multiplier;
    const points = (golden ? this.config.goldenFoodPoints : this.config.foodPoints) * multiplier;
    this._score += points;
    events.push({ type: 'eat', cell, golden, points, combo: this._combo, multiplier });

    if (this._snake.length === this.config.width * this.config.height) {
      this._status = 'perfect';
      this._score += this.config.perfectBonus;
      this._food = null;
      this._golden = null;
      events.push({ type: 'perfect', bonus: this.config.perfectBonus });
      return;
    }

    if (golden) {
      this._golden = null;
      this._goldenEaten++;
    } else {
      this.spawnFood(events);
      this.foodUntilGolden--;
      if (this.foodUntilGolden <= 0 && !this._golden) {
        const goldenCell = this.randomFreeCell();
        if (goldenCell) {
          const lifetimeMs = this.config.goldenLifetimeMs;
          this._golden = { cell: goldenCell, lifetimeMs, msLeft: lifetimeMs };
          events.push({ type: 'goldenSpawn', cell: goldenCell });
          this.foodUntilGolden = this.rollGoldenCountdown();
        }
      }
    }

    const targets = [this._food, this._golden?.cell].filter((c): c is Cell => c != null);
    const nearest = targets.length > 0 ? Math.min(...targets.map((c) => distance(cell, c))) : 0;
    this._comboWindowTicks = nearest + this.config.comboSlackTicks;
    this._comboTicksLeft = this._comboWindowTicks;
  }

  private spawnFood(events: GameEvent[]): void {
    this._food = this.randomFreeCell();
    if (this._food) events.push({ type: 'foodSpawn', cell: this._food });
  }

  private die(cause: 'wall' | 'self', cell: Cell): GameEvent[] {
    this._status = 'dead';
    this._previousSnake = this._snake;
    return [{ type: 'death', cause, cell }];
  }

  private inArena(cell: Cell): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.config.width && cell.y < this.config.height;
  }

  /** A random cell not covered by the snake or food, preferring ones at least `minDistance` from the head. */
  private randomFreeCell(minDistance = 0): Cell | null {
    const { width, height } = this.config;
    const taken = new Set(this._snake.map((c) => c.y * width + c.x));
    if (this._food) taken.add(this._food.y * width + this._food.x);
    if (this._golden) taken.add(this._golden.cell.y * width + this._golden.cell.x);
    const free: Cell[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!taken.has(y * width + x)) free.push({ x, y });
      }
    }
    if (free.length === 0) return null;
    const far = free.filter((c) => distance(c, this.head) >= minDistance);
    const pool = far.length > 0 ? far : free;
    return pool[Math.floor(this.rng() * pool.length)];
  }

  private rollGoldenCountdown(): number {
    return randomInt(this.rng, this.config.goldenEveryMin, this.config.goldenEveryMax);
  }
}
