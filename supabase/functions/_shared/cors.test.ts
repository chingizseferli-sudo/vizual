import { describe, expect, it } from "vitest";
import { corsHeadersFor } from "./cors.ts";
const req = (origin?: string) => new Request("https://x.supabase.co/functions/v1/f", { headers: origin ? { Origin: origin } : {} });
describe("corsHeadersFor", () => {
  it("falls back to * without ALLOWED_ORIGINS", () => { expect(corsHeadersFor(req("https://evil.test"), [])["Access-Control-Allow-Origin"]).toBe("*"); });
  it("echoes allowed origin", () => { expect(corsHeadersFor(req("https://vizual.az"), ["https://vizual.az"])["Access-Control-Allow-Origin"]).toBe("https://vizual.az"); });
  it("omits ACAO for other origins", () => { const h = corsHeadersFor(req("https://evil.test"), ["https://vizual.az"]); expect(h["Access-Control-Allow-Origin"]).toBeUndefined(); expect(h["Vary"]).toBe("Origin"); });
});
