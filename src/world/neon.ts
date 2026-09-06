import { Container, Graphics } from 'pixi.js';

// Single-line tubes, not filled font glyphs. Coordinates stay local to the sign.
const GLYPHS: Record<string, number[][]> = {
  A: [[0, 10, 3, 0, 6, 10], [1.1, 6.5, 4.9, 6.5]],
  M: [[0, 10, 0, 0, 3, 5, 6, 0, 6, 10]],
  L: [[0, 0, 0, 10, 6, 10]],
  a: [[5, 5, 4, 4, 1, 4, 0, 5, 0, 9, 1, 10, 4, 10, 5, 9], [5, 4, 5, 10]],
  b: [[0, 0, 0, 10], [0, 5, 1, 4, 4, 4, 5, 5, 5, 9, 4, 10, 1, 10, 0, 9]],
  s: [[5, 4, 1, 4, 0, 5, 0, 6, 1, 7, 4, 7, 5, 8, 5, 9, 4, 10, 0, 10]],
  '.': [[1, 9.6, 1, 10]],
  d: [[5, 0, 5, 10], [5, 5, 4, 4, 1, 4, 0, 5, 0, 9, 1, 10, 4, 10, 5, 9]],
  e: [[0, 7, 5, 7, 5, 5, 4, 4, 1, 4, 0, 5, 0, 9, 1, 10, 5, 10]],
  v: [[0, 4, 2.5, 10, 5, 4]],
};
export const NEON_TEXT = 'AMLabs.dev';
export function buildNeonSign(): Container {
  const sign = new Container();
  sign.label = 'amlabs-dev-neon'; sign.zIndex = 1120;
  sign.position.set(965, 54);
  const scale = 1.8;
  const width = [...NEON_TEXT].reduce((sum, letter) => sum + (letter === '.' ? 4 : 8), 0) * scale - 3 * scale;
  for (const [name, lineWidth, alpha, color] of [
    ['wall-glow', 7, 0.07, 0xa846ff], ['tube-glow', 3.2, 0.22, 0xc278ff], ['tube-core', 1, 0.95, 0xe8c7ff],
  ] as const) {
    const tubes = new Graphics(); tubes.label = `neon-${name}`;
    let cursor = -width / 2;
    for (const letter of NEON_TEXT) {
      for (const line of GLYPHS[letter]) {
        tubes.moveTo(cursor + line[0] * scale, (line[1] - 5) * scale);
        for (let i = 2; i < line.length; i += 2) tubes.lineTo(cursor + line[i] * scale, (line[i + 1] - 5) * scale);
      }
      cursor += (letter === '.' ? 4 : 8) * scale;
    }
    tubes.stroke({ width: lineWidth, color, alpha, cap: 'round', join: 'round' });
    sign.addChild(tubes);
  }
  return sign;
}
