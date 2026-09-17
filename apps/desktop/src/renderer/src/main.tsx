import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './routes/router.js';
import { I18nProvider } from './i18n.js';
import { applySavedTheme } from './lib/theme.js';
import { platformStore } from './state/store.js';
import { broadcastPort, connectWindowSync } from './state/window-sync.js';
import './styles.css';

// Every window starts from the same state and mirrors user actions to the others.
connectWindowSync(platformStore, broadcastPort());
applySavedTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  </StrictMode>,
);
