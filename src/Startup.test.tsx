// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import Startup from './Startup';
import { AVATAR_LABELS } from './AvatarPreview';
import { AVATAR_SHEETS, readPreferences, persistentAvatar, clearActivePreferences } from './preferences';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./App', () => ({ default: ({ onConfigure }: { onConfigure: () => void }) => <div>Laboratoire configuré<button onClick={onConfigure}>Configurer</button></div> }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  clearActivePreferences();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    clear: () => storage.clear(),
  });
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command) => {
    if (command === 'detect_hermes') return {
      root: '/fixture/hermes', agents: [
        { agent_id: 'florence', display_name: 'Florence', observed_state: 'connected' },
        { agent_id: 'atlas', display_name: 'Atlas', observed_state: 'disconnected' },
      ],
    };
  });
  // JSDOM does not implement native dialog behavior; visual/focus containment
  // is checked separately in the real macOS WebView.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('visual Hermes onboarding', () => {
  it('serializes VPS discovery and does not expose remote administration', async () => {
    render(<Startup />); await screen.findByRole('checkbox', { name: 'Florence' });
    fireEvent.click(screen.getByRole('button', { name: /Sur un VPS/ }));
    fireEvent.change(screen.getByLabelText('Serveur VPS'), { target: { value: 'fixture.invalid' } });
    let finish!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    fireEvent.change(screen.getByLabelText('Clé dédiée sur ce Mac'), { target: { value: '/fixture/viewer-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tester le VPS' }));
    expect(screen.getByRole('button', { name: /Connexion et détection/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Installer|Vérifier mon serveur/ })).not.toBeInTheDocument();
    await act(async () => finish({ root: '/export', remote: { host: 'fixture.invalid', user: 'aw-view', port: 22, root: '/export', identityFile: '/fixture/key' }, agents: [{ agent_id: 'r', display_name: 'Distant' }] }));
    expect(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 1 agents' })).toBeEnabled();
  });

  it('requires explicit consent to recover preferences, then returns to unconfigured discovery', async () => {
    invokeMock.mockRejectedValueOnce('settings_invalid');
    render(<Startup />);
    const reset = await screen.findByRole('button', { name: 'Sauvegarder et réinitialiser les préférences' });
    expect(reset).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Vos données Hermes ne sont pas en cause');
    expect(invokeMock.mock.calls.some(([c]) => c === 'recover_configuration')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /J’autorise la réinitialisation/ }));
    invokeMock.mockResolvedValueOnce('recovery-fixture/hermes-source.json');
    fireEvent.click(reset);
    await screen.findByRole('checkbox', { name: 'Florence' });
    expect(invokeMock).toHaveBeenCalledWith('recover_configuration', { confirmed: true });
    expect(readPreferences().configured).toBe(false);
    expect(screen.getByText(/Ancien fichier conservé/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sauvegarder et réinitialiser les préférences' })).not.toBeInTheDocument();
  });

  it('keeps recovery available and does not clear preferences if native recovery fails', async () => {
    localStorage.setItem('agent-world.preferences.v1', JSON.stringify({ version: 1, configured: true, enabledAgents: ['florence'], avatars: { florence: 5 } }));
    invokeMock.mockRejectedValueOnce('settings_invalid');
    render(<Startup />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /J’autorise la réinitialisation/ }));
    invokeMock.mockRejectedValueOnce('settings_unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Sauvegarder et réinitialiser les préférences' }));
    await screen.findByText(/La récupération n’a pas pu/);
    expect(readPreferences().avatars.florence).toBe(5);
    expect(screen.getByRole('button', { name: 'Sauvegarder et réinitialiser les préférences' })).toBeEnabled();
  });

  it('detects and configures a VPS without any local configuration or installation command', async () => {
    render(<Startup />);
    await screen.findByRole('checkbox', { name: 'Florence' });
    fireEvent.click(screen.getByRole('button', { name: /Sur un VPS/ }));
    expect(screen.queryByRole('checkbox', { name: 'Florence' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Serveur VPS'), { target: { value: 'example.invalid' } });
    fireEvent.change(screen.getByLabelText('Utilisateur SSH'), { target: { value: 'hermes' } });
    const source = { host: 'example.invalid', user: 'hermes', port: 22, identityFile: null, root: '/home/hermes/.hermes' };
    invokeMock.mockResolvedValueOnce({ root: source.root, sourceId: 'ssh:fixture', remote: source, agents: [{ agent_id: 'remote-agent', display_name: 'Distant', observed_state: 'connected' }] });
    fireEvent.change(screen.getByLabelText('Clé dédiée sur ce Mac'), { target: { value: '/fixture/viewer-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tester le VPS' }));
    expect(await screen.findByRole('checkbox', { name: 'Distant' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 1 agents' }));
    await screen.findByText('Laboratoire configuré');
    expect(invokeMock).toHaveBeenCalledWith('configure_remote_hermes', { source, preferences: expect.objectContaining({ root: 'ssh:fixture', enabledAgents: ['remote-agent'] }) });
    expect(invokeMock.mock.calls.some(([command]) => command === 'configure_hermes' || String(command).includes('install'))).toBe(false);
  });

  it('keeps host verification failures visible and does not allow launch', async () => {
    render(<Startup />); await screen.findByRole('checkbox', { name: 'Florence' });
    fireEvent.click(screen.getByRole('button', { name: /Sur un VPS/ }));
    fireEvent.change(screen.getByLabelText('Serveur VPS'), { target: { value: 'example.invalid' } });
    fireEvent.change(screen.getByLabelText('Utilisateur SSH'), { target: { value: 'hermes' } });
    invokeMock.mockRejectedValueOnce('ssh_host_untrusted');
    fireEvent.change(screen.getByLabelText('Clé dédiée sur ce Mac'), { target: { value: '/fixture/viewer-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tester le VPS' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('empreinte');
    expect(screen.queryByRole('button', { name: /Ouvrir mon laboratoire/ })).not.toBeInTheDocument();
  });

  it('invalidates a VPS detection when switching back to local', async () => {
    render(<Startup />); await screen.findByRole('checkbox', { name: 'Florence' });
    fireEvent.click(screen.getByRole('button', { name: /Sur un VPS/ }));
    fireEvent.change(screen.getByLabelText('Serveur VPS'), { target: { value: 'example.invalid' } });
    fireEvent.change(screen.getByLabelText('Utilisateur SSH'), { target: { value: 'hermes' } });
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.change(screen.getByLabelText('Clé dédiée sur ce Mac'), { target: { value: '/fixture/viewer-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tester le VPS' }));
    fireEvent.click(screen.getByRole('button', { name: /Sur ce Mac/ }));
    await act(async () => resolve({ root: '/remote', remote: {}, agents: [{ agent_id: 'x', display_name: 'Trop tard' }] }));
    expect(screen.getByRole('button', { name: /Sur ce Mac/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Trop tard')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Détecter' }));
    await screen.findByRole('checkbox', { name: 'Florence' });
    expect(invokeMock).toHaveBeenCalledWith('detect_hermes', { path: null, local: true });
  });

  it('restores an unreachable saved VPS into the connection form on startup', async () => {
    invokeMock.mockRejectedValueOnce('ssh_timeout').mockResolvedValueOnce({ host: 'offline.invalid', user: 'hermes', port: 22, root: null, identityFile: null });
    render(<Startup />);
    expect(await screen.findByLabelText('Serveur VPS')).toHaveValue('offline.invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('pas répondu');
  });
  it('does not count obsolete selected IDs as launchable agents', async () => {
    localStorage.setItem('agent-world.preferences.v1', JSON.stringify({ version: 1, configured: true, enabledAgents: ['deleted'], avatars: {} }));
    render(<Startup />);
    expect(await screen.findByRole('checkbox', { name: 'Florence' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 0 agents' })).toBeDisabled();
    expect(screen.getByText(/profils sélectionnés ne sont plus présents/)).toBeInTheDocument();
  });

  it('uses committed native preferences even when the browser cache is unavailable', async () => {
    render(<Startup />);
    await screen.findByRole('checkbox', { name: 'Florence' });
    localStorage.setItem = () => { throw new Error('quota'); };
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 2 agents' }));
    await screen.findByText('Laboratoire configuré');
    expect(readPreferences().configured).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not activate preferences if the native atomic save fails', async () => {
    render(<Startup />);
    await screen.findByRole('checkbox', { name: 'Florence' });
    invokeMock.mockRejectedValueOnce(new Error('disk failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 2 agents' }));
    await screen.findByRole('alert');
    expect(readPreferences().configured).toBe(false);
    expect(screen.queryByText('Laboratoire configuré')).not.toBeInTheDocument();
  });

  it('ignores a detection result after the user edits its path', async () => {
    render(<Startup />);
    await screen.findByRole('checkbox', { name: 'Florence' });
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Détecter' }));
    fireEvent.change(screen.getByLabelText('Dossier Hermes'), { target: { value: '/new-intent' } });
    await act(async () => resolve({ root: '/obsolete', agents: [] }));
    expect(screen.getByLabelText('Dossier Hermes')).toHaveValue('/new-intent');
    expect(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 2 agents' })).toBeDisabled();
  });

  it('restores source-specific selection and leaves known deselected agents disabled', async () => {
    invokeMock.mockResolvedValueOnce({ root: '/fixture/native', agents: [
      { agent_id: 'florence', display_name: 'Florence' }, { agent_id: 'atlas', display_name: 'Atlas' }, { agent_id: 'new', display_name: 'Nouveau' },
    ], preferences: { version: 1, configured: true, root: '/fixture/native', enabledAgents: ['florence'], knownAgents: ['florence', 'atlas'], avatars: { florence: 7 } } });
    render(<Startup />);
    await screen.findByText('Laboratoire configuré');
    expect(readPreferences()).toMatchObject({ root: '/fixture/native', enabledAgents: ['florence'], avatars: { florence: 7 } });
  });

  it('shows real avatars on each agent card and twelve illustrated choices', async () => {
    render(<Startup />);
    const trigger = await screen.findByRole('button', { name: 'Choisir l’avatar de Florence' });
    expect(trigger.querySelector('image')).toHaveAttribute('href', AVATAR_SHEETS[0]);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choisir l’avatar de Atlas' })).toBeEnabled();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'L’avatar de Florence' });
    for (const label of AVATAR_LABELS) {
      expect(within(dialog).getByRole('button', { name: label }).querySelector('svg image')).not.toBeNull();
    }
    expect(within(dialog).getByRole('button', { name: AVATAR_LABELS[0] })).toHaveAttribute('aria-pressed', 'true');
  });

  it('updates only the chosen agent, saves its identity and reuses it in the renderer', async () => {
    render(<Startup />);
    const florence = await screen.findByRole('button', { name: 'Choisir l’avatar de Florence' });
    const atlas = screen.getByRole('button', { name: 'Choisir l’avatar de Atlas' });
    const atlasFrame = atlas.querySelector('svg')?.getAttribute('viewBox');
    florence.focus();
    fireEvent.click(florence);
    fireEvent.click(screen.getByRole('button', { name: AVATAR_LABELS[9] }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(florence).toHaveFocus();
    expect(florence.querySelector('image')).toHaveAttribute('href', AVATAR_SHEETS[2]);
    expect(atlas.querySelector('svg')).toHaveAttribute('viewBox', atlasFrame);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 2 agents' }));
    await screen.findByText('Laboratoire configuré');
    expect(invokeMock).toHaveBeenCalledWith('configure_hermes', { path: '/fixture/hermes', preferences: expect.objectContaining({ root: '/fixture/hermes', enabledAgents: ['florence', 'atlas'] }) });
    expect(readPreferences()).toMatchObject({ configured: true, avatars: { florence: 10, atlas: 2 } });
    expect(persistentAvatar('florence', 3)).toBe(10);
  });

  it('cancels the gallery without changing the avatar or saving configuration', async () => {
    render(<Startup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir l’avatar de Florence' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(readPreferences().configured).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Choisir l’avatar de Florence' }));
    expect(screen.getByRole('button', { name: AVATAR_LABELS[0] })).toHaveAttribute('aria-pressed', 'true');
  });

  it('requires a selection and a freshly detected folder before launch', async () => {
    render(<Startup />);
    await screen.findByRole('button', { name: 'Choisir l’avatar de Florence' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Florence' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Atlas' }));
    expect(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 0 agents' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Atlas' }));
    fireEvent.change(screen.getByLabelText('Dossier Hermes'), { target: { value: '/another/hermes' } });
    expect(screen.getByRole('button', { name: 'Ouvrir mon laboratoire · 1 agents' })).toBeDisabled();
  });
});
