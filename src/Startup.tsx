import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import { loadWorldSnapshot } from './heartbeat';
import type { AgentHeartbeatDto } from './heartbeat';
import { readPreferences, activatePreferences, resetPreferences } from './preferences';
import { AvatarPreview, AVATAR_LABELS } from './AvatarPreview';
import type { Preferences } from './preferences';
import RemoteConnection, { EMPTY_SSH_SOURCE, connectionError, type SshSource } from './RemoteConnection';
import { useSetupOperation } from './useSetupOperation';
import CompanyLink from './CompanyLink';

export default function Startup() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [configuring, setConfiguring] = useState(true);
  const [booting, setBooting] = useState(true);
  const [registryNotice, setRegistryNotice] = useState('');
  const requestGeneration = useRef(0);
  const [agents, setAgents] = useState<AgentHeartbeatDto[]>([]);
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [root, setRoot] = useState('');
  const [error, setError] = useState('');
  const [settingsInvalid, setSettingsInvalid] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const { operation, begin, cancelDetection } = useSetupOperation();
  const busy = operation !== null;
  const saving = busy && operation !== 'detect';
  const [detectedRoot, setDetectedRoot] = useState<string | null>(null);
  const [choosingAvatar, setChoosingAvatar] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<'local' | 'ssh'>('local');
  const [sshSource, setSshSource] = useState<SshSource>(EMPTY_SSH_SOURCE);
  const [detectedRemote, setDetectedRemote] = useState<SshSource | null>(null);
  const [activeRemote, setActiveRemote] = useState<SshSource | null>(null);
  const avatarDialog = useRef<HTMLDialogElement>(null);
  const avatarTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!choosingAvatar) return;
    const dialog = avatarDialog.current;
    const trigger = avatarTrigger.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [choosingAvatar]);
  const detect = useCallback(async (path = '', initial = false, remoteSource?: SshSource | null) => {
    const release = begin('detect');
    if (!release) return;
    const generation = ++requestGeneration.current;
    setError(''); setDetectedRoot(null); setDetectedRemote(null);
    try {
      const result = await invoke<{ root: string; sourceId?: string; remote?: SshSource | null; agents: AgentHeartbeatDto[]; preferences?: Preferences | null }>(
        remoteSource ? 'detect_remote_hermes' : 'detect_hermes', remoteSource ? { source: remoteSource } : { path: path.trim() || null, ...(remoteSource === null ? { local: true } : {}) });
      if (generation !== requestGeneration.current) return;
      setRoot(result.root); setDetectedRoot(result.root); setAgents(result.agents);
      setDetectedRemote(result.remote ?? null); setConnectionMode(result.remote ? 'ssh' : 'local');
      if (result.remote) setSshSource(result.remote);
      const sourceId = result.sourceId ?? result.root;
      const cached = readPreferences();
      const current = result.preferences ?? (cached.root === sourceId || (!cached.root && initial && !result.remote) ? cached : undefined);
      const ids = result.agents.map((a) => a.agent_id);
      const next: Preferences = { version: 1, configured: current?.configured ?? false, root: sourceId,
        knownAgents: ids,
        enabledAgents: current?.configured ? current.enabledAgents.filter((id) => ids.includes(id)) : ids,
        avatars: { ...Object.fromEntries(result.agents.map((a, i) => [a.agent_id, (i % 12) + 1])), ...current?.avatars },
      };
      const added = current?.configured ? ids.filter((id) => !(current.knownAgents ?? current.enabledAgents).includes(id)).length : 0;
      const removed = current?.enabledAgents.filter((id) => !ids.includes(id)).length ?? 0;
      setRegistryNotice([added ? `${added} nouveaux profils détectés : choisissez ceux à afficher dans la configuration.` : '', removed ? `${removed} profils sélectionnés ne sont plus présents.` : ''].filter(Boolean).join(' '));
      setDraft(next);
      if (initial && next.configured && next.enabledAgents.length) {
        const active = { ...next, knownAgents: current?.knownAgents ?? current?.enabledAgents ?? ids };
        activatePreferences(active); setPreferences(active); setConfiguring(false);
        setActiveRemote(result.remote ?? null);
      }
    } catch (error) {
      if (generation === requestGeneration.current) {
        setAgents([]);
        if (String(error) === 'settings_invalid') {
          setSettingsInvalid(true); setRecoveryConfirmed(false);
          setError('Les préférences Agent World sont endommagées ou incompatibles. Vos données Hermes ne sont pas en cause.');
          return;
        }
        let remote = remoteSource;
        if (initial) {
          try { remote = await invoke<SshSource | null>('configured_remote'); } catch { /* keep the original error */ }
          if (generation !== requestGeneration.current) return;
          if (remote) { setConnectionMode('ssh'); setSshSource(remote); }
        }
        setError(remote ? connectionError(error) : 'Hermes ou sa configuration est introuvable ou illisible. Vérifie le dossier et les permissions, puis relance la détection.');
      }
    }
    finally { release(); if (generation === requestGeneration.current) setBooting(false); }
  }, [begin]);
  useEffect(() => { void detect('', true); return () => { requestGeneration.current++; cancelDetection(); }; }, [detect, cancelDetection]);
  const loadConfiguredWorld = useCallback(async () => {
    const snapshot = await loadWorldSnapshot();
    const ids = snapshot.agents.map((a) => a.agent_id);
    const added = ids.filter((id) => !(preferences.knownAgents ?? preferences.enabledAgents).includes(id)).length;
    const removed = preferences.enabledAgents.filter((id) => !ids.includes(id)).length;
    setRegistryNotice([added ? `${added} nouveaux profils détectés : choisissez ceux à afficher dans la configuration.` : '', removed ? `${removed} profils sélectionnés ne sont plus présents.` : ''].filter(Boolean).join(' '));
    return { ...snapshot, agents: snapshot.agents.filter((agent) => preferences.enabledAgents.includes(agent.agent_id)) };
  }, [preferences]);
  const selectedIds = draft.enabledAgents.filter((id) => agents.some((a) => a.agent_id === id));
  async function launch() {
    if (busy || !detectedRoot || !selectedIds.length) return;
    const release = begin('save');
    if (!release) return;
    setError('');
    try {
      const next: Preferences = { ...draft, enabledAgents: selectedIds, knownAgents: agents.map((a) => a.agent_id), configured: true };
      if (detectedRemote) await invoke('configure_remote_hermes', { source: detectedRemote, preferences: next });
      else await invoke('configure_hermes', { path: detectedRoot, preferences: next });
      activatePreferences(next);
      setActiveRemote(detectedRemote);
      setPreferences(next); setConfiguring(false);
    } catch (error) {
      if (String(error) === 'settings_invalid') {
        setSettingsInvalid(true); setRecoveryConfirmed(false);
        setError('Les préférences Agent World sont endommagées ou incompatibles. Vos données Hermes ne sont pas en cause.');
      } else setError(detectedRemote ? connectionError(error) : 'La configuration n’a pas pu être enregistrée. Vérifie les permissions du dossier et réessaie.');
    }
    finally { release(); }
  }
  async function recover() {
    if (!settingsInvalid || !recoveryConfirmed) return;
    const release = begin('recover');
    if (!release) return;
    let recovered = false;
    try {
      const backup = await invoke<string>('recover_configuration', { confirmed: true });
      const defaults = resetPreferences();
      setPreferences(defaults); setDraft(defaults); setAgents([]); setRoot('');
      setDetectedRoot(null); setDetectedRemote(null); setActiveRemote(null);
      setConnectionMode('local'); setSshSource(EMPTY_SSH_SOURCE);
      setSettingsInvalid(false); setRecoveryConfirmed(false); setError('');
      setRecoveryNotice(`Préférences réinitialisées. Ancien fichier conservé dans le dossier de configuration Agent World : ${backup}. Aucun fichier Hermes modifié. Reconfigurez votre connexion et vos avatars.`);
      recovered = true;
    } catch {
      setError('La récupération n’a pas pu être effectuée. Aucun effacement de données Hermes. Vérifiez les permissions du dossier de configuration Agent World.');
    } finally { release(); }
    if (recovered) void detect('', false, null);
  }
  if (booting) return <main className="setup-shell"><p role="status">Connexion à votre laboratoire…</p></main>;
  if (!configuring) return <App remoteSourceLabel={activeRemote ? `${activeRemote.user}@${activeRemote.host}` : undefined} configurationNotice={registryNotice} loadWorldSnapshot={loadConfiguredWorld} onConfigure={() => { setConfiguring(true); void detect(); }} />;
  function invalidateConnection() { requestGeneration.current++; cancelDetection(); setDetectedRoot(null); setDetectedRemote(null); setAgents([]); setRegistryNotice(''); setError(''); }
  return <main className="setup-shell">
    <header className="setup-hero"><div><p className="eyebrow"><span className="brand-mark">A</span> AM LABS / AGENT WORLD</p><h1>Un monde pour<br />votre équipe.</h1>
      <p>Retrouvez vos agents Hermes dans un laboratoire vivant.<br />Votre équipe, vos avatars, sur votre Mac.</p>
      <div className="setup-pills"><span>Mac ou VPS</span><span>Lecture seule</span><span>Sans compte AM Labs</span></div></div>
      <div className="setup-illustration" role="img" aria-label="Aperçu du laboratoire Agent World" /></header>
    <section className="setup-card" aria-labelledby="setup-source">
      <p className="step-number">01 · Connexion</p><h2 id="setup-source">Où tournent vos agents ?</h2>
      <div className="source-modes" role="group" aria-label="Emplacement des agents">
        <button type="button" disabled={saving} aria-pressed={connectionMode === 'local'} onClick={() => { invalidateConnection(); setConnectionMode('local'); setRoot(''); }}>Sur ce Mac<small>Détection locale</small></button>
        <button type="button" disabled={saving} aria-pressed={connectionMode === 'ssh'} onClick={() => { invalidateConnection(); setConnectionMode('ssh'); }}>Sur un VPS<small>Connexion sécurisée SSH</small></button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void detect(root, false, connectionMode === 'ssh' ? sshSource : null); }}>
        {connectionMode === 'local' ? <>
        <p>Détection automatique dans votre dossier Hermes. Aucune clé API à fournir.</p>
        <label htmlFor="hermes-root">Dossier Hermes</label>
        <div className="source-input"><input id="hermes-root" disabled={saving} value={root} placeholder="Détection automatique" onChange={(e) => { requestGeneration.current++; cancelDetection(); setRoot(e.target.value); setDetectedRoot(null); }} />
          <button disabled={busy}>{busy ? 'Recherche…' : 'Détecter'}</button></div></> : <>
          <RemoteConnection value={sshSource} disabled={saving} toolsDisabled={busy} beginOperation={begin} onChange={(value) => { invalidateConnection(); setSshSource(value); }} />
          <button className="primary-action" disabled={busy || !sshSource.host.trim() || !sshSource.user.trim()}>{busy ? 'Connexion et détection…' : 'Tester le VPS'}</button>
        </>}
      </form>
      {error && <p role="alert" className="room-error">{error}</p>}
      {settingsInvalid && <section className="settings-recovery" aria-label="Récupération des préférences">
        <p>Repartir à zéro pour la connexion, la sélection et les avatars. L’ancien fichier sera conservé dans un dossier de sauvegarde privé. Cette action ne touche ni aux agents ni aux bases Hermes.</p>
        <label><input type="checkbox" disabled={busy} checked={recoveryConfirmed} onChange={(event) => setRecoveryConfirmed(event.target.checked)} /> J’autorise la réinitialisation des seules préférences Agent World.</label>
        <button type="button" disabled={busy || !recoveryConfirmed} onClick={() => void recover()}>Sauvegarder et réinitialiser les préférences</button>
      </section>}
      {recoveryNotice && <p role="status">{recoveryNotice}</p>}
      {registryNotice && <p role="status">{registryNotice}</p>}
      {detectedRoot && <p role="status">{agents.length} agents détectés. Les agents déconnectés restent configurables.</p>}
    </section>
    {agents.length > 0 && <section className="setup-card" aria-labelledby="setup-avatars">
      <p className="step-number">02 · Votre équipe</p><h2 id="setup-avatars">Choisissez leurs avatars</h2>
      <p>Les noms viennent de Hermes. Les avatars et la sélection sont enregistrés sur ce Mac.</p>
      <div className="setup-agents">{agents.map((agent) => {
        const avatar = draft.avatars[agent.agent_id] ?? 1;
        return <article className={`setup-agent${draft.enabledAgents.includes(agent.agent_id) ? ' is-enabled' : ''}`} key={agent.agent_id}>
          <label className="agent-toggle"><input type="checkbox" disabled={saving} checked={draft.enabledAgents.includes(agent.agent_id)} onChange={(e) => setDraft((d) => ({ ...d, enabledAgents: e.target.checked ? [...d.enabledAgents, agent.agent_id] : d.enabledAgents.filter((id) => id !== agent.agent_id) }))} /> <span>{agent.display_name}</span></label>
          <button className="avatar-choice" disabled={saving} aria-label={`Choisir l’avatar de ${agent.display_name}`} onClick={(event) => { avatarTrigger.current = event.currentTarget; setChoosingAvatar(agent.agent_id); }}>
            <AvatarPreview avatar={avatar} /><span>Changer d’avatar <span aria-hidden="true">↗</span></span>
          </button>
          <small>{agent.observed_state === 'connected' ? '● Gateway connecté' : '○ Gateway non connecté'}</small>
        </article>;
      })}</div>
      <button className="primary-action" disabled={busy || !detectedRoot || !selectedIds.length} onClick={() => void launch()}>Ouvrir mon laboratoire · {selectedIds.length} agents</button>
    </section>}
    {choosingAvatar && <dialog ref={avatarDialog} className="avatar-dialog" aria-labelledby="avatar-title" onCancel={() => setChoosingAvatar(null)} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setChoosingAvatar(null);
    }}>
        <div className="panel-heading"><div><p className="eyebrow">Un visage pour votre agent</p><h2 id="avatar-title">L’avatar de {agents.find((a) => a.agent_id === choosingAvatar)?.display_name}</h2></div><button autoFocus aria-label="Fermer le choix d’avatar" onClick={() => setChoosingAvatar(null)}>×</button></div>
        <p>Choisissez le personnage que vous retrouverez dans le laboratoire.</p>
        <div className="avatar-gallery">{AVATAR_LABELS.map((label, i) => <button key={i} className="avatar-option" aria-label={label} aria-pressed={draft.avatars[choosingAvatar] === i + 1} onClick={() => {
          setDraft((d) => ({ ...d, avatars: { ...d.avatars, [choosingAvatar]: i + 1 } })); setChoosingAvatar(null);
        }}><AvatarPreview avatar={i + 1} /><span>{draft.avatars[choosingAvatar] === i + 1 ? '✓ Actuel' : 'Choisir'}</span></button>)}</div>
    </dialog>}
    <footer><p>Vos données restent entre vos machines. Agent World observe Hermes en lecture seule, sans relais AM Labs.</p>
      {import.meta.env.DEV && <a href="?fixture=1">Scénarios de vérification (données fictives)</a>}
      <CompanyLink>Un outil créé par AM Labs · découvrir notre travail ↗</CompanyLink>
      {preferences.configured && <button disabled={busy || settingsInvalid} onClick={() => { requestGeneration.current++; setConfiguring(false); }}>Revenir au laboratoire</button>}
    </footer>
  </main>;
}
