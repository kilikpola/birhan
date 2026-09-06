import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { PlatformStats } from '../types';
import { useI18n, t } from '../i18n';

export function Dashboard({ goVerify, goRequests }: { goVerify: () => void; goRequests: () => void }) {
  const { lang } = useI18n();
  const [c, setC] = useState<PlatformStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<PlatformStats>('/api/v1/admin/stats');
        setC(data);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t(lang, 'overview')}</div>
          <h1 className="serif">{t(lang, 'platformGlance')}</h1>
          <p>{t(lang, 'liveCounts')}</p>
        </div>
      </div>

      {err && <div className="banner">{t(lang, 'couldNotLoad')}: {err}</div>}

      <div className="stats">
        <div className="stat">
          <span className="stat-ico" aria-hidden>⛪</span>
          <div className="stat-body">
            <div className="k tnum serif">{c ? c.churches : '—'}</div>
            <div className="l">{t(lang, 'churches')}</div>
          </div>
        </div>
        <div className="stat">
          <span className="stat-ico" aria-hidden>👥</span>
          <div className="stat-body">
            <div className="k tnum serif">{c ? c.members.toLocaleString() : '—'}</div>
            <div className="l">{t(lang, 'members')}</div>
          </div>
        </div>
        <div className="stat">
          <span className="stat-ico" aria-hidden>✝️</span>
          <div className="stat-body">
            <div className="k tnum serif">{c ? c.pastors : '—'}</div>
            <div className="l">{t(lang, 'verifiedPastors')}</div>
          </div>
        </div>
        <div className={'stat' + (c && c.pending > 0 ? ' alert' : '')}>
          <span className="stat-ico" aria-hidden>⏳</span>
          <div className="stat-body">
            <div className="k tnum serif">{c ? c.pending : '—'}</div>
            <div className="l">{t(lang, 'pendingReview')}</div>
          </div>
        </div>
        <div className={'stat' + (c && c.pendingChurchRequests > 0 ? ' alert' : '')}>
          <span className="stat-ico" aria-hidden>📨</span>
          <div className="stat-body">
            <div className="k tnum serif">{c ? c.pendingChurchRequests : '—'}</div>
            <div className="l">{t(lang, 'pendingChurchRequests')}</div>
          </div>
        </div>
      </div>

      {c && c.pending > 0 && (
        <div className="row" style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}>
          <div>
            <div className="who-name serif">
              {c.pending} {t(lang, 'pastorAwaitingReview')}
            </div>
            <div className="who-meta">{t(lang, 'reviewDocsApprove')}</div>
          </div>
          <div className="row-actions">
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={goVerify}>
              {t(lang, 'openQueue')}
            </button>
          </div>
        </div>
      )}

      {c && c.pendingChurchRequests > 0 && (
        <div className="row" style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)' }}>
          <div>
            <div className="who-name serif">
              {c.pendingChurchRequests} {t(lang, 'churchRequestsAwaiting')}
            </div>
            <div className="who-meta">{t(lang, 'reviewChurchRequests')}</div>
          </div>
          <div className="row-actions">
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={goRequests}>
              {t(lang, 'openRequests')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}