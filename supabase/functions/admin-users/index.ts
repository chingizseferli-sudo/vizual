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
  email?: string;
  password?: string;
  plan_id?: string;
  subscription_status?: string;
  current_period_end?: string | null;
};

type IdRow = {
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  await deleteRows(supabaseUrl, serviceRoleKey, "user_profiles", {
    user_id: `eq.${targetUserId}`,
  });
}

function generateTemporaryPassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  // Bytes at or above the largest multiple of the alphabet size are skipped,
  // so every character is equally likely.
  const limit = 256 - (256 % alphabet.length);
  let password = "";
  while (password.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit && password.length < length) password += alphabet[byte % alphabet.length];
    }
  }
  return password;
}

async function createAuthUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
  password: string,
): Promise<{ id: string } | { error: string; status: number }> {
  // Admin-created accounts skip the confirmation email: the admin hands over
  // the login details directly.
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (response.ok) {
    const user = await response.json();
    return { id: user.id };
  }

  const detail = await response.text();
  if (response.status === 422 && /email_exists|already (been )?registered|already exists/i.test(detail)) {
    return { error: "Bu email ilə hesab artıq mövcuddur.", status: 409 };
  }
  if (response.status === 422 && /weak_password|password/i.test(detail)) {
    return { error: "Parol çox zəifdir. Daha uzun parol yazın və ya təsadüfi parol yaradın.", status: 400 };
  }
  throw new Error(`Auth user could not be created: ${response.status} ${detail}`);
}

// Runs as the calling admin (their JWT), so public.is_admin_user() and the
// MFA rule apply exactly as in the admin UI.
async function assignSubscriptionAsAdmin(
  supabaseUrl: string,
  serviceRoleKey: string,
  adminToken: string,
  params: { userId: string; planId: string; status: string; periodEnd: string | null },
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_assign_user_subscription`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      p_user_id: params.userId,
      p_plan_id: params.planId,
      p_status: params.status,
      p_current_period_end: params.periodEnd,
      p_notes: "Hesab admin tərəfindən yaradıldı",
    }),
  });

  if (!response.ok) {
    throw new Error(`Subscription could not be assigned: ${response.status} ${await response.text()}`);
  }
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

  if (body.action === "create_user") {
    const email = body.email?.trim().toLowerCase() || "";
    const planId = body.plan_id?.trim() || "";
    const subscriptionStatus = body.subscription_status === "trialing" ? "trialing" : "active";
    const periodEnd = body.current_period_end?.trim() || null;
    const typedPassword = body.password ?? "";

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return json({ error: "Email düzgün deyil." }, 400);
    }
    if (!UUID_PATTERN.test(planId)) {
      return json({ error: "Plan seçin." }, 400);
    }
    if (periodEnd && Number.isNaN(Date.parse(periodEnd))) {
      return json({ error: "Dövrün sonu tarixi düzgün deyil." }, 400);
    }
    if (typedPassword && (typedPassword.length < 8 || typedPassword.length > 72)) {
      return json({ error: "Parol 8-72 simvol olmalıdır." }, 400);
    }

    const password = typedPassword || generateTemporaryPassword();
    let createdUserId: string | null = null;

    try {
      const created = await createAuthUser(supabaseUrl, serviceRoleKey, email, password);
      if ("error" in created) return json({ error: created.error }, created.status);
      createdUserId = created.id;

      // The auth trigger made a pending profile; assigning the plan activates it.
      await assignSubscriptionAsAdmin(supabaseUrl, serviceRoleKey, auth.token, {
        userId: createdUserId,
        planId,
        status: subscriptionStatus,
        periodEnd,
      });
    } catch (error) {
      console.error("admin-users create_user failed", error);
      if (createdUserId) {
        // Do not leave a half-made pending account behind.
        try {
          await deleteUserData(supabaseUrl, serviceRoleKey, createdUserId);
          await deleteAuthUser(supabaseUrl, serviceRoleKey, createdUserId);
        } catch (cleanupError) {
          console.error("admin-users create_user cleanup failed", cleanupError);
        }
      }
      return json({ error: "Hesab yaradılmadı. Bir az sonra yenidən cəhd edin." }, 500);
    }

    return json({ ok: true, user_id: createdUserId, email, password });
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
      console.error("admin-users failed", error);
    return json({ error: "Xəta baş verdi. Bir az sonra yenidən cəhd edin." }, 500);
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
      console.error("admin-users failed", error);
    return json({ error: "Xəta baş verdi. Bir az sonra yenidən cəhd edin." }, 500);
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
      console.error("admin-users: auth users could not be read", response.status, await response.text());
      return json({ error: "Xəta baş verdi. Bir az sonra yenidən cəhd edin." }, 500);
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
