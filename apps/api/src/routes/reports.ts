import { Hono } from "hono";
import { z } from "zod";
import { sql } from "../db.ts";
import { body, fail, requireAuth, type Env } from "../http.ts";
import { DISPUTE_WINDOW_DAYS } from "../standing.ts";

const windowStart = () => new Date(Date.now() - DISPUTE_WINDOW_DAYS * 86_400_000);

export const reports = new Hono<Env>()
  .use("*", requireAuth())

  // Disputes on reports this account made, waiting for it to confirm or withdraw.
  .get("/disputed", async (c) => {
    const rows = await sql<
      { check_id: string; outcome: string; reference: string | null; agent_id: string; agent_name: string; authority: string; disputed_at: Date; dispute_note: string | null }[]
    >`
      select o.check_id, o.outcome, o.reference, o.agent_id, a.name as agent_name, ch.authority, o.disputed_at, o.dispute_note
      from outcomes o join agents a on a.id = o.agent_id join checks ch on ch.id = o.check_id
      where o.account_id = ${c.get("account").id} and o.status = 'disputed' and o.disputed_at >= ${windowStart()}
      order by o.disputed_at`;
    return c.json({
      data: rows.map((r) => ({
        check_id: r.check_id,
        outcome: r.outcome,
        reference: r.reference,
        agent: { id: r.agent_id, name: r.agent_name },
        site: r.authority,
        disputed_at: r.disputed_at.toISOString(),
        dispute_note: r.dispute_note,
        resolve_by: new Date(r.disputed_at.getTime() + DISPUTE_WINDOW_DAYS * 86_400_000).toISOString(),
      })),
    });
  })

  // The agent's owner disputes a negative report. It is removed unless the
  // reporter confirms it within the dispute window.
  .post("/:checkId/dispute", async (c) => {
    const input = await body(c, z.object({ note: z.string().trim().min(1, "Say why the report is wrong.").max(1000) }));
    const [row] = await sql<{ status: string; outcome: string }[]>`
      select o.status, o.outcome from outcomes o join agents a on a.id = o.agent_id
      where o.check_id = ${c.req.param("checkId")} and a.account_id = ${c.get("account").id} and o.counts`;
    if (!row) fail(404, "not_found", "Report not found.");
    if (row.outcome === "completed") fail(409, "not_disputable", "Only negative reports can be disputed.");
    if (row.status !== "active") fail(409, "not_disputable", "This report was already disputed.");
    await sql`
      update outcomes set status = 'disputed', disputed_at = now(), dispute_note = ${input.note}
      where check_id = ${c.req.param("checkId")}`;
    return c.json({ ok: true, status: "disputed" });
  })

  .post("/:checkId/resolve", async (c) => {
    const input = await body(c, z.object({ resolution: z.enum(["confirm", "withdraw"]) }));
    const [row] = await sql<{ status: string; disputed_at: Date | null }[]>`
      select status, disputed_at from outcomes where check_id = ${c.req.param("checkId")} and account_id = ${c.get("account").id}`;
    if (!row) fail(404, "not_found", "Report not found.");
    if (row.status !== "disputed") fail(409, "not_disputed", "This report is not under dispute.");
    if (row.disputed_at && row.disputed_at < windowStart()) fail(409, "expired", "The dispute window closed and the report was removed.");
    const status = input.resolution === "confirm" ? "confirmed" : "removed";
    await sql`update outcomes set status = ${status}, resolved_at = now() where check_id = ${c.req.param("checkId")}`;
    return c.json({ ok: true, status });
  });
