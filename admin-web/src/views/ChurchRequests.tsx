import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { ChurchRequest, RequestStatus } from '../types';
import { useI18n, t } from '../i18n';
import { Avatar } from '../components/Avatar';
import { SkeletonRows } from '../components/Skeleton';
import { timeAgo } from '../lib/format';

type Filter = RequestStatus;

export function ChurchRequests({ onCountChange }: { onCountChange?: (pending: number) => void }) {
  const { lang } = useI18n();
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<ChurchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ChurchRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch<{ requests: ChurchRequest[] }>(
        `/api/v1/admin/church-requests?status=${filter}`,
      );
      setRows(data.requests ?? []);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setRows([]);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (filter === 'pending') onCountChange?.(rows.length);
  }, [filter, rows.length, onCountChange]);

  const approve = async (r: ChurchRequest) => {
    setBusyId(r.id);
    try {
      await apiFetch(`/api/v1/admin/church-requests/${r.id}/approve`, { method: 'POST' });
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
    try {
      await apiFetch(`/api/v1/admin/church-requests/${rejecting.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason.trim() || 'Not specified' },
      });
      load();
    } catch (e: any) {
      alert('Reject failed: ' + (e?.message ?? String(e)));
    } finally {
      setBusyId(null);
      setRejecting(null);
      setRejectReason('');
    }
  };

  const filters: Filter[] = ['pending', 'approved', 'rejected'];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t(lang, 'churchRequests')}</div>
          <h1 className="serif">{t(lang, 'newChurchRequests')}</h1>
          <p>{t(lang, 'churchRequestsDesc')}</p>
        </div>
      </div>

      <div className="filter-bar">
        {filters.map((f) => (
          <button
            key={f}
            className={'btn ' + (filter === f ? 'btn-primary' : 'btn-ghost')}
            style={filter === f ? { width: 'auto' } : undefined}
            onClick={() => setFilter(f)}
          >
            {t(lang, f)}
          </button>
        ))}
      </div>

      {err && <div className="banner">{t(lang, 'couldNotLoad')}: {err}</div>}

      {loading ? (
        <SkeletonRows n={4} />
      ) : rows.length === 0 ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden>{filter === 'pending' ? '📨' : '📭'}</span>
          {t(lang, 'nothingHere')}
        </div>
      ) : (
        <div className="rows">
          {rows.map((r) => (
            <div className="row" key={r.id}>
              <div className="who">
                <Avatar name={r.nameEn || r.nameAm || '?'} square />
                <div className="who-body">
                  <div className="who-name serif">{r.nameEn}</div>
                  <div className="who-meta">
                    {r.nameAm ? <span>{r.nameAm} ·</span> : null}
                    {r.city ? <span>{r.city} ·</span> : null}
                    {r.denomination ? <span>{r.denomination} ·</span> : null}
                    <span>{t(lang, 'requestedBy')} <b>{r.requesterName ?? '—'}</b></span>
                    <span>· {timeAgo(r.createdAt, lang)}</span>
                    {r.status === 'rejected' && r.rejectedReason ? <span>· {r.rejectedReason}</span> : null}
                  </div>
                </div>
              </div>
              <div className="row-actions">
                <span className={'chip dot ' + r.status}>{t(lang, r.status)}</span>
                {filter === 'pending' && (
                  <>
                    <button className="btn btn-good" onClick={() => approve(r)} disabled={busyId === r.id}>
                      {t(lang, 'approveCreateChurch')}
                    </button>
                    <button className="btn btn-bad" onClick={() => setRejecting(r)} disabled={busyId === r.id}>
                      {t(lang, 'reject')}
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
            <h3>{t(lang, 'rejectChurchReq')}</h3>
            <p>{t(lang, 'rejectNote')}</p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t(lang, 'rejectReason')}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRejecting(null)}>{t(lang, 'cancel')}</button>
              <button className="btn btn-bad" onClick={confirmReject} disabled={busyId === rejecting.id}>
                {t(lang, 'confirmReject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}