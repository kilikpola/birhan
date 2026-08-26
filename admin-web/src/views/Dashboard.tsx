import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

type Counts = { churches: number; members: number; pastors: number; pending: number };

export function Dashboard({ goVerify }: { goVerify: () => void }) {
  const [c, setC] = useState<Counts | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Big-table tiles (churches, members) use an O(1) planner ESTIMATE —
        // exact count(*) on a 100M-row profiles table is a full scan every load.
        // Small, indexed sets (verified pastors, pending) stay exact: the
        // partial indexes make them index lookups, not scans.
        const head = { count: 'exact' as const, head: true };
        const [est, pastors, pending] = await Promise.all([
          supabase.rpc('platform_estimated_counts'),
          supabase.from('profiles').select('*', head).eq('role', 'pastor'),
          supabase.from('profiles').select('*', head).eq('pastor_status', 'pending'),
        ]);
        const firstErr = [est, pastors, pending].find((r) => r.error)?.error;
        if (firstErr) throw firstErr;
        const row = Array.isArray(est.data) ? est.data[0] : est.data;
        setC({
          churches: Number(row?.churches ?? 0),
          members: Number(row?.members ?? 0),
          pastors: pastors.count ?? 0,
          pending: pending.count ?? 0,
        });
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    })();
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>Platform at a glance</h1>
          <p>Live counts across every church on Birhan.</p>
        </div>
      </div>

      {err && <div className="banner">Couldn't load stats: {err}</div>}

      <div className="stats">
        <div className="stat">
          <div className="k tnum">{c ? c.churches : '—'}</div>
          <div className="l">Churches</div>
        </div>
        <div className="stat">
          <div className="k tnum">{c ? '≈ ' + c.members.toLocaleString() : '—'}</div>
          <div className="l">Members (estimated)</div>
        </div>
        <div className="stat">
          <div className="k tnum">{c ? c.pastors : '—'}</div>
          <div className="l">Verified pastors</div>
        </div>
        <div className={'stat' + (c && c.pending > 0 ? ' alert' : '')}>
          <div className="k tnum">{c ? c.pending : '—'}</div>
          <div className="l">Pastors awaiting review</div>
        </div>
      </div>

      {c && c.pending > 0 && (
        <div className="row" style={{ borderColor: 'color-mix(in srgb, var(--amber) 40%, transparent)' }}>
          <div>
            <div className="who-name">
              {c.pending} pastor{c.pending > 1 ? 's are' : ' is'} waiting to be verified
            </div>
            <div className="who-meta">Review their documents and approve or reject.</div>
          </div>
          <div className="row-actions">
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={goVerify}>
              Open the queue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
