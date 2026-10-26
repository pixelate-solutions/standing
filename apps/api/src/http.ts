import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { sha256 } from "./crypto.ts";
import { sql } from "./db.ts";
import { env } from "./env.ts";

export type Account = {
  id: string;
  name: string;
  email: string;
  domain: string | null;
  domain_token: string;
  domain_verified_at: Date | null;
  created_at: Date;
};

export type Env = {
  Variables: {
    account: Account;
    auth: { via: "session" } | { via: "key"; keyId: string; mode: "test" | "live" };
  };
};

export const SESSION_COOKIE = "standing_session";

export function fail(status: 400 | 401 | 403 | 404 | 409 | 415 | 422 | 429, code: string, message: string): never {
  throw new HTTPException(status, { res: Response.json({ error: { code, message } }, { status }) });
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    fail(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.join(".");
    fail(400, "invalid_request", path ? `${path}: ${issue.message}` : issue.message);
  }
  return parsed.data;
}

async function accountFromKey(key: string) {
  const [row] = await sql<(Account & { key_id: string; mode: "test" | "live" })[]>`
    update api_keys set last_used_at = now()
    from accounts a
    where api_keys.key_hash = ${sha256(key)} and api_keys.revoked_at is null and a.id = api_keys.account_id
    returning a.id, a.name, a.email, a.domain, a.domain_token, a.domain_verified_at, a.created_at, api_keys.id as key_id, api_keys.mode`;
  return row ?? null;
}

async function accountFromSession(token: string) {
  const [row] = await sql<Account[]>`
    select a.id, a.name, a.email, a.domain, a.domain_token, a.domain_verified_at, a.created_at
    from sessions s join accounts a on a.id = s.account_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  return row ?? null;
}

/**
 * Accepts either an API key (Authorization: Bearer sd_...) or a dashboard
 * session cookie. `keys` limits which of the two a route takes.
 */
export function requireAuth(accepts: "any" | "session" | "key" = "any"): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (header && accepts !== "session") {
      const key = header.replace(/^Bearer\s+/i, "").trim();
      const row = await accountFromKey(key);
      if (!row) fail(401, "invalid_key", "API key is missing, invalid, or revoked.");
      const { key_id, mode, ...account } = row;
      c.set("account", account);
      c.set("auth", { via: "key", keyId: key_id, mode });
      return next();
    }

    const token = getCookie(c, SESSION_COOKIE);
    if (token && accepts !== "key") {
      const account = await accountFromSession(token);
      if (account) {
        // Session requests that change state must be JSON. Browsers cannot send
        // cross-site JSON without a CORS preflight, which this API never allows.
        const method = c.req.method;
        if (method !== "GET" && method !== "HEAD" && !c.req.header("content-type")?.includes("application/json")) {
          fail(415, "json_required", "Send requests as application/json.");
        }
        c.set("account", account);
        c.set("auth", { via: "session" });
        return next();
      }
    }

    fail(401, "unauthenticated", accepts === "key" ? "Send an API key: Authorization: Bearer sd_..." : "Sign in first.");
  };
}

// Fixed-window limiter. Enough for a single instance; swap for Redis when scaling out.
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(name: string, limit: number, windowMs: number, keyOf: (c: Context<Env>) => string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const key = `${name}:${keyOf(c)}`;
    const now = Date.now();
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
    }
    window.count++;
    if (window.count > limit) {
      c.header("retry-after", String(Math.ceil((window.resetAt - now) / 1000)));
      fail(429, "rate_limited", "Too many requests. Try again shortly.");
    }
    if (windows.size > 50_000) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    }
    return next();
  };
}

export function resetRateLimits() {
  windows.clear();
}

/**
 * The caller's IP for rate limiting. X-Forwarded-For is only trusted behind our
 * own proxy (STANDING_TRUST_PROXY=1), and then only the entry that proxy added.
 */
export function clientIp(c: Context): string {
  if (env.trustProxy) {
    const hops = c.req.header("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops?.length) return hops.at(-1)!;
  }
  try {
    return getConnInfo(c).remote.address ?? "local";
  } catch {
    return "local";
  }
}
