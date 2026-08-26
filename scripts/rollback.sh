#!/usr/bin/env bash
# rollback.sh — revert PRODUCTION to the previous release in one command.
#
# Reverts the two surfaces that can be safely rolled back:
#   1. admin web  → roll Cloudflare Pages back to the previous prod deployment
#   2. edge fns   → redeploy the functions from the previous release tag
#
# It deliberately DOES NOT roll back the database. Migrations are written
# expand-then-contract (see supabase/MIGRATIONS.md), so the previous app/functions
# still work against the newer schema — reverting schema is riskier than the bug
# you're escaping. If a migration itself is the problem, forward-fix it.
#
# Usage (manual):
#   export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=…  CF_PAGES_PROJECT=birhan-admin
#   export SUPABASE_ACCESS_TOKEN=…  PROD_SUPABASE_PROJECT_REF=…
#   export PREV_RELEASE_REF=release-YYYYMMDD-HHMMSS-abcdef1   # optional; omit to skip fns
#   bash scripts/rollback.sh
set -euo pipefail

log() { printf '\n\033[1m» %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- Cloudflare Pages
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" && -n "${CF_PAGES_PROJECT:-}" ]]; then
  log "Cloudflare Pages: finding the previous production deployment for $CF_PAGES_PROJECT"
  api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT}"
  # Deployments are newest-first; [0] is the (bad) current one, [1] is the prior good one.
  prev_id=$(curl -fsS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "${api}/deployments?env=production&per_page=5" \
    | jq -r '[.result[] | select(.environment=="production")][1].id // empty')

  if [[ -n "$prev_id" ]]; then
    log "Rolling Pages back to deployment $prev_id"
    curl -fsS -X POST -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "${api}/deployments/${prev_id}/rollback" >/dev/null
    echo "  ✓ Pages rolled back."
  else
    echo "  ! No previous production deployment found — skipping Pages rollback."
  fi
else
  echo "  ! Cloudflare env not set — skipping Pages rollback."
fi

# ------------------------------------------------------------------- Edge Functions
if [[ -n "${PREV_RELEASE_REF:-}" && -n "${PROD_SUPABASE_PROJECT_REF:-}" ]]; then
  log "Edge Functions: redeploying from $PREV_RELEASE_REF"
  git checkout "$PREV_RELEASE_REF" -- supabase/functions supabase/config.toml
  supabase link --project-ref "$PROD_SUPABASE_PROJECT_REF"
  supabase functions deploy health --no-verify-jwt
  supabase functions deploy debug-error --no-verify-jwt
  supabase functions deploy post-telegram-announcement
  supabase functions deploy notify-announcement
  supabase functions deploy telegram-webhook
  git checkout HEAD -- supabase/functions supabase/config.toml
  echo "  ✓ Functions redeployed from previous release."
else
  echo "  ! PREV_RELEASE_REF / project ref not set — skipping function rollback."
fi

log "Rollback complete. DB schema was intentionally left untouched (expand-then-contract)."
