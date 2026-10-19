import { requireAdmin } from "../_shared/auth.ts";
import { withCors } from "../_shared/cors.ts";

type AuthUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type RequestBody = {
  action?: string;
  user_id?: string;
};

type IdRow = {
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serviceHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function restUrl(supabaseUrl: string, table: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return `${supabaseUrl}/rest/v1/${table}?${query.toString()}`;
}

async function readRows<T>(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  params: Record<string, string>,
): Promise<T[]> {
  const response = await fetch(restUrl(supabaseUrl, table, params), {
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok) {
    throw new Error(`${table} could not be read: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function deleteRows(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  params: Record<string, string>,
) {
  const response = await fetch(restUrl(supabaseUrl, table, params), {
    method: "DELETE",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      Prefer: "return=minimal",
    },
  });

  if (!response.ok) {
    throw new Error(`${table} could not be deleted: ${response.status} ${await response.text()}`);
  }
}

async function deleteUserData(supabaseUrl: string, serviceRoleKey: string, targetUserId: string) {
  const userMonitors = await readRows<IdRow>(supabaseUrl, serviceRoleKey, "user_monitors", {
    user_id: `eq.${targetUserId}`,
    select: "id",
  });
  const monitorIds = userMonitors.map((monitor) => monitor.id).filter(Boolean);

  if (monitorIds.length > 0) {
    const monitorIdFilter = `in.(${monitorIds.join(",")})`;
    const monitorMatches = await readRows<IdRow>(supabaseUrl, serviceRoleKey, "monitor_matches", {
      monitor_id: monitorIdFilter,
      select: "id",
    });
    const matchIds = monitorMatches.map((match) => match.id).filter(Boolean);

    if (matchIds.length > 0) {
      await deleteRows(supabaseUrl, serviceRoleKey, "monitor_alerts", {
        match_id: `in.(${matchIds.join(",")})`,
      });
    }

    await deleteRows(supabaseUrl, serviceRoleKey, "monitor_matches", {
      monitor_id: monitorIdFilter,
    });
    await deleteRows(supabaseUrl, serviceRoleKey, "monitor_keywords", {
      monitor_id: monitorIdFilter,
    });
  }

  await deleteRows(supabaseUrl, serviceRoleKey, "user_monitors", {
    user_id: `eq.${targetUserId}`,
  });

  const changeSources = await readRows<IdRow>(supabaseUrl, serviceRoleKey, "change_sources", {
    user_id: `eq.${targetUserId}`,
    select: "id",
  });
  const changeSourceIds = changeSources.map((source) => source.id).filter(Boolean);

  if (changeSourceIds.length > 0) {
    const sourceIdFilter = `in.(${changeSourceIds.join(",")})`;
    await deleteRows(supabaseUrl, serviceRoleKey, "change_alerts", {
      source_id: sourceIdFilter,
    });
    await deleteRows(supabaseUrl, serviceRoleKey, "change_events", {
      source_id: sourceIdFilter,
    });
    await deleteRows(supabaseUrl, serviceRoleKey, "change_snapshots", {
      source_id: sourceIdFilter,
    });
    await deleteRows(supabaseUrl, serviceRoleKey, "change_sources", {
      id: sourceIdFilter,
    });
  }

  await deleteRows(supabaseUrl, serviceRoleKey, "user_profiles", {
    user_id: `eq.${targetUserId}`,
  });
}

function generateTemporaryPassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function updateAuthUserPassword(
  supabaseUrl: string,
  serviceRoleKey: string,
  targetUserId: string,
  password: string,
) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(targetUserId)}`, {
    method: "PUT",
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(`Auth user password could not be updated: ${response.status} ${await response.text()}`);
  }
}

async function readAdminRole(supabaseUrl: string, serviceRoleKey: string, targetUserId: string) {
  const targetAdminRows = await readRows<{ role?: string | null; status?: string | null }>(
    supabaseUrl,
    serviceRoleKey,
    "admin_users",
    {
      user_id: `eq.${targetUserId}`,
      select: "role,status",
      limit: "1",
    },
  );
  return targetAdminRows[0];
}
async function deleteAuthUser(supabaseUrl: string, serviceRoleKey: string, targetUserId: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(targetUserId)}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey),
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Auth user could not be deleted: ${response.status} ${await response.text()}`);
  }
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireAdmin(req, json);
  if (auth instanceof Response) return auth;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing" }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  if (body.action === "create_temporary_password") {
    const targetUserId = body.user_id?.trim();

    if (!targetUserId || !UUID_PATTERN.test(targetUserId)) {
      return json({ error: "user_id must be a valid UUID" }, 400);
    }

    const targetAdmin = await readAdminRole(supabaseUrl, serviceRoleKey, targetUserId);
    if (targetAdmin?.role === "admin" || targetAdmin?.role === "superadmin") {
      return json({ error: "Admin panel accounts cannot be reset from this user list" }, 403);
    }

    const temporaryPassword = generateTemporaryPassword();

    try {
      await updateAuthUserPassword(supabaseUrl, serviceRoleKey, targetUserId, temporaryPassword);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }

    return json({ ok: true, temporary_password: temporaryPassword });
  }
  if (body.action === "delete_user") {
    const targetUserId = body.user_id?.trim();

    if (!targetUserId || !UUID_PATTERN.test(targetUserId)) {
      return json({ error: "user_id must be a valid UUID" }, 400);
    }
    if (targetUserId === auth.user.id) {
      return json({ error: "You cannot delete your own admin session account" }, 400);
    }

    const targetAdmin = await readAdminRole(supabaseUrl, serviceRoleKey, targetUserId);

    if (targetAdmin?.role === "admin" || targetAdmin?.role === "superadmin") {
      return json({ error: "Admin panel accounts cannot be deleted from this user list" }, 403);
    }

    try {
      await deleteUserData(supabaseUrl, serviceRoleKey, targetUserId);
      await deleteAuthUser(supabaseUrl, serviceRoleKey, targetUserId);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }

    return json({ ok: true });
  }

  const users: AuthUser[] = [];
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      return json({ error: `Auth users could not be read: ${response.status}`, detail: await response.text() }, 500);
    }

    const payload = await response.json();
    const batch = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
    users.push(
      ...batch.map((user: AuthUser) => ({
        id: user.id,
        email: user.email || null,
        phone: user.phone || null,
        created_at: user.created_at || null,
        updated_at: user.updated_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
        user_metadata: user.user_metadata || null,
      })),
    );

    if (batch.length < perPage) break;
    page += 1;
  }

  return json({ users });
}));
