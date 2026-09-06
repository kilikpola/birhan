import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import type { Branch, Church, ChurchPerson, BranchChoice, Role } from '../types';
import { useI18n, t } from '../i18n';
import { BranchChoiceModal } from '../components/BranchChoiceModal';
import { Avatar } from '../components/Avatar';
import { SkeletonRows } from '../components/Skeleton';
import { timeAgo } from '../lib/format';

const ROLE_KEY: Record<Role, string> = {
  member: 'roleLabelMember',
  pending_pastor: 'roleLabelPendingPastor',
  pastor: 'roleLabelPastor',
  admin: 'roleLabelAdmin',
  super_admin: 'roleLabelSuperAdmin',
};

export function ChurchDetail({ church, onBack }: { church: Church; onBack: () => void }) {
  const { lang } = useI18n();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [people, setPeople] = useState<ChurchPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // Add-branch inline form
  const [addingBranch, setAddingBranch] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchKind, setBranchKind] = useState<'mother' | 'child'>('mother');
  const [branchParentId, setBranchParentId] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);

  // Row action state
  const [busyId, setBusyId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<ChurchPerson | null>(null);
  const [removing, setRemoving] = useState<ChurchPerson | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const mothers = branches.filter((b) => !b.parentBranchId);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [b, p] = await Promise.all([
        apiFetch<{ branches: Branch[] }>(`/api/v1/admin/churches/${church.id}/branches`),
        apiFetch<{ people: ChurchPerson[] }>(`/api/v1/admin/churches/${church.id}/people`),
      ]);
      setBranches(b.branches ?? []);
      setPeople(p.people ?? []);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
    setLoading(false);
  }, [church.id]);

  useEffect(() => { load(); }, [load]);

  const resetBranchForm = () => {
    setAddingBranch(false);
    setBranchName('');
    setBranchKind('mother');
    setBranchParentId('');
  };

  const addBranch = async () => {
    const name = branchName.trim();
    if (!name) return;
    // A child must name its mother.
    if (branchKind === 'child' && !branchParentId) return;
    setBranchBusy(true);
    try {
      await apiFetch(`/api/v1/admin/churches/${church.id}/branches`, {
        method: 'POST',
        body: {
          nameEn: name,
          nameAm: name,
          ...(branchKind === 'child' ? { parentBranchId: branchParentId } : {}),
        },
      });
      resetBranchForm();
      await load();
    } catch (e: any) {
      alert(t(lang, 'couldNotLoad') + ': ' + (e?.message ?? String(e)));
    } finally {
      setBranchBusy(false);
    }
  };

  const confirmDeleteBranch = async () => {
    if (!deletingBranch) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/v1/admin/churches/${church.id}/branches/${deletingBranch.id}`, {
        method: 'DELETE',
      });
      setDeletingBranch(null);
      await load();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmMakePastor = async (choice: BranchChoice) => {
    if (!promoting) return;
    setBusyId(promoting.id);
    try {
      await apiFetch(`/api/v1/admin/people/${promoting.id}/make-pastor`, {
        method: 'POST',
        body: choice,
      });
      setPromoting(null);
      await load();
    } catch (e: any) {
      alert((e?.message ?? String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemovePastor = async () => {
    if (!removing) return;
    setBusyId(removing.id);
    try {
      await apiFetch(`/api/v1/admin/people/${removing.id}/remove-pastor`, { method: 'POST' });
      setRemoving(null);
      await load();
    } catch (e: any) {
      alert((e?.message ?? String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return people;
    return people.filter((p) =>
      p.displayName.toLowerCase().includes(s) ||
      (p.email ?? '').toLowerCase().includes(s) ||
      (p.churchRole ?? '').toLowerCase().includes(s),
    );
  }, [people, q]);

  return (
    <div>
      <button className="back-link" onClick={onBack}>{t(lang, 'backToChurches')}</button>

      <div className="page-head">
        <div>
          <div className="eyebrow">{church.nameEn}{church.city ? ` · ${church.city}` : ''}</div>
          <h1 className="serif">{church.nameAm}</h1>
          <p>{t(lang, 'peopleCount').replace('%s', String(church.memberCount))}</p>
        </div>
      </div>

      {err && <div className="banner">{t(lang, 'couldNotLoad')}: {err}</div>}

      {/* Branches */}
      <div className="section-head">
        <h2>{t(lang, 'branchesTitle')}</h2>
        {!addingBranch && (
          <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={() => setAddingBranch(true)}>
            {t(lang, 'addBranch')}
          </button>
        )}
      </div>

      {addingBranch && (
        <div className="branch-form">
          <input
            autoFocus
            placeholder={t(lang, 'branchNameEn')}
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBranch(); }}
          />
          <div className="branch-kind-label">{t(lang, 'branchKind')}</div>
          <div className="branch-kind">
            <label className={'kind-opt' + (branchKind === 'mother' ? ' on' : '')}>
              <input type="radio" name="branchKind" checked={branchKind === 'mother'} onChange={() => setBranchKind('mother')} />
              <span><b>{t(lang, 'branchMother')}</b><small>{t(lang, 'branchMotherHint')}</small></span>
            </label>
            <label className={'kind-opt' + (branchKind === 'child' ? ' on' : '') + (mothers.length === 0 ? ' disabled' : '')}>
              <input type="radio" name="branchKind" checked={branchKind === 'child'} disabled={mothers.length === 0} onChange={() => setBranchKind('child')} />
              <span><b>{t(lang, 'branchChild')}</b><small>{mothers.length === 0 ? t(lang, 'branchNoMothers') : t(lang, 'branchChildHint')}</small></span>
            </label>
          </div>
          {branchKind === 'child' && mothers.length > 0 && (
            <select value={branchParentId} onChange={(e) => setBranchParentId(e.target.value)}>
              <option value="">— {t(lang, 'branchParent')} —</option>
              {mothers.map((m) => <option key={m.id} value={m.id}>{m.nameEn}</option>)}
            </select>
          )}
          <div className="branch-form-actions">
            <button className="btn btn-ghost" style={{ width: 'auto' }} onClick={resetBranchForm}>{t(lang, 'cancel')}</button>
            <button
              className="btn btn-good"
              style={{ width: 'auto' }}
              onClick={addBranch}
              disabled={branchBusy || !branchName.trim() || (branchKind === 'child' && !branchParentId)}
            >
              {branchBusy ? t(lang, 'adding') : t(lang, 'add')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="branch-chips" aria-hidden>
          {[120, 90, 140].map((w, i) => (
            <span className="chip shimmer" key={i} style={{ width: w, color: 'transparent', borderColor: 'transparent' }}>·</span>
          ))}
        </div>
      ) : branches.length === 0 ? (
        <div className="empty" style={{ padding: '30px 20px' }}>
          <span className="empty-ico" aria-hidden>🌿</span>
          {t(lang, 'noBranchesYet')}
        </div>
      ) : (
        <div className="branch-list">
          {mothers.map((m) => {
            const kids = branches.filter((b) => b.parentBranchId === m.id);
            const renderNode = (b: Branch, isMother: boolean, childCount: number) => {
              const peopleOn = people.filter((p) => p.branchId === b.id).length;
              return (
                <div className={'branch-node' + (isMother ? '' : ' child')} key={b.id}>
                  <div className="branch-node-name">
                    <span className="serif">{b.nameEn}</span>
                    {isMother && childCount > 0 && <span className="chip role">{t(lang, 'motherLabel')}</span>}
                  </div>
                  <div className="branch-node-meta">
                    {peopleOn > 0 ? <span className="chip tnum">{peopleOn} {t(lang, 'peopleTitle')}</span> : null}
                    <button
                      className="branch-del"
                      title={t(lang, 'deleteBranch')}
                      aria-label={t(lang, 'deleteBranch')}
                      onClick={() => setDeletingBranch(b)}
                    >✕</button>
                  </div>
                </div>
              );
            };
            return (
              <div className="branch-group" key={m.id}>
                {renderNode(m, true, kids.length)}
                {kids.map((k) => renderNode(k, false, 0))}
              </div>
            );
          })}
        </div>
      )}

      {/* People */}
      <div className="section-head">
        <h2>{t(lang, 'peopleTitle')}</h2>
        <span className="count tnum">{people.length}</span>
      </div>

      {!loading && people.length > 0 && (
        <input
          style={{ maxWidth: 260, marginBottom: 14 }}
          placeholder={t(lang, 'searchPeople')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}

      {loading ? (
        <SkeletonRows n={4} />
      ) : filtered.length === 0 ? (
        <div className="empty">
          <span className="empty-ico" aria-hidden>🙋</span>
          {q.trim() ? t(lang, 'noPeopleMatch').replace('%s', q) : t(lang, 'noPeopleYet')}
        </div>
      ) : (
        <div className="rows">
          {filtered.map((p) => {
            const isAdmin = p.role === 'admin' || p.role === 'super_admin';
            const roleClass = p.role === 'pastor' ? 'approved' : p.role === 'pending_pastor' ? 'pending' : 'role';
            return (
              <div className="row" key={p.id}>
                <div className="who">
                  <Avatar name={p.displayName} />
                  <div className="who-body">
                    <div className="who-name">{p.displayName}</div>
                    <div className="who-meta">
                      {p.branchName ? <b>{p.branchName}</b> : null}
                      {p.churchRole ? <span>· {p.churchRole}</span> : null}
                      {p.email ? <span>· {p.email}</span> : null}
                      {p.createdAt ? <span>· {t(lang, 'joinedAgo').replace('%s', timeAgo(p.createdAt, lang))}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="row-actions">
                  <span className={'chip dot ' + roleClass}>{t(lang, ROLE_KEY[p.role])}</span>
                  {isAdmin ? null : p.role === 'pastor' ? (
                    <button className="btn btn-bad" style={{ width: 'auto' }} onClick={() => setRemoving(p)} disabled={busyId === p.id}>
                      {t(lang, 'removePastor')}
                    </button>
                  ) : (
                    <button className="btn btn-good" style={{ width: 'auto' }} onClick={() => setPromoting(p)} disabled={busyId === p.id}>
                      {t(lang, 'makePastor')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {promoting && (
        <BranchChoiceModal
          title={t(lang, 'makePastorTitle').replace('%s', promoting.displayName)}
          churchId={church.id}
          currentBranchId={promoting.branchId}
          keepLabel={t(lang, 'branchNone')}
          busy={busyId === promoting.id}
          onCancel={() => setPromoting(null)}
          onConfirm={confirmMakePastor}
        />
      )}

      {removing && (
        <div className="modal-back" onClick={() => setRemoving(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(lang, 'removePastorTitle').replace('%s', removing.displayName)}</h3>
            <p>{t(lang, 'removePastorNote')}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRemoving(null)}>{t(lang, 'cancel')}</button>
              <button className="btn btn-bad" onClick={confirmRemovePastor} disabled={busyId === removing.id}>
                {t(lang, 'confirmRemove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingBranch && (() => {
        const kids = branches.filter((b) => b.parentBranchId === deletingBranch.id).length;
        const peopleOn = people.filter((p) => p.branchId === deletingBranch.id).length;
        return (
          <div className="modal-back" onClick={() => setDeletingBranch(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>{t(lang, 'deleteBranchTitle').replace('%s', deletingBranch.nameEn)}</h3>
              <p>
                {kids > 0
                  ? t(lang, 'deleteBranchHasChildren')
                  : peopleOn > 0
                    ? t(lang, 'deleteBranchPeople').replace('%s', String(peopleOn))
                    : t(lang, 'deleteBranchEmpty')}
              </p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setDeletingBranch(null)}>{t(lang, 'cancel')}</button>
                <button
                  className="btn btn-bad"
                  onClick={confirmDeleteBranch}
                  disabled={deleteBusy || kids > 0}
                >
                  {t(lang, 'confirmDeleteBranch')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
