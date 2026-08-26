# Birhan Backend API

Offline-first backend for Protestant churches in Ethiopia.

## Stack

- Node.js + TypeScript + Hono
- PostgreSQL + Drizzle ORM
- Better Auth (JWT plugin)
- MinIO (S3-compatible storage)
- Vitest for testing

## Setup

1. Copy `.env.example` to `.env` and fill in values
2. Run `npm install`
3. Start infrastructure: `docker compose up postgres minio`
4. Run migrations: `npm run db:migrate`
5. Seed data: `npm run db:seed`
6. Start server: `npm run dev`

## Running with Docker Compose

```bash
docker compose up
```

This starts API, Postgres, and MinIO.

## Testing

```bash
npm test
```

## Promoting First Super Admin

There is no self-service super_admin promotion. After seeding:

```sql
UPDATE profiles SET role = 'super_admin' WHERE id = '<your-user-id>';
```

## Authorization Summary

Authorization is enforced at the **service layer**. Every function receives an `AuthContext` derived from the verified JWT and applies `church_id` scoping. Role checks use `requireRole()`. The route handlers never issue raw queries.

Key invariants:
- `church_id` and `role` come **only** from the JWT
- Client-sent `church_id`, `role`, `pastor_status`, `uploaded_by` are **ignored**
- `pending_pastor` has member-level read access only
- Cross-church access returns 403/404 with zero data leakage


## Better Auth Infrastructure (Optional)

The backend includes optional support for Better Auth Infrastructure plugins:

- **`dash()`** — Audit logging, analytics, and admin dashboard APIs
- **`sentinel()`** — Security checks (credential stuffing, bot blocking, compromised password detection)

### ⚠️ Important Privacy Warning

`@better-auth/infra` is a **paid, closed-source service** that sends authentication events (including IP addresses, geolocation, and login activity) to Better Auth's external servers. For a project handling **sensitive church membership data** in Ethiopia, consider:

1. **Data residency** — Auth logs leave your infrastructure
2. **Privacy** — Member login patterns and IPs are transmitted to a third party
3. **Offline capability** — External API dependencies can break offline-first behavior

These plugins are **disabled by default** (no `BETTER_AUTH_API_KEY` = no external calls). Only enable if your organization accepts the privacy trade-offs.

### Enabling

```bash
BETTER_AUTH_API_KEY=your_key_here
BETTER_AUTH_API_URL=https://api.better-auth.com
BETTER_AUTH_KV_URL=https://kv.better-auth.com
```

### Mobile App Client Setup

The Birhan mobile app should use:

```ts
import { createAuthClient } from "better-auth/client";
import { dashClient, sentinelNativeClient } from "@better-auth/infra/native";

export const authClient = createAuthClient({
  baseURL: "https://your-api.example.com",
  plugins: [
    dashClient(),
    sentinelNativeClient({ autoSolveChallenge: true }),
  ],
});
```
