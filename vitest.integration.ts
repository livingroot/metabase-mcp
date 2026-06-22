import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    globalSetup: ["./test/globalSetup.integration.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000, // globalSetup may wait up to 2 min for Docker
    // No setupFiles — globalSetup provides apiKey/baseUrl via inject()
  },
});
