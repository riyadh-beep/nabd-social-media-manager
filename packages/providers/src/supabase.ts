import { createClient } from "@supabase/supabase-js";
import { assertCoreEnvironment } from "../../config/src/env.js";

const environment = assertCoreEnvironment();

export const supabaseAdmin = createClient(environment.supabaseUrl!, environment.supabaseSecretKey!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function authenticatedUser(authorization: string | undefined): Promise<{ id: string; email?: string }> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Authentication is required");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid authentication token");
  return { id: data.user.id, email: data.user.email };
}
