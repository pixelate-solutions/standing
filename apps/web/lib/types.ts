import type { Agent, AgentStanding, Check } from "@standing/sdk";

export type { Agent, AgentStanding, Check, Decision, Level, Outcome } from "@standing/sdk";

export type Account = {
  id: string;
  name: string;
  email: string;
  domain: string | null;
  domain_verified: boolean;
  domain_token: string;
  created_at: string;
};

export type AgentWithStanding = Agent & { standing: AgentStanding };

export type ApiKey = { id: string; name: string; mode: "test" | "live"; hint: string; created_at: string; last_used_at: string | null };

export type Policy = { mode: "monitor" | "enforce"; unknown_action: Check["decision"]; poor_action: Check["decision"] };

export type Overview = {
  keys: number;
  live_checks: number;
  test_checks: number;
  agents: number;
  reports_to_review: number;
  disputes_to_resolve: number;
};

export type AgentReport = {
  check_id: string;
  outcome: string;
  status: "active" | "disputed" | "confirmed" | "removed";
  site: string;
  action: string | null;
  reported_at: string;
  disputed_at: string | null;
  dispute_note: string | null;
  resolve_by: string | null;
  can_dispute: boolean;
};

export type DisputeToResolve = {
  check_id: string;
  outcome: string;
  reference: string | null;
  agent: { id: string; name: string };
  site: string;
  disputed_at: string;
  dispute_note: string | null;
  resolve_by: string;
};
