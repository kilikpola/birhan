import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError, OfflineError } from './api';
import { useAuth } from './auth';
import { getLocalDb, runExclusive, runTransactionExclusive } from '../utils/db';
import { reportError } from './errors';
import { postAnnouncementToTelegram } from './telegram';

export type Announcement = {
  id: string;
  church_id: string;
  title_am: string | null;
  title_en: string | null;
  body: string;
  locked: boolean;
  posted_to_telegram: boolean;
  created_at: string;
  reply_count?: number;
};

export type Reply = {
  id: string;
  announcement_id: string;
  author_id: string;
  author_name: string;
  text: string;
  created_at: string;
  pending?: boolean; // true = still in outbox, not yet on server
};

/** GET /api/v1/announcements returns camelCase rows — flattened to match the
 * snake_case shape every screen already reads. */
function normalizeAnnouncement(raw: any): Announcement {
  return {
    id: raw.id,
    church_id: raw.churchId,
    title_am: raw.titleAm ?? null,
    title_en: raw.titleEn ?? null,
    body: raw.body,
    locked: raw.locked,
    posted_to_telegram: raw.postedToTelegram,
    created_at: raw.createdAt,
    reply_count: raw.replyCount ?? 0,
  };
}

function normalizeReply(raw: any): Reply {
  return {
    id: raw.id,
    announcement_id: raw.announcementId,
    author_id: raw.authorId,
    author_name: raw.authorName,
    text: raw.text,
    created_at: raw.createdAt,
  };
}

async function cacheAnnouncements(rows: Announcement[]) {
  const d = await getLocalDb();
  await runTransactionExclusive(d, async () => {
    for (const a of rows) {
      await d.runAsync(
        `INSERT OR REPLACE INTO ann_cache
         (id, church_id, title_am, title_en, body, locked, posted_to_telegram, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [a.id, a.church_id, a.title_am, a.title_en, a.body,
         a.locked ? 1 : 0, a.posted_to_telegram ? 1 : 0, a.created_at],
      );
    }
  });
}

async function readCachedAnnouncements(): Promise<Announcement[]> {
  const d = await getLocalDb();
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM ann_cache ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    ...r, locked: !!r.locked, posted_to_telegram: !!r.posted_to_telegram,
  }));
}

export function useAnnouncements() {
  const { session } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [online, setOnline] = useState(false);

  const load = useCallback(async () => {
    try {
      // Show cached immediately (works offline).
      setItems(await readCachedAnnouncements());
      // Then refresh from server if we can. Bounded: a member reads the most
      // recent announcements, not a church's entire multi-year history. Older
      // ones stay reachable in the cache; the server list is capped so app-open
      // is O(50), not O(all announcements ever).
      const res = await apiFetch<{ announcements: any[] }>('/api/v1/announcements?limit=50');
      const mapped = res.announcements.map(normalizeAnnouncement);
      setItems(mapped);
      await cacheAnnouncements(mapped);
    } catch (err) {
      if (!(err instanceof OfflineError)) {
        reportError(err, 'Announcements.load', 'am', false);
      }
    }
  }, []);

  useEffect(() => {
    load().catch((err) => reportError(err, 'useAnnouncements.load', 'am', false));
    const unsub = NetInfo.addEventListener((s) => {
      const up = Boolean(s.isConnected && s.isInternetReachable !== false);
      setOnline(up);
      if (up) {
        flushOutbox()
          .then(load)
          .catch((err) => reportError(err, 'NetInfo.flushOutbox', 'am', false));
      }
    });
    return () => unsub();
  }, [load, session]);

  return { items, online, reload: load };
}

/* ---------- replies ---------- */

export async function fetchReplies(annId: string): Promise<Reply[]> {
  const d = await getLocalDb();

  let server: Reply[];
  try {
    // There is no standalone replies-list endpoint — replies come bundled
    // with the announcement, bounded server-side (replyLimit, default 200).
    const res = await apiFetch<{ replies: any[] }>(`/api/v1/announcements/${annId}?replyLimit=200`);
    server = res.replies.map(normalizeReply);
    // Cache this thread so it's readable offline next time. Replace the whole
    // thread so deletions on the server are reflected locally too.
    await runTransactionExclusive(d, async () => {
      await d.runAsync(`DELETE FROM replies_cache WHERE announcement_id = ?`, [annId]);
      for (const r of server) {
        await d.runAsync(
          `INSERT OR REPLACE INTO replies_cache
           (id, announcement_id, author_id, author_name, text, created_at)
           VALUES (?,?,?,?,?,?)`,
          [r.id, r.announcement_id, r.author_id, r.author_name, r.text, r.created_at],
        );
      }
    });
  } catch (err) {
    if (!(err instanceof OfflineError)) reportError(err, 'fetchReplies', 'am', false);
    // Offline or failed — fall back to the cached thread.
    const cached = await d.getAllAsync<any>(
      `SELECT * FROM replies_cache WHERE announcement_id = ? ORDER BY created_at`,
      [annId],
    );
    server = cached as Reply[];
  }

  const pending = await d.getAllAsync<any>(
    `SELECT * FROM outbox WHERE announcement_id = ? ORDER BY created_at`, [annId],
  );
  const pend: Reply[] = pending.map((p) => ({ ...p, pending: true }));
  return [...server, ...pend];
}

export async function queueReply(r: {
  announcementId: string; authorId: string; authorName: string; text: string;
}) {
  const d = await getLocalDb();
  const id = `local_${Date.now()}`;
  await runExclusive(async () => {
    await d.runAsync(
      `INSERT INTO outbox (id, announcement_id, author_id, author_name, text, created_at)
       VALUES (?,?,?,?,?,?)`,
      [id, r.announcementId, r.authorId, r.authorName, r.text, new Date().toISOString()],
    );
  });
  await flushOutbox().catch((err) => reportError(err, 'queueReply.flushOutbox', 'am', false));
}

let _flushing = false;
export async function flushOutbox() {
  if (_flushing) return;
  _flushing = true;
  try {
    const d = await getLocalDb();
    const rows = await d.getAllAsync<any>(`SELECT * FROM outbox ORDER BY created_at`);
    for (const row of rows) {
      // The server derives author_name from the caller's own profile — it
      // isn't accepted from the client, so only `text` goes out.
      try {
        await apiFetch(`/api/v1/announcements/${row.announcement_id}/replies`, {
          method: 'POST',
          body: { text: row.text },
        });
        await runExclusive(async () => {
          await d.runAsync(`DELETE FROM outbox WHERE id = ?`, [row.id]);
        });
      } catch (err) {
        if (err instanceof OfflineError) break; // stop on first failure, retry later
        const attempts = (row.attempts ?? 0) + 1;
        await runExclusive(async () => {
          if (attempts >= 5) await d.runAsync(`DELETE FROM outbox WHERE id = ?`, [row.id]);
          else await d.runAsync(`UPDATE outbox SET attempts = ? WHERE id = ?`, [attempts, row.id]);
        });
        break; // stop on first failure
      }
    }
  } finally {
    _flushing = false;
  }
}

/* ---------- pastor: publish & delete ---------- */

export async function publishAnnouncement(a: {
  churchId: string;
  authorId: string;
  title: string;
  body: string;
  postToTelegram?: boolean;
}): Promise<{
  data?: Announcement;
  error?: string;
  telegramSuccess?: boolean;
  telegramError?: string;
}> {
  let created: Announcement;
  try {
    // The backend stores separate Amharic/English titles; every current
    // caller only collects one title, so it goes into both — same behaviour
    // as before this rewrite (title_am and title_en were always identical).
    const raw = await apiFetch<any>('/api/v1/announcements', {
      method: 'POST',
      body: { titleAm: a.title, titleEn: a.title, body: a.body },
    });
    created = normalizeAnnouncement(raw);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to publish announcement' };
  }

  if (a.postToTelegram) {
    const res = await postAnnouncementToTelegram({
      announcementId: created.id,
      churchId: a.churchId,
      title: a.title,
      body: a.body,
    });

    if (!res.success) {
      return {
        data: created,
        telegramSuccess: false,
        telegramError: res.error,
      };
    }

    return { data: created, telegramSuccess: true };
  }

  return { data: created };
}

export async function deleteAnnouncement(annId: string): Promise<{ error?: string }> {
  try {
    await apiFetch(`/api/v1/announcements/${annId}`, { method: 'DELETE' });
    return {};
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to delete announcement' };
  }
}

export async function toggleLock(annId: string, locked: boolean) {
  await apiFetch(`/api/v1/announcements/${annId}/lock`, {
    method: 'POST',
    body: { locked },
  });
}
