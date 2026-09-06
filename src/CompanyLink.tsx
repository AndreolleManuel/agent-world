import { useState, type ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export default function CompanyLink({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return <>
    <a href="https://amlabs.dev" target="_blank" rel="noreferrer" onClick={(event) => {
      if (!isTauri()) return;
      event.preventDefault();
      setFailed(false);
      // Native command has a fixed URL, not a frontend-supplied shell argument.
      void invoke('open_company_site').catch(() => setFailed(true));
    }}>{children}</a>
    {failed && <span role="alert">Ouverture du navigateur impossible. Adresse : amlabs.dev</span>}
  </>;
}
