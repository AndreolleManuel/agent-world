import type { SpritePoint } from './placement';
import { OBSTACLES, SCENE_SEATS, seatApproach } from './scene';
export { OBSTACLES } from './scene';
// Ground envelope in world pixels. Seat approaches alone may enter their own
// furniture footprint; circulating actors retain space around their feet/body.
export const BODY_CLEARANCE_PX = 6;
const clearanceX = BODY_CLEARANCE_PX / 12.8, clearanceY = BODY_CLEARANCE_PX / 7.2;
const circulationObstacles = OBSTACLES.map((b) => ({ ...b, left: b.left - clearanceX, right: b.right + clearanceX, top: b.top - clearanceY, bottom: b.bottom + clearanceY }));

export function walkable(point: SpritePoint, ignored?: string): boolean {
  return point.x >= 8 && point.x <= 96 && point.y >= 28 && point.y <= 90
    && !circulationObstacles.some((b) => b.id !== ignored && point.x > b.left && point.x < b.right && point.y > b.top && point.y < b.bottom);
}
export function clearSegment(a: SpritePoint, b: SpritePoint, ignored?: string): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3));
  for (let i = 0; i <= steps; i++) {
    if (!walkable({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, ignored)) return false;
  }
  return true;
}
const distance = (a: SpritePoint, b: SpritePoint) => Math.hypot((a.x - b.x) * 12.8, (a.y - b.y) * 7.2);
const equal = (a: SpritePoint, b: SpritePoint) => distance(a, b) < 0.1;
function apronSeat(a: SpritePoint, b: SpritePoint) {
  return SCENE_SEATS.find((seat) => {
    const to = seatApproach(seat);
    return Math.abs(a.x - seat.point.x) < .01 && Math.abs(b.x - seat.point.x) < .01
      && a.y >= seat.point.y - .01 && b.y >= seat.point.y - .01 && a.y <= to.y + .01 && b.y <= to.y + .01;
  });
}
function approach(point: SpritePoint): SpritePoint {
  const seat = SCENE_SEATS.find((seat) => equal(seat.point, point)) ?? SCENE_SEATS.find((s) => apronSeat(s.point, point) === s);
  return seat ? seatApproach(seat) : point;
}
export function safeRouteSegment(a: SpritePoint, b: SpritePoint): boolean {
  return clearSegment(a, b) || !!apronSeat(a, b) && clearSegment(a, b, apronSeat(a, b)!.objectId);
}

// The static visibility graph is shared by every route; no per-agent grid search.
const corners: SpritePoint[] = circulationObstacles.flatMap((b) => [
  { x: b.left - .6, y: b.top - .6 }, { x: b.right + .6, y: b.top - .6 },
  { x: b.left - .6, y: b.bottom + .6 }, { x: b.right + .6, y: b.bottom + .6 },
]).filter((point) => walkable(point));
const edges = corners.map((a, i) => corners.flatMap((b, j) => j !== i && clearSegment(a, b) ? [j] : []));
const cache = new Map<string, SpritePoint[]>();
export function navigate(origin: SpritePoint, destination: SpritePoint, occupied: readonly SpritePoint[] = []): SpritePoint[] {
  if (equal(origin, destination)) return [destination];
  const bodies = occupied.map((p) => ({ left: p.x - 18 / 12.8, right: p.x + 18 / 12.8, top: p.y - 14 / 7.2, bottom: p.y + 14 / 7.2 }));
  const bodyClear = (a: SpritePoint, b: SpritePoint) => {
    const steps = Math.max(1, Math.ceil(distance(a, b) / 2));
    for (let i = 0; i <= steps; i++) {
      const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
      if (bodies.some((o) => p.x > o.left && p.x < o.right && p.y > o.top && p.y < o.bottom)) return false;
    }
    return true;
  };
  const clear = (a: SpritePoint, b: SpritePoint) => clearSegment(a, b) && bodyClear(a, b);
  const key = JSON.stringify([origin, destination]);
  const cached = occupied.length ? undefined : cache.get(key); if (cached) return cached.map((p) => ({ ...p }));
  const from = approach(origin), to = approach(destination);
  // Fail closed for invalid anchors, including the seat-entry segments.
  if (!safeRouteSegment(origin, from) || !safeRouteSegment(to, destination) || !bodyClear(origin, from) || !bodyClear(to, destination)) return [origin];
  const dynamicCorners = bodies.flatMap((b) => [
    { x: b.left - .1, y: b.top - .1 }, { x: b.right + .1, y: b.top - .1 },
    { x: b.left - .1, y: b.bottom + .1 }, { x: b.right + .1, y: b.bottom + .1 },
  ]).filter((p) => walkable(p) && bodyClear(p, p));
  const routeCorners = [...corners, ...dynamicCorners];
  const routeEdges = occupied.length ? routeCorners.map((a, i) => routeCorners.flatMap((b, j) => j !== i && clear(a, b) ? [j] : [])) : edges;
  const nodes = [...routeCorners, from, to], start = routeCorners.length, target = start + 1;
  const costs = new Map<number, number>([[start, 0]]), previous = new Map<number, number>();
  const open = new Set([start]), closed = new Set<number>();
  while (open.size) {
    let current = start, best = Infinity;
    for (const i of open) { const score = costs.get(i)! + distance(nodes[i], to); if (score < best) { best = score; current = i; } }
    if (current === target) {
      const path = [to]; let cursor = target;
      while (previous.has(cursor)) { cursor = previous.get(cursor)!; path.unshift(nodes[cursor]); }
      const result = compact([origin, ...path, destination]);
      if (!occupied.length) {
        if (cache.size >= 512) cache.clear();
        cache.set(key, result);
      }
      return result.map((p) => ({ ...p }));
    }
    open.delete(current); closed.add(current);
    const neighbors = current === start ? nodes.map((_, i) => i) : [...routeEdges[current], target];
    for (const i of neighbors) {
      if (i === current || closed.has(i) || !clear(nodes[current], nodes[i])) continue;
      const cost = costs.get(current)! + distance(nodes[current], nodes[i]);
      if (cost < (costs.get(i) ?? Infinity)) { costs.set(i, cost); previous.set(i, current); open.add(i); }
    }
  }
  return [origin];
}
function compact(points: SpritePoint[]): SpritePoint[] { return points.filter((point, i) => !i || !equal(point, points[i - 1])); }

export function routeLength(route: readonly SpritePoint[]): number {
  return route.slice(1).reduce((total, p, i) => total + distance(route[i], p), 0);
}
export function movementDuration(route: readonly SpritePoint[]): number { return Math.max(350, routeLength(route) / 160 * 1000); }
