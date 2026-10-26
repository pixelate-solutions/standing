import { Hono } from "hono";
import { z } from "zod";
import { authorityMatchesDomain, decide, type Policy } from "../decide.ts";
import { randomId } from "../crypto.ts";
import { sql } from "../db.ts";
import { body, fail, rateLimit, requireAuth, type Account, type Env } from "../http.ts";
import { loadOwner, presentAgent } from "../present.ts";
import { loadStanding, type Standing } from "../standing.ts";
import { verifyAgentRequest, type AgentRow, type Reason, type Verification } from "../verify.ts";

const OUTCOME_WINDOW_DAYS = 120;

type CheckRow = {
  id: string;
  account_id: string;
  mode: "test" | "live";
  agent_id: string | null;
  kid: string | null;
  method: string;
  authority: string;
  path: string;
  action: string | null;
  decision: "allow" | "challenge" | "deny";
  enforced: boolean;
  reasons: Reason[];
  standing: Standing | null;
  signature_valid: boolean;
  counts: boolean;
  created_at: Date;
};

type OutcomeRow = { outcome: string; status: string; reference: string | null; updated_at: Date; disputed_at: Date | null };

async function presentCheck(check: CheckRow) {
  const [agent] = check.agent_id
    ? await sql<(AgentRow & { created_at: Date })[]>`
        select id, account_id, name, directory_url, test_standing, revoked_at, created_at from agents where id = ${check.agent_id}`
    : [];
  const [outcome] = await sql<OutcomeRow[]>`
    select outcome, status, reference, updated_at, disputed_at from outcomes where check_id = ${check.id}`;
  const presentedAgent = agent && check.standing ? presentAgent(agent, await loadOwner(agent), check.standing) : null;
  return {
    id: check.id,
    decision: check.decision,
    enforced: check.enforced,
    mode: check.mode,
    reasons: check.reasons,
    agent: presentedAgent ? { ...presentedAgent, standing: undefined } : null,
    standing: presentedAgent?.standing ?? null,
    signature: { valid: check.signature_valid, kid: check.kid },
    request: { method: check.method, authority: check.authority, path: check.path, action: check.action },
    counts: check.counts,
    outcome: outcome
      ? { outcome: outcome.outcome, status: outcome.status, reference: outcome.reference, reported_at: outcome.updated_at.toISOString() }
      : null,
    created_at: check.created_at.toISOString(),
  };
}

async function claimSignature(verification: Extract<Verification, { status: "verified" }>, accountId: string, checkId: string) {
  const [claimed] = await sql`
    insert into replays (replay_key, account_id, check_id, expires_at)
    values (${verification.replayKey}, ${accountId}, ${checkId}, ${new Date(verification.expires.getTime() + 60_000)})
    on conflict (replay_key) do nothing returning check_id`;
  if (claimed) return { status: "new" as const };
  const [existing] = await sql<{ account_id: string; check_id: string }[]>`
    select account_id, check_id from replays where replay_key = ${verification.replayKey}`;
  if (existing?.account_id === accountId) return { status: "retry" as const, checkId: existing.check_id };
  return { status: "replayed" as const };
}

function countsTowardStanding(account: Account, mode: "test" | "live", authority: string, verification: Verification): boolean {
  if (verification.status !== "verified" || mode !== "live") return false;
  if (verification.agent.test_standing || verification.agent.account_id === account.id) return false;
  return Boolean(account.domain && account.domain_verified_at && authorityMatchesDomain(authority, account.domain));
}

const checkInput = z.object({
  method: z.string().trim().toUpperCase().regex(/^[A-Z]{1,10}$/),
  url: z.string().url().max(4096),
  headers: z.record(z.string(), z.string().max(8192)).refine((h) => Object.keys(h).length <= 32, "At most 32 headers."),
  action: z.string().trim().min(1).max(40).optional(),
});

const outcomeInput = z.object({
  outcome: z.enum(["completed", "disputed", "fraud", "abuse"]),
  reference: z.string().trim().min(1).max(200).optional(),
});

export const checks = new Hono<Env>()
  .post("/", requireAuth("key"), rateLimit("checks", 600, 60_000, (c) => c.get("account").id), async (c) => {
    const input = await body(c, checkInput);
    const account = c.get("account");
    const auth = c.get("auth");
    const mode = auth.via === "key" ? auth.mode : "test";
    const url = new URL(input.url);

    let verification = await verifyAgentRequest(input);
    if (verification.status === "unsigned") {
      fail(400, "not_signed", "The request has no Signature and Signature-Input headers. Only signed agent requests can be checked.");
    }

    const id = randomId("chk");
    if (verification.status === "verified") {
      const claim = await claimSignature(verification, account.id, id);
      if (claim.status === "retry") {
        const [existing] = await sql<CheckRow[]>`select * from checks where id = ${claim.checkId}`;
        if (!existing) fail(409, "in_progress", "This request is already being checked. Retry shortly.");
        return c.json(await presentCheck(existing));
      }
      if (claim.status === "replayed") {
        verification = {
          status: "invalid",
          kid: verification.kid,
          agent: verification.agent,
          reason: { code: "signature_replayed", message: "This signature was already used at another business." },
        };
      }
    }

    const agent: AgentRow | null = verification.status === "verified" || verification.status === "invalid" ? verification.agent : null;
    const owner = agent ? await loadOwner(agent) : null;
    const standing = agent ? await loadStanding(agent) : null;
    const [policy] = await sql<Policy[]>`select mode, unknown_action, poor_action from policies where account_id = ${account.id}`;
    const { decision, reasons } = decide({
      verification,
      owner,
      standing,
      policy: policy ?? { mode: "monitor", unknown_action: "allow", poor_action: "challenge" },
      mode,
    });

    const [check] = await sql<CheckRow[]>`
      insert into checks (id, account_id, mode, agent_id, kid, method, authority, path, action, decision, enforced, reasons, standing, signature_valid, counts)
      values (${id}, ${account.id}, ${mode}, ${agent?.id ?? null}, ${verification.kid}, ${input.method}, ${url.host}, ${url.pathname},
        ${input.action ?? null}, ${decision}, ${policy?.mode === "enforce"}, ${sql.json(reasons)}, ${standing ? sql.json(standing) : null},
        ${verification.status === "verified"}, ${countsTowardStanding(account, mode, url.host, verification)})
      returning *`;
    return c.json(await presentCheck(check!), 201);
  })

  .get("/", requireAuth(), async (c) => {
    const query = z
      .object({
        mode: z.enum(["test", "live"]).optional(),
        decision: z.enum(["allow", "challenge", "deny"]).optional(),
        agent: z.string().optional(),
        before: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .safeParse(c.req.query());
    if (!query.success) fail(400, "invalid_request", query.error.issues[0]!.message);
    const q = query.data;
    const auth = c.get("auth");
    const mode = q.mode ?? (auth.via === "key" ? auth.mode : "live");
    const rows = await sql<CheckRow[]>`
      select * from checks
      where account_id = ${c.get("account").id} and mode = ${mode}
        ${q.decision ? sql`and decision = ${q.decision}` : sql``}
        ${q.agent ? sql`and agent_id = ${q.agent}` : sql``}
        ${q.before ? sql`and created_at < (select created_at from checks where id = ${q.before})` : sql``}
      order by created_at desc limit ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    return c.json({ data: await Promise.all(page.map(presentCheck)), has_more: rows.length > q.limit });
  })

  .get("/:id", requireAuth(), async (c) => {
    const [check] = await sql<CheckRow[]>`select * from checks where id = ${c.req.param("id")} and account_id = ${c.get("account").id}`;
    if (!check) fail(404, "not_found", "Check not found.");
    return c.json(await presentCheck(check));
  })

  .post("/:id/outcome", requireAuth(), async (c) => {
    const input = await body(c, outcomeInput);
    const account = c.get("account");
    const [check] = await sql<CheckRow[]>`select * from checks where id = ${c.req.param("id")} and account_id = ${account.id}`;
    if (!check) fail(404, "not_found", "Check not found.");
    if (!check.agent_id || !check.signature_valid) {
      fail(409, "not_reportable", "Outcomes can only be reported for checks with a verified agent signature.");
    }
    if (Date.now() - check.created_at.getTime() > OUTCOME_WINDOW_DAYS * 86_400_000) {
      fail(409, "too_late", `Outcomes must be reported within ${OUTCOME_WINDOW_DAYS} days of the check.`);
    }

    const [current] = await sql<OutcomeRow[]>`select outcome, status, reference, updated_at, disputed_at from outcomes where check_id = ${check.id}`;
    if (current && current.status !== "active") {
      fail(409, "locked", current.status === "disputed" ? "The agent's owner disputed this report. Confirm or withdraw it first." : "This report was resolved and can no longer change.");
    }
    await sql`
      insert into outcomes (check_id, account_id, agent_id, outcome, reference, counts)
      values (${check.id}, ${account.id}, ${check.agent_id}, ${input.outcome}, ${input.reference ?? null}, ${check.counts})
      on conflict (check_id) do update set outcome = excluded.outcome, reference = coalesce(excluded.reference, outcomes.reference), updated_at = now()`;
    return c.json(await presentCheck({ ...check, standing: await refreshStanding(check.agent_id) }));
  });

async function refreshStanding(agentId: string): Promise<Standing | null> {
  const [agent] = await sql<{ id: string; test_standing: string | null }[]>`select id, test_standing from agents where id = ${agentId}`;
  return agent ? loadStanding(agent) : null;
}
