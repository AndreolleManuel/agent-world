import { useCallback, useRef, useState } from 'react';

export type SetupOperation = 'detect' | 'diagnose' | 'install' | 'save' | 'recover';
export type BeginSetupOperation = (kind: SetupOperation) => (() => void) | null;

// A release belongs to its request: a late result cannot unlock another action.
export function useSetupOperation() {
  const owner = useRef<{ kind: SetupOperation } | null>(null);
  const [operation, setOperation] = useState<SetupOperation | null>(null);
  const begin = useCallback<BeginSetupOperation>((kind) => {
    if (owner.current) return null;
    const token = { kind };
    owner.current = token;
    setOperation(kind);
    return () => {
      if (owner.current !== token) return;
      owner.current = null;
      setOperation(null);
    };
  }, []);
  const cancelDetection = useCallback(() => {
    if (owner.current?.kind !== 'detect') return;
    owner.current = null;
    setOperation(null);
  }, []);
  return { operation, begin, cancelDetection };
}
