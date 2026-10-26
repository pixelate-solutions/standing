import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";
import { seedTestAgents } from "./test-agents.ts";

const dir = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function migrate() {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(dir + file, "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  await seedTestAgents();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => sql.end())
    .catch(async (error) => {
      console.error(error);
      await sql.end();
      process.exit(1);
    });
}
