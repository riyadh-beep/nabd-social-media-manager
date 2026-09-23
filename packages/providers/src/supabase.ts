YªçŠx-®éÜj×¢ëiºÚ+Š§j[h‘éÜ¢éíÛ­S¢Ö¥¢ëiºÙbë5import { createClient } from "@supabase/supabase-js";
import { assertCoreEnvironment } from "../../config/src/env.js";

const environment = assertCore×­m¢G§²ÚîÆ­yÔUser(token);
  if (error || !data.user) throw new Error("Invalid authentication token");
  return { id: data.user.id, email: data.user.email };
}
