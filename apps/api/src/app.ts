import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "./db.ts";
import { requireAuth, type Env } from "./http.ts";
import { account } from "./routes/account.ts";
import { agents, jwksFor } from "./routes/agents.ts";
import { auth } from "./routes/auth.ts";
import { checks } from "./routes/checks.ts";
import { keys } from "./routes/keys.ts";
import { reports } from "./routes/reports.ts";
import { DISPUTE_WINDOW_DAYS } from "./standing.ts";
import { agentIdFromHost } from "./verify.ts";

export function createApp() {
  const app = new Hono<Env>();

  // Each registered agent has its own origin serving a Web Bot Auth key
  // directory, e.g. https://agt-abc.agents.standing.dev/.well-known/http-message-signatures-directory
  app.use("*", async (c, next) => {
    const agentId = agentIdFromHost(c.req.header("host") ?? "");
    if (!agentId) return next();
    if (c.req.path !== "/.well-known/http-message-signatures-directory") return c.json({ error: { code: "not_found", message: "Not found." } }, 404);
    const [agent] = await sql`select 1 from agents where id = ${agentId} and (account_id is not null or test_standing is not null)`;
    if (!agent) return c.json({ error: { code: "not_found", message: "No such agent." } }, 404);
    c.header("content-type", "application/http-message-signatures-directory+json");
    c.header("cache-control", "public, max-age=300");
    return c.body(JSON.stringify(await jwksFor(agentId)));
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/v1/auth", auth);
  app.route("/v1/account", account);
  app.route("/v1/keys", keys);
  app.route("/v1/agents", agents);
  app.route("/v1/checks", checks);
  app.route("/v1/reports", reports);

  app.get("/v1/overview", requireAuth("session"), async (c) => {
    const id = c.get("account").id;
    const [row] = await sql<Record<string, number>[]>`
      select
        (select count(*) from api_keys where account_id = ${id} and revoked_at is null)::int as keys,
        (select count(*) from checks where account_id = ${id} and mode = 'live')::int as live_checks,
        (select count(*) from checks where account_id = ${id} and mode = 'test')::int as test_checks,
        (select count(*) from agents where account_id = ${id})::int as agents,
        (select count(*) from outcomes o join agents a on a.id = o.agent_id
          where a.account_id = ${id} and o.counts and o.status = 'active' and o.outcome <> 'completed')::int as reports_to_review,
        (select count(*) from outcomes where account_id = ${id} and status = 'disputed'
          and disputed_at >= now() - make_interval(days => ${DISPUTE_WINDOW_DAYS}))::int as disputes_to_resolve`;
    return c.json(row);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.json({ error: { code: "server_error", message: "Something went wrong on our side." } }, 500);
  });

  return app;
}
