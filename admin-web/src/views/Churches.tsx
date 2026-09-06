import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { Church } from '../types';
import { useI18n, t } from '../i18n';
import { ChurchDetail } from './ChurchDetail';
import { Avatar } from '../components/Avatar';
import { SkeletonRows } from '../components/Skeleton';

export function Churches() {
  const { lang } = useI18n();
  const [rows, setRows] = useState<Church[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Church | null>(null);

  if (selected) {
    return <ChurchDetail church={selected} onBack={() => setSelected(null)} />;
  }

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ churches: Church[] }>('/api/v1/admin/churches');
        setRows(data.churches ?? []);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((c) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      c.nameEn?.toLowerCase().includes(s) ||
      c.nameAm?.includes(q) ||
      (c.city ?? '').toLowerCase().includes(s) ||
      (c.denomination ?? '').toLowerCase().includes(s)
    );
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t(lang, 'churchList')}</div>
          <h1 className="serif">{t(lang, 'churches')}</h1>
          <p>{t(lang, 'everyChurch')}</p>
        </div>
        <input
          style={{ maxWidth: 240 }}
          placeholder={t(lang, 'searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {err && <div className="banner">{t(lang, 'couldNotLoad')}: {err}</div>}

      {loading ? (
        <SkeletonRows n={6} />
      ) : filtered.length === 0 ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden>⛪</span>
          {t(lang, 'noChurches').replace('%s', q)}
        </div>
      ) : (
        <div className="rows">
          {filtered.map((c) => (
            <div
              className="row"
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(c)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c); } }}
            >
              <div className="who">
                <Avatar name={c.nameEn || c.nameAm} square />
                <div className="who-body">
                  <div className="who-name serif">{c.nameAm}</div>
                  <div className="who-meta">
                    <b>{c.nameEn}</b>
                    {c.denomination ? <span>· {c.denomination}</span> : null}
                    {c.city ? <span>· {c.city}</span> : null}
                  </div>
                </div>
              </div>
              <div className="row-actions">
                {c.telegramChatId ? <span className="chip approved dot">{t(lang, 'telegramLinked')}</span> : null}
                <span className="chip role tnum">{c.memberCount} {t(lang, 'memberCount')}</span>
                <span className="chip" aria-hidden>›</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}