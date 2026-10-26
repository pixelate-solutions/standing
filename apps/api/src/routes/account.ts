import { resolveTxt } from "node:dns/promises";
import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db.ts";
import { env } from "../env.ts";
import { body, fail, rateLimit, requireAuth, type Account, type Env } from "../http.ts";
import { fetchPublic } from "../network.ts";
import { presentAccount } from "./auth.ts";

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DEV_HOST = /^(localhost|127\.0\.0\.1|[a-z0-9.-]+\.localhost)(:\d{2,5})?$/;

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  .refine((d) => HOST.test(d) || (env.allowPrivateNetwork && DEV_HOST.test(d)), "Enter a domain like example.com.");

export const VERIFICATION_PATH = "/.well-known/standing-verification.txt";

async function domainHasToken(domain: string, token: string): Promise<{ ok: boolean; tried: string[] }> {
  const tried: string[] = [];
  try {
    const records = await resolveTxt(`_standing.${domain.replace(/:\d+$/, "")}`);
    tried.push(`TXT _standing.${domain}`);
    if (records.some((parts) => parts.join("").trim() === token)) return { ok: true, tried };
  } catch {
    tried.push(`TXT _standing.${domain}`);
  }
  for (const scheme of env.allowPrivateNetwork ? ["https", "http"] : ["https"]) {
    const url = `${scheme}://${domain}${VERIFICATION_PATH}`;
    tried.push(url);
    try {
      const text = await fetchPublic(new URL(url), { maxBytes: 1024, accept: "text/plain" });
      if (text.trim() === token) return { ok: true, tried };
    } catch {
      // Try the next method.
    }
  }
  return { ok: false, tried };
}

const policySchema = z.object({
  mode: z.enum(["monitor", "enforce"]),
  unknown_action: z.enum(["allow", "challenge", "deny"]),
  poor_action: z.enum(["allow", "challenge", "deny"]),
});

export const account = new Hono<Env>()
  .use("*", requireAuth("session"))

  .patch("/", async (c) => {
    const input = await body(c, z.object({ name: z.string().trim().min(1).max(100).optional(), domain: domainSchema.nullable().optional() }));
    const current = c.get("account");
    const domainChanged = input.domain !== undefined && input.domain !== current.domain;
    if (domainChanged && input.domain) {
      const [taken] = await sql`select 1 from accounts where domain = ${input.domain} and domain_verified_at is not null and id <> ${current.id}`;
      if (taken) fail(409, "domain_taken", "Another account already verified this domain.");
    }
    const [updated] = await sql<Account[]>`
      update accounts set
        name = ${input.name ?? current.name},
        domain = ${domainChanged ? (input.domain ?? null) : current.domain},
        domain_verified_at = ${domainChanged ? null : current.domain_verified_at}
      where id = ${current.id}
      returning id, name, email, domain, domain_token, domain_verified_at, created_at`;
    return c.json({ account: presentAccount(updated!) });
  })

  .post("/verify-domain", rateLimit("verify-domain", 20, 60 * 60_000, (c) => c.get("account").id), async (c) => {
    const current = c.get("account");
    if (!current.domain) fail(400, "no_domain", "Add a domain first.");
    if (current.domain_verified_at) return c.json({ account: presentAccount(current) });
    const [taken] = await sql`select 1 from accounts where domain = ${current.domain} and domain_verified_at is not null and id <> ${current.id}`;
    if (taken) fail(409, "domain_taken", "Another account already verified this domain.");
    const { ok, tried } = await domainHasToken(current.domain, current.domain_token);
    if (!ok) fail(422, "not_verified", `Token not found. Checked: ${tried.join(", ")}.`);
    const [updated] = await sql<Account[]>`
      update accounts set domain_verified_at = now() where id = ${current.id}
      returning id, name, email, domain, domain_token, domain_verified_at, created_at`;
    return c.json({ account: presentAccount(updated!) });
  })

  .get("/policy", async (c) => {
    const [policy] = await sql`select mode, unknown_action, poor_action from policies where account_id = ${c.get("account").id}`;
    return c.json({ policy });
  })

  .put("/policy", async (c) => {
    const input = await body(c, policySchema);
    const [policy] = await sql`
      insert into policies (account_id, mode, unknown_action, poor_action) values (${c.get("account").id}, ${input.mode}, ${input.unknown_action}, ${input.poor_action})
      on conflict (account_id) do update set mode = excluded.mode, unknown_action = excluded.unknown_action, poor_action = excluded.poor_action, updated_at = now()
      returning mode, unknown_action, poor_action`;
    return c.json({ policy });
  });
