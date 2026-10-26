"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentKey } from "@standing/sdk/agent";
import { useAccount } from "@/components/account-context";
import { KeyFile, newKeyPair } from "@/components/key-file";
import { Badge, Button, Code, Empty, Field, Input, LevelBadge, Modal, Mono, Notice, PageHeader, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { cliSnippet } from "@/lib/snippets";
import type { AgentWithStanding } from "@/lib/types";

function RegisterAgent({ onCreated }: { onCreated: () => void }) {
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AgentKey | null>(null);

  const close = () => {
    setOpen(false);
    setCreated(null);
    setName("");
    setError(null);
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const pair = await newKeyPair(account.id);
      const { agent } = await api<{ agent: AgentWithStanding }>("/agents", { body: { name, public_key: pair.publicKey, proof: pair.proof } });
      setCreated({ agent_id: agent.id, directory: agent.directory!, private_key: pair.privateKey });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} /> Register agent
      </Button>
      <Modal open={open} onClose={close} title={created ? "Agent registered" : "Register agent"}>
        {created ? (
          <KeyFile agentKey={created} onDone={close} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <Field label="Name" htmlFor="agent-name" hint="Shown to sites that check this agent.">
              <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Shopping assistant" autoFocus />
            </Field>
            <p className="text-zinc-500">A signing key is created in your browser. You download the private key; Standing stores only the public key.</p>
            {error && <Notice tone="red">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create agent"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export default function AgentsPage() {
  const { refresh } = useAccount();
  const [agents, setAgents] = useState<AgentWithStanding[] | null>(null);

  const load = async () => setAgents((await api<{ data: AgentWithStanding[] }>("/agents")).data);
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <PageHeader title="Agents" description="Agents you run. Sites see their standing when they check them." action={<RegisterAgent onCreated={() => (load(), refresh())} />} />
      {agents === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : agents.length === 0 ? (
        <Empty title="No agents yet">
          <p>Register an agent here, or from the terminal:</p>
          <div className="mt-3 text-left">
            <Code>{cliSnippet}</Code>
          </div>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <Th>Name</Th>
                <Th>ID</Th>
                <Th>Standing</Th>
                <Th>Reports</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {agents.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-50">
                  <Td>
                    <Link href={`/dashboard/agents/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                      {a.name}
                    </Link>
                    {a.revoked && (
                      <span className="ml-2">
                        <Badge tone="red">Revoked</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Mono>{a.id}</Mono>
                  </Td>
                  <Td>
                    <LevelBadge level={a.standing.level} score={a.standing.score} />
                  </Td>
                  <Td className="tabular-nums">
                    {a.standing.reports}
                    {a.standing.negative > 0 && <span className="text-red-700"> · {a.standing.negative} negative</span>}
                  </Td>
                  <Td className="text-zinc-500">{ago(a.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
