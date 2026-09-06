import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { Church } from '../types';
import { useI18n, t } from '../i18n';
import { ChurchDetail } from './ChurchDetail';

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
        <div className="loading">{t(lang, 'loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="empty">{t(lang, 'noChurches').replace('%s', q)}</div>
      ) : (
        <div className="rows">
          {filtered.map((c) => (
            <div
              className="row"
              key={c.id}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(c)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c); } }}
            >
              <div>
                <div className="who-name serif">{c.nameAm}</div>
                <div className="who-meta">
                  <b>{c.nameEn}</b>
                  {c.denomination ? ` · ${c.denomination}` : ''}
                  {c.city ? ` · ${c.city}` : ''}
                </div>
              </div>
              <div className="row-actions">
                {c.telegramChatId ? <span className="chip approved">{t(lang, 'telegramLinked')}</span> : null}
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