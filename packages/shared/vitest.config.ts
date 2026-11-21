import { defineConfig } from "vitest/config";

// Tests live in tests/, mirroring src/ (tests/safety/secrets.test.ts tests src/safety/secrets.ts).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
