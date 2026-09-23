YªçŠx-®éÜj×¢ëiºÚ+Š§j[h‘éÜ¢éíÛNS¢Ö¥¢ëiºÙbë5import { getEnvironment, type AppEnvironment } from "../../config/src/env.js";

export function integrationStatus(environment: AppEnvironment) {
  ×Nm¢G§²ÚîÆ­yÔ",
    email: environment.email.status,
  } as const;
}

export function providerStatus() {
  return integrationStatus(getEnvironment());
}
