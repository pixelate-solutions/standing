"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Account, Overview } from "@/lib/types";

type Ctx = { account: Account; overview: Overview | null; refresh: () => Promise<void>; setAccount: (a: Account) => void };

const AccountContext = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ account }, overview] = await Promise.all([api<{ account: Account }>("/auth/me"), api<Overview>("/overview")]);
      setAccount(account);
      setOverview(overview);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!account) return <div className="p-8 text-zinc-500">Loading…</div>;
  return <AccountContext.Provider value={{ account, overview, refresh, setAccount }}>{children}</AccountContext.Provider>;
}

export function useAccount(): Ctx {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount outside AccountProvider");
  return ctx;
}
