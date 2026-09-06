import { useState, useEffect } from 'react';
import { useAuth } from './auth';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { Verification } from './views/Verification';
import { Churches } from './views/Churches';
import { ChurchRequests } from './views/ChurchRequests';
import { DebugSentry } from './views/DebugSentry';
import { Avatar } from './components/Avatar';
import { setMonitoringUser, clearMonitoringUser } from './monitoring';
import { useTheme } from './theme';
import { I18nProvider, useI18n, t, type Lang } from './i18n';

type Tab = 'dashboard' | 'verify' | 'requests' | 'churches';

function Shell() {
  const { ready, session, authorized, profile, profileError, retryProfile, signOut } = useAuth();
  const { night, setNight } = useTheme();
  const { lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [pending, setPending] = useState<number | null>(null);
  const [pendingReqs, setPendingReqs] = useState<number | null>(null);

  useEffect(() => {
    if (profile) setMonitoringUser(profile.id);
    else clearMonitoringUser();
  }, [profile]);

  if (!ready) return <div className="login-wrap"><div className="loading">{t(lang, 'loading')}</div></div>;
  if (!session) return <Login />;
  // A failed profile load is not an answer about this account's role, so it must
  // not fall through to the access-denied screen.
  if (profileError) {
    return (
      <div className="login-wrap">
        <div className="loading">
          <p>{t(lang, 'profileLoadFailed')}</p>
          <p className="muted">{profileError}</p>
          <button className="btn" onClick={retryProfile}>{t(lang, 'retry')}</button>
          <button className="btn ghost" onClick={signOut}>{t(lang, 'signOut')}</button>
        </div>
      </div>
    );
  }
  if (!authorized) return <Login unauthorized />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <img className="brand-logo" src="/birhanlogo.png" alt="Birhan" />
          <span className="m serif">{t(lang, 'appName')}</span>
          <span className="l">{t(lang, 'admin')}</span>
        </div>

        <div className="lang-toggle">
          <button
            className={'lang-btn' + (lang === 'am' ? ' active' : '')}
            onClick={() => setLang('am')}
          >
            {t(lang, 'langAm')}
          </button>
          <button
            className={'lang-btn' + (lang === 'en' ? ' active' : '')}
            onClick={() => setLang('en')}
          >
            {t(lang, 'langEn')}
          </button>
        </div>

        <button
          className={'nav-item' + (tab === 'dashboard' ? ' active' : '')}
          onClick={() => setTab('dashboard')}
        >
          {t(lang, 'overview')}
        </button>
        <button
          className={'nav-item' + (tab === 'verify' ? ' active' : '')}
          onClick={() => setTab('verify')}
        >
          <span>{t(lang, 'verification')}</span>
          {pending != null && pending > 0 && <span className="nav-count tnum">{pending}</span>}
        </button>
        <button
          className={'nav-item' + (tab === 'requests' ? ' active' : '')}
          onClick={() => setTab('requests')}
        >
          <span>{t(lang, 'churchRequests')}</span>
          {pendingReqs != null && pendingReqs > 0 && <span className="nav-count tnum">{pendingReqs}</span>}
        </button>
        <button
          className={'nav-item' + (tab === 'churches' ? ' active' : '')}
          onClick={() => setTab('churches')}
        >
          {t(lang, 'churches')}
        </button>

        <div className="side-foot">
          <div className="who-foot">
            <Avatar name={profile?.displayName ?? '?'} size={36} />
            <div className="who">
              {profile?.displayName}
              <small>{profile?.role}</small>
            </div>
          </div>
          <button className="theme-toggle" onClick={() => setNight(!night)}>
            {night ? '☀️' : '🌙'} {t(lang, night ? 'dayMode' : 'nightMode')}
          </button>
          <button
            className="btn btn-ghost"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => signOut()}
          >
            {t(lang, 'signOut')}
          </button>
        </div>
      </aside>

      <main className="main">
        {tab === 'dashboard' && (
          <Dashboard goVerify={() => setTab('verify')} goRequests={() => setTab('requests')} />
        )}
        {tab === 'verify' && <Verification onCountChange={setPending} />}
        {tab === 'requests' && <ChurchRequests onCountChange={setPendingReqs} />}
        {tab === 'churches' && <Churches />}
      </main>

      {import.meta.env.DEV && <DebugSentry />}
    </div>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = localStorage.getItem('birhan:lang');
    return (stored === 'am' || stored === 'en') ? stored : 'am';
  });

  useEffect(() => {
    localStorage.setItem('birhan:lang', lang);
  }, [lang]);

  return (
    <I18nProvider value={{ lang, setLang }}>
      <Shell />
    </I18nProvider>
  );
}
