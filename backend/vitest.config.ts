import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // src/config/index.ts throws on missing env at import time, so the suite
    // needs its placeholders in place before the first module loads.
    setupFiles: ["./tests/support/env.ts"],
    testTimeout: 60000,
  },
});
