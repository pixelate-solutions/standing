import { defineConfig } from "@playwright/test";

// End-to-end runs use their own ports and database so they never touch dev data.
export const E2E = {
  api: "http://localhost:4110",
  web: "http://localhost:3110",
  store: "http://localhost:5110",
  agentsHost: "agents.localhost:4110",
  database: "postgres://localhost:5432/standing_e2e",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: E2E.web, trace: "retain-on-failure", viewport: { width: 1360, height: 900 } },
  webServer: [
    {
      command: "pnpm --filter @standing/api start",
      url: `${E2E.api}/health`,
      env: {
        PORT: "4110",
        DATABASE_URL: E2E.database,
        STANDING_PUBLIC_URL: E2E.api,
        STANDING_AGENTS_HOST: E2E.agentsHost,
        STANDING_ALLOW_PRIVATE_NETWORK: "1",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @standing/web build && pnpm --filter @standing/web exec next start --port 3110",
      url: E2E.web,
      env: { API_URL: E2E.api, NEXT_PUBLIC_API_URL: E2E.api, NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "pnpm --filter @standing/example-store start",
      url: `${E2E.store}/products`,
      env: { PORT: "5110", STANDING_API_URL: E2E.api },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
