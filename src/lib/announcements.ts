import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { getLocalDb, runExclusive, runTransactionExclusive } from '../utils/db';
import { reportError } from './errors';

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
      const { data, error } = await supabase
        .from('announcements')
        .select('*, replies(count)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) {
        const mapped: Announcement[] = data.map((a: any) => ({
          ...a, reply_count: a.replies?.[0]?.count ?? 0,
        }));
        setItems(mapped);
        await cacheAnnouncements(mapped);
      }
    } catch (err) {
      reportError(err, 'Announcements.load', 'am', false);
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

  // Bounded: even a thread that somehow attracts thousands of replies loads a
  // capped window, not the whole thing, so one busy thread can't OOM the app.
  const { data, error } = await supabase
    .from('replies')
    .select('*')
    .eq('announcement_id', annId)
    .order('created_at', { ascending: true })
    .limit(200);

  let server: Reply[];
  if (!error && data) {
    server = data as Reply[];
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
  } else {
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
      const { error } = await supabase.from('replies').insert({
        announcement_id: row.announcement_id,
        author_id: row.author_id,
        author_name: row.author_name,
        text: row.text,
      });
      if (!error) {
        await runExclusive(async () => {
          await d.runAsync(`DELETE FROM outbox WHERE id = ?`, [row.id]);
        });
      } else {
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

import { postAnnouncementToTelegram } from './telegram';

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
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      church_id: a.churchId,
      author_id: a.authorId,
      title_am: a.title,
      title_en: a.title,
      body: a.body,
    })
    .select('*')
    .single();

  if (error || !data) {
    return { error: error?.message || 'Failed to publish announcement' };
  }

  const created = data as Announcement;

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
  const { error } = await supabase.from('announcements').delete().eq('id', annId);
  return error ? { error: error.message } : {};
}

export async function toggleLock(annId: string, locked: boolean) {
  await supabase.from('announcements').update({ locked }).eq('id', annId);
}
