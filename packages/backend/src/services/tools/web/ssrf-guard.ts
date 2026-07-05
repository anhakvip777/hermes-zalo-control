// =============================================================================
// SSRF guard for web.fetchPage (Phase 6)
// =============================================================================
// Blocks: non-http(s) schemes, localhost/internal hostnames, and any URL whose
// resolved IP(s) fall in loopback / private / link-local / metadata / ULA /
// unspecified ranges. Re-run on every redirect target (DNS-rebinding defense).
//
// DNS resolution is injectable so tests never touch the real network.
// Residual TOCTOU (resolve→connect IP pinning) is a documented follow-up.
// =============================================================================

import { isIP } from "node:net";
import { toolErrors } from "../../tool-gateway/errors.js";

export type DnsResolver = (hostname: string) => Promise<string[]>;

/** Default resolver using node:dns (all A/AAAA records). */
export async function defaultResolveDns(hostname: string): Promise<string[]> {
  const dns = await import("node:dns");
  const res = await dns.promises.lookup(hostname, { all: true });
  return res.map((r) => r.address);
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = n * 256 + b;
  }
  return n >>> 0;
}

function inV4Range(ipInt: number, cidrBase: string, bits: number): boolean {
  const base = ipv4ToInt(cidrBase);
  if (base == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

/** True if an IP (v4 or v6) is in a blocked (non-public) range. */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true; // malformed → block
    return (
      inV4Range(n, "0.0.0.0", 8) || // "this" network / unspecified
      inV4Range(n, "10.0.0.0", 8) || // private
      inV4Range(n, "127.0.0.0", 8) || // loopback
      inV4Range(n, "169.254.0.0", 16) || // link-local (incl. 169.254.169.254 metadata)
      inV4Range(n, "172.16.0.0", 12) || // private
      inV4Range(n, "192.168.0.0", 16) || // private
      inV4Range(n, "100.64.0.0", 10) || // CGNAT
      inV4Range(n, "192.0.0.0", 24) || // IETF protocol assignments
      inV4Range(n, "198.18.0.0", 15) || // benchmarking
      inV4Range(n, "224.0.0.0", 4) || // multicast
      inV4Range(n, "240.0.0.0", 4) // reserved
    );
  }
  if (fam === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // unspecified / loopback
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped ::ffff:a.b.c.d → validate the embedded v4
    const m = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]!);
    return false;
  }
  return true; // not a valid IP → block
}

/**
 * Assert a URL is safe to fetch. Throws toolErrors.blocked otherwise.
 * Validates scheme + hostname + ALL resolved IPs.
 */
export async function assertUrlAllowed(rawUrl: string, resolveDns: DnsResolver = defaultResolveDns): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw toolErrors.blocked("Invalid URL");
  }

  // Scheme allowlist.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw toolErrors.blocked(`Blocked URL scheme: ${url.protocol}`);
  }
  // No embedded credentials.
  if (url.username || url.password) {
    throw toolErrors.blocked("URL must not contain credentials");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw toolErrors.blocked(`Blocked hostname: ${host}`);
  }

  // If host is a literal IP, validate directly; else resolve and validate all IPs.
  if (isIP(host)) {
    if (isBlockedIp(host)) throw toolErrors.blocked(`Blocked IP: ${host}`);
    return url;
  }

  let ips: string[];
  try {
    ips = await resolveDns(host);
  } catch {
    throw toolErrors.blocked(`DNS resolution failed for ${host}`);
  }
  if (!ips || ips.length === 0) throw toolErrors.blocked(`No DNS records for ${host}`);
  for (const ip of ips) {
    if (isBlockedIp(ip)) throw toolErrors.blocked(`Blocked resolved IP ${ip} for ${host}`);
  }
  return url;
}
