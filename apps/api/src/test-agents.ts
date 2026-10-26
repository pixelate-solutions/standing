import { TEST_AGENTS as PUBLISHED } from "@standing/sdk/testing";
import { sql } from "./db.ts";
import { thumbprint, type PublicJwk } from "./crypto.ts";

export const TEST_AGENTS = Object.values(PUBLISHED).map((a) => ({ id: a.id, name: a.name, standing: a.standing, jwk: a.privateKey }));

export async function seedTestAgents() {
  for (const agent of TEST_AGENTS) {
    const jwk: PublicJwk = { kty: "OKP", crv: "Ed25519", x: agent.jwk.x };
    await sql`
      insert into agents (id, name, test_standing) values (${agent.id}, ${agent.name}, ${agent.standing})
      on conflict (id) do nothing`;
    await sql`
      insert into agent_keys (kid, agent_id, jwk) values (${thumbprint(jwk)}, ${agent.id}, ${sql.json(jwk)})
      on conflict (kid) do nothing`;
  }
}
