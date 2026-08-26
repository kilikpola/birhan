#!/usr/bin/env node
// Post-deploy smoke test — runs against a REAL deployed environment (staging or
// production), not local mocks. Wired into the deploy workflow in Phase 3: if it
// fails, the deploy is treated as unhealthy and rolled back.
//
// Env:
//   SMOKE_SUPABASE_URL       required — https://<ref>.supabase.co
//   SMOKE_SUPABASE_ANON_KEY  required — publishable anon key
//   SMOKE_ADMIN_URL          optional — admin console URL (e.g. https://admin-staging.birhan.cc)
//   SMOKE_HEALTH_URL         optional — health Edge Function URL (added in Phase 3)
//
// Exit code is non-zero if any check fails.

const { SMOKE_SUPABASE_URL, SMOKE_SUPABASE_ANON_KEY, SMOKE_ADMIN_URL, SMOKE_HEALTH_URL } = process.env;

const TIMEOUT_MS = 10_000;
let failures = 0;

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function check(name, fn) {
  process.stdout.write(`• ${name} … `);
  try {
    await fn();
    console.log('ok');
  } catch (err) {
    failures++;
    console.log(`FAIL\n    ${err.message}`);
  }
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  must(SMOKE_SUPABASE_URL && SMOKE_SUPABASE_ANON_KEY,
    'SMOKE_SUPABASE_URL and SMOKE_SUPABASE_ANON_KEY are required');

  const base = SMOKE_SUPABASE_URL.replace(/\/$/, '');
  const authHeaders = { apikey: SMOKE_SUPABASE_ANON_KEY, Authorization: `Bearer ${SMOKE_SUPABASE_ANON_KEY}` };

  // 1. GoTrue auth service is up.
  await check('auth service health', async () => {
    const res = await get(`${base}/auth/v1/health`, { headers: authHeaders });
    must(res.ok, `expected 200, got ${res.status}`);
  });

  // 2. PostgREST reachable + the public church list reads (RLS: churches_read).
  await check('anon church-list read', async () => {
    const res = await get(`${base}/rest/v1/churches?select=id&limit=1`, { headers: authHeaders });
    must(res.ok, `expected 200, got ${res.status}`);
    const body = await res.json();
    must(Array.isArray(body), 'expected a JSON array from /rest/v1/churches');
  });

  // 3. Health Edge Function (Phase 3) — only if provided.
  if (SMOKE_HEALTH_URL) {
    await check('health endpoint', async () => {
      const res = await get(SMOKE_HEALTH_URL, { headers: authHeaders });
      must(res.ok, `expected 200, got ${res.status}`);
      const body = await res.json().catch(() => ({}));
      must(body.status === 'ok' || body.healthy === true, `unhealthy: ${JSON.stringify(body)}`);
    });
  }

  // 4. Admin console serves its shell — only if provided.
  if (SMOKE_ADMIN_URL) {
    await check('admin console loads', async () => {
      const res = await get(SMOKE_ADMIN_URL);
      must(res.ok, `expected 200, got ${res.status}`);
      const html = await res.text();
      must(html.includes('<div id="root"'), 'admin index.html missing #root mount');
    });
  }

  console.log('');
  if (failures > 0) {
    console.error(`SMOKE FAILED — ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('SMOKE PASSED.');
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err.message);
  process.exit(1);
});
