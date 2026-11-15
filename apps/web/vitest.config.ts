import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests read AXIOMIC_DATABASE_URL etc. from .env.local; they skip themselves when it's missing.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    // "server-only" throws outside Next's server bundle; in tests we are the server.
    alias: { "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)) },
  },
  test: { testTimeout: 30_000, fileParallelism: false },
});
