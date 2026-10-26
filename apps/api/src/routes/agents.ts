import { Hono, type Context } from "hono";
import { z } from "zod";
import { isEd25519PublicJwk, randomId, thumbprint, verifyProof, type PublicJwk } from "../crypto.ts";
import { sql } from "../db.ts";
import { body, clientIp, fail, rateLimit, requireAuth, type Env } from "../http.ts";
import { directoryUrlFor, loadOwner, presentAgent } from "../present.ts";
import { DISPUTE_WINDOW_DAYS, loadStanding } from "../standing.ts";
import type { AgentRow } from "../verify.ts";

type FullAgent = AgentRow & { created_at: Date };

const keyInput = z.object({
  public_key: z.custom<PublicJwk>(isEd25519PublicJwk, "Must be an Ed25519 public JWK: {kty: \"OKP\", crv: \"Ed25519\", x}"),
  proof: z.string().min(1).max(200),
});

async function findAgent(id: string): Promise<FullAgent | null> {
  const [row] = await sql<FullAgent[]>`
    select id, account_id, name, directory_url, test_standing, revoked_at, created_at from agents where id = ${id}`;
  return row ?? null;
}

async function ownAgent(c: Context<Env>): Promise<FullAgent> {
  const agent = await findAgent(c.req.param("id")!);
  if (!agent || agent.account_id !== c.get("account").id) fail(404, "not_found", "Agent not found.");
  return agent;
}

async function addKey(accountId: string, agentId: string, input: z.infer<typeof keyInput>) {
  const jwk: PublicJwk = { kty: "OKP", crv: "Ed25519", x: input.public_key.x };
  if (!verifyProof(accountId, jwk, input.proof)) {
    fail(422, "invalid_proof", "Proof must be the key's signature over `standing-key-proof:<account_id>:<x>`.");
  }
  const kid = thumbprint(jwk);
  const [existing] = await sql`select 1 from agent_keys where kid = ${kid}`;
  if (existing) fail(409, "key_in_use", "This key is already registered.");
  await sql`insert into agent_keys (kid, agent_id, jwk) values (${kid}, ${agentId}, ${sql.json(jwk)})`;
  return kid;
}

async function listKeys(agentId: string) {
  const rows = await sql<{ kid: string; jwk: PublicJwk; created_at: Date }[]>`
    select kid, jwk, created_at from agent_keys where agent_id = ${agentId} and revoked_at is null order by created_at`;
  return rows.map((k) => ({ kid: k.kid, public_key: k.jwk, created_at: k.created_at.toISOString() }));
}

export async function jwksFor(agentId: string) {
  const rows = await sql<{ kid: string; jwk: PublicJwk }[]>`
    select k.kid, k.jwk from agent_keys k join agents a on a.id = k.agent_id
    where k.agent_id = ${agentId} and k.revoked_at is null and a.revoked_at is null`;
  return { keys: rows.map((k) => ({ ...k.jwk, kid: k.kid, alg: "EdDSA", use: "sig" })) };
}

export const agents = new Hono<Env>()
  .get("/", requireAuth(), async (c) => {
    const rows = await sql<FullAgent[]>`
      select id, account_id, name, directory_url, test_standing, revoked_at, created_at
      from agents where account_id = ${c.get("account").id} order by created_at desc`;
    const owner = await loadOwner({ account_id: c.get("account").id });
    const data = await Promise.all(rows.map(async (a) => presentAgent(a, owner, await loadStanding(a))));
    return c.json({ data });
  })

  .post("/", requireAuth(), async (c) => {
    const input = await body(c, keyInput.extend({ name: z.string().trim().min(1).max(80) }));
    const accountId = c.get("account").id;
    const id = randomId("agt");
    const [agent] = await sql<FullAgent[]>`
      insert into agents (id, account_id, name) values (${id}, ${accountId}, ${input.name})
      returning id, account_id, name, directory_url, test_standing, revoked_at, created_at`;
    let kid: string;
    try {
      kid = await addKey(accountId, id, input);
    } catch (error) {
      await sql`delete from agents where id = ${id}`;
      throw error;
    }
    const presented = presentAgent(agent!, await loadOwner(agent!), await loadStanding(agent!));
    return c.json({ agent: { ...presented, kid } }, 201);
  })

  .get("/:id", rateLimit("lookup", 120, 60_000, clientIp), async (c) => {
    const agent = await findAgent(c.req.param("id"));
    if (!agent) fail(404, "not_found", "No agent with this ID.");
    return c.json({ agent: presentAgent(agent, await loadOwner(agent), await loadStanding(agent)) });
  })

  .get("/:id/jwks", async (c) => {
    const agent = await findAgent(c.req.param("id"));
    if (!agent || !agent.account_id && !agent.test_standing) fail(404, "not_found", "No key directory for this agent.");
    c.header("content-type", "application/http-message-signatures-directory+json");
    c.header("cache-control", "public, max-age=300");
    return c.body(JSON.stringify(await jwksFor(agent.id)));
  })

  .get("/:id/keys", requireAuth(), async (c) => {
    const agent = await ownAgent(c);
    return c.json({ data: await listKeys(agent.id), directory: directoryUrlFor(agent.id) });
  })

  .post("/:id/keys", requireAuth(), async (c) => {
    const agent = await ownAgent(c);
    if (agent.revoked_at) fail(409, "agent_revoked", "This agent is revoked.");
    const kid = await addKey(c.get("account").id, agent.id, await body(c, keyInput));
    return c.json({ kid, data: await listKeys(agent.id) }, 201);
  })

  .delete("/:id/keys/:kid", requireAuth(), async (c) => {
    const agent = await ownAgent(c);
    const [row] = await sql`
      update agent_keys set revoked_at = now() where kid = ${c.req.param("kid")} and agent_id = ${agent.id} and revoked_at is null returning kid`;
    if (!row) fail(404, "not_found", "Key not found.");
    return c.json({ data: await listKeys(agent.id) });
  })

  .post("/:id/revoke", requireAuth(), async (c) => {
    const agent = await ownAgent(c);
    const [row] = await sql<FullAgent[]>`
      update agents set revoked_at = coalesce(revoked_at, now()) where id = ${agent.id}
      returning id, account_id, name, directory_url, test_standing, revoked_at, created_at`;
    return c.json({ agent: presentAgent(row!, await loadOwner(row!), await loadStanding(row!)) });
  })

  // Every report that affects this agent's standing, so the owner can dispute it.
  .get("/:id/reports", requireAuth(), async (c) => {
    const agent = await ownAgent(c);
    const rows = await sql<
      { check_id: string; outcome: string; status: string; authority: string; action: string | null; created_at: Date; updated_at: Date; disputed_at: Date | null; dispute_note: string | null; resolved_at: Date | null }[]
    >`
      select o.check_id, o.outcome, o.status, ch.authority, ch.action, o.created_at, o.updated_at, o.disputed_at, o.dispute_note, o.resolved_at
      from outcomes o join checks ch on ch.id = o.check_id
      where o.agent_id = ${agent.id} and o.counts order by o.updated_at desc limit 500`;
    const now = Date.now();
    return c.json({
      data: rows.map((r) => {
        const expired = r.status === "disputed" && r.disputed_at && now - r.disputed_at.getTime() > DISPUTE_WINDOW_DAYS * 86_400_000;
        return {
          check_id: r.check_id,
          outcome: r.outcome,
          status: expired ? "removed" : r.status,
          site: r.authority,
          action: r.action,
          reported_at: r.updated_at.toISOString(),
          disputed_at: r.disputed_at?.toISOString() ?? null,
          dispute_note: r.dispute_note,
          resolve_by: r.disputed_at ? new Date(r.disputed_at.getTime() + DISPUTE_WINDOW_DAYS * 86_400_000).toISOString() : null,
          can_dispute: r.outcome !== "completed" && r.status === "active",
        };
      }),
    });
  });
