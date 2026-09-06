import { Application, Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import { buildDynamicEnvironment } from './environment';
import { EDITABLE_DESKS, type LayoutDraft } from './layoutDraft';
import { initializePixiAssets } from './pixiRuntime';

// Reuse the real furniture builder, textures, scale and chair positions.
// Only this isolated preview's display objects are translated.
export async function createLayoutPreview(host: HTMLElement) {
  const app = new Application();
  try {
    await app.init({ width: 1280, height: 720, autoStart: false, resolution: 1,
      antialias: false, backgroundColor: 0x15101e, preference: ['canvas', 'webgl'] });
    await initializePixiAssets();
    const [background, workstationKit, loungeStool, loungePouf] = await Promise.all([
      Assets.load<Texture>(new URL('../assets/am-labs-restored-static-v1.png', import.meta.url).href),
      Assets.load<Texture>(new URL('../assets/am-labs-workstation-kit-16bit-v1.png', import.meta.url).href),
      Assets.load<Texture>(new URL('../assets/am-labs-lounge-stool-16bit-v1.png', import.meta.url).href),
      Assets.load<Texture>(new URL('../assets/am-labs-lounge-pouf-16bit-v1.png', import.meta.url).href),
    ]);
    app.stage.sortableChildren = true;
    const backdrop = new Sprite(background);
    backdrop.width = 1280; backdrop.height = 720;
    app.stage.addChild(backdrop);
    const repair = new Sprite(new Texture({ source: background.source, frame: new Rectangle(596, 433, 24, 63) }));
    repair.position.set(480, 331); repair.width = 24 * 1280 / 1672; repair.height = 63 * 720 / 941; repair.zIndex = 1;
    app.stage.addChild(repair);
    buildDynamicEnvironment(app.stage, { workstationKit, loungeStool, loungePouf });
    const groups = EDITABLE_DESKS.map((desk) => ({ id: desk.id,
      nodes: app.stage.children.filter((node) => desk.matches(node.label)).map((node) => ({ node, x: node.x, y: node.y, z: node.zIndex })),
    }));
    app.canvas.setAttribute('aria-label', 'Décor actuel et bureaux déplaçables');
    host.appendChild(app.canvas);
    return {
      update(draft: LayoutDraft) {
        for (const { id, nodes } of groups) for (const { node, x, y, z } of nodes) {
          node.position.set(x + draft[id].x, y + draft[id].y);
          node.zIndex = z + Math.round(draft[id].y / 720 * 10000);
        }
        app.render();
      },
      destroy() { app.destroy({ removeView: true }, { children: true }); },
    };
  } catch (error) {
    try { app.destroy({ removeView: true }, { children: true }); } catch { /* incomplete init */ }
    throw error;
  }
}
