import { useCallback, useEffect, useState } from 'react';
import { supabase, type ChurchRequest } from '../supabase';

type Filter = 'pending' | 'approved' | 'rejected';

export function ChurchRequests({ onCountChange }: { onCountChange?: (pending: number) => void }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<ChurchRequest[]>([]);
  const [requesterNames, setRequesterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ChurchRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('church_requests')
      .select('*')
      .eq('status', filter)
      .order('created_at', { ascending: true });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      const list = (data as ChurchRequest[]) ?? [];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.requested_by))];
      if (ids.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', ids);
        const map: Record<string, string> = {};
        (profiles ?? []).forEach((p: any) => (map[p.id] = p.display_name));
        setRequesterNames(map);
      }
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (filter === 'pending') onCountChange?.(rows.length);
  }, [filter, rows.length, onCountChange]);

  const approve = async (r: ChurchRequest) => {
    setBusyId(r.id);
    try {
      // 1. Create the church from the requested details.
      const { data: church, error: cErr } = await supabase
        .from('churches')
        .insert({
          name_en: r.name_en,
          name_am: r.name_am || r.name_en,
          city: r.city,
          denomination: r.denomination,
        })
        .select('id')
        .single();
      if (cErr || !church) throw cErr ?? new Error('church insert failed');

      // 2. Link the requester to the new church.
      const { error: pErr } = await supabase
        .from('profiles')
        .update({ church_id: church.id })
        .eq('id', r.requested_by);
      if (pErr) throw pErr;

      // 3. Close the request.
      const { error: rErr } = await supabase
        .from('church_requests')
        .update({ status: 'approved', created_church_id: church.id, rejected_reason: null })
        .eq('id', r.id);
      if (rErr) throw rErr;

      load();
    } catch (e: any) {
      alert('Approve failed: ' + (e?.message ?? String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    const { error } = await supabase
      .from('church_requests')
      .update({ status: 'rejected', rejected_reason: rejectReason.trim() || 'Not specified' })
      .eq('id', rejecting.id);
    setBusyId(null);
    setRejecting(null);
    setRejectReason('');
    if (error) alert('Reject failed: ' + error.message);
    else load();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Church requests</div>
          <h1>New church requests</h1>
          <p>Members who picked “Other” at signup. Approving creates the church and links the member to it.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['pending', 'approved', 'rejected'] as Filter[]).map((f) => (
          <button
            key={f}
            className={'btn ' + (filter === f ? 'btn-primary' : 'btn-ghost')}
            style={filter === f ? { width: 'auto' } : undefined}
            onClick={() => setFilter(f)}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {err && <div className="banner">Couldn't load requests: {err}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Nothing {filter} right now.</div>
      ) : (
        <div className="rows">
          {rows.map((r) => (
            <div className="row" key={r.id}>
              <div>
                <div className="who-name serif">{r.name_en}</div>
                <div className="who-meta">
                  {r.name_am ? `${r.name_am} · ` : ''}
                  {r.city ? `${r.city} · ` : ''}
                  {r.denomination ? `${r.denomination} · ` : ''}
                  requested by <b>{requesterNames[r.requested_by] ?? '—'}</b>
                  {` · ${new Date(r.created_at).toLocaleDateString()}`}
                  {r.status === 'rejected' && r.rejected_reason ? ` · reason: ${r.rejected_reason}` : ''}
                </div>
              </div>
              <div className="row-actions">
                <span className={'chip ' + r.status}>{r.status}</span>
                {filter === 'pending' && (
                  <>
                    <button className="btn btn-good" onClick={() => approve(r)} disabled={busyId === r.id}>
                      Approve → create church
                    </button>
                    <button className="btn btn-bad" onClick={() => setRejecting(r)} disabled={busyId === r.id}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rejecting && (
        <div className="modal-back" onClick={() => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reject “{rejecting.name_en}”?</h3>
            <p>The member stays registered (no church linked) and can re-submit. The reason is saved.</p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. This church is already listed as “Ethiopian Kale Heywet Church” — please pick it from the list."
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn btn-bad" onClick={confirmReject} disabled={busyId === rejecting.id}>
                Confirm rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
