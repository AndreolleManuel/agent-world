// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import RemoteTools, { diagnosticText, type RemoteDiagnostic } from './RemoteTools';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const source = { host: 'private.invalid', user: 'secret-user', port: 22, root: '/private/hermes', identityFile: '/private/key' };
const report: RemoteDiagnostic = { appVersion: '0.1.0', platform: 'linux', architecture: 'x86_64', canInstall: true,
  checks: [{ id: 'ssh', status: 'ok', code: 'ssh_verified' }, { id: 'collector', status: 'warning', code: 'collector_missing' }] };
const beginOperation = () => () => {};
afterEach(() => { cleanup(); vi.mocked(invoke).mockReset(); });
it('diagnoses only on request and installs only after explicit consent', async () => {
  vi.mocked(invoke).mockResolvedValue(report);
  render(<RemoteTools source={source} disabled={false} beginOperation={beginOperation} />);
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  const install = await screen.findByRole('button', { name: 'Installer le collecteur sur mon VPS' });
  expect(install).toBeDisabled();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('diagnose_remote', { source });
  fireEvent.click(screen.getByRole('checkbox', { name: /J’autorise/ }));
  fireEvent.click(install);
  await screen.findByText(/Installation confirmée/);
  expect(invoke).toHaveBeenCalledWith('install_remote_collector', { source, confirmed: true });
});
it('invalidates diagnostics and consent after editing the server', async () => {
  vi.mocked(invoke).mockResolvedValue(report);
  const view = render(<RemoteTools source={source} disabled={false} beginOperation={beginOperation} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /J’autorise/ }));
  view.rerender(<RemoteTools source={{...source, host: 'another.invalid'}} disabled={false} beginOperation={beginOperation} />);
  expect(screen.queryByRole('button', { name: 'Installer le collecteur sur mon VPS' })).not.toBeInTheDocument();
});
it('does not offer installation when the packaged binaries are absent', async () => {
  vi.mocked(invoke).mockResolvedValue({...report, canInstall: false, checks: [{id:'bundle',status:'warning',code:'collector_bundle_missing'}]});
  render(<RemoteTools source={source} disabled={false} beginOperation={beginOperation} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  await screen.findByText(/Cette build ne contient pas/);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('support export uses an allowlist even for malformed or additional fields', () => {
  const output = diagnosticText({...report, appVersion:'SECRET', architecture:'SECRET', checks:[{id:'SECRET',status:'error',code:'SECRET'}, {id:'ssh',status:'SECRET',code:'SECRET'}], ...source });
  expect(output).not.toContain('SECRET'); expect(output).not.toContain('private'); expect(output).not.toContain('secret-user');
  expect(JSON.parse(output).checks).toEqual([{step:'ssh',status:'unknown',code:'unknown_error'}]);
});
it('discards stale success and consent when a repeated diagnostic fails', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(report).mockRejectedValueOnce('ssh_timeout').mockResolvedValueOnce(report);
  render(<RemoteTools source={source} disabled={false} beginOperation={beginOperation} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /J’autorise/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Délai dépassé');
  expect(screen.queryByRole('button', { name: 'Installer le collecteur sur mon VPS' })).not.toBeInTheDocument();
  expect(screen.queryByText('Connexion et identité du serveur vérifiées.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  expect(await screen.findByRole('checkbox', { name: /J’autorise/ })).not.toBeChecked();
});
it('does not invoke or unlock anything if another operation owns the setup', () => {
  render(<RemoteTools source={source} disabled={false} beginOperation={() => null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier mon serveur' }));
  expect(invoke).not.toHaveBeenCalled();
});
