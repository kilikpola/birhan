# Database migrations

Migrations live in `supabase/migrations/` as timestamped SQL files. The deploy
pipeline applies them with `supabase db push`, which runs only the migrations a
project hasn't seen yet (tracked in `supabase_migrations.schema_migrations`).

> The flat `supabase/NN_*.sql` files are the original hand-run scripts, kept for
> history and referenced by the setup docs. `supabase/migrations/` is now the
> **canonical, automated** source of truth — add new migrations there, not as
> flat files.

## The rule: expand-then-contract

Never write a migration that an already-running previous app version can't
tolerate — otherwise rolling back application code lands on a schema it can't use.
Split every breaking change across releases:

1. **Expand** — add the new thing, keep the old. New columns are nullable or have
   defaults; add a new column/table alongside the old one; write to both.
2. **Migrate/backfill** — deploy code that uses the new shape; backfill data.
3. **Contract** — only after the old code is fully gone from production, a *later*
   migration drops the old column/table.

Concretely:
- ✅ `add column … null`, `create table`, `create index concurrently`, add a nullable FK.
- ⛔ in one release: `drop column`, `rename column`, `alter … not null` on existing
  data, narrowing a type. Do these as a **contract** step a release later.

This is why `scripts/rollback.sh` never reverts the schema: with expand-then-contract
the previous release still runs against the newer schema, so reverting *code* is
safe and reverting *schema* is the risky move. If a migration itself is broken,
forward-fix with a new migration.

## One-time: baseline the EXISTING production project

Production already has `01`–`15` applied by hand, but has no migration history, so
`supabase db push` would try to re-run them and fail. Mark them as already applied
once (per project), then future pushes only apply new files:

```bash
supabase link --project-ref <PROD_REF>
# tell Supabase these versions are already in the DB (no SQL runs):
supabase migration repair --status applied \
  20240101000001 20240101000002 20240101000003 20240101000004 20240101000005 \
  20240101000006 20240101000007 20240101000008 20240101000009 20240101000010 \
  20240101000011 20240101000012 20240101000013 20240101000014 20240101000015
supabase db push   # should now report "no new migrations"
```

Staging is a **fresh** project, so it needs no repair — `supabase db push` applies
everything from scratch.

## Adding a migration

```bash
supabase migration new short_description      # creates migrations/<ts>_short_description.sql
# write expand-only SQL, then test locally:
supabase db reset                             # applies all migrations to a clean local DB
psql "$LOCAL_DB_URL" -f supabase/tests/rls_regression.sql   # keep RLS green
```

Open a PR → CI runs the RLS suite → merge → the deploy workflow pushes it to
staging, then (after manual approval) production.
