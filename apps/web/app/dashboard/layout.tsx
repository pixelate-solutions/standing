"use client";

import { Bot, Flag, KeyRound, LayoutGrid, ListChecks, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AccountProvider, useAccount } from "@/components/account-context";
import { Logo } from "@/components/site-header";
import { cx } from "@/components/ui";
import { api } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/checks", label: "Checks", icon: ListChecks },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/reports", label: "Reports", icon: Flag },
  { href: "/dashboard/keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { account, overview } = useAccount();
  const attention = (overview?.reports_to_review ?? 0) + (overview?.disputes_to_resolve ?? 0);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 px-2" aria-label="Dashboard">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx("flex h-8 items-center gap-2.5 rounded-md px-2.5", active ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:text-zinc-900")}
            >
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {label === "Reports" && attention > 0 && <span className="rounded-full bg-zinc-900 px-1.5 text-[11px] font-medium text-white">{attention}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-zinc-200 p-3">
        <p className="truncate font-medium">{account.name}</p>
        <p className="truncate text-xs text-zinc-500">{account.email}</p>
        <button
          className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900"
          onClick={async () => {
            await api("/auth/logout", { body: {} });
            router.push("/login");
          }}
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccountProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>
        </main>
      </div>
    </AccountProvider>
  );
}
