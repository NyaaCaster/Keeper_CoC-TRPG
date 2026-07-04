import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {loadPublicConfig} from './lib/publicConfig';
import {migrateFromLocalStorage} from './lib/idbStorage';
import {hydrateSaves} from './lib/saveManager';
import {hydrateApiSettings} from './lib/apiSettings';

// Bootstrap sequence (async, before React mounts):
//   1. loadPublicConfig      → image-cache allowlist for sanitizeForStorage
//   2. migrateFromLocalStorage → one-shot localStorage → IndexedDB (idempotent)
//   3. hydrateSaves / hydrateApiSettings → fill the in-memory caches so that
//      App.tsx / StartScreen can synchronously read from saveManager / apiSettings
//      right after mount, without waiting on async IDB transactions.
//
// A failed public-config fetch is non-fatal — we still render and the allowlist
// stays empty, which fails closed (no imageUrl persisted).
loadPublicConfig()
  .catch((e) => console.error('[public-config] failed to load:', e))
  .then(async () => {
    await migrateFromLocalStorage();
    await Promise.all([hydrateSaves(), hydrateApiSettings()]);
  })
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
