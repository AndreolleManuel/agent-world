import type { SpritePoint } from './placement';
import { routeLength } from './navigation';

export const WORLD_WIDTH = 1_280;
export const WORLD_HEIGHT = 720;

export function projectWorldPoint(
  point: SpritePoint,
  width = WORLD_WIDTH,
  height = WORLD_HEIGHT,
): SpritePoint {
  return {
    x: (point.x / 100) * width,
    y: (point.y / 100) * height,
  };
}

export function interpolateRoute(route: readonly SpritePoint[], progress: number): SpritePoint {
  if (route.length === 0) return { x: 0, y: 0 };
  if (route.length === 1) return { ...route[0] };

  const clampedProgress = Math.min(1, Math.max(0, progress));
  const length = routeLength(route);
  if (length === 0) return { ...route[route.length - 1] };
  let remaining = clampedProgress * length;
  let segmentIndex = 0;
  for (; segmentIndex < route.length - 2; segmentIndex++) {
    const segment = routeLength([route[segmentIndex], route[segmentIndex + 1]]);
    if (remaining <= segment) break;
    remaining -= segment;
  }
  const segmentProgress = Math.min(1, remaining / (routeLength([route[segmentIndex], route[segmentIndex + 1]]) || 1));
  const origin = route[segmentIndex];
  const destination = route[segmentIndex + 1];

  return {
    x: origin.x + ((destination.x - origin.x) * segmentProgress),
    y: origin.y + ((destination.y - origin.y) * segmentProgress),
  };
}

export function depthFor(worldY: number, layerOffset: number): number {
  return Math.round(worldY * 100) + layerOffset;
}

export interface WalkPose {
  facing: -1 | 1;
  leftLegY: number;
  rightLegY: number;
}

export function walkPose(
  previousPoint: SpritePoint,
  point: SpritePoint,
  progress: number,
  reducedMotion = false,
): WalkPose {
  if (reducedMotion) return { facing: 1, leftLegY: 0, rightLegY: 0 };
  const stride = Math.sin(progress * Math.PI * 6) >= 0 ? 3 : -3;
  return {
    facing: point.x < previousPoint.x ? -1 : 1,
    leftLegY: stride,
    rightLegY: -stride,
  };
}

export function sortByDepth<T extends { id: string; y: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const depthDifference = depthFor(left.y, 0) - depthFor(right.y, 0);
    return depthDifference || left.id.localeCompare(right.id);
  });
}
