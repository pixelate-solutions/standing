"use client";

import { Download } from "lucide-react";
import { generateAgentKeyPair, proveKey, type AgentKey } from "@standing/sdk/agent";
import { Button, Code, CopyButton, Notice } from "./ui";

/** Generates the key pair in the browser. The private key never reaches Standing. */
export async function newKeyPair(accountId: string) {
  const pair = await generateAgentKeyPair();
  return { ...pair, proof: await proveKey(accountId, pair.privateKey) };
}

export function downloadKeyFile(key: AgentKey) {
  const blob = new Blob([JSON.stringify(key, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `standing-agent-${key.agent_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function KeyFile({ agentKey, onDone }: { agentKey: AgentKey; onDone: () => void }) {
  const json = JSON.stringify(agentKey, null, 2);
  return (
    <div className="space-y-4">
      <Notice tone="amber">Save this key file now. Standing does not keep the private key and cannot show it again.</Notice>
      <div className="flex gap-2">
        <Button onClick={() => downloadKeyFile(agentKey)}>
          <Download size={14} /> Download key file
        </Button>
        <CopyButton value={json} label="Copy JSON" />
      </div>
      <details>
        <summary className="cursor-pointer text-zinc-500">Show key file</summary>
        <div className="mt-2">
          <Code copy={false}>{json}</Code>
        </div>
      </details>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          I saved it
        </Button>
      </div>
    </div>
  );
}
