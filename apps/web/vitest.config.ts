import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests read AXIOMIC_DATABASE_URL etc. from .env.local; they skip themselves when it's missing.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const webRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // "@/lib/db" means apps/web/lib/db (same as "paths" in tsconfig.json, which Next.js reads).
      { find: /^@\//, replacement: webRoot },
      // "server-only" throws outside Next's server bundle; in tests we are the server.
      { find: "server-only", replacement: fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)) },
    ],
  },
  // Tests live in tests/, mirroring the app (tests/rules/push.test.ts tests lib/rules/push.ts).
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, fileParallelism: false },
});
