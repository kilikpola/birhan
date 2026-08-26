import { useState, useEffect } from 'react';
import { useAuth } from './auth';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { Verification } from './views/Verification';
import { Churches } from './views/Churches';
import { ChurchRequests } from './views/ChurchRequests';
import { DebugSentry } from './views/DebugSentry';
import { setMonitoringUser, clearMonitoringUser } from './monitoring';

type Tab = 'dashboard' | 'verify' | 'requests' | 'churches';

export function App() {
  const { ready, session, authorized, profile, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [pending, setPending] = useState<number | null>(null);
  const [pendingReqs, setPendingReqs] = useState<number | null>(null);

  // Tag monitoring events with the admin's user id (id only — no PII).
  useEffect(() => {
    if (session) setMonitoringUser(session.user.id);
    else clearMonitoringUser();
  }, [session]);

  if (!ready) return <div className="login-wrap"><div className="loading">Loading…</div></div>;
  if (!session) return <Login />;
  if (!authorized) return <Login unauthorized />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <img className="brand-logo" src="/birhanlogo.png" alt="Birhan" />
          <span className="l">Admin</span>
        </div>

        <button className={'nav-item' + (tab === 'dashboard' ? ' active' : '')} onClick={() => setTab('dashboard')}>
          Overview
        </button>
        <button className={'nav-item' + (tab === 'verify' ? ' active' : '')} onClick={() => setTab('verify')}>
          <span>Verification</span>
          {pending != null && pending > 0 && <span className="nav-count tnum">{pending}</span>}
        </button>
        <button className={'nav-item' + (tab === 'requests' ? ' active' : '')} onClick={() => setTab('requests')}>
          <span>Church requests</span>
          {pendingReqs != null && pendingReqs > 0 && <span className="nav-count tnum">{pendingReqs}</span>}
        </button>
        <button className={'nav-item' + (tab === 'churches' ? ' active' : '')} onClick={() => setTab('churches')}>
          Churches
        </button>

        <div className="side-foot">
          <div className="who">
            {profile?.display_name}
            <small>{profile?.role}</small>
          </div>
          <button className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        {tab === 'dashboard' && <Dashboard goVerify={() => setTab('verify')} />}
        {tab === 'verify' && <Verification onCountChange={setPending} />}
        {tab === 'requests' && <ChurchRequests onCountChange={setPendingReqs} />}
        {tab === 'churches' && <Churches />}
      </main>

      {import.meta.env.DEV && <DebugSentry />}
    </div>
  );
}
