import { sql } from "./db.ts";

export type Outcome = "completed" | "disputed" | "fraud" | "abuse";
export type Level = "good" | "neutral" | "poor" | "unknown";

export type Standing = {
  level: Level;
  score: number | null;
  reports: number;
  reporters: number;
  negative: number;
  under_dispute: number;
  last_report_at: string | null;
};

export type OutcomeRow = {
  reporter: string;
  outcome: Outcome;
  status: "active" | "disputed" | "confirmed" | "removed";
  updated_at: Date;
  disputed_at: Date | null;
};

const DAY = 86_400_000;
export const DISPUTE_WINDOW_DAYS = 30;

// Older reports matter less. Fraud and abuse fade more slowly than routine outcomes.
const HALF_LIFE_DAYS: Record<Outcome, number> = { completed: 180, disputed: 180, abuse: 365, fraud: 365 };
// How much one report weighs. Negative outcomes outweigh a completed one.
const SEVERITY: Record<Outcome, number> = { completed: 1, disputed: 2, abuse: 10, fraud: 20 };

export function isExpiredDispute(row: Pick<OutcomeRow, "status" | "disputed_at">, now: Date): boolean {
  return row.status === "disputed" && row.disputed_at !== null && now.getTime() - row.disputed_at.getTime() > DISPUTE_WINDOW_DAYS * DAY;
}

export function levelFor(score: number, evidence: number): Level {
  if (evidence < 1) return "unknown";
  if (score >= 80) return "good";
  if (score >= 50) return "neutral";
  return "poor";
}

/**
 * Standing from outcomes reported by verified businesses.
 *
 * Each business's reports are summed and then log-scaled, so a single business
 * cannot outweigh many independent ones. Negative reports are multiplied by the
 * reporter's reliability (how often its disputed reports held up).
 */
export function computeStanding(rows: OutcomeRow[], reliability: Map<string, number>, now = new Date()): Standing {
  const perReporter = new Map<string, { pos: number; neg: number }>();
  let reports = 0;
  let negative = 0;
  let underDispute = 0;
  let last: Date | null = null;

  for (const row of rows) {
    if (row.status === "removed" || isExpiredDispute(row, now)) continue;
    reports++;
    if (row.outcome !== "completed") negative++;
    if (row.status === "disputed") underDispute++;
    if (!last || row.updated_at > last) last = row.updated_at;

    const ageDays = Math.max(0, now.getTime() - row.updated_at.getTime()) / DAY;
    const weight = SEVERITY[row.outcome] * 0.5 ** (ageDays / HALF_LIFE_DAYS[row.outcome]);
    const totals = perReporter.get(row.reporter) ?? { pos: 0, neg: 0 };
    if (row.outcome === "completed") totals.pos += weight;
    else totals.neg += weight;
    perReporter.set(row.reporter, totals);
  }

  let positive = 0;
  let negativeWeight = 0;
  for (const [reporter, totals] of perReporter) {
    positive += Math.log1p(totals.pos);
    negativeWeight += (reliability.get(reporter) ?? 1) * Math.log1p(totals.neg);
  }

  const evidence = positive + negativeWeight;
  const score = Math.round((100 * (positive + 1)) / (positive + negativeWeight + 2));
  const level = levelFor(score, evidence);
  return {
    level,
    score: level === "unknown" ? null : score,
    reports,
    reporters: perReporter.size,
    negative,
    under_dispute: underDispute,
    last_report_at: last ? last.toISOString() : null,
  };
}

// A reporter whose disputed reports keep getting withdrawn or left unconfirmed
// loses weight on its future negative reports.
export function reliabilityFor(confirmed: number, removed: number): number {
  return Math.max(0.25, (1 + confirmed) / (1 + confirmed + removed));
}

const TEST_STANDING: Record<string, Standing> = {
  good: { level: "good", score: 94, reports: 120, reporters: 14, negative: 1, under_dispute: 0, last_report_at: null },
  poor: { level: "poor", score: 18, reports: 40, reporters: 6, negative: 22, under_dispute: 0, last_report_at: null },
  unknown: { level: "unknown", score: null, reports: 0, reporters: 0, negative: 0, under_dispute: 0, last_report_at: null },
};

export async function loadStanding(agent: { id: string; test_standing: string | null }, now = new Date()): Promise<Standing> {
  if (agent.test_standing) return { ...TEST_STANDING[agent.test_standing]! };

  const rows = await sql<OutcomeRow[]>`
    select account_id as reporter, outcome, status, updated_at, disputed_at
    from outcomes where agent_id = ${agent.id} and counts`;
  const reporters = [...new Set(rows.map((r) => r.reporter))];
  const reliability = new Map<string, number>();
  if (reporters.length > 0) {
    const stats = await sql<{ reporter: string; confirmed: number; removed: number }[]>`
      select account_id as reporter,
        count(*) filter (where status = 'confirmed')::int as confirmed,
        count(*) filter (where disputed_at is not null and (status = 'removed'
          or (status = 'disputed' and disputed_at < ${new Date(now.getTime() - DISPUTE_WINDOW_DAYS * DAY)})))::int as removed
      from outcomes where account_id in ${sql(reporters)} and counts
      group by account_id`;
    for (const s of stats) reliability.set(s.reporter, reliabilityFor(s.confirmed, s.removed));
  }
  return computeStanding(rows, reliability, now);
}
