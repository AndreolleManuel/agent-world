// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import CompanyLink from './CompanyLink';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('uses the fixed native company command and shows an error if it cannot open', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockRejectedValue('browser_unavailable');
  render(<CompanyLink>AM Labs</CompanyLink>);
  fireEvent.click(screen.getByRole('link'));
  expect(invoke).toHaveBeenCalledExactlyOnceWith('open_company_site');
  expect(await screen.findByRole('alert')).toHaveTextContent('amlabs.dev');
});
it('keeps a normal website link outside Tauri', () => {
  vi.mocked(isTauri).mockReturnValue(false);
  render(<CompanyLink>AM Labs</CompanyLink>);
  const link = screen.getByRole('link');
  expect(link).toHaveAttribute('href', 'https://amlabs.dev');
  expect(link).toHaveAttribute('rel', 'noreferrer');
  expect(invoke).not.toHaveBeenCalled();
});
