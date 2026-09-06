import { routeLength } from './navigation';
import { describe, expect, it } from 'vitest';

import {
  depthFor,
  interpolateRoute,
  projectWorldPoint,
  sortByDepth,
  walkPose,
} from './projection';

describe('Pixi world projection', () => {
  it('projects stable percentage coordinates into the fixed 1280 × 720 stage', () => {
    expect(projectWorldPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(projectWorldPoint({ x: 50, y: 50 })).toEqual({ x: 640, y: 360 });
    expect(projectWorldPoint({ x: 100, y: 100 })).toEqual({ x: 1280, y: 720 });
  });

  it('interpolates every doorway segment and clamps progress', () => {
    const route = [
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 60, y: 20 },
      { x: 90, y: 80 },
    ];

    expect(interpolateRoute(route, -1)).toEqual(route[0]);
    const middle = interpolateRoute(route, .5);
    expect(routeLength([route[0], middle])).toBeCloseTo(routeLength(route) / 2);
    expect(middle.y).toBe(20);
    expect(interpolateRoute(route, 1)).toEqual(route[3]);
    expect(interpolateRoute(route, 2)).toEqual(route[3]);
  });

  it('sorts agents by floor depth with identity as a deterministic tie-breaker', () => {
    const agents = [
      { id: 'zulu', y: 20 },
      { id: 'bravo', y: 70 },
      { id: 'alpha', y: 70 },
    ];

    expect(sortByDepth(agents).map(({ id }) => id)).toEqual(['zulu', 'alpha', 'bravo']);
    expect(depthFor(70, 0)).toBeGreaterThan(depthFor(20, 0));
  });

  it('alternates two walking poses, faces the route, and disables animation for reduced motion', () => {
    expect(walkPose({ x: 5, y: 0 }, { x: 4, y: 0 }, 0.1)).toEqual({
      facing: -1,
      leftLegY: 3,
      rightLegY: -3,
    });
    expect(walkPose({ x: 4, y: 0 }, { x: 5, y: 0 }, 0.2)).toEqual({
      facing: 1,
      leftLegY: -3,
      rightLegY: 3,
    });
    expect(walkPose({ x: 5, y: 0 }, { x: 4, y: 0 }, 0.1, true)).toEqual({
      facing: 1,
      leftLegY: 0,
      rightLegY: 0,
    });
  });
});
