export type SafeUrlOptions = {
  allowBareHost?: boolean;
  maxRedirects?: number;
};

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "0.0.0.0"]);
const DEFAULT_MAX_REDIRECTS = 3;

function cleanHost(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null;
  return nums;
}

function isPrivateIpv4(hostname: string) {
  const ip = parseIpv4(hostname);
  if (!ip) return false;
  const [a, b, c] = ip;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(hostname: string) {
  const host = cleanHost(hostname);
  if (!host.includes(":")) return false;
  if (host === "::" || host === "0:0:0:0:0:0:0:0") return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  // ::/16 covers IPv4-mapped (::ffff:7f00:1) and IPv4-compatible (::7f00:1).
  if (host.startsWith("::") || host.startsWith("0:")) return true;
  // NAT64, 6to4 and Teredo embed an IPv4 address that may be private.
  if (host.startsWith("64:ff9b:") || host.startsWith("2002:") || host.startsWith("2001:0:") || host.startsWith("2001::")) return true;
  if (host.startsWith("fe80:") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("ff") || host.startsWith("2001:db8:")) return true;
  return false;
}

function isBlockedHostname(hostname: string) {
  const host = cleanHost(hostname);
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return true;
  return false;
}

async function resolveDnsBestEffort(hostname: string) {
  const host = cleanHost(hostname);
  if (parseIpv4(host) || host.includes(":")) return [host];
  const resolver = (Deno as unknown as { resolveDns?: (query: string, recordType: "A" | "AAAA") => Promise<string[]> }).resolveDns;
  if (!resolver) return [];

  const results: string[] = [];
  try {
    results.push(...await resolver(host, "A"));
  } catch {
    // DNS guard is best-effort in Supabase Edge runtime.
  }
  try {
    results.push(...await resolver(host, "AAAA"));
  } catch {
    // DNS guard is best-effort in Supabase Edge runtime.
  }
  return results;
}

export function normalizeHttpUrl(raw: unknown, options: SafeUrlOptions = {}) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("URL is required");

  const candidate = options.allowBareHost && !/^https?:\/\//i.test(value) ? `https://${value}` : value;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Unsafe URL host is blocked");
  }
  url.username = "";
  url.password = "";
  return url;
}

export async function assertSafeUrl(raw: unknown, options: SafeUrlOptions = {}) {
  const url = normalizeHttpUrl(raw, options);
  const addresses = await resolveDnsBestEffort(url.hostname);
  if (addresses.some((address) => isBlockedHostname(address))) {
    throw new Error("Unsafe URL resolves to a blocked network address");
  }
  return url;
}

async function assertSafeRedirect(initialUrl: URL, finalUrl: string | null | undefined) {
  if (!finalUrl) return initialUrl;
  const next = await assertSafeUrl(finalUrl);
  if (next.protocol !== initialUrl.protocol && next.protocol !== "https:") {
    throw new Error("Unsafe redirect protocol is blocked");
  }
  return next;
}

export async function safeFetch(inputUrl: URL, init: RequestInit = {}, options: SafeUrlOptions = {}) {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = await assertSafeUrl(inputUrl.toString());

  for (let index = 0; index <= maxRedirects; index += 1) {
    const response = await fetch(currentUrl.toString(), {
      ...init,
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      await assertSafeRedirect(currentUrl, response.url || currentUrl.toString());
      return response;
    }

    const redirectUrl = new URL(location, currentUrl.toString());
    currentUrl = await assertSafeUrl(redirectUrl.toString());
  }

  throw new Error("Too many redirects");
}
