import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './styles.css';
import { initMonitoring } from './monitoring';
import { AuthProvider } from './auth';
import { App } from './App';

// Initialise monitoring before anything renders. No-op without VITE_SENTRY_DSN.
initMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div className="login-wrap"><div className="loading">Something went wrong. The team has been notified.</div></div>}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
