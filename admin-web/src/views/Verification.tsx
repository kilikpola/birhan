import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import type { PastorApplication, PastorStatus, BranchChoice } from '../types';
import { useI18n, t } from '../i18n';
import { BranchChoiceModal } from '../components/BranchChoiceModal';
import { Avatar } from '../components/Avatar';
import { SkeletonRows } from '../components/Skeleton';
import { timeAgo } from '../lib/format';

type Filter = PastorStatus;

export function Verification({ onCountChange }: { onCountChange?: (pending: number) => void }) {
  const { lang } = useI18n();
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<PastorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PastorApplication | null>(null);
  const [approving, setApproving] = useState<PastorApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch<{ applications: PastorApplication[] }>(
        `/api/v1/admin/pastor-applications?status=${filter}`,
      );
      setRows(data.applications ?? []);
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

  const viewDoc = async (r: PastorApplication) => {
    if (!r.pastorDocPath) return;
    try {
      const data = await apiFetch<{ url: string }>(`/api/v1/admin/pastor-applications/${r.id}/document`);
      window.open(data.url, '_blank', 'noopener');
    } catch (e: any) {
      alert('Could not open document: ' + (e?.message ?? 'unknown error'));
    }
  };

  const confirmApprove = async (choice: BranchChoice) => {
    if (!approving) return;
    setBusyId(approving.id);
    try {
      await apiFetch(`/api/v1/admin/pastor-applications/${approving.id}/approve`, {
        method: 'POST',
        body: choice,
      });
      setApproving(null);
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
      await apiFetch(`/api/v1/admin/pastor-applications/${rejecting.id}/reject`, {
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
          <div className="eyebrow">{t(lang, 'verification')}</div>
          <h1 className="serif">{t(lang, 'verificationQueue')}</h1>
          <p>{t(lang, 'verificationDesc')}</p>
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
          <span className="empty-ico" aria-hidden>{filter === 'pending' ? '☑️' : '📭'}</span>
          {t(lang, 'nothingHere')}
        </div>
      ) : (
        <div className="rows">
          {rows.map((r) => (
            <div className="row" key={r.id}>
              <div className="who">
                <Avatar name={r.displayName} />
                <div className="who-body">
                  <div className="who-name">{r.displayName}</div>
                  <div className="who-meta">
                    <b>{r.churchName ?? 'No church'}</b>
                    {r.branchName ? <span>· {r.branchName}</span> : null}
                    {r.pastorBranchName ? <span>· {r.pastorBranchName}</span> : null}
                    {r.churchRole ? <span>· {r.churchRole}</span> : null}
                    {r.email ? <span>· {r.email}</span> : null}
                    {r.pastorRequestedAt
                      ? <span>· {t(lang, 'requestedAgo').replace('%s', timeAgo(r.pastorRequestedAt, lang))}</span>
                      : null}
                    {r.pastorStatus === 'rejected' && r.pastorRejectedReason
                      ? <span>· {r.pastorRejectedReason}</span>
                      : null}
                  </div>
                </div>
              </div>
              <div className="row-actions">
                <span className={'chip dot ' + (r.pastorStatus ?? 'pending')}>{t(lang, r.pastorStatus ?? 'pending')}</span>
                <button className="btn btn-ghost" onClick={() => viewDoc(r)} disabled={!r.pastorDocPath}>
                  {r.pastorDocPath ? t(lang, 'viewDoc') : t(lang, 'noDoc')}
                </button>
                {filter === 'pending' && (
                  <>
                    <button className="btn btn-good" onClick={() => setApproving(r)} disabled={busyId === r.id}>
                      {t(lang, 'approve')}
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

      {approving && (
        <BranchChoiceModal
          title={t(lang, 'makePastorTitle').replace('%s', approving.displayName)}
          churchId={approving.churchId}
          currentBranchId={approving.branchId}
          keepLabel={approving.pastorBranchName
            ? `${t(lang, 'branchNew')}: ${approving.pastorBranchName}`
            : t(lang, 'branchKeep')}
          busy={busyId === approving.id}
          onCancel={() => setApproving(null)}
          onConfirm={confirmApprove}
        />
      )}

      {rejecting && (
        <div className="modal-back" onClick={() => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(lang, 'rejectTitle')}</h3>
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