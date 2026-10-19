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
  ])("blocks non-public address %s", (value) => {
    expect(() => normalizeHttpUrl(value)).toThrow("Unsafe URL host is blocked");
  });

  it("accepts a public HTTPS URL", () => {
    expect(normalizeHttpUrl("https://example.com/news").toString()).toBe(
      "https://example.com/news",
    );
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
