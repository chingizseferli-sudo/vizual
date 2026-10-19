import { describe, expect, it } from "vitest";
import { normalizeHttpUrl } from "./url_safety.ts";

describe("normalizeHttpUrl", () => {
  it.each([
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[2001:db8::1]",
    "http://[::127.0.0.1]",
    "http://[::7f00:1]",
    "http://[64:ff9b::a9fe:a9fe]",
    "http://[2002:a9fe:a9fe::1]",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]",
    "http://2130706433",
    "http://0x7f.1",
  ])("blocks non-public address %s", (value) => {
    expect(() => normalizeHttpUrl(value)).toThrow("Unsafe URL host is blocked");
  });

  it("accepts a public HTTPS URL", () => {
    expect(normalizeHttpUrl("https://example.com/news").toString()).toBe(
      "https://example.com/news",
    );
  });

  it("accepts a public IPv6 literal", () => {
    expect(normalizeHttpUrl("https://[2606:4700:4700::1111]/").hostname).toBe("[2606:4700:4700::1111]");
  });

  it("rejects credentials and non-HTTP protocols", () => {
    expect(() => normalizeHttpUrl("https://user:pass@example.com")).toThrow(
      "URL credentials are not allowed",
    );
    expect(() => normalizeHttpUrl("file:///etc/passwd")).toThrow(
      "Only http/https URLs are allowed",
    );
  });
});
