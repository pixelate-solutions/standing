import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/standing_test",
      STANDING_ALLOW_PRIVATE_NETWORK: "1",
      STANDING_AGENTS_HOST: "agents.test",
    },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
