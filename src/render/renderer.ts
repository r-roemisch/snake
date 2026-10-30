import { sameCell, type Cell, type Game, type GameEvent } from '../game/game';
import { lerp, measure, pointAt, roundCorners, section, spine, type Point } from './geometry';
import { HUE, Particles, glowSprite, tintColor, type Tint } from './particles';

const TAU = Math.PI * 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => (t <= 0 ? 0 : 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2);

/** Hue for a multiplier: cool at ×1, through pink, to gold at the top. */
export function multiplierHue(multiplier: number): number {
  const stops = [HUE.cyan, HUE.cyan, 210, HUE.violet, 300, HUE.food, 360 + 15, 360 + 30, 360 + HUE.gold];
  return stops[Math.min(multiplier, stops.length - 1)] % 360;
}

interface Timed {
  cell: Cell;
  at: number;
}
interface Popup {
  x: number;
  y: number;
  text: string;
  tint: Tint;
  size: number;
  at: number;
}
interface Ripple {
  x: number;
  y: number;
  at: number;
  strength: number;
  tint: Tint;
}
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
}
interface DeathScene {
  at: number;
  cell: Cell;
  segments: Cell[];
  interval: number;
  exploded: number;
}

const DEATH_LUNGE_MS = 240;
const DEATH_EXPLODE_DELAY_MS = 300;
const PERFECT_SCENE_MS = 2800;
const RIPPLE_MS = 1400;
const POPUP_MS = 1000;
const TRAIL_MS = 900;

/**
 * Draws the arena and everything in it, and owns every purely visual effect.
 * Reads the game for positions; learns about moments (eating, dying…) through `apply`.
 */
export class Renderer {
  /** Presentation clock in ms. It stops while paused and slows during slow motion. */
  time = 0;

  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private arena = { x: 0, y: 0, size: 0, cell: 0 };
  private cols = 20;
  private background: CanvasGradient | null = null;

  private readonly particles = new Particles();
  private popups: Popup[] = [];
  private ripples: Ripple[] = [];
  private trail: Timed[] = [];
  private bulges: Timed[] = [];
  private motes: Mote[] = [];

  private food: Timed | null = null;
  private golden: Timed | null = null;
  private lastEatAt = -1e9;
  private lastTick = 0;
  private heat = 0;
  private trauma = 0;
  private flash: { tint: Tint; alpha: number } = { tint: 'white', alpha: 0 };
  private wallPulse = 0;
  private death: DeathScene | null = null;
  private perfectAt: number | null = null;
  private slowMoUntil = 0;
  private celebrateUntil = 0;
  private headPx: Point | null = null;
  private sparkDebt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stage: HTMLElement,
    private readonly reducedMotion: boolean,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    const r = this.stage.getBoundingClientRect();
    this.arena = { x: r.left, y: r.top, size: r.width, cell: r.width / this.cols };
    this.background = null;
    if (this.motes.length === 0) {
      this.motes = Array.from({ length: 70 }, () => ({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10 - 4,
        size: 0.6 + Math.random() * 1.4,
        phase: Math.random() * TAU,
      }));
    }
  }

  /** Start drawing a fresh run. */
  reset(game: Game): void {
    this.cols = game.config.width;
    this.resize();
    this.food = game.food ? { cell: game.food, at: this.time } : null;
    this.golden = null;
    this.death = null;
    this.perfectAt = null;
    this.bulges = [];
    this.trail = [];
    this.popups = [];
    this.lastTick = game.ticks;
    this.heat = 0;
  }

  /** True once the closing animation of a finished run has played out. */
  get sceneDone(): boolean {
    if (this.death) {
      const length = DEATH_EXPLODE_DELAY_MS + this.death.segments.length * this.death.interval + 450;
      return this.time - this.death.at > length;
    }
    if (this.perfectAt !== null) return this.time - this.perfectAt > PERFECT_SCENE_MS;
    return false;
  }

  /** Show a moment from the game. Called when the moment is visible, not when it was decided. */
  apply(event: GameEvent, game: Game): void {
    const cs = this.arena.cell;
    switch (event.type) {
      case 'eat': {
        const p = this.cellCentre(event.cell);
        const power = Math.min(event.multiplier, 8);
        const tint = event.golden ? HUE.gold : HUE.food;
        this.particles.burst(p.x, p.y, {
          count: event.golden ? 46 : 14 + power * 4,
          tint: event.golden ? [HUE.gold, HUE.gold, 30, 'white'] : [HUE.food, HUE.food - 18, multiplierHue(power), 'white'],
          speed: [cs * 1.5, cs * (event.golden ? 9 : 4.5 + power * 0.6)],
          size: [cs * 0.12, cs * 0.32],
          ttl: [350, event.golden ? 1100 : 800],
          drag: 3.2,
        });
        this.ripples.push({ x: p.x, y: p.y, at: this.time, strength: event.golden ? 1.4 : 0.6 + power * 0.08, tint });
        this.popups.push({
          x: p.x,
          y: p.y - cs * 0.3,
          text: `+${event.points}`,
          tint: event.golden ? HUE.gold : multiplierHue(event.multiplier),
          size: cs * (event.golden ? 0.85 : 0.5 + power * 0.035),
          at: this.time,
        });
        this.bulges.push({ cell: event.cell, at: this.time });
        this.lastEatAt = this.time;
        this.wallPulse = Math.min(1, this.wallPulse + 0.3 + power * 0.05);
        this.addTrauma(event.golden ? 0.38 : 0.06 + power * 0.015);
        if (event.golden) {
          this.golden = null;
          this.flash = { tint: HUE.gold, alpha: 0.16 };
        } else {
          this.food = null;
        }
        break;
      }
      case 'foodSpawn':
        this.food = { cell: event.cell, at: this.time };
        break;
      case 'goldenSpawn': {
        this.golden = { cell: event.cell, at: this.time };
        const p = this.cellCentre(event.cell);
        this.particles.burst(p.x, p.y, {
          count: 24,
          tint: [HUE.gold, 'white'],
          speed: [cs * 2, cs * 5],
          size: [cs * 0.1, cs * 0.24],
          ttl: [300, 700],
        });
        this.ripples.push({ x: p.x, y: p.y, at: this.time, strength: 0.9, tint: HUE.gold });
        break;
      }
      case 'goldenExpire': {
        const p = this.cellCentre(event.cell);
        this.particles.burst(p.x, p.y, {
          count: 18,
          tint: HUE.gold,
          speed: [cs * 0.3, cs * 1.4],
          size: [cs * 0.08, cs * 0.18],
          ttl: [400, 900],
          gravity: -cs * 1.5,
        });
        this.golden = null;
        break;
      }
      case 'comboBreak':
        this.heat *= 0.4;
        break;
      case 'death': {
        const n = game.snake.length;
        this.death = {
          at: this.time,
          cell: event.cell,
          segments: [...game.snake],
          interval: Math.min(34, 900 / n),
          exploded: 0,
        };
        const head = this.cellCentre(game.snake[0]);
        const hit = this.cellCentre(event.cell);
        const impact = { x: (head.x + hit.x) / 2, y: (head.y + hit.y) / 2 };
        this.particles.burst(impact.x, impact.y, {
          count: 40,
          tint: [HUE.danger, HUE.danger, 'white', HUE.food],
          speed: [cs * 2, cs * 9],
          size: [cs * 0.12, cs * 0.3],
          ttl: [300, 900],
          drag: 3.5,
        });
        this.ripples.push({ x: impact.x, y: impact.y, at: this.time, strength: 2, tint: HUE.danger });
        this.addTrauma(1);
        this.flash = { tint: HUE.danger, alpha: 0.42 };
        this.slowMoUntil = this.time + 90;
        break;
      }
      case 'perfect':
        this.perfectAt = this.time;
        this.flash = { tint: 'white', alpha: 0.6 };
        this.addTrauma(0.5);
        break;
    }
  }

  /** A shower of sparks for a new high score. */
  celebrate(): void {
    this.celebrateUntil = this.time + 1600;
  }

  update(dtMs: number, game: Game): void {
    const dt = this.time < this.slowMoUntil ? dtMs * 0.25 : dtMs;
    this.time += dt;
    const t = this.time;
    const cs = this.arena.cell;

    this.particles.update(dt);
    this.popups = this.popups.filter((p) => t - p.at < POPUP_MS);
    this.ripples = this.ripples.filter((r) => t - r.at < RIPPLE_MS);
    this.trail = this.trail.filter((r) => t - r.at < TRAIL_MS);
    this.trauma = Math.max(0, this.trauma - (dt / 1000) * 1.5);
    this.flash.alpha = Math.max(0, this.flash.alpha - (dt / 1000) * 1.6);
    this.wallPulse = Math.max(0, this.wallPulse - (dt / 1000) * 1.8);

    const max = game.config.maxMultiplier;
    const targetHeat = game.combo > 0 && !game.isOver ? (game.multiplier - 1) / (max - 1) : 0;
    this.heat += (targetHeat - this.heat) * Math.min(1, (dt / 1000) * 3);

    const drift = 1 + this.heat * 2.5;
    for (const m of this.motes) {
      m.x = (m.x + (m.vx * drift * dt) / 1000 + this.width) % this.width;
      m.y = (m.y + (m.vy * drift * dt) / 1000 + this.height) % this.height;
    }

    // Sparks fly off the head once a combo gets going.
    if (this.headPx && game.status === 'playing' && game.combo >= 3) {
      this.sparkDebt += (dt / 1000) * (game.multiplier - 2) * 7;
      while (this.sparkDebt >= 1) {
        this.sparkDebt--;
        this.particles.burst(this.headPx.x, this.headPx.y, {
          count: 1,
          tint: multiplierHue(game.multiplier),
          speed: [cs * 0.4, cs * 1.6],
          size: [cs * 0.08, cs * 0.18],
          ttl: [250, 600],
        });
      }
    }

    if (this.golden && Math.random() < (dt / 1000) * 6) {
      const p = this.cellCentre(this.golden.cell);
      this.particles.burst(p.x + (Math.random() - 0.5) * cs * 0.8, p.y + (Math.random() - 0.5) * cs * 0.8, {
        count: 1,
        tint: [HUE.gold, 'white'],
        speed: [cs * 0.1, cs * 0.5],
        size: [cs * 0.06, cs * 0.14],
        ttl: [400, 800],
        gravity: -cs * 1.2,
      });
    }

    if (this.death) this.explodeSegments();

    if (this.perfectAt !== null && t - this.perfectAt < PERFECT_SCENE_MS - 600 && Math.random() < (dt / 1000) * 7) {
      this.firework(HUE.gold);
    }
    if (t < this.celebrateUntil && Math.random() < (dt / 1000) * 9) {
      this.firework(Math.random() < 0.5 ? HUE.gold : HUE.food);
    }
  }

  draw(game: Game, alpha: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.recordTrail(game);
    this.drawBackground();

    const shake = this.reducedMotion ? 0 : this.trauma ** 2 * this.arena.cell * 0.6;
    const t = this.time;
    ctx.save();
    ctx.translate(
      shake * (Math.sin(t * 0.091) + 0.6 * Math.sin(t * 0.057 + 1.3)) * 0.62,
      shake * (Math.sin(t * 0.077 + 2.1) + 0.6 * Math.sin(t * 0.043)) * 0.62,
    );
    this.drawFloor();
    this.drawTrail();
    this.drawGrid();
    this.drawWalls();
    this.drawFood();
    this.drawGolden(game, alpha);
    this.drawSnake(game, alpha);
    this.particles.draw(ctx);
    this.drawPopups();
    ctx.restore();

    if (this.flash.alpha > 0.002) {
      ctx.fillStyle = tintColor(this.flash.tint, this.flash.alpha * (this.reducedMotion ? 0.25 : 1));
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  // ---- helpers ------------------------------------------------------------

  private cellCentre(cell: Cell): Point {
    const { x, y, cell: cs } = this.arena;
    return { x: x + (cell.x + 0.5) * cs, y: y + (cell.y + 0.5) * cs };
  }

  private addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  private firework(baseHue: number): void {
    const { x, y, size, cell: cs } = this.arena;
    const px = x + size * (0.15 + Math.random() * 0.7);
    const py = y + size * (0.1 + Math.random() * 0.6);
    const hue = (baseHue + (Math.random() - 0.5) * 60 + 360) % 360;
    this.particles.burst(px, py, {
      count: 34,
      tint: [hue, hue, 'white'],
      speed: [cs * 2, cs * 7],
      size: [cs * 0.1, cs * 0.26],
      ttl: [600, 1300],
      drag: 2,
      gravity: cs * 3,
    });
  }

  private explodeSegments(): void {
    const death = this.death!;
    const cs = this.arena.cell;
    const due = Math.floor((this.time - death.at - DEATH_EXPLODE_DELAY_MS) / death.interval) + 1;
    const target = Math.min(death.segments.length, Math.max(0, due));
    while (death.exploded < target) {
      const i = death.exploded++;
      const p = this.cellCentre(death.segments[i]);
      const hue = this.snakeHue(i * cs);
      this.particles.burst(p.x, p.y, {
        count: 9,
        tint: [hue, hue, 'white'],
        speed: [cs * 1, cs * 4.5],
        size: [cs * 0.14, cs * 0.34],
        ttl: [450, 1100],
        drag: 2.6,
      });
      if (i % 4 === 0) this.ripples.push({ x: p.x, y: p.y, at: this.time, strength: 0.5, tint: hue });
    }
  }

  private recordTrail(game: Game): void {
    if (game.ticks === this.lastTick) return;
    this.lastTick = game.ticks;
    const left = game.previousSnake.at(-1);
    if (left && !game.snake.some((c) => sameCell(c, left))) this.trail.push({ cell: left, at: this.time });
  }

  /** The snake's colour `s` pixels from its head: a slow neon gradient that flows along the body. */
  private snakeHue(s: number): number {
    const cs = this.arena.cell;
    if (this.perfectAt !== null) return (s / cs) * 14 + this.time * 0.3;
    const flow = this.time * (0.0011 + this.heat * 0.0025);
    const k = 0.5 + 0.5 * Math.sin(s / (cs * 5.5) - flow * 3);
    return lerp(HUE.cyan, HUE.violet + this.heat * 70, k);
  }

  // ---- layers ------------------------------------------------------------

  private drawBackground(): void {
    const ctx = this.ctx;
    const { x, y, size } = this.arena;
    const cx = x + size / 2;
    const cy = y + size / 2;
    if (!this.background) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(this.width, this.height) * 0.75);
      g.addColorStop(0, '#0e0b2a');
      g.addColorStop(0.55, '#07061a');
      g.addColorStop(1, '#020107');
      this.background = g;
    }
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.width, this.height);

    const t = this.time;
    const reach = Math.max(this.width, this.height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const blobs = [
      { hue: lerp(HUE.violet, HUE.food, this.heat), a: 0.15 + this.heat * 0.1, r: 0.55, fx: 0.00011, fy: 0.00013, ox: 0 },
      { hue: lerp(HUE.cyan, 214, this.heat), a: 0.08 + this.heat * 0.06, r: 0.45, fx: 0.00009, fy: 0.00007, ox: 2 },
    ];
    for (const b of blobs) {
      const bx = cx + Math.sin(t * b.fx + b.ox) * size * 0.45;
      const by = cy + Math.cos(t * b.fy + b.ox) * size * 0.35;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, reach * b.r);
      g.addColorStop(0, `hsl(${b.hue} 90% 50% / ${b.a})`);
      g.addColorStop(1, `hsl(${b.hue} 90% 50% / 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.fillStyle = '#c9c2ff';
    for (const m of this.motes) {
      ctx.globalAlpha = 0.12 + 0.12 * Math.sin(t * 0.0012 + m.phase);
      ctx.fillRect(m.x, m.y, m.size, m.size);
    }
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  private drawFloor(): void {
    const ctx = this.ctx;
    const { x, y, size, cell: cs } = this.arena;
    this.roundRect(x, y, size, size, cs * 0.35);
    const g = ctx.createLinearGradient(x, y, x, y + size);
    g.addColorStop(0, 'rgba(22, 17, 58, 0.78)');
    g.addColorStop(1, 'rgba(12, 9, 34, 0.82)');
    ctx.fillStyle = g;
    ctx.fill();
  }

  private drawTrail(): void {
    const ctx = this.ctx;
    const cs = this.arena.cell;
    const sprite = glowSprite(lerp(HUE.violet, HUE.food, this.heat));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const tr of this.trail) {
      const k = 1 - (this.time - tr.at) / TRAIL_MS;
      const p = this.cellCentre(tr.cell);
      const r = cs * (0.5 + 0.25 * (1 - k));
      ctx.globalAlpha = 0.22 * k * k;
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const { x, y, cell: cs } = this.arena;
    const t = this.time;
    const live = this.ripples.map((r) => ({
      r,
      radius: (t - r.at) * cs * 0.017,
      fade: (1 - (t - r.at) / RIPPLE_MS) * r.strength,
    }));
    const base = 0.12 + this.heat * 0.06;
    for (let gy = 1; gy < this.cols; gy++) {
      for (let gx = 1; gx < this.cols; gx++) {
        const px = x + gx * cs;
        const py = y + gy * cs;
        let boost = 0;
        let tint: Tint = HUE.wall;
        for (const { r, radius, fade } of live) {
          const d = Math.hypot(px - r.x, py - r.y);
          const b = Math.exp(-(((d - radius) / (cs * 1.2)) ** 2)) * fade;
          if (b > boost) tint = r.tint;
          boost += b;
        }
        boost = Math.min(boost, 1.6);
        const s = 1.4 + boost * 2.4;
        ctx.globalAlpha = Math.min(1, base + boost * 0.65);
        ctx.fillStyle = boost > 0.05 ? tintColor(tint, 1, 72) : '#8f86d9';
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawWalls(): void {
    const ctx = this.ctx;
    const { x, y, size, cell: cs } = this.arena;
    const pad = cs * 0.14;
    const hue = lerp(HUE.wall, 330, this.heat);
    const glow = Math.min(1, 0.55 + this.wallPulse * 0.45 + this.heat * 0.2);
    ctx.save();
    this.roundRect(x - pad, y - pad, size + pad * 2, size + pad * 2, cs * 0.45);
    ctx.shadowColor = `hsl(${hue} 100% 60%)`;
    ctx.shadowBlur = cs * (0.6 + this.wallPulse * 0.6);
    ctx.strokeStyle = `hsl(${hue} 100% 66% / ${glow})`;
    ctx.lineWidth = Math.max(2, cs * 0.075);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `hsl(${hue} 100% 92% / ${glow * 0.6})`;
    ctx.lineWidth = Math.max(1, cs * 0.025);
    ctx.stroke();
    ctx.restore();
  }

  private drawFood(): void {
    if (!this.food) return;
    const ctx = this.ctx;
    const cs = this.arena.cell;
    const t = this.time;
    const p = this.cellCentre(this.food.cell);
    const age = t - this.food.at;
    const appear = easeOutBack(clamp01(age / 380));
    const r = cs * 0.25 * appear * (1 + Math.sin(t * 0.006) * 0.07);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    const glow = cs * 1.15 * appear;
    ctx.drawImage(glowSprite(HUE.food), p.x - glow, p.y - glow, glow * 2, glow * 2);
    ctx.globalAlpha = 0.9;
    for (let k = 0; k < 2; k++) {
      const a = t * 0.0032 + k * Math.PI;
      const sx = p.x + Math.cos(a) * cs * 0.42;
      const sy = p.y + Math.sin(a) * cs * 0.42;
      const sr = cs * 0.09;
      ctx.drawImage(glowSprite(HUE.food), sx - sr, sy - sr, sr * 2, sr * 2);
    }
    if (age < 600) {
      const k = age / 600;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = tintColor(HUE.food);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, cs * (0.3 + 0.9 * easeOutCubic(k)), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r);
    g.addColorStop(0, `hsl(${HUE.food} 100% 88%)`);
    g.addColorStop(0.5, `hsl(${HUE.food} 100% 66%)`);
    g.addColorStop(1, `hsl(${HUE.food} 100% 52%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0, r), 0, TAU);
    ctx.fill();
  }

  private drawGolden(game: Game, alpha: number): void {
    if (!this.golden) return;
    const ctx = this.ctx;
    const cs = this.arena.cell;
    const t = this.time;
    const p = this.cellCentre(this.golden.cell);
    const logical = game.golden;
    const msLeft =
      logical && sameCell(logical.cell, this.golden.cell)
        ? logical.msLeft - (game.status === 'playing' ? alpha * game.tickMs : 0)
        : game.config.goldenLifetimeMs;
    const fraction = clamp01(msLeft / game.config.goldenLifetimeMs);
    const appear = easeOutBack(clamp01((t - this.golden.at) / 420));
    const urgent = msLeft < 2000;
    const visibility = urgent ? 0.55 + 0.45 * Math.cos(t * (0.012 + (1 - msLeft / 2000) * 0.02)) : 1;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.55 + Math.sin(t * 0.008) * 0.12) * visibility;
    const glow = cs * 1.5 * appear;
    ctx.drawImage(glowSprite(HUE.gold), -glow, -glow, glow * 2, glow * 2);

    ctx.globalAlpha = 0.22 * visibility;
    ctx.strokeStyle = tintColor(HUE.gold, 1, 70);
    ctx.lineWidth = Math.max(1, cs * 0.03);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = t * 0.0006 + (i * TAU) / 8;
      ctx.moveTo(Math.cos(a) * cs * 0.45, Math.sin(a) * cs * 0.45);
      ctx.lineTo(Math.cos(a) * cs * 0.85 * appear, Math.sin(a) * cs * 0.85 * appear);
    }
    ctx.stroke();

    // Countdown ring: how long until it vanishes.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = visibility;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, cs * 0.06);
    ctx.strokeStyle = tintColor(HUE.gold, 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, cs * 0.48 * appear, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = tintColor(urgent ? HUE.danger : HUE.gold, 0.95, 64);
    ctx.beginPath();
    ctx.arc(0, 0, cs * 0.48 * appear, -Math.PI / 2, -Math.PI / 2 + TAU * fraction);
    ctx.stroke();

    // A slowly turning four-pointed star.
    ctx.rotate(t * 0.0015);
    const outer = cs * 0.34 * appear * (1 + Math.sin(t * 0.008) * 0.06);
    const inner = outer * 0.38;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? outer : inner;
      const a = (i * TAU) / 8;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, outer);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, `hsl(${HUE.gold} 100% 75%)`);
    g.addColorStop(1, `hsl(${HUE.gold - 10} 100% 55%)`);
    ctx.fillStyle = g;
    ctx.shadowColor = tintColor(HUE.gold);
    ctx.shadowBlur = cs * 0.5;
    ctx.fill();
    ctx.restore();
  }

  private drawSnake(game: Game, alpha: number): void {
    const ctx = this.ctx;
    const { x: ax, y: ay, cell: cs } = this.arena;
    const death = this.death;
    const cells = spine(game.previousSnake, game.snake, alpha);

    if (death) {
      // The head lunges into whatever killed it, then recoils.
      const age = this.time - death.at;
      const lunge = Math.sin(clamp01(age / DEATH_LUNGE_MS) * Math.PI) * 0.34;
      const head = game.snake[0];
      cells[0] = { x: cells[0].x + (death.cell.x - head.x) * lunge, y: cells[0].y + (death.cell.y - head.y) * lunge };
    }

    const path = roundCorners(
      cells.map((p) => ({ x: ax + p.x * cs, y: ay + p.y * cs })),
      cs * 0.5,
      5,
    );
    const lengths = measure(path);
    const fullLength = lengths[lengths.length - 1];
    const neck = game.previousSnake[0];
    const headSegment = Math.hypot(path[0].x - ax - (neck.x + 0.5) * cs, path[0].y - ay - (neck.y + 0.5) * cs);

    // Swallowed food travels down the body as a bulge until the tail passes it.
    this.bulges = this.bulges.filter(
      (b) => game.previousSnake.some((c) => sameCell(c, b.cell)) || sameCell(game.snake[0], b.cell),
    );
    const bulgeAt = this.bulges.map((b) => {
      const i = game.previousSnake.findIndex((c) => sameCell(c, b.cell));
      return { s: i < 0 ? 0 : headSegment + i * cs, grow: clamp01((this.time - b.at) / 160) };
    });

    // While dying, the snake bursts apart from the head backwards.
    const cut = death && death.exploded > 0 ? death.exploded * cs - cs * 0.5 : 0;
    if (cut >= fullLength && fullLength > 0) {
      this.headPx = null;
      return;
    }

    const bodyWidth = cs * 0.6;
    const tailWidth = cs * 0.22;
    const taper = Math.min(cs * 3.5, fullLength * 0.7);
    const taperStart = fullLength - taper;
    const widthAt = (s: number) => {
      let w = bodyWidth;
      if (s > taperStart) w = lerp(tailWidth, bodyWidth, 1 - (1 - (fullLength - s) / taper) ** 2);
      for (const b of bulgeAt) w *= 1 + 0.42 * b.grow * Math.exp(-(((s - b.s) / (cs * 0.55)) ** 2));
      return w;
    };
    const nearBulge = (s: number) => bulgeAt.some((b) => Math.abs(s - b.s) < cs * 1.4);
    const hueAt = (s: number) => this.snakeHue(s);
    const stroke = (points: Point[]) => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y);
      ctx.stroke();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Glow underneath. It stops before the thin tail so it never shows around it.
    const glowEnd = taperStart + taper * 0.3;
    if (glowEnd > cut) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = `hsl(${hueAt(cut)} 100% 60%)`;
      ctx.shadowBlur = cs * (0.8 + this.heat * 0.7);
      ctx.strokeStyle = `hsl(${hueAt(fullLength / 2)} 100% 58% / 0.32)`;
      ctx.lineWidth = bodyWidth * 0.9;
      stroke(section(path, lengths, cut, glowEnd));
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
    }

    // The body, in short pieces so width and colour can vary along it. Square ends
    // that overlap slightly join seamlessly; only the very ends are rounded.
    const overlap = cs * 0.08;
    const lightness = 60 + this.heat * 6;
    if (fullLength - cut < 0.5) {
      ctx.strokeStyle = `hsl(${hueAt(0)} 100% ${lightness}%)`;
      ctx.lineWidth = bodyWidth;
      stroke(section(path, lengths, cut, fullLength));
    }
    for (let s = cut; s < fullLength - 0.5; ) {
      const step = s >= taperStart || nearBulge(s) ? cs * 0.16 : cs * 0.34;
      const e = Math.min(fullLength, s + step);
      const mid = (s + e) / 2;
      ctx.lineCap = s === cut || e === fullLength ? 'round' : 'butt';
      ctx.strokeStyle = `hsl(${hueAt(mid)} 100% ${lightness}%)`;
      ctx.lineWidth = widthAt(mid);
      stroke(section(path, lengths, s === cut ? s : s - overlap, e));
      s = e;
    }

    // A hot white core makes it read as a neon tube.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = bodyWidth * 0.17;
    stroke(section(path, lengths, cut, fullLength - cs * 0.15));
    ctx.restore();

    if (cut > 0) {
      this.headPx = null;
      return;
    }
    this.drawHead(game, path, lengths, hueAt(0), bodyWidth);
  }

  private drawHead(game: Game, path: Point[], lengths: number[], hue: number, bodyWidth: number): void {
    const ctx = this.ctx;
    const cs = this.arena.cell;
    const t = this.time;
    const head = path[0];
    this.headPx = head;
    const behind = pointAt(path, lengths, cs * 0.5);
    const vec =
      Math.hypot(head.x - behind.x, head.y - behind.y) > 0.5
        ? { x: head.x - behind.x, y: head.y - behind.y }
        : { x: game.direction === 'left' ? -1 : game.direction === 'right' ? 1 : 0, y: game.direction === 'up' ? -1 : 1 };
    const angle = Math.atan2(vec.y, vec.x);
    const gulp = 1 + 0.3 * Math.max(0, 1 - (t - this.lastEatAt) / 220);
    const r = bodyWidth * 0.6 * gulp;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    const glow = cs * 1.1;
    ctx.drawImage(glowSprite(hue), head.x - glow, head.y - glow, glow * 2, glow * 2);
    ctx.restore();

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);

    // Tongue: a quick flick every couple of seconds while alive.
    const flick = (t % 2300) / 260;
    if (!this.death && game.status === 'playing' && flick < 1) {
      const len = r * 1.1 * Math.sin(flick * Math.PI);
      ctx.strokeStyle = tintColor(HUE.food, 1, 70);
      ctx.lineWidth = Math.max(1, cs * 0.04);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.9, 0);
      ctx.lineTo(r * 0.9 + len, 0);
      ctx.lineTo(r * 0.9 + len * 1.3, -len * 0.25);
      ctx.moveTo(r * 0.9 + len, 0);
      ctx.lineTo(r * 0.9 + len * 1.3, len * 0.25);
      ctx.stroke();
    }

    const g = ctx.createRadialGradient(r * 0.2, -r * 0.2, 0, 0, 0, r * 1.1);
    g.addColorStop(0, `hsl(${hue} 100% 86%)`);
    g.addColorStop(1, `hsl(${hue} 100% 62%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.12, r, 0, 0, TAU);
    ctx.fill();

    const blinking = t % 3700 < 130;
    for (const side of [-1, 1]) {
      const ex = r * 0.28;
      const ey = side * r * 0.48;
      const er = r * 0.24;
      ctx.fillStyle = '#0a0619';
      if (this.death) {
        ctx.strokeStyle = '#0a0619';
        ctx.lineWidth = Math.max(1.2, er * 0.55);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - er, ey - er);
        ctx.lineTo(ex + er, ey + er);
        ctx.moveTo(ex + er, ey - er);
        ctx.lineTo(ex - er, ey + er);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.ellipse(ex, ey, er, blinking ? er * 0.18 : er, 0, 0, TAU);
      ctx.fill();
      if (!blinking) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(ex + er * 0.35, ey - er * 0.3, er * 0.32, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPopups(): void {
    const ctx = this.ctx;
    const cs = this.arena.cell;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const k = (this.time - p.at) / POPUP_MS;
      const scale = k < 0.15 ? easeOutBack(k / 0.15) : 1;
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = `700 ${Math.max(1, p.size * scale)}px Oxanium, system-ui, sans-serif`;
      ctx.shadowColor = tintColor(p.tint);
      ctx.shadowBlur = p.size * 0.6;
      ctx.fillStyle = tintColor(p.tint, 1, 80);
      ctx.fillText(p.text, p.x, p.y - cs * 0.9 * easeOutCubic(k));
    }
    ctx.restore();
  }
}
