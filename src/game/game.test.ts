import { describe, expect, it } from 'vitest';
import {
  Game,
  OPPOSITE,
  distance,
  neighbour,
  sameCell,
  type Cell,
  type Direction,
  type GameConfig,
  type GameEvent,
} from './game';
import { seededRng } from './rng';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const NO_GOLDEN: Partial<GameConfig> = { goldenEveryMin: 1000, goldenEveryMax: 1000 };

function newGame(config: Partial<GameConfig> = {}, seed = 1): Game {
  return new Game({ ...NO_GOLDEN, ...config }, seededRng(seed));
}

function move(game: Game, direction: Direction): GameEvent[] {
  game.turn(direction);
  return game.tick();
}

function isSafe(game: Game, cell: Cell): boolean {
  const { width, height } = game.config;
  if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) return false;
  return !game.snake.slice(0, -1).some((c) => sameCell(c, cell));
}

function safeDirections(game: Game, avoid: Cell[] = []): Direction[] {
  const current = game.direction;
  return DIRECTIONS.filter((d) => !current || d !== OPPOSITE[current]).filter((d) => {
    const cell = neighbour(game.head, d);
    return isSafe(game, cell) && !avoid.some((a) => sameCell(a, cell));
  });
}

/** Steer greedily onto `target`, returning every event on the way. */
function travelTo(game: Game, target: Cell): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < 200 && !sameCell(game.head, target) && !game.isOver; i++) {
    const options = safeDirections(game).sort(
      (a, b) => distance(neighbour(game.head, a), target) - distance(neighbour(game.head, b), target),
    );
    events.push(...move(game, options[0]));
  }
  return events;
}

/** Move for `ticks` ticks without eating anything. */
function wander(game: Game, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const avoid = [game.food, game.golden?.cell].filter((c): c is Cell => c != null);
    const options = safeDirections(game, avoid);
    const direction = game.direction && options.includes(game.direction) ? game.direction : options[0];
    events.push(...move(game, direction));
  }
  return events;
}

function eatFood(game: Game): Extract<GameEvent, { type: 'eat' }> {
  const events = travelTo(game, game.food!);
  const eat = events.find((e) => e.type === 'eat');
  if (!eat || eat.type !== 'eat') throw new Error('did not eat');
  return eat;
}

describe('a new run', () => {
  it('starts with the snake coiled up in the middle and food some distance away', () => {
    const game = newGame();
    expect(game.status).toBe('ready');
    expect(game.snake).toHaveLength(3);
    expect(game.snake.every((c) => sameCell(c, { x: 10, y: 10 }))).toBe(true);
    expect(distance(game.food!, game.head)).toBeGreaterThanOrEqual(4);
  });

  it('does not move before the first turn', () => {
    const game = newGame();
    expect(game.tick()).toEqual([]);
    expect(game.head).toEqual({ x: 10, y: 10 });
  });

  it.each(DIRECTIONS)('starts with a first turn in any direction (%s)', (direction) => {
    const game = newGame();
    expect(game.turn(direction)).toBe(true);
    expect(game.status).toBe('playing');
    game.tick();
    expect(game.head).toEqual(neighbour({ x: 10, y: 10 }, direction));
  });
});

describe('moving', () => {
  it('advances one cell per tick and uncoils without growing', () => {
    const game = newGame();
    game.turn('right');
    game.tick();
    game.tick();
    game.tick();
    expect(game.snake).toEqual([
      { x: 13, y: 10 },
      { x: 12, y: 10 },
      { x: 11, y: 10 },
    ]);
  });

  it('ignores a turn straight back into the neck', () => {
    const game = newGame();
    move(game, 'right');
    expect(game.turn('left')).toBe(false);
    game.tick();
    expect(game.head).toEqual({ x: 12, y: 10 });
  });

  it('queues quick turns so none are lost', () => {
    const game = newGame();
    move(game, 'right');
    expect(game.turn('up')).toBe(true);
    expect(game.turn('left')).toBe(true);
    game.tick();
    expect(game.head).toEqual({ x: 11, y: 9 });
    game.tick();
    expect(game.head).toEqual({ x: 10, y: 9 });
  });

  it('queues at most two turns', () => {
    const game = newGame();
    move(game, 'right');
    game.turn('up');
    game.turn('left');
    expect(game.turn('down')).toBe(false);
  });

  it('may move into the cell the tail is leaving', () => {
    const game = newGame({ startLength: 4 }, 3);
    ['right', 'right', 'right', 'up', 'left'].forEach((d) => move(game, d as Direction));
    move(game, 'down');
    expect(game.status).toBe('playing');
  });
});

describe('death', () => {
  it('happens when the head hits a wall', () => {
    const game = newGame({}, 7);
    game.turn('up');
    let events: GameEvent[] = [];
    while (!game.isOver) events = game.tick();
    expect(game.status).toBe('dead');
    expect(events).toEqual([{ type: 'death', cause: 'wall', cell: { x: 10, y: -1 } }]);
  });

  it('happens when the head runs into the body', () => {
    const game = newGame({ startLength: 5 }, 3);
    ['right', 'right', 'right', 'right', 'up', 'left'].forEach((d) => move(game, d as Direction));
    expect(move(game, 'down')).toEqual([{ type: 'death', cause: 'self', cell: { x: 13, y: 10 } }]);
  });

  it('ends the run: nothing moves or turns afterwards', () => {
    const game = newGame({}, 7);
    game.turn('up');
    while (!game.isOver) game.tick();
    const snake = game.snake;
    expect(game.tick()).toEqual([]);
    expect(game.turn('left')).toBe(false);
    expect(game.snake).toBe(snake);
  });
});

describe('eating', () => {
  it('grows the snake by one segment, scores, and places new food', () => {
    const game = newGame();
    const food = game.food!;
    const events = travelTo(game, food);
    expect(events).toContainEqual({ type: 'eat', cell: food, golden: false, points: 10, combo: 1, multiplier: 1 });
    expect(game.snake).toHaveLength(4);
    expect(game.score).toBe(10);
    expect(game.food).not.toEqual(food);
    expect(game.snake.some((c) => sameCell(c, game.food!))).toBe(false);
    expect(events).toContainEqual({ type: 'foodSpawn', cell: game.food });
  });

  it('speeds the snake up as it grows, down to a floor', () => {
    const game = newGame({ startTickMs: 100, tickMsPerSegment: 10, fastestTickMs: 75 });
    expect(game.tickMs).toBe(100);
    eatFood(game);
    expect(game.tickMs).toBe(90);
    eatFood(game);
    expect(game.tickMs).toBe(80);
    eatFood(game);
    expect(game.tickMs).toBe(75);
  });
});

describe('combo', () => {
  it('multiplies points for food eaten in quick succession', () => {
    const game = newGame({ comboSlackTicks: 20 });
    expect(eatFood(game)).toMatchObject({ combo: 1, multiplier: 1, points: 10 });
    expect(eatFood(game)).toMatchObject({ combo: 2, multiplier: 2, points: 20 });
    expect(eatFood(game)).toMatchObject({ combo: 3, multiplier: 3, points: 30 });
    expect(game.score).toBe(60);
  });

  it('caps the multiplier', () => {
    const game = newGame({ comboSlackTicks: 20, maxMultiplier: 2 });
    eatFood(game);
    eatFood(game);
    expect(eatFood(game)).toMatchObject({ combo: 3, multiplier: 2, points: 20 });
  });

  it('gives the direct distance to the next food plus some slack', () => {
    const game = newGame({ comboSlackTicks: 5 });
    eatFood(game);
    expect(game.comboWindowTicks).toBe(distance(game.head, game.food!) + 5);
    expect(game.comboTicksLeft).toBe(game.comboWindowTicks);
  });

  it('breaks when the window runs out without eating', () => {
    const game = newGame();
    eatFood(game);
    const window = game.comboWindowTicks;
    expect(wander(game, window - 1)).not.toContainEqual(expect.objectContaining({ type: 'comboBreak' }));
    expect(game.combo).toBe(1);
    expect(wander(game, 1)).toContainEqual({ type: 'comboBreak', combo: 1 });
    expect(game.combo).toBe(0);
    expect(eatFood(game)).toMatchObject({ combo: 1, multiplier: 1 });
  });
});

describe('golden food', () => {
  const GOLDEN: Partial<GameConfig> = { goldenEveryMin: 1, goldenEveryMax: 1, comboSlackTicks: 40 };

  it('appears after the configured number of regular food', () => {
    const game = newGame(GOLDEN);
    const events = travelTo(game, game.food!);
    expect(game.golden).not.toBeNull();
    expect(events).toContainEqual({ type: 'goldenSpawn', cell: game.golden!.cell });
    expect(sameCell(game.golden!.cell, game.food!)).toBe(false);
  });

  it('vanishes when its time is up', () => {
    const game = newGame({ ...GOLDEN, goldenLifetimeMs: 1000 });
    eatFood(game);
    const cell = game.golden!.cell;
    const events = wander(game, Math.ceil(1000 / game.tickMs));
    expect(events).toContainEqual({ type: 'goldenExpire', cell });
    expect(game.golden).toBeNull();
  });

  it('is worth more, grows the snake and continues the combo', () => {
    const game = newGame(GOLDEN);
    eatFood(game);
    const length = game.snake.length;
    const events = travelTo(game, game.golden!.cell);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'eat', golden: true, combo: 2, multiplier: 2, points: 100 }),
    );
    expect(game.snake).toHaveLength(length + 1);
    expect(game.golden).toBeNull();
    expect(game.goldenEaten).toBe(1);
  });
});

describe('perfect', () => {
  it('happens when the snake fills every cell of the arena', () => {
    const game = newGame({ width: 2, height: 1, startLength: 1, perfectBonus: 1000 });
    expect(game.food).toEqual({ x: 0, y: 0 });
    const events = move(game, 'left');
    expect(events).toContainEqual({ type: 'perfect', bonus: 1000 });
    expect(game.status).toBe('perfect');
    expect(game.isOver).toBe(true);
    expect(game.score).toBe(1010);
    expect(game.food).toBeNull();
  });
});
