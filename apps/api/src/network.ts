import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { env } from "./env.ts";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

function isBlockedAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1]!, "ipv4");
  return blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

/**
 * Fetch a small document from a URL an outside party gave us (a key directory
 * or a domain verification file). Refuses private addresses, redirects, slow
 * responses, and large bodies.
 */
export async function fetchPublic(url: URL, { maxBytes = 65_536, timeoutMs = 2_000, accept = "application/json" } = {}): Promise<string> {
  if (url.protocol !== "https:" && !(env.allowPrivateNetwork && url.protocol === "http:")) {
    throw new Error("URL must use https");
  }
  if (!env.allowPrivateNetwork) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      throw new Error("URL resolves to a private address");
    }
  }

  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { accept } });
  if (response.status !== 200) throw new Error(`Fetch returned ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("Response too large");

  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
