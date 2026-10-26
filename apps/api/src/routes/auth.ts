import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { checkPassword, hashPassword, randomId, randomToken, sha256 } from "../crypto.ts";
import { sql } from "../db.ts";
import { env } from "../env.ts";
import { body, clientIp, fail, rateLimit, requireAuth, SESSION_COOKIE, type Account, type Env } from "../http.ts";

const SESSION_DAYS = 30;

export function presentAccount(a: Account) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    domain: a.domain,
    domain_verified: a.domain_verified_at !== null,
    domain_token: a.domain_token,
    created_at: a.created_at.toISOString(),
  };
}

async function startSession(c: Parameters<typeof setCookie>[0], accountId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await sql`insert into sessions (token_hash, account_id, expires_at) values (${sha256(token)}, ${accountId}, ${expires})`;
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure: env.production, path: "/", expires });
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

export const auth = new Hono<Env>()
  .use("/signup", rateLimit("signup", 10, 60 * 60_000, clientIp))
  .use("/login", rateLimit("login", 20, 15 * 60_000, clientIp))

  .post("/signup", async (c) => {
    const input = await body(c, credentials.extend({ name: z.string().trim().min(1).max(100) }));
    const [existing] = await sql`select 1 from accounts where email = ${input.email}`;
    if (existing) fail(409, "email_taken", "An account with this email already exists.");
    const [account] = await sql<Account[]>`
      insert into accounts (id, name, email, password_hash, domain_token)
      values (${randomId("acc")}, ${input.name}, ${input.email}, ${await hashPassword(input.password)}, ${randomId("standing", 24)})
      returning id, name, email, domain, domain_token, domain_verified_at, created_at`;
    await sql`insert into policies (account_id) values (${account!.id})`;
    await startSession(c, account!.id);
    return c.json({ account: presentAccount(account!) }, 201);
  })

  .post("/login", async (c) => {
    const input = await body(c, credentials.extend({ password: z.string().min(1).max(200) }));
    const [row] = await sql<(Account & { password_hash: string })[]>`
      select id, name, email, domain, domain_token, domain_verified_at, created_at, password_hash from accounts where email = ${input.email}`;
    const ok = row ? await checkPassword(input.password, row.password_hash) : await hashPassword(input.password).then(() => false);
    if (!row || !ok) fail(401, "invalid_login", "Email or password is incorrect.");
    await startSession(c, row.id);
    const { password_hash: _, ...account } = row;
    return c.json({ account: presentAccount(account) });
  })

  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })

  .get("/me", requireAuth(), (c) => c.json({ account: presentAccount(c.get("account")) }));
