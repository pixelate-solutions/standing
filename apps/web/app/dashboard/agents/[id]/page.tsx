"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AgentKey } from "@standing/sdk/agent";
import { useAccount } from "@/components/account-context";
import { KeyFile, newKeyPair } from "@/components/key-file";
import { Badge, Button, Card, Code, Empty, Field, LevelBadge, Modal, Mono, Notice, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, dateTime, OUTCOME_LABEL, REPORT_STATUS_LABEL } from "@/lib/format";
import { agentSnippet } from "@/lib/snippets";
import type { AgentReport, AgentWithStanding } from "@/lib/types";

type Key = { kid: string; created_at: string };

function DisputeButton({ report, onDone }: { report: AgentReport; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Dispute
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Dispute report">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api(`/reports/${report.check_id}/dispute`, { body: { note } });
              setOpen(false);
              onDone();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-zinc-600">
            {report.site} reported <strong>{OUTCOME_LABEL[report.outcome]}</strong> {ago(report.reported_at)}. They have 30 days to confirm it. If they don&apos;t, it is removed.
          </p>
          <Field label="Why is this report wrong?" htmlFor="note" hint="The reporting business sees this note.">
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
              maxLength={1000}
              rows={4}
              className="w-full rounded-md border border-zinc-200 p-3 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </Field>
          {error && <Notice tone="red">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !note.trim()}>
              Send dispute
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const { account, refresh } = useAccount();
  const [agent, setAgent] = useState<AgentWithStanding | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [newKey, setNewKey] = useState<AgentKey | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, k, r] = await Promise.all([
      api<{ agent: AgentWithStanding }>(`/agents/${id}`),
      api<{ data: Key[] }>(`/agents/${id}/keys`),
      api<{ data: AgentReport[] }>(`/agents/${id}/reports`),
    ]);
    setAgent(a.agent);
    setKeys(k.data);
    setReports(r.data);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  if (error && !agent) return <Notice tone="red">{error}</Notice>;
  if (!agent) return <p className="text-zinc-500">Loading…</p>;
  const s = agent.standing;

  async function addKey() {
    setError(null);
    try {
      const pair = await newKeyPair(account.id);
      await api(`/agents/${id}/keys`, { body: { public_key: pair.publicKey, proof: pair.proof } });
      setNewKey({ agent_id: agent!.id, directory: agent!.directory!, private_key: pair.privateKey });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeKey(kid: string) {
    setError(null);
    try {
      await api(`/agents/${id}/keys/${kid}`, { method: "DELETE", body: {} });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Link href="/dashboard/agents" className="mb-4 inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} /> Agents
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
            {agent.revoked && <Badge tone="red">Revoked</Badge>}
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500">{agent.id}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/agents/${agent.id}`} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3.5 font-medium hover:bg-zinc-50">
            Public page <ExternalLink size={13} />
          </Link>
          {!agent.revoked && (
            <Button variant="danger" onClick={() => setConfirmRevoke(true)}>
              Revoke
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Notice tone="red">{error}</Notice>
        </div>
      )}

      <div className="space-y-6">
        <Card title="Standing" action={<LevelBadge level={s.level} score={s.score} />}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[
              ["Score", s.score ?? "—"],
              ["Reports", s.reports],
              ["Businesses", s.reporters],
              ["Negative", s.negative],
              ["Under dispute", s.under_dispute],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {!account.domain_verified && (
            <p className="mt-4 text-xs text-zinc-500">
              Sites see a level but no score until you{" "}
              <Link href="/dashboard/settings" className="underline">
                verify your domain
              </Link>
              .
            </p>
          )}
        </Card>

        <Card title="Reports" description="Outcomes businesses reported about this agent. Dispute any that are wrong.">
          {reports.length === 0 ? (
            <p className="text-zinc-500">No reports yet.</p>
          ) : (
            <table className="-mx-5 -my-4 w-[calc(100%+2.5rem)]">
              <thead className="border-b border-zinc-100">
                <tr>
                  <Th>Reported</Th>
                  <Th>Site</Th>
                  <Th>Outcome</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reports.map((r) => (
                  <tr key={r.check_id} data-testid="report-row">
                    <Td className="text-zinc-500">{ago(r.reported_at)}</Td>
                    <Td className="font-mono text-xs">
                      {r.site}
                      {r.action && <span className="ml-1 font-sans text-zinc-500">· {r.action}</span>}
                    </Td>
                    <Td>{r.outcome === "completed" ? OUTCOME_LABEL[r.outcome] : <span className="font-medium text-red-700">{OUTCOME_LABEL[r.outcome]}</span>}</Td>
                    <Td className="text-zinc-600">
                      {REPORT_STATUS_LABEL[r.status]}
                      {r.status === "disputed" && r.resolve_by && <span className="block text-xs text-zinc-500">Removed {ago(r.resolve_by)} unless confirmed</span>}
                    </Td>
                    <Td className="text-right">{r.can_dispute && <DisputeButton report={r} onDone={() => (load(), refresh())} />}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Signing keys"
          description={<>Published at <Mono>{agent.directory}</Mono></>}
          action={
            !agent.revoked && (
              <Button variant="secondary" size="sm" onClick={addKey}>
                Add key
              </Button>
            )
          }
        >
          {keys.length === 0 ? (
            <p className="text-zinc-500">No active keys. The agent cannot sign requests.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {keys.map((k) => (
                <li key={k.kid} className="flex items-center justify-between gap-4 py-2">
                  <div>
                    <Mono>{k.kid}</Mono>
                    <p className="text-xs text-zinc-500">Added {dateTime(k.created_at)}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeKey(k.kid)} disabled={keys.length === 1 && !agent.revoked} title={keys.length === 1 ? "Add another key before removing the last one" : undefined}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Code label="Sign requests with the key file">{agentSnippet(`standing-agent-${agent.id}.json`)}</Code>
      </div>

      <Modal open={newKey !== null} onClose={() => setNewKey(null)} title="New key added">
        {newKey && <KeyFile agentKey={newKey} onDone={() => setNewKey(null)} />}
      </Modal>

      <Modal open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title="Revoke agent">
        <p className="text-zinc-600">Every site will deny this agent from now on. This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await api(`/agents/${id}/revoke`, { body: {} });
              setConfirmRevoke(false);
              load();
            }}
          >
            Revoke agent
          </Button>
        </div>
      </Modal>
    </>
  );
}
