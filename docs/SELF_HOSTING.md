# Self-hosting the website + admin console

> **Out of date, kept for the server-side parts.** This guide was written when
> the admin console talked to Supabase from the browser and CI published it to
> Cloudflare Pages. Neither is true now: the console calls the Birhan API
> (`VITE_API_URL`), authorisation is enforced by the backend rather than by
> Supabase RLS, and it is deployed by `admin-web/deploy.sh` over ssh. The
> workflows referenced in sections 6 and 7 were removed along with Supabase.
>
> Sections 1–4 and 8–10 (DNS, server prep, nginx, TLS, locking down, verifying)
> are still accurate and are why this file is still here.

How to serve the Birhan **marketing site** (`website/`) and the **admin console** (`admin-web/`)
from your own Linux VPS with nginx and Let's Encrypt.

Both are **static sites**. There is no app server and no database on this box: the admin console
talks to Supabase directly from the browser, and Supabase RLS (`super_admin` policies) is the
security boundary. The VPS only serves files.

> This replaces the Cloudflare Pages steps in `.github/workflows/deploy.yml`. Until you swap those
> (see [CI](#7-ci-deploy-instead-of-cloudflare-pages)), merges to `main` still publish to Pages and
> the smoke test still checks `https://admin.birhan.online` — point that at whichever host is live.

Replace `birhan.online` and `203.0.113.7` with your domain and server IP throughout.

---

## 1. DNS

At your registrar, two A records (plus AAAA if the VPS has IPv6):

| Type | Name    | Value         |
|------|---------|---------------|
| A    | `@`     | `203.0.113.7` |
| A    | `www`   | `203.0.113.7` |
| A    | `admin` | `203.0.113.7` |

Wait for propagation before running certbot — it validates over HTTP against these records:

```bash
dig +short birhan.online admin.birhan.online
```

## 2. Server prep (once)

```bash
ssh root@203.0.113.7

apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx rsync

mkdir -p /var/www/birhan /var/www/birhan-admin
chown -R www-data:www-data /var/www/birhan /var/www/birhan-admin

# Firewall: SSH + HTTP/HTTPS only
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

## 3. nginx vhosts

From your laptop, in the repo:

```bash
scp deploy/nginx/birhan.online.conf       root@203.0.113.7:/etc/nginx/sites-available/birhan.online
scp deploy/nginx/admin.birhan.online.conf root@203.0.113.7:/etc/nginx/sites-available/admin.birhan.online
```

On the server:

```bash
ln -s /etc/nginx/sites-available/birhan.online       /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/admin.birhan.online /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default     # drop the "Welcome to nginx" catch-all
nginx -t && systemctl reload nginx
```

What the two configs already handle:

- **`birhan.online`** — plain static files, plus `/downloads/` served as
  `application/vnd.android.package-archive` so Android actually offers to install the APK instead
  of saving it as text.
- **`admin.birhan.online`** — SPA fallback (`try_files … /index.html`), so a refresh on any route
  works; immutable caching for Vite's hashed `/assets/`; `no-store` on `index.html` so admins
  never run a stale bundle after a deploy; `.map` files blocked (they're uploaded to Sentry, not
  meant to be public).

## 4. TLS

```bash
certbot --nginx -d birhan.online -d www.birhan.online
certbot --nginx -d admin.birhan.online
```

Certbot rewrites both vhosts for port 443 and installs a renewal timer. Verify it:

```bash
systemctl status certbot.timer
certbot renew --dry-run
```

## 5. Admin console build config

The admin bundle needs its Supabase project baked in at build time. Create
`admin-web/.env.production` on the machine that runs the build (git-ignored):

```ini
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
VITE_SENTRY_DSN=          # optional
VITE_ENV=production
```

The anon key is meant to be public — RLS is what protects the data. What must **never** land here
is the `service_role` key.

## 6. Deploy

```bash
export BIRHAN_SSH=root@203.0.113.7

./scripts/deploy-web.sh admin    # npm ci && vite build, then rsync dist/ → /var/www/birhan-admin
./scripts/deploy-web.sh site     # rsync website/ → /var/www/birhan
```

To publish an APK with the site (the landing page's download button points at
`/downloads/birhan.apk`):

```bash
APK=android/app/build/outputs/apk/release/app-release.apk ./scripts/deploy-web.sh site
```

`rsync --delete` mirrors the local tree, but `downloads/` is only touched when `APK=` is set — so a
routine content deploy can't wipe the published APK.

After the first deploy, fix ownership once:

```bash
ssh root@203.0.113.7 'chown -R www-data:www-data /var/www/birhan /var/www/birhan-admin'
```

## 7. CI deploy (instead of Cloudflare Pages)

To move the pipeline off Pages, replace the `Deploy admin web → Cloudflare Pages` step in
`.github/workflows/deploy.yml` (both the staging and production jobs) with:

```yaml
      - name: Deploy admin web → VPS
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: "admin-web/dist/*"
          target: "/var/www/birhan-admin"
          strip_components: 2
          rm: true          # clear the target first, like --delete
```

Add three repository secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (a **deploy-only** private key
— generate a fresh keypair and give it a `command=`-restricted entry in `authorized_keys` rather
than reusing your personal key). Then drop `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` and the
`CF_PAGES_PROJECT_*` vars once nothing references them.

`SMOKE_ADMIN_URL` in both jobs should keep pointing at the live admin hostname.

## 8. Lock down the admin console

The login form should not be world-reachable even though RLS protects the data. Uncomment **one**
block in `deploy/nginx/admin.birhan.online.conf`:

```bash
# Option 1 — HTTP basic auth in front of the SPA
apt install -y apache2-utils
htpasswd -c /etc/nginx/.birhan-admin-htpasswd yourname
# then uncomment the auth_basic lines and: nginx -t && systemctl reload nginx

# Option 2 — allowlist your static IP (the `allow` / `deny all` lines)
```

Also confirm in the Supabase dashboard that **Authentication → URL Configuration → Site URL** lists
`https://admin.birhan.online`, so password-reset and confirmation emails link to the right host.

## 9. Verify

```bash
curl -I https://birhan.online                        # 200, HTTP/2
curl -I https://admin.birhan.online                  # 200 (or 401 with basic auth on)
curl -sI https://birhan.online/downloads/birhan.apk | grep -i content-type
#   → content-type: application/vnd.android.package-archive
curl -I https://admin.birhan.online/verify           # 200, not 404 → SPA fallback works
curl -I https://admin.birhan.online/assets/index.js.map   # 403 → source maps not public
```

Then, in a browser: load the admin console, sign in as a `super_admin`, and confirm the
verification queue loads. If sign-in works but every list is empty, the account's JWT probably
predates the `super_admin` promotion — sign out and back in so the auth hook re-stamps the role
(see `admin-web/README.md`).

## 10. Routine updates

The landing page is bilingual: **Amharic is the markup**, and each translatable element carries a
`data-en` attribute with its English text. To change copy, edit both — the Amharic in the element,
the English in its `data-en`. `?lang=en` deep-links the English version; the toggle's choice is
remembered in `localStorage`. Amharic renders everywhere because
`website/assets/noto-serif-ethiopic.woff2` (a Ge'ez + Latin subset of the bundled Noto Serif
Ethiopic) is served from your own host — no Google Fonts request, no missing-glyph boxes on
machines without an Ethiopic font.

| Change                    | Command                                                       |
|---------------------------|---------------------------------------------------------------|
| Landing page copy/design  | edit `website/index.html` → `./scripts/deploy-web.sh site`     |
| Admin console code        | `./scripts/deploy-web.sh admin`                                |
| New APK release           | `APK=… ./scripts/deploy-web.sh site`                           |
| nginx config              | `scp` the file, `nginx -t`, `systemctl reload nginx`           |

Nothing here holds state, so a bad deploy is fixed by re-running the previous build — no database
on this box to roll back.
