/**
 * Runs before any module in the suite is imported, because src/config/index.ts
 * throws on a missing required variable the moment it loads. These values are
 * placeholders — the database is PGlite (see pglite-db.ts) and nothing here
 * reaches a network.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters!!";
process.env.PUBLIC_API_URL ??= "https://api.birhan.test";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_ACCESS_KEY_ID ??= "test";
process.env.S3_SECRET_ACCESS_KEY ??= "test";
process.env.S3_BUCKET_RESOURCES ??= "resources";
process.env.S3_BUCKET_PASTOR_DOCS ??= "pastor-docs";

// Empty, not unset: config/index.ts calls dotenv.config(), which leaves any key
// already present in process.env alone but would otherwise pull a real key out
// of backend/.env. That key switches on @better-auth/infra, which needs zod v4
// against this project's v3 and throws while loading. Nothing under test needs
// it, and the tests must not depend on a developer's local .env either way.
process.env.BETTER_AUTH_API_KEY = "";
