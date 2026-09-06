// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSetupOperation } from './useSetupOperation';

it('a cancelled detection cannot unlock a newer diagnostic or allow a second writer', () => {
  const { result } = renderHook(() => useSetupOperation());
  let releaseOld!: () => void;
  let releaseNew!: () => void;
  act(() => { releaseOld = result.current.begin('detect')!; });
  expect(result.current.begin('install')).toBeNull();
  act(() => result.current.cancelDetection());
  act(() => { releaseNew = result.current.begin('diagnose')!; });
  act(releaseOld);
  expect(result.current.operation).toBe('diagnose');
  act(() => result.current.cancelDetection());
  expect(result.current.operation).toBe('diagnose');
  expect(result.current.begin('save')).toBeNull();
  act(releaseNew);
  expect(result.current.operation).toBeNull();
});
