// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UpdateControl, { UpdateProvider, type UpdateBackend, type UpdateStatus } from './Updates';

const idle: UpdateStatus = { phase: 'idle', currentVersion: '0.2.0', version: null, notes: null, downloaded: 0, total: null, error: null };
const available: UpdateStatus = { ...idle, phase: 'available', version: '0.3.0', notes: '<script>unsafe()</script>\nCorrections' };
function backend(): UpdateBackend {
  return { status: vi.fn(async () => idle), check: vi.fn(async () => available), install: vi.fn(async () => ({ ...available, phase: 'restarting' as const })) };
}
function show(service: UpdateBackend, alwaysVisible = true) { render(<StrictMode><UpdateProvider backend={service}><UpdateControl alwaysVisible={alwaysVisible} /></UpdateProvider></StrictMode>); }
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

it('checks once under StrictMode but never installs automatically; displays notes as text', async () => {
  const service = backend(); show(service);
  fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle version · 0.3.0' }));
  expect(service.check).toHaveBeenCalledTimes(1); expect(service.install).not.toHaveBeenCalled();
  expect(screen.getByText(/<script>/).querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Installer et redémarrer' }));
  await waitFor(() => expect(service.install).toHaveBeenCalledTimes(1));
});
it('respects disabled startup checks and persists the preference', async () => {
  localStorage.setItem('agent-world.check-updates', 'false'); const service = backend(); show(service);
  await waitFor(() => expect(service.status).toHaveBeenCalled()); expect(service.check).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier les mises à jour' }));
  await screen.findByText('Version installée : 0.2.0');
  fireEvent.click(screen.getByRole('checkbox')); expect(localStorage.getItem('agent-world.check-updates')).toBe('true');
  await screen.findByText('La version 0.3.0 est disponible.');
});
it('keeps offline errors recoverable and never offers installation for an invalid signature', async () => {
  const service = backend(); service.check = vi.fn(async (): Promise<UpdateStatus> => ({ ...idle, phase: 'error', error: 'update_signature' })); show(service);
  await waitFor(() => expect(service.check).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier les mises à jour' }));
  await screen.findByText(/Vérification de sécurité refusée/);
  expect(screen.queryByRole('button', { name: 'Installer et redémarrer' })).toBeNull();
});
it('prevents concurrent clicks and restores focus after closing', async () => {
  localStorage.setItem('agent-world.check-updates', 'false'); const service = backend(); let finish!: (s: UpdateStatus) => void;
  service.check = vi.fn(() => new Promise<UpdateStatus>(resolve => { finish = resolve; })); show(service);
  const trigger = screen.getByRole('button', { name: 'Vérifier les mises à jour' }); trigger.focus(); fireEvent.click(trigger);
  const button = screen.getAllByRole('button', { name: 'Vérifier les mises à jour' }).find(b => b.closest('dialog'))!; fireEvent.click(button); fireEvent.click(button);
  expect(service.check).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
  await act(async () => { finish(available); });
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger).toHaveFocus();
});
it('does not contact the network when the build has no publishing key', async () => {
  const service = backend(); service.status = vi.fn(async (): Promise<UpdateStatus> => ({ ...idle, phase: 'unconfigured' })); show(service);
  await waitFor(() => expect(service.status).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier les mises à jour' })); await screen.findByText(/ajout de la clé publique/);
  expect(service.check).not.toHaveBeenCalled(); expect(screen.getAllByRole('button', { name: 'Vérifier les mises à jour' }).find(b => b.closest('dialog'))).toBeDisabled();
});

it('keeps the laboratory quiet while checking and when no update is available', async () => {
  const service = backend(); let finish!: (s: UpdateStatus) => void;
  service.check = vi.fn(() => new Promise<UpdateStatus>(resolve => { finish = resolve; })); show(service, false);
  await waitFor(() => expect(service.check).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button')).toBeNull();
  await act(async () => { finish({ ...idle, phase: 'current' }); });
  expect(screen.queryByRole('button')).toBeNull();
});
