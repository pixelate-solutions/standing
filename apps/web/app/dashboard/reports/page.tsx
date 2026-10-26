"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "@/components/account-context";
import { Button, Card, Empty, Mono, Notice, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, OUTCOME_LABEL } from "@/lib/format";
import type { AgentWithStanding, DisputeToResolve } from "@/lib/types";

export default function ReportsPage() {
  const { refresh } = useAccount();
  const [disputes, setDisputes] = useState<DisputeToResolve[] | null>(null);
  const [agents, setAgents] = useState<AgentWithStanding[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [d, a] = await Promise.all([api<{ data: DisputeToResolve[] }>("/reports/disputed"), api<{ data: AgentWithStanding[] }>("/agents")]);
    setDisputes(d.data);
    setAgents(a.data);
  };
  useEffect(() => {
    load();
  }, []);

  async function resolve(checkId: string, resolution: "confirm" | "withdraw") {
    setError(null);
    try {
      await api(`/reports/${checkId}/resolve`, { body: { resolution } });
      await load();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const agentsWithNegatives = agents.filter((a) => a.standing.negative > 0);

  return (
    <>
      <PageHeader title="Reports" description="Disputes on reports you made, and negative reports about your agents." />
      {error && (
        <div className="mb-4">
          <Notice tone="red">{error}</Notice>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-semibold">Disputed by agent owners</h2>
        {disputes === null ? (
          <p className="text-zinc-500">Loading…</p>
        ) : disputes.length === 0 ? (
          <Empty title="No open disputes">When an agent&apos;s owner disputes one of your reports, it appears here. You have 30 days to confirm or withdraw it.</Empty>
        ) : (
          <div className="space-y-3">
            {disputes.map((d) => (
              <Card key={d.check_id}>
                <div className="flex items-start justify-between gap-4" data-testid="dispute">
                  <div>
                    <p>
                      You reported <strong>{OUTCOME_LABEL[d.outcome]}</strong> for{" "}
                      <Link href={`/agents/${d.agent.id}`} className="underline" target="_blank">
                        {d.agent.name}
                      </Link>{" "}
                      on <Mono>{d.site}</Mono>
                      {d.reference && (
                        <>
                          {" "}
                          · <Mono>{d.reference}</Mono>
                        </>
                      )}
                    </p>
                    <blockquote className="mt-2 border-l-2 border-zinc-200 pl-3 text-zinc-600">{d.dispute_note}</blockquote>
                    <p className="mt-2 text-xs text-zinc-500">
                      Disputed {ago(d.disputed_at)}. Removed {ago(d.resolve_by)} unless you confirm it.
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => resolve(d.check_id, "withdraw")}>
                      Withdraw
                    </Button>
                    <Button size="sm" onClick={() => resolve(d.check_id, "confirm")}>
                      Confirm
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">About your agents</h2>
        {agentsWithNegatives.length === 0 ? (
          <Empty title="No negative reports about your agents" />
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {agentsWithNegatives.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3">
                <span>
                  <span className="font-medium">{a.name}</span> <span className="text-zinc-500">· {a.standing.negative} negative</span>
                </span>
                <Link href={`/dashboard/agents/${a.id}`} className="font-medium underline">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
