import type { Cell } from '../game/game';

export interface Point {
  x: number;
  y: number;
}

const EPSILON = 1e-6;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function centre(cell: Cell): Point {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

function length(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || length(points[i - 1], p) > EPSILON);
}

/**
 * The snake's centre line, head first, in cell units, `t` of the way through a tick.
 * Only the ends move between ticks: the head glides into its new cell while the
 * tail glides out of the old one, so the body never wobbles.
 */
export function spine(previous: readonly Cell[], current: readonly Cell[], t: number): Point[] {
  if (previous === current || previous.length === 0) return dedupe(current.map(centre));
  const head = lerpPoint(centre(previous[0]), centre(current[0]), t);
  const body = previous.map(centre);
  const grows = current.length > previous.length;
  if (!grows) {
    if (body.length === 1) return [head];
    const n = body.length;
    body[n - 1] = lerpPoint(body[n - 1], body[n - 2], t);
  }
  return dedupe([head, ...body]);
}

/**
 * Replace each corner of a polyline with a smooth curve of up to `maxRadius`.
 * Interior segments are shared by two corners, so each corner may use half of them.
 */
export function roundCorners(points: Point[], maxRadius: number, steps = 6): Point[] {
  if (points.length < 3) return points.slice();
  const out: Point[] = [points[0]];
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const a = points[i - 1];
    const p = points[i];
    const b = points[i + 1];
    const la = length(p, a);
    const lb = length(p, b);
    const ua = { x: (a.x - p.x) / la, y: (a.y - p.y) / la };
    const ub = { x: (b.x - p.x) / lb, y: (b.y - p.y) / lb };
    if (Math.abs(ua.x * ub.y - ua.y * ub.x) < EPSILON) {
      out.push(p);
      continue;
    }
    const r = Math.min(maxRadius, i === 1 ? la : la / 2, i + 1 === last ? lb : lb / 2);
    const q1 = { x: p.x + ua.x * r, y: p.y + ua.y * r };
    const q2 = { x: p.x + ub.x * r, y: p.y + ub.y * r };
    for (let s = 0; s <= steps; s++) {
      const k = s / steps;
      const m = 1 - k;
      out.push({
        x: m * m * q1.x + 2 * m * k * p.x + k * k * q2.x,
        y: m * m * q1.y + 2 * m * k * p.y + k * k * q2.y,
      });
    }
  }
  out.push(points[last]);
  return dedupe(out);
}

/** Cumulative distance along a polyline: `result[i]` is the length from the start to `points[i]`. */
export function measure(points: Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + length(points[i - 1], points[i]));
  return out;
}

/** Index of the first point further along than `s`. */
function firstAfter(lengths: number[], s: number): number {
  let lo = 0;
  let hi = lengths.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] > s) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The point `s` along a measured polyline, clamped to its ends. */
export function pointAt(points: Point[], lengths: number[], s: number): Point {
  if (s <= 0) return points[0];
  const total = lengths[lengths.length - 1];
  if (s >= total) return points[points.length - 1];
  const i = firstAfter(lengths, s);
  const span = lengths[i] - lengths[i - 1];
  return lerpPoint(points[i - 1], points[i], span > 0 ? (s - lengths[i - 1]) / span : 0);
}

/** The part of a measured polyline between distances `from` and `to`. */
export function section(points: Point[], lengths: number[], from: number, to: number): Point[] {
  const total = lengths[lengths.length - 1];
  const a = Math.max(0, from);
  const b = Math.min(total, to);
  if (b <= a) return [pointAt(points, lengths, a)];
  const out = [pointAt(points, lengths, a)];
  for (let i = firstAfter(lengths, a); i < points.length && lengths[i] < b; i++) out.push(points[i]);
  out.push(pointAt(points, lengths, b));
  return out;
}
