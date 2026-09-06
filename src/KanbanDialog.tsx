import { useEffect, useRef, type ReactNode } from 'react';

export default function KanbanDialog({ children, onClose, title = 'Kanban' }: { children: ReactNode; onClose: () => void; title?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = triggerRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="kanban-dialog" aria-labelledby="kanban-dialog-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const r = event.currentTarget.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
    }}>
    <header className="kanban-dialog-header"><div><p className="eyebrow">Supervision · lecture seule</p><h2 id="kanban-dialog-title">{title}</h2></div>
      <button type="button" onClick={onClose} aria-label={title === 'Kanban' ? 'Fermer le Kanban' : 'Fermer la supervision'} autoFocus>Fermer ×</button>
    </header>
    <div className="kanban-dialog-content">{children}</div>
  </dialog>;
}
