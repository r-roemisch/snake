import { describe, expect, it } from 'vitest';
import { measure, pointAt, roundCorners, section, spine } from './geometry';

const c = (x: number, y: number) => ({ x, y });

describe('spine', () => {
  const previous = [c(2, 0), c(1, 0), c(0, 0)];
  const current = [c(3, 0), c(2, 0), c(1, 0)];

  it('matches the previous cells at the start of a tick and the current cells at the end', () => {
    expect(spine(previous, current, 0)).toEqual([
      { x: 2.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(spine(previous, current, 1)).toEqual([
      { x: 3.5, y: 0.5 },
      { x: 2.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
    ]);
  });

  it('moves only the head and tail mid-tick', () => {
    expect(spine(previous, current, 0.5)).toEqual([
      { x: 3, y: 0.5 },
      { x: 2.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
  });

  it('keeps the tail still while the snake grows', () => {
    const grown = [c(3, 0), c(2, 0), c(1, 0), c(0, 0)];
    expect(spine(previous, grown, 0.5).at(-1)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('collapses a coiled snake to the cells it actually covers', () => {
    const coiled = [c(5, 5), c(5, 5), c(5, 5)];
    expect(spine(coiled, coiled, 0)).toEqual([{ x: 5.5, y: 5.5 }]);
    expect(spine(coiled, [c(6, 5), c(5, 5), c(5, 5)], 0.5)).toEqual([
      { x: 6, y: 5.5 },
      { x: 5.5, y: 5.5 },
    ]);
  });
});

describe('roundCorners', () => {
  const corner = [c(0, 0), c(2, 0), c(2, 2)];

  it('keeps both ends and cuts the corner', () => {
    const rounded = roundCorners(corner, 0.5);
    expect(rounded[0]).toEqual(c(0, 0));
    expect(rounded.at(-1)).toEqual(c(2, 2));
    expect(rounded).not.toContainEqual(c(2, 0));
  });

  it('leaves straight lines alone', () => {
    expect(roundCorners([c(0, 0), c(1, 0), c(2, 0)], 0.5)).toEqual([c(0, 0), c(1, 0), c(2, 0)]);
  });

  it('never rounds past a short end segment', () => {
    const rounded = roundCorners([c(0, 0.1), c(0, 0), c(1, 0)], 0.5);
    expect(rounded[0]).toEqual(c(0, 0.1));
    expect(rounded.every((p) => p.x >= 0 && p.y >= 0 && p.y <= 0.1 + 1e-9)).toBe(true);
  });
});

describe('measure and pointAt', () => {
  const line = [c(0, 0), c(3, 0), c(3, 4)];
  const lengths = measure(line);

  it('accumulates segment lengths', () => {
    expect(lengths).toEqual([0, 3, 7]);
  });

  it('finds points along the line and clamps to the ends', () => {
    expect(pointAt(line, lengths, 1.5)).toEqual({ x: 1.5, y: 0 });
    expect(pointAt(line, lengths, 3)).toEqual(c(3, 0));
    expect(pointAt(line, lengths, 5)).toEqual({ x: 3, y: 2 });
    expect(pointAt(line, lengths, -1)).toEqual(c(0, 0));
    expect(pointAt(line, lengths, 99)).toEqual(c(3, 4));
  });

  it('cuts out a section, keeping the corners inside it', () => {
    expect(section(line, lengths, 1, 5)).toEqual([c(1, 0), c(3, 0), c(3, 2)]);
    expect(section(line, lengths, 0.5, 2)).toEqual([c(0.5, 0), c(2, 0)]);
    expect(section(line, lengths, 6, 99)).toEqual([c(3, 3), c(3, 4)]);
  });
});
