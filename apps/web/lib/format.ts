const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return Math.abs(seconds) < 30 ? "just now" : relative.format(Math.round(seconds), "second");
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const OUTCOME_LABEL: Record<string, string> = {
  completed: "Completed",
  disputed: "Disputed payment",
  fraud: "Fraud",
  abuse: "Abuse",
};

export const REPORT_STATUS_LABEL: Record<string, string> = {
  active: "Counts",
  disputed: "Under dispute",
  confirmed: "Confirmed after dispute",
  removed: "Removed",
};
