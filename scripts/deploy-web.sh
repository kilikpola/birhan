#!/usr/bin/env bash
#
# Deploy the Birhan marketing site + admin console to a Linux VPS over SSH.
#
#   ./scripts/deploy-web.sh                 # both
#   ./scripts/deploy-web.sh site            # marketing site only
#   ./scripts/deploy-web.sh admin           # admin console only
#   APK=android/app/build/outputs/apk/release/app-release.apk ./scripts/deploy-web.sh site
#
# Config (env or edit the defaults):
#   BIRHAN_SSH   user@host of the server            (required)
#   SITE_DIR     server path for the marketing site (default /var/www/birhan)
#   ADMIN_DIR    server path for the admin console  (default /var/www/birhan-admin)
#   APK          local APK to publish as /downloads/birhan.apk (optional)
#
# The admin build needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Put them in
# admin-web/.env.production (git-ignored) or export them before running.

set -euo pipefail

SSH_TARGET="${BIRHAN_SSH:-}"
SITE_DIR="${SITE_DIR:-/var/www/birhan}"
ADMIN_DIR="${ADMIN_DIR:-/var/www/birhan-admin}"
WHAT="${1:-all}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "$SSH_TARGET" ]]; then
  echo "error: set BIRHAN_SSH, e.g. BIRHAN_SSH=root@203.0.113.7 $0" >&2
  exit 1
fi

deploy_site() {
  echo "==> marketing site → $SSH_TARGET:$SITE_DIR"

  if [[ -n "${APK:-}" ]]; then
    [[ -f "$APK" ]] || { echo "error: APK not found: $APK" >&2; exit 1; }
    mkdir -p website/downloads
    cp "$APK" website/downloads/birhan.apk
    echo "    bundled APK ($(du -h website/downloads/birhan.apk | cut -f1))"
  fi

  # --delete keeps the server a mirror of website/. downloads/ is excluded so a
  # deploy without APK= set does not wipe the published APK.
  rsync -avz --delete --exclude 'downloads/.gitignore' \
    ${APK:+--include 'downloads/***'} ${APK:---exclude 'downloads/***'} \
    website/ "$SSH_TARGET:$SITE_DIR/"
}

deploy_admin() {
  echo "==> admin console: building"
  ( cd admin-web && npm ci && npm run build )

  echo "==> admin console → $SSH_TARGET:$ADMIN_DIR"
  rsync -avz --delete admin-web/dist/ "$SSH_TARGET:$ADMIN_DIR/"
}

case "$WHAT" in
  site)  deploy_site ;;
  admin) deploy_admin ;;
  all)   deploy_site; deploy_admin ;;
  *)     echo "usage: $0 [site|admin|all]" >&2; exit 1 ;;
esac

echo "==> done"
