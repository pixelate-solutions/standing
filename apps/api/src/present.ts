import { sql } from "./db.ts";
import type { Owner } from "./decide.ts";
import { env } from "./env.ts";
import type { Standing } from "./standing.ts";
import { agentHostLabel, type AgentRow } from "./verify.ts";

export async function loadOwner(agent: Pick<AgentRow, "account_id">): Promise<Owner> {
  if (!agent.account_id) return null;
  const [row] = await sql<{ name: string; domain: string | null; domain_verified_at: Date | null }[]>`
    select name, domain, domain_verified_at from accounts where id = ${agent.account_id}`;
  if (!row) return null;
  const verified = row.domain_verified_at !== null;
  return { name: row.name, domain: verified ? row.domain : null, verified };
}

export function directoryUrlFor(agentId: string): string {
  const scheme = new URL(env.publicUrl).protocol;
  return `${scheme}//${agentHostLabel(agentId)}.${env.agentsHost}`;
}

/**
 * What anyone may see about an agent. Numeric scores are shown only when a
 * verified organization owns the agent; otherwise only the level.
 */
export function presentAgent(agent: AgentRow & { created_at: Date }, owner: Owner, standing: Standing) {
  const showScore = Boolean(agent.test_standing) || Boolean(owner?.verified);
  return {
    id: agent.id,
    name: agent.name,
    registered: agent.account_id !== null,
    owner,
    directory: agent.account_id || agent.test_standing ? directoryUrlFor(agent.id) : agent.directory_url,
    test: Boolean(agent.test_standing),
    revoked: agent.revoked_at !== null,
    created_at: agent.created_at.toISOString(),
    standing: { ...standing, score: showScore ? standing.score : null },
  };
}
