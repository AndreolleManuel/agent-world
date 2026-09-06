// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import KanbanDialog from './KanbanDialog';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Ouvrir</button>
    {open && <KanbanDialog onClose={() => setOpen(false)}><p>Une carte</p></KanbanDialog>}</>;
}
describe('closable Kanban overlay', () => {
  it('opens modally, locks page scrolling and restores focus without scrolling on close', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });
    trigger.focus();
    const focus = vi.spyOn(trigger, 'focus');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Kanban' })).toHaveAttribute('open');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le Kanban' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });
  it('closes on the native Escape/cancel event and supports reopening', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByText('Une carte')).toBeInTheDocument();
  });
  it('restores the previous scroll policy when unmounted', () => {
    document.body.style.overflow = 'auto';
    const result = render(<KanbanDialog onClose={() => {}}>Carte</KanbanDialog>);
    result.unmount();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });
});
