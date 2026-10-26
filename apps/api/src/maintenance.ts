import { sql } from "./db.ts";
import { DISPUTE_WINDOW_DAYS } from "./standing.ts";

// How long records are kept. Negative outcomes are kept longer than routine
// ones; checks nobody reported on are dropped soonest.
export const RETENTION_DAYS = { unreported: 90, completed: 365, negative: 730 };

export async function runMaintenance(now = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  await sql`delete from sessions where expires_at < ${now}`;
  await sql`delete from replays where expires_at < ${now}`;
  await sql`
    update outcomes set status = 'removed', resolved_at = disputed_at + make_interval(days => ${DISPUTE_WINDOW_DAYS})
    where status = 'disputed' and disputed_at < ${days(DISPUTE_WINDOW_DAYS)}`;
  await sql`
    delete from checks c where c.created_at < ${days(RETENTION_DAYS.unreported)}
      and not exists (select 1 from outcomes o where o.check_id = c.id)`;
  await sql`
    delete from checks c using outcomes o where o.check_id = c.id and (
      (o.outcome = 'completed' and o.updated_at < ${days(RETENTION_DAYS.completed)})
      or (o.outcome <> 'completed' and o.updated_at < ${days(RETENTION_DAYS.negative)}))`;
}

export function scheduleMaintenance(everyMs = 60 * 60_000) {
  const run = () => runMaintenance().catch((error) => console.error("maintenance failed", error));
  run();
  return setInterval(run, everyMs).unref();
}
