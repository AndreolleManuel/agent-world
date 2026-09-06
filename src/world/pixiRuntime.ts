// Despite its name, this official adapter REMOVES Pixi's need for unsafe-eval.
// Keep the native CSP strict; use static shader/renderer sync implementations.
import 'pixi.js/unsafe-eval';
import { Assets } from 'pixi.js';

let initialization: Promise<void> | undefined;

export function initializePixiAssets(): Promise<void> {
  // Bundle-local images work through img-src in WKWebView. Pixi's defaults use
  // blob workers and fetch/ImageBitmap, which are not allowed by our native CSP.
  initialization ??= Assets.init({ skipDetections: true, texturePreference: { format: ['png'] }, preferences: {
    preferWorkers: false,
    preferCreateImageBitmap: false,
  } });
  return initialization;
}
