import { defineConfig } from "vitest/config";

// Tests live in tests/, mirroring src/ (tests/local-files/writer.test.ts tests src/local-files/writer.ts).
// Before every test file, a safety net points HOME and every config folder at a temp folder
// (see tests/helpers/test-setup.ts).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/test-setup.ts"],
  },
});
