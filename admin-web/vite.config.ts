import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// SENTRY_AUTH_TOKEN + SENTRY_ORG/PROJECT are provided by CI to upload source
// maps. When absent (local dev), the plugin is disabled and the build still
// succeeds — you just don't get uploaded maps.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT ?? 'birhan-admin',
      authToken: sentryAuthToken,
      disable: !sentryAuthToken,
    }),
  ],
  // Emit source maps so Sentry can symbolicate; the plugin uploads then deletes
  // them from the deployed bundle when a token is present.
  build: { sourcemap: true },
  server: { port: 5180 },
});
