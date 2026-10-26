"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useAccount } from "@/components/account-context";
import { Card, Code, PageHeader } from "@/components/ui";
import { businessSnippet } from "@/lib/snippets";

function Step({ done, title, children, href, action }: { done: boolean; title: string; children?: React.ReactNode; href: string; action: string }) {
  return (
    <li className="flex gap-3 py-3">
      {done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Done" /> : <Circle size={18} className="mt-0.5 shrink-0 text-zinc-300" aria-label="Not done" />}
      <div className="flex-1">
        <p className={done ? "text-zinc-500 line-through" : "font-medium"}>{title}</p>
        {!done && children && <div className="mt-1 text-zinc-500">{children}</div>}
      </div>
      {!done && (
        <Link href={href} className="self-start text-sm font-medium underline">
          {action}
        </Link>
      )}
    </li>
  );
}

export default function Overview() {
  const { account, overview } = useAccount();
  if (!overview) return null;
  const checks = overview.live_checks + overview.test_checks;

  return (
    <>
      <PageHeader title="Overview" />

      {(overview.reports_to_review > 0 || overview.disputes_to_resolve > 0) && (
        <Card className="mb-6" title="Needs attention">
          <ul className="space-y-1">
            {overview.disputes_to_resolve > 0 && (
              <li>
                <Link href="/dashboard/reports" className="underline">
                  {overview.disputes_to_resolve} of your reports {overview.disputes_to_resolve === 1 ? "is" : "are"} disputed
                </Link>{" "}
                <span className="text-zinc-500">— confirm or withdraw within 30 days or they are removed.</span>
              </li>
            )}
            {overview.reports_to_review > 0 && (
              <li>
                <Link href="/dashboard/agents" className="underline">
                  {overview.reports_to_review} negative {overview.reports_to_review === 1 ? "report" : "reports"} about your agents
                </Link>{" "}
                <span className="text-zinc-500">— review and dispute any that are wrong.</span>
              </li>
            )}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Check agents on your site">
          <ol className="-my-3 divide-y divide-zinc-100">
            <Step done={account.domain_verified} title="Verify your domain" href="/dashboard/settings" action="Verify">
              Your reports count toward agents&apos; standing only for requests to your verified domain.
            </Step>
            <Step done={overview.keys > 0} title="Create an API key" href="/dashboard/keys" action="Create" />
            <Step done={checks > 0} title="Check your first agent request" href="/docs#businesses" action="Docs">
              Try it with a test key and a published test agent.
            </Step>
          </ol>
        </Card>
        <Card title="If you run agents" description="Optional. Skip this if you only check agents.">
          <ol className="-my-3 divide-y divide-zinc-100">
            <Step done={overview.agents > 0} title="Register an agent" href="/dashboard/agents" action="Register">
              You get a key file. Your agent signs its requests with it.
            </Step>
            <Step done={account.domain_verified} title="Verify your domain" href="/dashboard/settings" action="Verify">
              Sites see your agents as owned by a verified organization.
            </Step>
          </ol>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Live checks", overview.live_checks, "/dashboard/checks"],
          ["Test checks", overview.test_checks, "/dashboard/checks?mode=test"],
          ["Agents", overview.agents, "/dashboard/agents"],
          ["API keys", overview.keys, "/dashboard/keys"],
        ].map(([label, value, href]) => (
          <Link key={label as string} href={href as string} className="rounded-lg border border-zinc-200 px-4 py-3 hover:border-zinc-400">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
          </Link>
        ))}
      </div>

      {checks === 0 && (
        <div className="mt-6">
          <Code label="Add to your server">{businessSnippet()}</Code>
        </div>
      )}
    </>
  );
}
