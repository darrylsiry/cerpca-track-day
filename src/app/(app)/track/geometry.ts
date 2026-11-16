import type { TrackShape } from "@/lib/types";

type Pt = [number, number];

/** The centerline as points. The stored path is "M x y L x y … Z". */
export function pathPoints(d: string): Pt[] {
  return d
    .replace(/[MZ]/gi, "")
    .split(/L/i)
    .map((pair) => pair.trim().split(/[\s,]+/).map(Number))
    .filter((p): p is Pt => p.length === 2 && p.every(Number.isFinite));
}

/** Position and direction of travel at a fraction (0–1) of the lap. */
export function pointAt(points: Pt[], frac: number): { x: number; y: number; dx: number; dy: number } {
  const n = points.length;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay);
    lengths.push(len);
    total += len;
  }
  let target = ((((frac % 1) + 1) % 1) || 0) * total;
  for (let i = 0; i < n; i++) {
    if (target <= lengths[i] || i === n - 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % n];
      const t = lengths[i] ? Math.min(1, target / lengths[i]) : 0;
      const len = lengths[i] || 1;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / len, dy: (by - ay) / len };
    }
    target -= lengths[i];
  }
  return { x: points[0][0], y: points[0][1], dx: 1, dy: 0 };
}

/** Middle of a stretch that may wrap past start/finish. */
export function midFraction(start: number, end: number) {
  const len = (((end - start) % 1) + 1) % 1;
  return (start + len / 2) % 1;
}

/**
 * Where to put a badge beside the track at a lap fraction: on whichever side
 * keeps it clear of the turn numbers and inside the drawing.
 */
export function badgeSpot(shape: TrackShape, points: Pt[], frac: number, offset = 27, half = 14): Pt {
  const p = pointAt(points, frac);
  const [vx, vy, vw, vh] = shape.viewBox;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;
  const sides: Pt[] = [
    [p.x - p.dy * offset, p.y + p.dx * offset],
    [p.x + p.dy * offset, p.y - p.dx * offset],
  ];
  const score = ([x, y]: Pt) => {
    const inside = x - half >= vx && x + half <= vx + vw && y - half >= vy && y + half <= vy + vh;
    const clearance = Math.min(...shape.turns.map((t) => Math.hypot(t.label[0] - x, t.label[1] - y)), 200);
    // Prefer the outside of the circuit when both sides are equally clear.
    const outward = Math.hypot(x - cx, y - cy) / 1000;
    return (inside ? 0 : -1000) + Math.min(clearance, 60) + outward;
  };
  return score(sides[0]) >= score(sides[1]) ? sides[0] : sides[1];
}
