"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "@/components/account-context";
import { Badge, Button, Code, Empty, Field, Input, Modal, Mono, Notice, PageHeader, Segmented, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { businessSnippet } from "@/lib/snippets";
import type { ApiKey } from "@/lib/types";

function CreateKey({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setSecret(null);
    setName("");
    setError(null);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} /> Create key
      </Button>
      <Modal open={open} onClose={close} title={secret ? "Key created" : "Create API key"}>
        {secret ? (
          <div className="space-y-4">
            <Notice tone="amber">Copy this key now. It is not shown again.</Notice>
            <Code label="API key">{secret}</Code>
            <Code label="Use it">{businessSnippet(secret)}</Code>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const { key } = await api<{ key: ApiKey & { secret: string } }>("/keys", { body: { name, mode } });
                setSecret(key.secret);
                onCreated();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Field label="Name" htmlFor="key-name" hint="Where the key is used, e.g. “production server”.">
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
            </Field>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Mode</span>
              <Segmented
                label="Mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "test", label: "Test" },
                  { value: "live", label: "Live" },
                ]}
              />
              <p className="text-xs text-zinc-500">{mode === "test" ? "Test checks never affect any agent's standing." : "Live checks and reports count toward standing."}</p>
            </div>
            {error && <Notice tone="red">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Create key
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export default function KeysPage() {
  const { refresh } = useAccount();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const load = async () => setKeys((await api<{ data: ApiKey[] }>("/keys")).data);
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <PageHeader title="API keys" description="Your server uses these to check agents and report outcomes." action={<CreateKey onCreated={() => (load(), refresh())} />} />
      {keys === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : keys.length === 0 ? (
        <Empty title="No API keys">Create a test key to try Standing with the published test agents.</Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50">
              <tr>
                <Th>Name</Th>
                <Th>Key</Th>
                <Th>Mode</Th>
                <Th>Last used</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {keys.map((k) => (
                <tr key={k.id}>
                  <Td className="font-medium">{k.name}</Td>
                  <Td>
                    <Mono>{k.hint}</Mono>
                  </Td>
                  <Td>
                    <Badge tone={k.mode === "live" ? "green" : "zinc"}>{k.mode === "live" ? "Live" : "Test"}</Badge>
                  </Td>
                  <Td className="text-zinc-500">{k.last_used_at ? ago(k.last_used_at) : "Never"}</Td>
                  <Td className="text-zinc-500">{ago(k.created_at)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>
                      Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title="Revoke key">
        <p className="text-zinc-600">
          Requests using <Mono>{revoking?.hint}</Mono> will fail immediately.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await api(`/keys/${revoking!.id}`, { method: "DELETE", body: {} });
              setRevoking(null);
              load();
              refresh();
            }}
          >
            Revoke key
          </Button>
        </div>
      </Modal>
    </>
  );
}
