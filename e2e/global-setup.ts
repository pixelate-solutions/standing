import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

// Web servers start before global setup, so the API has already migrated the
// database. Wipe its data (keeping the schema and seeded test agents).
export default async function globalSetup() {
  execSync(
    `psql postgres://localhost:5432/standing_e2e -v ON_ERROR_STOP=1 -c "truncate outcomes, checks, replays, sessions, api_keys, policies; delete from agents where test_standing is null; delete from accounts;"`,
    { stdio: "inherit" },
  );
  rmSync("e2e/.artifacts", { recursive: true, force: true });
  mkdirSync("e2e/.artifacts/screens", { recursive: true });
}
