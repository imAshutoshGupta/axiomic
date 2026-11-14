import { defineConfig } from "vitest/config";

// Only look at this package's own tests, and run a safety net before every test file (see src/test-setup.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
  },
});
