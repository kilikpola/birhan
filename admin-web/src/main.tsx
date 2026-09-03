import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './styles.css';
import { initMonitoring } from './monitoring';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { App } from './App';

initMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div className="login-wrap"><div className="loading">Something went wrong. The team has been notified.</div></div>}>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
