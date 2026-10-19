export type AuthContext = {
  user: {
    id: string;
    email?: string | null;
  };
  profile: {
    role: string | null;
    status: string | null;
  } | null;
};

export type JsonResponder = (body: unknown, status?: number) => Response;

function bearerToken(req: Request) {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

async function getUserFromJwt(supabaseUrl: string, serviceRoleKey: string, token: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return null;
  return await response.json();
}

async function readSingleProfile(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: "user_profiles" | "admin_users",
  userId: string,
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&select=role,status&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getProfile(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  return readSingleProfile(supabaseUrl, serviceRoleKey, "user_profiles", userId);
}

async function getAdminProfile(supabaseUrl: string, serviceRoleKey: string, userId: string) {
  return readSingleProfile(supabaseUrl, serviceRoleKey, "admin_users", userId);
}

export async function requireAuthenticated(req: Request, json: JsonResponder): Promise<AuthContext | Response> {
  const token = bearerToken(req);
  if (!token) return json({ error: "Authentication required" }, 401);

  let supabaseUrl: string;
  let serviceRoleKey: string;
  try {
    supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
    serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }

  const user = await getUserFromJwt(supabaseUrl, serviceRoleKey, token);
  if (!user?.id) return json({ error: "Invalid or expired session" }, 401);

  const profile = await getProfile(supabaseUrl, serviceRoleKey, user.id);
  if (profile?.status === "blocked" || profile?.status === "inactive") {
    return json({ error: "Account is not active" }, 403);
  }

  return {
    user: {
      id: user.id,
      email: user.email || null,
    },
    profile,
  };
}

export async function requireAdmin(req: Request, json: JsonResponder): Promise<AuthContext | Response> {
  const token = bearerToken(req);
  if (!token) return json({ error: "Authentication required" }, 401);

  let supabaseUrl: string;
  let serviceRoleKey: string;
  try {
    supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
    serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }

  const user = await getUserFromJwt(supabaseUrl, serviceRoleKey, token);
  if (!user?.id) return json({ error: "Invalid or expired session" }, 401);

  const adminProfile = await getAdminProfile(supabaseUrl, serviceRoleKey, user.id);
  const role = adminProfile?.role || "";
  const status = adminProfile?.status || "";

  if ((role !== "admin" && role !== "superadmin") || status !== "active") {
    return json({ error: "Admin access required" }, 403);
  }

  return {
    user: {
      id: user.id,
      email: user.email || null,
    },
    profile: adminProfile,
  };
}
