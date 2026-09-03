import { useState } from 'react';
import { useAuth } from '../auth';
import { useI18n, t } from '../i18n';

export function Login({ unauthorized }: { unauthorized?: boolean }) {
  const { signIn, signOut } = useAuth();
  const { lang } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await signIn(email.trim(), password);
    setBusy(false);
    if (res.error) setErr(res.error);
  };

  if (unauthorized) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <img className="login-logo" src="/birhanlogo.png" alt="Birhan" />
          <div className="login-sub">{t(lang, 'admin')}</div>
          <p className="login-title" style={{ marginTop: 22 }}>
            {t(lang, 'accessDeniedBefore')}
            <b style={{ color: 'var(--accent)' }}>{t(lang, 'accessDeniedRole')}</b>
            {t(lang, 'accessDeniedAfter')}
          </p>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => signOut()}>
            {t(lang, 'signOut')}
          </button>
          <p className="note">
            {t(lang, 'accessDeniedNote')}<br />
            <code style={{ color: 'var(--text-soft)' }}>
              {t(lang, 'superAdmin')}
            </code>
            <br />{t(lang, 'thenSignOut')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/birhanlogo.png" alt="Birhan" />
        <div className="login-sub">{t(lang, 'signInSubtitle')}</div>
        <p className="login-title">{t(lang, 'signInTitle')}</p>

        <label className="field">
          <span>{t(lang, 'email')}</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@birhan.online"
            required
          />
        </label>
        <label className="field">
          <span>{t(lang, 'password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </label>

        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? t(lang, 'signingIn') : t(lang, 'signIn')}
        </button>
        {err && <div className="err">{err}</div>}
        <p className="note">{t(lang, 'signInNote')}</p>
      </form>
    </div>
  );
}
