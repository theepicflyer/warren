import { defineConfig } from "vitest/config";

// The whole app against a real Pocket ID in Docker. Slow, so it runs apart from the unit tests.
export default defineConfig({
  test: { include: ["test/pocketid/*.test.ts"], testTimeout: 120_000, hookTimeout: 180_000 },
});
