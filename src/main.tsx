import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import Startup from './Startup';
import FixtureLab from './FixtureLab';

const fixtureMode = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('fixture') === '1';
const layoutMode = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('layout') === '1';
const LayoutEditor = import.meta.env.DEV ? lazy(() => import('./LayoutEditor')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {layoutMode && LayoutEditor ? <Suspense fallback={<p>Chargement de l’atelier…</p>}><LayoutEditor /></Suspense>
      : fixtureMode ? <FixtureLab /> : <Startup />}
  </StrictMode>,
);
