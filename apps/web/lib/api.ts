export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Browser-side call to the Standing API through the same-origin /v1 proxy. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, json?.error?.code ?? "error", json?.error?.message ?? "Request failed.");
  return json as T;
}

/** Server-side call straight to the API (public data only). */
export async function serverApi<T>(path: string): Promise<T | null> {
  const base = process.env.API_URL ?? "http://localhost:4100";
  const response = await fetch(`${base}/v1${path}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`API ${response.status}`);
  return (await response.json()) as T;
}

export const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
