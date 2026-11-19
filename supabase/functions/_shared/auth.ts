import { serviceKey, serviceAuthHeaders } from "./service_key.ts";

export type AuthContext = {
  token: string;
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

function tokenAal(token: string): string | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
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

  if (!response.ok) {
    console.error("auth: session check failed", response.status, (await response.text()).slice(0, 300));
    return null;
  }
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
        ...serviceAuthHeaders(serviceRoleKey),
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    console.error(`auth: ${table} read failed`, response.status, (await response.text()).slice(0, 300));
    return null;
  }
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
  if (!token) return json({ error: "Sessiyanın vaxtı bitib. Zəhmət olmasa yenidən daxil olun." }, 401);

  let supabaseUrl: string;
  let serviceRoleKey: string;
  try {
    supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
    serviceRoleKey = serviceKey() || "";
    if (!serviceRoleKey) throw new Error("SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY is missing");
  } catch (error) {
    console.error("auth failed", error);
    return json({ error: "Xəta baş verdi. Bir az sonra yenidən cəhd edin." }, 500);
  }

  const user = await getUserFromJwt(supabaseUrl, serviceRoleKey, token);
  if (!user?.id) return json({ error: "Sessiyanın vaxtı bitib. Zəhmət olmasa yenidən daxil olun." }, 401);

  const profile = await getProfile(supabaseUrl, serviceRoleKey, user.id);
  if (profile?.status === "blocked" || profile?.status === "inactive") {
    return json({ error: "Hesabınız aktiv deyil." }, 403);
  }

  return {
    token,
    user: {
      id: user.id,
      email: user.email || null,
    },
    profile,
  };
}

export async function requireAdmin(req: Request, json: JsonResponder): Promise<AuthContext | Response> {
  const token = bearerToken(req);
  if (!token) return json({ error: "Sessiyanın vaxtı bitib. Zəhmət olmasa yenidən daxil olun." }, 401);

  let supabaseUrl: string;
  let serviceRoleKey: string;
  try {
    supabaseUrl = env("SUPABASE_URL").replace(/\/$/, "");
    serviceRoleKey = serviceKey() || "";
    if (!serviceRoleKey) throw new Error("SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY is missing");
  } catch (error) {
    console.error("auth failed", error);
    return json({ error: "Xəta baş verdi. Bir az sonra yenidən cəhd edin." }, 500);
  }

  const user = await getUserFromJwt(supabaseUrl, serviceRoleKey, token);
  if (!user?.id) return json({ error: "Sessiyanın vaxtı bitib. Zəhmət olmasa yenidən daxil olun." }, 401);

  const adminProfile = await getAdminProfile(supabaseUrl, serviceRoleKey, user.id);
  const role = adminProfile?.role || "";
  const status = adminProfile?.status || "";

  if ((role !== "admin" && role !== "superadmin") || status !== "active") {
    return json({ error: "Bu əməliyyat üçün admin icazəsi lazımdır." }, 403);
  }

  // Same rule as public.is_admin_user(): admin rights need two-step login.
  // Auth already validated this token above, so reading its claims is safe.
  if (tokenAal(token) !== "aal2") {
    return json({ error: "Admin əməliyyatı üçün iki addımlı kodu yazın. Çıxıb yenidən daxil olun." }, 403);
  }

  return {
    token,
    user: {
      id: user.id,
      email: user.email || null,
    },
    profile: adminProfile,
  };
}
