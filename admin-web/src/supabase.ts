import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.',
  );
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** Roles that are allowed into this console at all. */
export const CONSOLE_ROLES = ['super_admin'] as const;

export type Profile = {
  id: string;
  display_name: string;
  email?: string | null;
  church_id: string | null;
  branch_name: string | null;
  role: 'member' | 'pastor' | 'admin' | 'super_admin' | 'pending_pastor';
  church_role: string | null;
  pastor_status: 'pending' | 'approved' | 'rejected' | null;
  pastor_doc_path: string | null;
  pastor_rejected_reason: string | null;
  pastor_requested_at: string | null;
  is_mother_branch: boolean | null;
  created_at: string;
};

export type Church = {
  id: string;
  name_am: string;
  name_en: string;
  denomination: string | null;
  city: string | null;
  member_count: number;
  telegram_chat_id: string | null;
  created_at: string;
};

export type ChurchRequest = {
  id: string;
  requested_by: string;
  name_en: string;
  name_am: string | null;
  city: string | null;
  denomination: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_church_id: string | null;
  rejected_reason: string | null;
  created_at: string;
};
