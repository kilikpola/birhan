# Tests

Birhan's automated tests, by layer and where they run.

| Layer | What it covers | Run locally | CI job |
|---|---|---|---|
| **Unit (mobile)** | Jest via `jest-expo` — date logic, search, error classification, telegram helpers, components | `npm test` | `CI / mobile` |
| **Unit (edge)** | Deno tests for shared helpers (`_shared/html.ts` Telegram escaper) | `deno test supabase/functions/_shared/` | `CI / edge` |
| **Build/typecheck** | `tsc --noEmit` (mobile), `tsc -b && vite build` (admin) | `npx tsc --noEmit` · `cd admin-web && npm run build` | `CI / mobile`, `CI / admin-web` |
| **RLS regression** | The security fixes: church_id tenant-escape, reply author spoofing, RPC guard, self-promotion | see below | `Integration (RLS) / rls` |
| **Smoke (post-deploy)** | A deployed env is actually up: auth health, anon church read, health endpoint, admin shell | `SMOKE_SUPABASE_URL=… SMOKE_SUPABASE_ANON_KEY=… npm run test:smoke` | deploy workflow (Phase 3) |

## RLS regression (local)

Runs against a throwaway local Supabase with all migrations applied:

```bash
supabase start
for f in supabase/*.sql; do psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f "$f"; done
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls_regression.sql
supabase stop
```

Each test sets the JWT claims the auth hook would produce, switches to the
`authenticated` role, and asserts a known-bad action is blocked. Any failed
assertion aborts (`ON_ERROR_STOP=1`) and fails the job.

> The Integration workflow is intentionally **not** a required check yet — it
> hasn't been observed green in Actions (the authoring env had no Docker). Once
> it passes there, add it to branch protection.
