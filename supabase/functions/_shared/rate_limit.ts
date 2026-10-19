// Per-user fixed-window rate limit backed by public.consume_edge_rate_limit
// (migration 20261019000003). Fails open if the RPC is unavailable so a
// missing migration cannot take the feature down; failures are logged.
export async function consumeRateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return true;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_edge_rate_limit`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });
    if (!response.ok) {
      console.error(`rate limit rpc failed: ${response.status}`);
      return true;
    }
    return (await response.json()) !== false;
  } catch (error) {
    console.error("rate limit rpc error", error instanceof Error ? error.message : String(error));
    return true;
  }
}
