// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LayoutEditor from './LayoutEditor';
import { LAYOUT_DRAFT_KEY } from './world/layoutDraft';
import { SHARED_LAB_DESK, WORKSTATION_SLOTS } from './world/furniture';

vi.mock('./world/layoutPreview', () => ({ createLayoutPreview: vi.fn(async () => ({ update: vi.fn(), destroy: vi.fn() })) }));

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value) });
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const coordinates = () => JSON.parse((screen.getByLabelText('Coordonnées du placement') as HTMLTextAreaElement).value);

describe('layout editor controls', () => {
  it('drags in world coordinates at a scaled viewport, persists and undoes the entire group', async () => {
    render(<LayoutEditor />);
    const handle = await screen.findByRole('button', { name: 'Déplacer Bureau triple' });
    vi.spyOn(handle.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect);
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 150 });
    fireEvent.pointerMove(handle, { clientX: 215, clientY: 170 });
    fireEvent.pointerUp(handle);
    expect(coordinates().sharedDesk.pixelY).toBe(SHARED_LAB_DESK.pixelY + 40);
    expect(coordinates().sharedDesk.left).toBe(SHARED_LAB_DESK.left + 30);
    expect(coordinates().labWorkstations[0].pixelY).toBe(SHARED_LAB_DESK.pixelY + 40);
    expect(JSON.parse(localStorage.getItem(LAYOUT_DRAFT_KEY)!)['laboratory-desk-shared']).toEqual({ x: 30, y: 40 });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler le déplacement' }));
    expect(coordinates().sharedDesk.pixelY).toBe(SHARED_LAB_DESK.pixelY);
    expect(coordinates().sharedDesk.left).toBe(SHARED_LAB_DESK.left);
  });

  it('supports precise keyboard placement and restores the saved proposal on reopening', async () => {
    const first = render(<LayoutEditor />);
    const handle = await screen.findByRole('button', { name: 'Déplacer Bureau 1' });
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(coordinates().workstations[0]).toMatchObject({ pixelX: WORKSTATION_SLOTS[0].pixelX + 10, pixelY: WORKSTATION_SLOTS[0].pixelY + 1 });
    first.unmount();
    render(<LayoutEditor />);
    await screen.findByRole('button', { name: 'Déplacer Bureau 1' });
    expect(coordinates().workstations[0]).toMatchObject({ pixelX: WORKSTATION_SLOTS[0].pixelX + 10, pixelY: WORKSTATION_SLOTS[0].pixelY + 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Placement initial' }));
    expect(coordinates().workstations[0]).toMatchObject({ pixelX: WORKSTATION_SLOTS[0].pixelX, pixelY: WORKSTATION_SLOTS[0].pixelY });
  });
});
