import { AVATAR_SHEETS } from './preferences';

// The authored sheets are 1536 × 1024, with six poses per row. Rows
// slightly overrun the nominal 256px cells: crop the actual front silhouettes
// so a previous character's feet cannot leak into the next preview.
const FRONT_FRAMES = [
  { top: 16, height: 252 },
  { top: 274, height: 250 },
  { top: 528, height: 244 },
  { top: 774, height: 250 },
] as const;

export const AVATAR_LABELS = [
  'Veste turquoise, cheveux bouclés', 'Veste jaune, cheveux roux',
  'Veste bleue, lunettes', 'Veste verte, barbe',
  'Veste rouge, cheveux attachés', 'Veste mauve, cheveux gris',
  'Veste brique, cheveux bouclés', 'Costume bleu, cheveux blonds',
  'Veste orange, cheveux longs', 'Veste ocre, barbe grise',
  'Gilet gris, chemise turquoise', 'Veste rouge, cheveux ondulés',
] as const;

export function AvatarPreview({ avatar }: { avatar: number }) {
  const index = Number.isInteger(avatar) && avatar >= 1 && avatar <= 12 ? avatar - 1 : 0;
  const frame = FRONT_FRAMES[index % 4];
  return <svg className="avatar-preview" aria-hidden="true" focusable="false"
    viewBox={`72 ${frame.top} 160 ${frame.height}`}>
    <image href={AVATAR_SHEETS[Math.floor(index / 4)]} width="1536" height="1024" />
  </svg>;
}
