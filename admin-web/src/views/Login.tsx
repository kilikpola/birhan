import { useState } from 'react';
import { useAuth } from '../auth';

export function Login({ unauthorized }: { unauthorized?: boolean }) {
  const { signIn, signOut } = useAuth();
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
          <div className="login-sub">Admin</div>
          <p className="login-title" style={{ marginTop: 22 }}>
            This account is signed in, but it isn't a <b style={{ color: 'var(--gold)' }}>super&nbsp;admin</b>.
            The console is limited to platform administrators.
          </p>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => signOut()}>
            Sign out
          </button>
          <p className="note">
            To grant access, run in Supabase SQL:<br />
            <code style={{ color: 'var(--ink-soft)' }}>
              update profiles set role='super_admin' where id='…';
            </code>
            <br />then sign out and back in so the JWT re-stamps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/birhanlogo.png" alt="Birhan" />
        <div className="login-sub">Admin Console</div>
        <p className="login-title">Sign in with your super-admin account</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@birhan.app"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
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
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {err && <div className="err">{err}</div>}
        <p className="note">Access is enforced by Supabase row-level security, not by this page.</p>
      </form>
    </div>
  );
}
