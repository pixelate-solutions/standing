import { Hono } from "hono";
import { z } from "zod";
import { randomId, randomToken, sha256 } from "../crypto.ts";
import { sql } from "../db.ts";
import { body, fail, requireAuth, type Env } from "../http.ts";

type KeyRow = { id: string; name: string; mode: "test" | "live"; hint: string; created_at: Date; last_used_at: Date | null };

const present = (k: KeyRow) => ({
  id: k.id,
  name: k.name,
  mode: k.mode,
  hint: k.hint,
  created_at: k.created_at.toISOString(),
  last_used_at: k.last_used_at?.toISOString() ?? null,
});

export const keys = new Hono<Env>()
  .use("*", requireAuth("session"))

  .get("/", async (c) => {
    const rows = await sql<KeyRow[]>`
      select id, name, mode, hint, created_at, last_used_at from api_keys
      where account_id = ${c.get("account").id} and revoked_at is null order by created_at desc`;
    return c.json({ data: rows.map(present) });
  })

  // The full key is returned once. Only its hash is stored.
  .post("/", async (c) => {
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(60), mode: z.enum(["test", "live"]) }));
    const secret = `sd_${input.mode}_${randomToken(24)}`;
    const [row] = await sql<KeyRow[]>`
      insert into api_keys (id, account_id, name, mode, hint, key_hash)
      values (${randomId("key")}, ${c.get("account").id}, ${input.name}, ${input.mode}, ${`${secret.slice(0, 8)}…${secret.slice(-4)}`}, ${sha256(secret)})
      returning id, name, mode, hint, created_at, last_used_at`;
    return c.json({ key: { ...present(row!), secret } }, 201);
  })

  .delete("/:id", async (c) => {
    const [row] = await sql`
      update api_keys set revoked_at = now()
      where id = ${c.req.param("id")} and account_id = ${c.get("account").id} and revoked_at is null returning id`;
    if (!row) fail(404, "not_found", "Key not found.");
    return c.json({ ok: true });
  });
