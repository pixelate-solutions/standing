"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useAccount } from "@/components/account-context";
import { Badge, Button, Code, DecisionBadge, Drawer, Empty, Field, Input, LevelBadge, Mono, Notice, PageHeader, Segmented, Select, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, dateTime, OUTCOME_LABEL, plural, REPORT_STATUS_LABEL } from "@/lib/format";
import { businessSnippet } from "@/lib/snippets";
import type { Check, Outcome } from "@/lib/types";

type Mode = "live" | "test";

function ReportOutcome({ check, onReported }: { check: Check; onReported: (c: Check) => void }) {
  const [reference, setReference] = useState(check.outcome?.reference ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = check.outcome && check.outcome.status !== "active";

  if (!check.signature.valid || !check.agent) {
    return <p className="text-zinc-500">Outcomes can only be reported for requests with a verified agent signature.</p>;
  }

  async function report(outcome: Outcome) {
    setBusy(true);
    setError(null);
    try {
      onReported(await api<Check>(`/checks/${check.id}/outcome`, { body: { outcome, reference: reference.trim() || undefined } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {check.outcome && (
        <p>
          Reported <strong>{OUTCOME_LABEL[check.outcome.outcome]}</strong> {ago(check.outcome.reported_at)}
          {check.outcome.reference && <> · <Mono>{check.outcome.reference}</Mono></>} · <span className="text-zinc-500">{REPORT_STATUS_LABEL[check.outcome.status]}</span>
        </p>
      )}
      {locked ? (
        <p className="text-zinc-500">{check.outcome?.status === "disputed" ? "The agent's owner disputed this report. Resolve it on the Reports page." : "This report is final."}</p>
      ) : (
        <>
          <Field label="Your reference (optional)" htmlFor="reference" hint="An order or ticket ID. Only you see it.">
            <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="order_123" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {(["completed", "disputed", "fraud", "abuse"] as const).map((o) => (
              <Button key={o} size="sm" variant={o === "completed" ? "secondary" : "danger"} disabled={busy} onClick={() => report(o)}>
                {OUTCOME_LABEL[o]}
              </Button>
            ))}
          </div>
          {!check.counts && (
            <p className="text-xs text-zinc-500">
              {check.mode === "test" ? "Test checks never affect standing." : "This report will not affect the agent's standing: it needs a live key, your verified domain, and an agent you don't own."}
            </p>
          )}
        </>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  );
}

function CheckDetail({ check, onReported }: { check: Check; onReported: (c: Check) => void }) {
  const s = check.standing;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-medium text-zinc-500">Decision at {dateTime(check.created_at)}</h3>
        <div className="flex items-center gap-2">
          <DecisionBadge decision={check.decision} />
          {!check.enforced && <Badge tone="outline">Monitor mode — not enforced</Badge>}
        </div>
        <ul className="mt-3 space-y-1.5">
          {check.reasons.map((r) => (
            <li key={r.code} className="flex gap-2">
              <Mono>{r.code}</Mono>
              <span className="text-zinc-600">{r.message}</span>
            </li>
          ))}
        </ul>
      </section>

      {check.agent && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-zinc-500">Agent</h3>
          <p>
            <Link href={`/agents/${check.agent.id}`} className="font-medium underline" target="_blank">
              {check.agent.name}
            </Link>{" "}
            <Mono>{check.agent.id}</Mono>
          </p>
          <p className="mt-1 text-zinc-600">
            {check.agent.owner ? `${check.agent.owner.name}${check.agent.owner.verified ? ` · ${check.agent.owner.domain} (verified)` : " (unverified)"}` : check.agent.directory}
          </p>
          {s && (
            <p className="mt-2 flex items-center gap-2">
              <LevelBadge level={s.level} score={s.score} />
              <span className="text-zinc-500">
                {plural(s.reports, "report")} from {plural(s.reporters, "business", "businesses")}, {s.negative} negative
              </span>
            </p>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-medium text-zinc-500">Request</h3>
        <dl className="grid grid-cols-[110px_1fr] gap-y-1">
          <dt className="text-zinc-500">Time</dt>
          <dd>{dateTime(check.created_at)}</dd>
          <dt className="text-zinc-500">Request</dt>
          <dd className="font-mono text-xs">
            {check.request.method} {check.request.authority}
            {check.request.path}
          </dd>
          <dt className="text-zinc-500">Action</dt>
          <dd>{check.request.action ?? "—"}</dd>
          <dt className="text-zinc-500">Key ID</dt>
          <dd className="break-all font-mono text-xs">{check.signature.kid ?? "—"}</dd>
          <dt className="text-zinc-500">Check ID</dt>
          <dd className="font-mono text-xs">{check.id}</dd>
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium text-zinc-500">Outcome</h3>
        <ReportOutcome check={check} onReported={onReported} />
      </section>
    </div>
  );
}

function ChecksPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAccount();
  const mode = (params.get("mode") === "test" ? "test" : "live") as Mode;
  const [decision, setDecision] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Check | null>(null);

  const load = useCallback(
    async (before?: string) => {
      const q = new URLSearchParams({ mode, limit: "50" });
      if (decision) q.set("decision", decision);
      if (before) q.set("before", before);
      const page = await api<{ data: Check[]; has_more: boolean }>(`/checks?${q}`);
      setChecks((prev) => (before && prev ? [...prev, ...page.data] : page.data));
      setHasMore(page.has_more);
    },
    [mode, decision],
  );

  useEffect(() => {
    setChecks(null);
    load();
  }, [load]);

  const replace = (updated: Check) => {
    setChecks((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
    setSelected(updated);
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Checks"
        description="Every signed agent request you asked Standing about."
        action={
          <Segmented
            label="Mode"
            value={mode}
            onChange={(m) => router.replace(m === "test" ? "/dashboard/checks?mode=test" : "/dashboard/checks")}
            options={[
              { value: "live", label: "Live" },
              { value: "test", label: "Test" },
            ]}
          />
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="decision" className="text-zinc-500">
          Decision
        </label>
        <Select id="decision" value={decision} onChange={(e) => setDecision(e.target.value)} className="h-8">
          <option value="">All</option>
          <option value="allow">Allow</option>
          <option value="challenge">Challenge</option>
          <option value="deny">Deny</option>
        </Select>
      </div>

      {checks === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : checks.length === 0 ? (
        <Empty title={decision ? "No checks match" : `No ${mode} checks yet`}>
          {!decision && (
            <div className="text-left">
              <p className="mb-3 text-center">Call Standing from your server when a signed agent request arrives.</p>
              <Code>{businessSnippet(mode === "test" ? "sd_test_…" : "sd_live_…")}</Code>
            </div>
          )}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <Th>Time</Th>
                <Th>Agent</Th>
                <Th>Request</Th>
                <Th>Decision</Th>
                <Th>Standing</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {checks.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c)} className="cursor-pointer hover:bg-zinc-50" data-testid="check-row">
                  <Td className="whitespace-nowrap text-zinc-500">{ago(c.created_at)}</Td>
                  <Td>{c.agent ? c.agent.name : <span className="text-zinc-500">Unknown key</span>}</Td>
                  <Td>
                    <span className="font-mono text-xs">
                      {c.request.method} {c.request.path}
                    </span>
                    {c.request.action && <span className="ml-2 text-zinc-500">{c.request.action}</span>}
                  </Td>
                  <Td>
                    <DecisionBadge decision={c.decision} />
                  </Td>
                  <Td>{c.standing ? <LevelBadge level={c.standing.level} score={c.standing.score} /> : <span className="text-zinc-400">—</span>}</Td>
                  <Td className="text-zinc-600">{c.outcome ? OUTCOME_LABEL[c.outcome.outcome] : <span className="text-zinc-400">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="border-t border-zinc-100 p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => load(checks.at(-1)?.id)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      <Drawer open={selected !== null} onClose={() => setSelected(null)} title="Check">
        {selected && <CheckDetail check={selected} onReported={replace} />}
      </Drawer>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChecksPage />
    </Suspense>
  );
}
