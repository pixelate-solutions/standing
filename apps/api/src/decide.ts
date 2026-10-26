import type { Standing } from "./standing.ts";
import type { AgentRow, Reason, Verification } from "./verify.ts";

export type Decision = "allow" | "challenge" | "deny";
export type Policy = { mode: "monitor" | "enforce"; unknown_action: Decision; poor_action: Decision };
export type Owner = { name: string; domain: string | null; verified: boolean } | null;

const OWNER_REASON = {
  verified: (o: NonNullable<Owner>) => ({ code: "owner_verified", message: `Registered by ${o.name} (${o.domain}), domain verified.` }),
  unverified: (o: NonNullable<Owner>) => ({ code: "owner_unverified", message: `Registered by ${o.name}. Domain not verified.` }),
  selfHosted: (a: AgentRow) => ({ code: "self_hosted", message: `Keys published at ${a.directory_url}. Not registered with Standing.` }),
};

const STANDING_REASON: Record<Standing["level"], Reason> = {
  good: { code: "standing_good", message: "Good standing across businesses that reported outcomes." },
  neutral: { code: "standing_neutral", message: "Mixed or limited history." },
  poor: { code: "standing_poor", message: "Poor standing: businesses reported fraud, abuse, or disputes." },
  unknown: { code: "standing_unknown", message: "New agent: not enough reported outcomes yet." },
};

export function decide(input: {
  verification: Exclude<Verification, { status: "unsigned" }>;
  owner: Owner;
  standing: Standing | null;
  policy: Policy;
  mode: "test" | "live";
}): { decision: Decision; reasons: Reason[] } {
  const { verification, owner, standing, policy, mode } = input;

  if (verification.status === "invalid") return { decision: "deny", reasons: [verification.reason] };
  if (verification.status === "unverified") return { decision: "challenge", reasons: [verification.reason] };

  const agent = verification.agent;
  const reasons: Reason[] = [{ code: "signature_valid", message: "Signature verified." }];
  if (agent.revoked_at) return { decision: "deny", reasons: [...reasons, { code: "agent_revoked", message: "The owner revoked this agent." }] };
  if (agent.test_standing && mode === "live") {
    return { decision: "deny", reasons: [...reasons, { code: "test_agent", message: "Test agents are denied when using a live key." }] };
  }

  if (agent.test_standing) reasons.push({ code: "test_agent", message: "Published test agent with fixed standing." });
  else if (owner) reasons.push(owner.verified ? OWNER_REASON.verified(owner) : OWNER_REASON.unverified(owner));
  else reasons.push(OWNER_REASON.selfHosted(agent));

  const level = standing?.level ?? "unknown";
  reasons.push(STANDING_REASON[level]);
  if (level === "poor") return { decision: policy.poor_action, reasons };
  if (level === "unknown") return { decision: policy.unknown_action, reasons };
  return { decision: "allow", reasons };
}

// A business's reports only count for requests made to its own verified domain.
export function authorityMatchesDomain(authority: string, domain: string): boolean {
  const a = authority.toLowerCase();
  const d = domain.toLowerCase();
  if (d.includes(":")) return a === d;
  const host = a.replace(/:\d+$/, "");
  return host === d || host.endsWith(`.${d}`);
}
