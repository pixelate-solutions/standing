"use client";

import { Check as CheckIcon, Copy, X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" };

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-700",
        variant === "secondary" && "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm placeholder:text-zinc-400",
        "focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900",
        className,
      )}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx("h-9 rounded-md border border-zinc-200 bg-white px-2.5 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900", className)}
    />
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-900">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Card({ title, description, action, children, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-zinc-200 bg-white", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-zinc-900">{title}</h2>
            {description && <p className="mt-0.5 text-zinc-500">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children && <div className="px-5 py-4">{children}</div>}
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
  outline: "bg-white text-zinc-500 ring-zinc-300",
};

export function Badge({ tone = "zinc", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone])}>{children}</span>;
}

export function DecisionBadge({ decision }: { decision: string }) {
  const tone = decision === "allow" ? "green" : decision === "challenge" ? "amber" : "red";
  return <Badge tone={tone}>{decision[0]!.toUpperCase() + decision.slice(1)}</Badge>;
}

export function LevelBadge({ level, score }: { level: string; score?: number | null }) {
  const tone = level === "good" ? "green" : level === "poor" ? "red" : level === "neutral" ? "zinc" : "outline";
  const label = level === "unknown" ? "New" : level[0]!.toUpperCase() + level.slice(1);
  return (
    <Badge tone={tone}>
      {label}
      {score != null && <span className="ml-1 opacity-70">{score}</span>}
    </Badge>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center">
      <p className="font-medium text-zinc-900">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-zinc-500">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "zinc", children }: { tone?: "zinc" | "red" | "amber" | "green"; children: ReactNode }) {
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={cx(
        "rounded-md px-3 py-2 text-sm",
        tone === "red" && "bg-red-50 text-red-800",
        tone === "amber" && "bg-amber-50 text-amber-900",
        tone === "green" && "bg-emerald-50 text-emerald-800",
        tone === "zinc" && "bg-zinc-100 text-zinc-700",
      )}
    >
      {children}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Code({ children, copy = true, label }: { children: string; copy?: boolean; label?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
      {(label || copy) && (
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5">
          <span className="text-xs text-zinc-500">{label}</span>
          {copy && <CopyButton value={children} />}
        </div>
      )}
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-800">{children}</pre>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-zinc-600">{children}</span>;
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-zinc-900/20" onClick={onClose} />
      <aside role="dialog" aria-label={typeof title === "string" ? title : "Details"} className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <div className="font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-zinc-900/30" onClick={onClose} />
      <div role="dialog" aria-label={title} className="relative w-full max-w-lg rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("h-7 rounded px-3 text-xs font-medium", o.value === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("px-4 py-2 text-left text-xs font-medium text-zinc-500", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-2.5 align-middle", className)}>{children}</td>;
}

export { cx };
