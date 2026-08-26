import { useState } from 'react';
import * as Sentry from '@sentry/react';
import { captureMonitoringError } from '../monitoring';

/**
 * Dev-only test-error panel to verify the Sentry pipeline end to end. Rendered
 * only when import.meta.env.DEV is true (see App.tsx), so it never ships in a
 * production build.
 */
export function DebugSentry() {
  const [boom, setBoom] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

  // Throw during render to exercise the unhandled path (Sentry.ErrorBoundary).
  if (boom) throw new Error('Birhan admin Sentry test: unhandled render error');

  return (
    <div
      style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: 12, borderRadius: 10, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
      }}
    >
      <strong style={{ color: '#fff', fontSize: 12 }}>Sentry test (dev)</strong>
      {lastId && <span style={{ color: '#9fe', fontSize: 11 }}>event: {lastId}</span>}
      <button className="btn" onClick={() => setLastId(Sentry.captureMessage('Birhan admin Sentry test: manual message'))}>
        captureMessage
      </button>
      <button className="btn" onClick={() => captureMonitoringError(new Error('Birhan admin Sentry test: handled exception'), 'DebugSentry')}>
        handled error
      </button>
      <button className="btn" onClick={() => setBoom(true)}>
        unhandled render error
      </button>
    </div>
  );
}
