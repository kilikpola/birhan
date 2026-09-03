#!/bin/bash
#
# Build the admin console and publish it to the VPS.
#
# Deploys as root over the deploy key. The birhan user does not accept that
# key — `ssh birhan@…` fails with "Permission denied (publickey,password)" —
# which is why the earlier three-step chown dance around an unprivileged rsync
# is gone: root writes the directory directly and hands it to www-data at the
# end.
set -euo pipefail

HOST="${BIRHAN_DEPLOY_HOST:-root@191.215.40.44}"
KEY="${BIRHAN_DEPLOY_KEY:-$HOME/.ssh/birhan_deploy}"
TARGET=/var/www/admin.birhan.online

cd "$(dirname "$0")"

# src/api.ts throws at import time without this, so a missing value would
# otherwise surface as an opaque build failure.
if [ -z "${VITE_API_URL:-}" ]; then
  echo "VITE_API_URL is not set. Point it at the Birhan API, e.g." >&2
  echo "  VITE_API_URL=https://api.birhan.online ./deploy.sh" >&2
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "No deploy key at $KEY. Set BIRHAN_DEPLOY_KEY to its path." >&2
  exit 1
fi

npm run build

# Sourcemaps are not served. They expose the console's full source to anyone
# who can reach the host — and, having once been left in place, they are the
# only reason the source was recoverable when it went missing from the repo.
# Keep them out of the deploy; the copy in dist/ locally is the backup.
rm -f dist/assets/*.map

rsync -avz --delete \
  -e "ssh -i '$KEY' -o StrictHostKeyChecking=accept-new" \
  ./dist/ "$HOST:$TARGET/"

ssh -i "$KEY" "$HOST" "chown -R www-data:www-data $TARGET"

echo "Deployed to $TARGET on $HOST"
