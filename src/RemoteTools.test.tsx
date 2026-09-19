// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import RemoteTools from './RemoteTools';
import { connectionError } from './RemoteConnection';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(cleanup);
it('only explains administrative preparation and never exposes an installer', () => {
  render(<RemoteTools />);
  fireEvent.click(screen.getByText('Préparer le lecteur VPS'));
  expect(screen.getByText(/compte dédié aw-view/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
});
it('legacy access requires migration and arbitrary errors never echo source data', () => {
  expect(connectionError('secure_setup_required')).toContain('ancien accès général');
  for (const code of ['constructor', '__proto__', 'SECRET/path']) {
    expect(typeof connectionError(code)).toBe('string');
    expect(connectionError(code)).not.toContain(code);
  }
});
