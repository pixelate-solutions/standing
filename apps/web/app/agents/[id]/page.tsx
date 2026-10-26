import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LookupForm } from "@/components/lookup-form";
import { SiteHeader } from "@/components/site-header";
import { Badge, LevelBadge } from "@/components/ui";
import { serverApi } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import type { AgentWithStanding } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id };
}

const LEVEL_TEXT: Record<string, string> = {
  good: "Businesses report this agent's interactions complete as expected.",
  neutral: "Limited or mixed history.",
  poor: "Businesses have reported fraud, abuse, or disputed payments.",
  unknown: "New: not enough reported outcomes to judge yet.",
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await serverApi<{ agent: AgentWithStanding }>(`/agents/${encodeURIComponent(id)}`);
  if (!result) notFound();
  const { agent } = result;
  const s = agent.standing;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 max-w-md">
          <LookupForm initial={agent.id} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          {agent.revoked && <Badge tone="red">Revoked</Badge>}
          {agent.test && <Badge tone="amber">Test agent</Badge>}
          {!agent.registered && !agent.test && <Badge tone="outline">Not registered</Badge>}
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-500">{agent.id}</p>

        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Owner</dt>
            <dd className="mt-0.5">
              {agent.owner ? (
                agent.owner.verified ? (
                  <span className="inline-flex items-center gap-1">
                    {agent.owner.name} · {agent.owner.domain}
                    <BadgeCheck size={15} className="text-emerald-600" aria-label="Domain verified" />
                  </span>
                ) : (
                  <span>
                    {agent.owner.name} <span className="text-zinc-500">(domain not verified)</span>
                  </span>
                )
              ) : agent.test ? (
                "Standing (published test agent)"
              ) : (
                <span className="text-zinc-500">Unknown. Keys are self-published.</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">First seen</dt>
            <dd className="mt-0.5">{dateTime(agent.created_at)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-zinc-500">Key directory</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{agent.directory ?? "—"}</dd>
          </div>
        </dl>

        <section className="mt-8 rounded-lg border border-zinc-200 p-5" aria-label="Standing">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Standing</h2>
            <LevelBadge level={s.level} score={s.score} />
          </div>
          <p className="mt-1 text-zinc-500">{LEVEL_TEXT[s.level]}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Score" value={s.score ?? "—"} />
            <Stat label="Reports" value={s.reports} />
            <Stat label="Businesses" value={s.reporters} />
            <Stat label="Negative" value={s.negative} />
            <Stat label="Under dispute" value={s.under_dispute} />
          </dl>
          <p className="mt-5 text-xs text-zinc-500">
            Last report {ago(s.last_report_at)}. Only reports from businesses with verified domains count, and only as totals.
            {s.score === null && s.level !== "unknown" && " Scores are shown only for agents owned by a verified organization."}{" "}
            <Link href="/docs#standing" className="underline">
              How standing works
            </Link>
          </p>
        </section>
      </main>
    </>
  );
}
