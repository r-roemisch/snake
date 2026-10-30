/** A hue in degrees, or white. Every glowing thing in the game is tinted by one. */
export type Tint = number | 'white';

export const HUE = {
  food: 338,
  gold: 45,
  cyan: 186,
  violet: 266,
  wall: 252,
  danger: 352,
} as const;

export function tintColor(tint: Tint, alpha = 1, lightness = 62): string {
  return tint === 'white' ? `hsl(0 0% 100% / ${alpha})` : `hsl(${tint} 100% ${lightness}% / ${alpha})`;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A soft glowing dot, white-hot in the middle, cached per tint. */
export function glowSprite(tint: Tint): HTMLCanvasElement {
  const key = tint === 'white' ? 'white' : String(Math.round(tint / 4) * 4);
  let sprite = sprites.get(key);
  if (!sprite) {
    const hue: Tint = tint === 'white' ? 'white' : Number(key);
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const ctx = sprite.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'hsl(0 0% 100% / 1)');
    g.addColorStop(0.16, tintColor(hue, 1, 75));
    g.addColorStop(0.42, tintColor(hue, 0.32));
    g.addColorStop(1, tintColor(hue, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    sprites.set(key, sprite);
  }
  return sprite;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  tint: Tint;
  drag: number;
  gravity: number;
}

export interface BurstOptions {
  count: number;
  tint: Tint | Tint[];
  /** Pixels per second. */
  speed: [number, number];
  /** Radius of the glow in pixels. */
  size: [number, number];
  ttl: [number, number];
  /** Fraction of velocity lost per second. */
  drag?: number;
  /** Pixels per second squared, downwards. */
  gravity?: number;
  /** Direction and spread in radians; omitted means all around. */
  angle?: number;
  spread?: number;
}

const between = ([min, max]: [number, number]) => min + Math.random() * (max - min);

export class Particles {
  private list: Particle[] = [];

  burst(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const angle = o.angle === undefined ? Math.random() * Math.PI * 2 : o.angle + (Math.random() - 0.5) * (o.spread ?? 0);
      const speed = between(o.speed);
      const tint = Array.isArray(o.tint) ? o.tint[Math.floor(Math.random() * o.tint.length)] : o.tint;
      this.list.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        ttl: between(o.ttl),
        size: between(o.size),
        tint,
        drag: o.drag ?? 2.5,
        gravity: o.gravity ?? 0,
      });
    }
    if (this.list.length > 1500) this.list.splice(0, this.list.length - 1500);
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.list) {
      p.age += dtMs;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.age < p.ttl);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const k = 1 - p.age / p.ttl;
      const r = p.size * (0.35 + 0.65 * k);
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.drawImage(glowSprite(p.tint), p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  clear(): void {
    this.list = [];
  }
}
