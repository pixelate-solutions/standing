"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input } from "./ui";

export function LookupForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const id = value.trim();
        if (id) router.push(`/agents/${encodeURIComponent(id)}`);
      }}
    >
      <label htmlFor="lookup" className="sr-only">
        Agent ID
      </label>
      <Input id="lookup" value={value} onChange={(e) => setValue(e.target.value)} placeholder="agt_…" className="h-10 font-mono" autoComplete="off" spellCheck={false} />
      <Button type="submit" className="h-10 shrink-0 whitespace-nowrap px-4">
        <Search size={15} />
        Look up
      </Button>
    </form>
  );
}
