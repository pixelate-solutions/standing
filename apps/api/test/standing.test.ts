import { describe, expect, it } from "vitest";
import { computeStanding, levelFor, reliabilityFor, type OutcomeRow } from "../src/standing.ts";

const now = new Date("2026-09-30T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const row = (reporter: string, outcome: OutcomeRow["outcome"], extra: Partial<OutcomeRow> = {}): OutcomeRow => ({
  reporter,
  outcome,
  status: "active",
  updated_at: daysAgo(1),
  disputed_at: null,
  ...extra,
});
const many = (n: number, make: (i: number) => OutcomeRow) => Array.from({ length: n }, (_, i) => make(i));

describe("computeStanding", () => {
  it("is unknown with no or very little history", () => {
    expect(computeStanding([], new Map(), now)).toMatchObject({ level: "unknown", score: null, reports: 0, reporters: 0 });
    expect(computeStanding([row("a", "completed")], new Map(), now).level).toBe("unknown");
  });

  it("is good after many completed outcomes at independent businesses", () => {
    const rows = many(30, (i) => row(`biz${i % 10}`, "completed"));
    const s = computeStanding(rows, new Map(), now);
    expect(s.level).toBe("good");
    expect(s.reporters).toBe(10);
    expect(s.reports).toBe(30);
  });

  it("does not let one business outweigh many", () => {
    const oneBusiness = computeStanding(many(1000, () => row("a", "completed")), new Map(), now);
    const tenBusinesses = computeStanding(many(100, (i) => row(`b${i % 10}`, "completed")), new Map(), now);
    expect(tenBusinesses.score!).toBeGreaterThan(oneBusiness.score!);

    // One business flooding fraud reports cannot sink an agent that many others vouch for.
    const flooded = computeStanding([...many(100, (i) => row(`b${i % 20}`, "completed")), ...many(500, () => row("hostile", "fraud"))], new Map(), now);
    expect(flooded.level).not.toBe("poor");
  });

  it("is poor when several businesses report fraud", () => {
    const rows = [...many(5, (i) => row(`b${i}`, "completed")), ...many(4, (i) => row(`f${i}`, "fraud"))];
    expect(computeStanding(rows, new Map(), now).level).toBe("poor");
  });

  it("forgets old outcomes", () => {
    const fresh = computeStanding(many(6, (i) => row(`f${i}`, "abuse", { updated_at: daysAgo(1) })), new Map(), now);
    const stale = computeStanding(many(6, (i) => row(`f${i}`, "abuse", { updated_at: daysAgo(1500) })), new Map(), now);
    expect(stale.score ?? 50).toBeGreaterThan(fresh.score!);
  });

  it("ignores removed reports and disputes past the window, but counts open disputes", () => {
    const rows = [
      row("a", "fraud", { status: "removed" }),
      row("b", "fraud", { status: "disputed", disputed_at: daysAgo(40) }),
      row("c", "fraud", { status: "disputed", disputed_at: daysAgo(3) }),
    ];
    const s = computeStanding(rows, new Map(), now);
    expect(s.reports).toBe(1);
    expect(s.under_dispute).toBe(1);
  });

  it("discounts negative reports from unreliable reporters", () => {
    const rows = [...many(4, (i) => row(`g${i}`, "completed")), row("x", "fraud")];
    const trusted = computeStanding(rows, new Map(), now);
    const unreliable = computeStanding(rows, new Map([["x", reliabilityFor(0, 9)]]), now);
    expect(unreliable.score!).toBeGreaterThan(trusted.score!);
  });
});

describe("levels and reliability", () => {
  it("maps scores to levels", () => {
    expect(levelFor(90, 5)).toBe("good");
    expect(levelFor(60, 5)).toBe("neutral");
    expect(levelFor(20, 5)).toBe("poor");
    expect(levelFor(90, 0.5)).toBe("unknown");
  });

  it("bounds reliability", () => {
    expect(reliabilityFor(0, 0)).toBe(1);
    expect(reliabilityFor(0, 100)).toBe(0.25);
    expect(reliabilityFor(3, 1)).toBeCloseTo(0.8);
  });
});
