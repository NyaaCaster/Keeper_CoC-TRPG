import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {loadPublicConfig} from './lib/publicConfig';

// Wait for the public config (image cache base URL etc.) before rendering so
// that saveManager / fetchClueImage have the localStorage allowlist ready
// from the very first save. A failed fetch is non-fatal — we still render
// and the allowlist stays empty, which fails closed (no imageUrl persisted).
loadPublicConfig()
  .catch((e) => console.error('[public-config] failed to load:', e))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
