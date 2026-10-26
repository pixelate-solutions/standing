import type { AgentKey } from "./agent.ts";

/**
 * Published test agents. Their private keys are public on purpose: sign
 * requests with them to see each decision while using a test API key.
 * Checks with a live key always deny them.
 */
export const TEST_AGENTS = {
  good: {
    id: "agt_testgood",
    name: "Test agent (good standing)",
    standing: "good",
    privateKey: { kty: "OKP", crv: "Ed25519", x: "vbALd_cPmoCZW2TEizDIfdKAVX688WXzNapFX0cV7Gw", d: "esb6k_UaPm5ZExjMq8bz1zEMKz1ZYiHmaUZQio3nWtE" },
  },
  poor: {
    id: "agt_testpoor",
    name: "Test agent (poor standing)",
    standing: "poor",
    privateKey: { kty: "OKP", crv: "Ed25519", x: "RiMDofEZhHsi02IsLWCdyrmkLYzPDxcSiNhN_IHz3WY", d: "hOPEahA5UOZy2NiHX4Uuc3nxVg1Gz8Ld9n2Ua27phXY" },
  },
  new: {
    id: "agt_testnew",
    name: "Test agent (no history)",
    standing: "unknown",
    privateKey: { kty: "OKP", crv: "Ed25519", x: "3cRS10dI0z8_LOBIZ8uQuWNDvEWZBVB7x9xFj24pz5M", d: "OKVkoZtDE8VPFm4iqdFc2iYT8mW1t9mv040aN0ct1nc" },
  },
} as const;

/** A key file for a test agent, ready for `createAgentFetch`. */
export function testAgentKey(which: keyof typeof TEST_AGENTS, agentsHost = "agents.standing.dev"): AgentKey {
  const agent = TEST_AGENTS[which];
  const scheme = agentsHost.includes("localhost") ? "http" : "https";
  return { agent_id: agent.id, directory: `${scheme}://${agent.id.replace("_", "-")}.${agentsHost}`, private_key: { ...agent.privateKey } };
}
