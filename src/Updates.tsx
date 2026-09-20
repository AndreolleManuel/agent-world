import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export type UpdateStatus = {
  phase: 'idle' | 'unconfigured' | 'checking' | 'available' | 'current' | 'downloading' | 'installing' | 'restarting' | 'error';
  currentVersion: string; version: string | null; notes: string | null;
  downloaded: number; total: number | null; error: string | null;
};
export interface UpdateBackend { status(): Promise<UpdateStatus>; check(): Promise<UpdateStatus>; install(): Promise<UpdateStatus> }
const native: UpdateBackend = {
  status: () => invoke('app_update_status'), check: () => invoke('check_app_update'), install: () => invoke('install_app_update'),
};
const initial: UpdateStatus = { phase: 'idle', currentVersion: '', version: null, notes: null, downloaded: 0, total: null, error: null };
const preference = 'agent-world.check-updates';
const automaticInterval = 24 * 60 * 60 * 1000;
const busy = (status: UpdateStatus) => ['checking', 'downloading', 'installing', 'restarting'].includes(status.phase);
type Context = { status: UpdateStatus; automatic: boolean; setAutomatic(value: boolean): void; check(): void; install(): void; pending: boolean; demo: boolean };
const UpdatesContext = createContext<Context | null>(null);

export function UpdateProvider({ children, backend, demo = false }: { children: ReactNode; backend?: UpdateBackend; demo?: boolean }) {
  const available = backend ?? (isTauri() ? native : null);
  const [status, setStatus] = useState(initial);
  const [pending, setPending] = useState(false);
  const [automatic, setAutomaticState] = useState(() => { try { return localStorage.getItem(preference) !== 'false'; } catch { return false; } });
  const [ready, setReady] = useState(false);
  const [checkSequence, setCheckSequence] = useState(0);
  const lastCheck = useRef<number | null>(null);
  const operation = useRef(false);
  const perform = async (action: 'check' | 'install') => {
    if (!available || operation.current) return;
    if (action === 'check') { lastCheck.current = Date.now(); setCheckSequence(value => value + 1); }
    operation.current = true; setPending(true);
    try { setStatus(await available[action]()); }
    catch { setStatus(s => ({ ...s, phase: 'error', error: 'update_unavailable' })); }
    finally { operation.current = false; setPending(false); }
  };
  useEffect(() => {
    if (!available) return;
    let active = true;
    void available.status().then(s => {
      if (!active) return;
      setStatus(s);
      setReady(true);
    }).catch(() => { if (active) setStatus(s => ({ ...s, phase: 'error', error: 'update_unavailable' })); });
    return () => { active = false; };
  }, [available]);
  useEffect(() => {
    if (!available || !ready || !automatic || pending || busy(status) || status.phase === 'unconfigured') return;
    const remainingDelay = () => lastCheck.current === null ? 0 : Math.max(0, lastCheck.current + automaticInterval - Date.now());
    let timer: number;
    const schedule = () => {
      window.clearTimeout(timer);
      const remaining = remainingDelay();
      if (remaining <= 0) void perform('check');
      else timer = window.setTimeout(schedule, remaining);
    };
    // Re-evaluate the wall clock after sleep/background suspension; no extra
    // request is made on focus if the 24-hour deadline has not been reached.
    const resume = () => { if (document.visibilityState !== 'hidden') schedule(); };
    timer = window.setTimeout(schedule, remainingDelay());
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [available, ready, automatic, pending, status.phase, checkSequence]);
  useEffect(() => {
    if (!available || !pending) return;
    let active = true;
    const timer = window.setInterval(() => { void available.status().then(s => { if (active && operation.current) setStatus(s); }).catch(() => {}); }, 400);
    return () => { active = false; window.clearInterval(timer); };
  }, [available, pending]);
  if (!available) return <>{children}</>;
  return <UpdatesContext.Provider value={{ status, automatic, pending, demo,
    setAutomatic(value) { setAutomaticState(value); try { localStorage.setItem(preference, String(value)); } catch { /* Session-only preference if storage is unavailable. */ } },
    check: () => { void perform('check'); }, install: () => { void perform('install'); },
  }}>{children}</UpdatesContext.Provider>;
}

const errors: Record<string, string> = {
  update_network: 'Vérification impossible pour le moment. Vous pouvez continuer à utiliser l’app et réessayer plus tard.',
  update_not_published: 'Aucune mise à jour signée n’est publiée sur ce canal pour le moment.',
  update_signature: 'Vérification de sécurité refusée. Le fichier reçu est invalide ; l’app actuelle a été conservée.',
  update_manifest: 'Les informations de mise à jour sont invalides. L’app actuelle a été conservée.',
  update_size: 'Le téléchargement dépasse la taille autorisée. L’app actuelle a été conservée.',
  update_platform: 'Cette mise à jour ne correspond pas à votre Mac.',
  update_location: 'Placez une copie de l’app dans votre dossier Applications personnel, puis relancez-la. La mise à jour ne demande aucun droit administrateur.',
  update_archive: 'Le paquet reçu n’est pas une version valide d’Agent World. L’app actuelle a été conservée.',
  update_install: 'Installation impossible. L’app actuelle est conservée ou restaurée. Vérifiez l’espace disque et les droits du dossier.',
  update_restore: 'Remplacement interrompu. L’ancienne app est conservée dans le dossier masqué .agent-world-backup à côté de l’app. Restaurez-la avant de fermer cette fenêtre.',
};

export default function UpdateControl({ alwaysVisible = false }: { alwaysVisible?: boolean }) {
  const context = useContext(UpdatesContext);
  const [open, setOpen] = useState(false);
  if (!context) return null;
  const { status, pending } = context;
  const installing = ['downloading', 'installing', 'restarting'].includes(status.phase);
  const visible = alwaysVisible || status.phase === 'available' || installing || (status.phase === 'error' && status.version !== null);
  const label = status.phase === 'available' ? `Nouvelle version · ${status.version}`
    : status.phase === 'downloading' ? 'Téléchargement de la mise à jour…'
    : status.phase === 'installing' ? 'Installation de la mise à jour…'
    : status.phase === 'restarting' ? 'Redémarrage…'
    : status.phase === 'checking' ? 'Recherche de mises à jour…'
    : 'Vérifier les mises à jour';
  return <>{visible && <button className={`update-trigger${status.phase === 'available' ? ' update-available' : ''}`} onClick={() => {
    setOpen(true);
    if (alwaysVisible && !pending && ['idle', 'current', 'error'].includes(status.phase)) context.check();
  }}>{label}</button>}
    {open && <UpdateDialog context={context} onClose={() => setOpen(false)} pending={pending} />}</>;
}

function UpdateDialog({ context, onClose, pending }: { context: Context; onClose(): void; pending: boolean }) {
  const { status, automatic, setAutomatic, check, install, demo } = context;
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const dialog = ref.current!; const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previous; trigger.current?.focus({ preventScroll: true }); };
  }, []);
  const working = pending || busy(status);
  return <dialog ref={ref} className="update-dialog" aria-labelledby="update-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><p className="eyebrow">Agent World{demo ? ' · Simulation' : ''}</p><h2 id="update-title">Mises à jour</h2></div><button onClick={onClose} aria-label="Fermer les mises à jour" autoFocus>Fermer ×</button></header>
    <p className="update-current">Version installée : {status.currentVersion || '…'}</p>
    <div role="status" aria-live="polite">
      {status.phase === 'idle' && <p>Recherchez les nouvelles versions publiées sur GitHub.</p>}
      {status.phase === 'unconfigured' && <p>Les mises à jour seront activées après l’ajout de la clé publique de publication à cette version.</p>}
      {status.phase === 'checking' && <p>Recherche d’une nouvelle version…</p>}
      {status.phase === 'current' && <p>Vous utilisez la dernière version proposée.</p>}
      {status.phase === 'available' && <><h3>La version {status.version} est disponible.</h3>{status.notes && <p className="update-notes">{status.notes}</p>}</>}
      {status.phase === 'downloading' && <><p>Téléchargement de la version {status.version}…</p><progress max={status.total || 1} value={status.downloaded} /><p>{Math.round(status.downloaded / 1048576)} / {Math.round((status.total || 0) / 1048576)} Mo</p></>}
      {status.phase === 'installing' && <p>Vérification et installation…</p>}
      {status.phase === 'restarting' && <p>{demo ? 'Simulation terminée. Aucun fichier n’a été installé.' : 'Installation terminée. Redémarrage…'}</p>}
      {status.phase === 'error' && <p>{errors[status.error || ''] || 'Opération impossible pour le moment. Réessayez dans quelques instants.'}</p>}
    </div>
    <div className="update-actions">
      {status.phase === 'available' && <button className="update-install" onClick={install} disabled={working}>{demo ? 'Simuler l’installation' : 'Installer et redémarrer'}</button>}
      <button onClick={check} disabled={working || status.phase === 'unconfigured'}>Vérifier les mises à jour</button>
    </div>
    <label className="update-preference"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} />Vérifier automatiquement</label>
    <p className="update-privacy">À l’ouverture, puis toutes les 24 h tant que l’app reste ouverte.</p>
    <p className="update-privacy">{demo ? 'Démonstration locale : aucun téléchargement ni redémarrage.' : 'La vérification contacte GitHub. Aucune donnée Hermes, clé SSH ou information sur votre VPS n’est envoyée. L’installation attend votre confirmation et conserve vos réglages.'}</p>
  </dialog>;
}
