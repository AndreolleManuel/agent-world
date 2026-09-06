import { useEffect, useRef, useState } from 'react';
import { EDITABLE_DESKS, emptyLayout, exportLayout, LAYOUT_DRAFT_KEY, moveDesk, readLayout, type LayoutDraft } from './world/layoutDraft';
import { createLayoutPreview } from './world/layoutPreview';
import './styles.css';
import './layoutEditor.css';

export default function LayoutEditor() {
  // Remount even during Vite hot updates when the accepted base changes.
  return <LayoutEditorDraft key={LAYOUT_DRAFT_KEY} />;
}

function LayoutEditorDraft() {
  const [draft, setDraft] = useState(() => {
    try { return readLayout(localStorage.getItem(LAYOUT_DRAFT_KEY)); } catch { return emptyLayout(); }
  });
  const [history, setHistory] = useState<LayoutDraft[]>([]);
  const [selected, setSelected] = useState('laboratory-desk-shared');
  const [guides, setGuides] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('Chargement du décor…');
  const host = useRef<HTMLDivElement>(null);
  const preview = useRef<Awaited<ReturnType<typeof createLayoutPreview>> | null>(null);
  const current = useRef(draft);
  current.current = draft;
  const drag = useRef<{ id: string; pointer: number; x: number; y: number; scale: number; start: LayoutDraft } | null>(null);

  useEffect(() => {
    let disposed = false;
    let instance: typeof preview.current = null;
    void createLayoutPreview(host.current!).then((result) => {
      if (disposed) { result.destroy(); return; }
      instance = result; preview.current = result;
      result.update(current.current); setReady(true); setMessage('Brouillon local · aucun changement dans l’application');
    }).catch(() => { if (!disposed) setMessage('Le décor n’a pas pu charger. Recharge cette page.'); });
    return () => { disposed = true; instance?.destroy(); preview.current = null; };
  }, []);

  useEffect(() => {
    preview.current?.update(draft);
    try { localStorage.setItem(LAYOUT_DRAFT_KEY, JSON.stringify(draft)); }
    catch { setMessage('Stockage indisponible : exporte les coordonnées avant de fermer.'); }
  }, [draft]);

  function remember() { setHistory((items) => [...items.slice(-49), current.current]); }
  function undo() {
    const last = history.at(-1);
    if (last) { setDraft(last); setHistory(history.slice(0, -1)); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportLayout(draft), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'placement-bureaux.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main className="layout-editor">
    <header><div><p className="eyebrow">AM Labs · atelier de placement</p><h1>À toi de placer les bureaux</h1>
      <p>Glisse un bureau : ses écrans et ses chaises suivent. Flèches : 1 px · Maj + flèches : 10 px.</p></div>
      <a href="/">Retour à l’application</a></header>
    <div className="layout-tools">
      <button disabled={!history.length} onClick={undo}>Annuler le déplacement</button>
      <button onClick={() => { remember(); setDraft(emptyLayout()); }}>Placement initial</button>
      <label><input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} /> Repères</label>
      <button className="primary-action" onClick={download}>Exporter les coordonnées</button>
      <span role="status">{message}</span>
    </div>
    <div className={`layout-stage ${guides ? 'with-guides' : ''}`}>
      <div className="layout-canvas" ref={host} />
      {ready && EDITABLE_DESKS.map((desk) => <button key={desk.id} type="button"
        className={`layout-handle ${selected === desk.id ? 'is-selected' : ''}`}
        aria-label={`Déplacer ${desk.name}`} aria-pressed={selected === desk.id}
        style={{ left: `${(desk.x + draft[desk.id].x) / 12.8}%`, top: `${(desk.y + draft[desk.id].y) / 7.2}%`,
          width: `${desk.width / 12.8}%`, height: `${desk.height / 7.2}%`, zIndex: Math.round(desk.y + draft[desk.id].y) + 1000 }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
          setSelected(desk.id); remember();
          drag.current = { id: desk.id, pointer: event.pointerId, x: event.clientX, y: event.clientY,
            scale: event.currentTarget.parentElement!.getBoundingClientRect().width / 1280, start: current.current };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId) return;
          setDraft(moveDesk(active.start, active.id, active.start[active.id].x + (event.clientX - active.x) / active.scale,
            active.start[active.id].y + (event.clientY - active.y) / active.scale));
        }}
        onPointerUp={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onPointerCancel={() => { if (drag.current) setDraft(drag.current.start); drag.current = null; }}
        onKeyDown={(event) => {
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!delta) return;
          event.preventDefault(); setSelected(desk.id); remember(); const step = event.shiftKey ? 10 : 1;
          setDraft(moveDesk(draft, desk.id, draft[desk.id].x + delta[0] * step, draft[desk.id].y + delta[1] * step));
        }}><span>{desk.name}</span></button>)}
    </div>
    <footer><p>4 bureaux + 1 petit + 1 triple = 8 places · 2 places fixes à la paillasse = 10 agents.
      <br />Placement libre, sans contrôle des collisions : on vérifiera les passages et les assises après ton choix. La salle de pause reste intacte.</p>
      <p>Ton brouillon reste enregistré dans ce navigateur. Masque les repères pour ta capture, puis envoie aussi le fichier de coordonnées.</p></footer>
    <details><summary>Voir les coordonnées exactes</summary><textarea aria-label="Coordonnées du placement" readOnly value={JSON.stringify(exportLayout(draft), null, 2)} /></details>
  </main>;
}
