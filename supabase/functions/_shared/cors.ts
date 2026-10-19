// CORS for edge functions. Auth is a Bearer token (no cookies), so CORS is
// defence in depth: with ALLOWED_ORIGINS set (comma-separated, e.g.
// "https://vizual.az,https://www.vizual.az") only those origins are echoed.
// Unset keeps the previous "*" so a deploy without the secret does not break.

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const ALLOW_METHODS = "POST, OPTIONS";

function readAllowedOrigins(): string[] {
  const deno = (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno;
  const raw = deno?.env.get("ALLOWED_ORIGINS") || "";
  return raw.split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
}

export function corsHeadersFor(req: Request, allowedOrigins = readAllowedOrigins()): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
  };
  if (allowedOrigins.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*";
    return headers;
  }
  headers["Vary"] = "Origin";
  const origin = req.headers.get("Origin") || "";
  if (allowedOrigins.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Wraps a handler: answers preflight and sets the CORS headers on every response.
export function withCors(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeadersFor(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const response = await handler(req);
    const headers = new Headers(response.headers);
    headers.delete("Access-Control-Allow-Origin");
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
