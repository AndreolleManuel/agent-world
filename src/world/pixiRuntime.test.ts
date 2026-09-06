// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { AbstractRenderer, Assets } from 'pixi.js';
import { initializePixiAssets } from './pixiRuntime';

it('installs the official static adapter, with no eval capability probe', () => {
  const probe = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw Error('CSP blocks dynamic code'); });
  try {
    const check = Reflect.get(AbstractRenderer.prototype, '_unsafeEvalCheck') as () => void;
    expect(() => check()).not.toThrow();
    expect(probe).not.toHaveBeenCalled();
  } finally { probe.mockRestore(); }
});

it('initializes local PNG loading once, without workers, fetch bitmaps or data URI probes', async () => {
  const init = vi.spyOn(Assets, 'init').mockResolvedValue();
  try {
    await Promise.all([initializePixiAssets(), initializePixiAssets()]);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith({ skipDetections: true, texturePreference: { format: ['png'] }, preferences: { preferWorkers: false, preferCreateImageBitmap: false } });
  } finally { init.mockRestore(); }
});
