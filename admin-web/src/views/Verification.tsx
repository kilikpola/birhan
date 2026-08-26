import { useCallback, useEffect, useState } from 'react';
import { supabase, type Profile } from '../supabase';

type Filter = 'pending' | 'approved' | 'rejected';

export function Verification({ onCountChange }: { onCountChange?: (pending: number) => void }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<Profile[]>([]);
  const [churchNames, setChurchNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Profile | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    // Pending pastors are profiles that went through the KYC flow.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('pastor_status', filter)
      .order('pastor_requested_at', { ascending: true });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      const list = (data as Profile[]) ?? [];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.church_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: churches } = await supabase
          .from('churches')
          .select('id, name_en, name_am')
          .in('id', ids);
        const map: Record<string, string> = {};
        (churches ?? []).forEach((c: any) => (map[c.id] = c.name_en || c.name_am));
        setChurchNames(map);
      }
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the sidebar's pending badge in sync whenever the pending list loads.
  useEffect(() => {
    if (filter === 'pending') onCountChange?.(rows.length);
  }, [filter, rows.length, onCountChange]);

  const viewDoc = async (r: Profile) => {
    if (!r.pastor_doc_path) return;
    const { data, error } = await supabase.storage
      .from('pastor-docs')
      .createSignedUrl(r.pastor_doc_path, 3600);
    if (error || !data?.signedUrl) {
      alert('Could not open document: ' + (error?.message ?? 'no URL'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const approve = async (r: Profile) => {
    setBusyId(r.id);
    const { error } = await supabase
      .from('profiles')
      .update({ role: 'pastor', pastor_status: 'approved', pastor_rejected_reason: null })
      .eq('id', r.id);
    setBusyId(null);
    if (error) alert('Approve failed: ' + error.message);
    else load();
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    // Revert to member; they can re-apply. Keep the reason on record.
    const { error } = await supabase
      .from('profiles')
      .update({
        role: 'member',
        pastor_status: 'rejected',
        pastor_rejected_reason: rejectReason.trim() || 'Not specified',
      })
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
          <div className="eyebrow">Pastor verification</div>
          <h1>Verification queue</h1>
          <p>Review the document each applicant uploaded, then approve them to pastor or reject with a reason.</p>
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

      {err && <div className="banner">Couldn't load the queue: {err}</div>}

      {loading ? (
        <div className="loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Nothing {filter} right now.</div>
      ) : (
        <div className="rows">
          {rows.map((r) => (
            <div className="row" key={r.id}>
              <div>
                <div className="who-name">{r.display_name}</div>
                <div className="who-meta">
                  <b>{r.church_id ? churchNames[r.church_id] ?? '—' : 'No church'}</b>
                  {r.branch_name ? ` · ${r.branch_name}` : ''}
                  {r.church_role ? ` · ${r.church_role}` : ''}
                  {r.pastor_requested_at
                    ? ` · applied ${new Date(r.pastor_requested_at).toLocaleDateString()}`
                    : ''}
                  {r.pastor_status === 'rejected' && r.pastor_rejected_reason
                    ? ` · reason: ${r.pastor_rejected_reason}`
                    : ''}
                </div>
              </div>
              <div className="row-actions">
                <span className={'chip ' + (r.pastor_status ?? 'pending')}>{r.pastor_status ?? 'pending'}</span>
                <button className="btn btn-ghost" onClick={() => viewDoc(r)} disabled={!r.pastor_doc_path}>
                  {r.pastor_doc_path ? 'View document' : 'No document'}
                </button>
                {filter === 'pending' && (
                  <>
                    <button className="btn btn-good" onClick={() => approve(r)} disabled={busyId === r.id}>
                      Approve → pastor
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
            <h3>Reject {rejecting.display_name}?</h3>
            <p>They'll return to member and can re-apply. The reason is saved on their record.</p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Document unreadable — please re-upload a clear photo of your ordination letter."
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
