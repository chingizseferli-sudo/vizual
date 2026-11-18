// The project's server-side key. Projects on the new API keys get it in
// SUPABASE_SECRET_KEYS (JSON keyed by name); once the legacy keys are turned
// off, the injected SUPABASE_SERVICE_ROLE_KEY no longer works, so the new key
// wins when both exist.
export function serviceKey(): string | null {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      const key = typeof parsed.default === "string" ? parsed.default.trim() : "";
      if (key) return key;
    } catch {
      console.error("SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || null;
}

// New secret keys (sb_secret_...) are not JWTs and go in the apikey header
// only; the legacy service-role JWT also goes in Authorization.
export function serviceAuthHeaders(key: string): Record<string, string> {
  return key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}
