export type Decision = "allow" | "challenge" | "deny";
export type Outcome = "completed" | "disputed" | "fraud" | "abuse";
export type Level = "good" | "neutral" | "poor" | "unknown";

export type Reason = { code: string; message: string };

export type AgentStanding = {
  level: Level;
  /** 0–100. Only present when a verified organization owns the agent. */
  score: number | null;
  reports: number;
  reporters: number;
  negative: number;
  under_dispute: number;
  last_report_at: string | null;
};

export type Agent = {
  id: string;
  name: string;
  registered: boolean;
  owner: { name: string; domain: string | null; verified: boolean } | null;
  directory: string | null;
  test: boolean;
  revoked: boolean;
  created_at: string;
};

export type Check = {
  id: string;
  decision: Decision;
  /** False while your policy is in monitor mode: the decision is advisory. */
  enforced: boolean;
  mode: "test" | "live";
  reasons: Reason[];
  agent: Agent | null;
  standing: AgentStanding | null;
  signature: { valid: boolean; kid: string | null };
  request: { method: string; authority: string; path: string; action: string | null };
  counts: boolean;
  outcome: { outcome: Outcome; status: string; reference: string | null; reported_at: string } | null;
  created_at: string;
};

export type StandingError = { code: string; message: string };
