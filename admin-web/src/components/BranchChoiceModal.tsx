import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';
import type { Branch, BranchChoice } from '../types';
import { useI18n, t } from '../i18n';

const KEEP = '__keep__';
const NEW = '__new__';

/**
 * Picks the branch a pastor leads, scoped to one church.
 *
 * Shared by the make-pastor flow (church drill-in) and the approve flow
 * (verification queue) so both settle the branch the same way. The caller gets
 * back a {@link BranchChoice}: an existing `branchId`, a `newBranchName` to
 * create, or an empty object meaning "leave the branch as it is".
 */
export function BranchChoiceModal({
  title,
  churchId,
  currentBranchId,
  keepLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  churchId: string;
  currentBranchId?: string | null;
  /** Label for the "don't change the branch" option (e.g. "No branch" / "Leave as is"). */
  keepLabel: string;
  onConfirm: (choice: BranchChoice) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { lang } = useI18n();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string>(currentBranchId || KEEP);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiFetch<{ branches: Branch[] }>(
          `/api/v1/admin/churches/${churchId}/branches`,
        );
        if (!alive) return;
        setBranches(data.branches ?? []);
      } catch (e: any) {
        if (!alive) return;
        setLoadErr(e?.message ?? String(e));
        setBranches([]);
      }
    })();
    return () => { alive = false; };
  }, [churchId]);

  const canConfirm = useMemo(() => {
    if (busy) return false;
    if (sel === NEW) return newName.trim().length > 0;
    return true;
  }, [busy, sel, newName]);

  const confirm = () => {
    if (sel === NEW) onConfirm({ newBranchName: newName.trim() });
    else if (sel === KEEP) onConfirm({});
    else onConfirm({ branchId: sel });
  };

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{t(lang, 'branchLead')}</p>

        {loadErr && <div className="banner">{t(lang, 'couldNotLoad')}: {loadErr}</div>}

        {branches === null ? (
          <div className="loading">{t(lang, 'loading')}</div>
        ) : (
          <div className="branch-opts">
            {branches.map((b) => (
              <label className="branch-opt" key={b.id}>
                <input
                  type="radio"
                  name="branch"
                  checked={sel === b.id}
                  onChange={() => setSel(b.id)}
                />
                <span>{b.nameEn}{b.nameAm && b.nameAm !== b.nameEn ? ` · ${b.nameAm}` : ''}</span>
              </label>
            ))}

            <label className="branch-opt">
              <input
                type="radio"
                name="branch"
                checked={sel === NEW}
                onChange={() => setSel(NEW)}
              />
              <span>{t(lang, 'branchNew')}</span>
            </label>
            {sel === NEW && (
              <input
                autoFocus
                style={{ marginTop: 4 }}
                placeholder={t(lang, 'branchNameEn')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) confirm(); }}
              />
            )}

            <label className="branch-opt">
              <input
                type="radio"
                name="branch"
                checked={sel === KEEP}
                onChange={() => setSel(KEEP)}
              />
              <span>{keepLabel}</span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>{t(lang, 'cancel')}</button>
          <button className="btn btn-good" onClick={confirm} disabled={!canConfirm}>
            {busy ? t(lang, 'working') : t(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
