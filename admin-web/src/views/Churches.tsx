import { useEffect, useState } from 'react';
import { supabase, type Church } from '../supabase';

export function Churches() {
  const [rows, setRows] = useState<Church[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('churches')
        .select('*')
        .order('member_count', { ascending: false })
        .limit(500);
      if (error) setErr(error.message);
      else setRows((data as Church[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((c) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      c.name_en?.toLowerCase().includes(s) ||
      c.name_am?.includes(q) ||
      (c.city ?? '').toLowerCase().includes(s) ||
      (c.denomination ?? '').toLowerCase().includes(s)
    );
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Directory</div>
          <h1>Churches</h1>
          <p>Every church registered on the platform, busiest first.</p>
        </div>
        <input
          style={{ maxWidth: 240 }}
          placeholder="Search name, city, denomination…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {err && <div className="banner">Couldn't load churches: {err}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No churches match “{q}”.</div>
      ) : (
        <div className="rows">
          {filtered.map((c) => (
            <div className="row" key={c.id}>
              <div>
                <div className="who-name serif">{c.name_am}</div>
                <div className="who-meta">
                  <b>{c.name_en}</b>
                  {c.denomination ? ` · ${c.denomination}` : ''}
                  {c.city ? ` · ${c.city}` : ''}
                </div>
              </div>
              <div className="row-actions">
                {c.telegram_chat_id ? <span className="chip approved">Telegram linked</span> : null}
                <span className="chip role tnum">{c.member_count} members</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
