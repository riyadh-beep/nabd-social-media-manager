// Keep hosted API settings independent of provider credentials.
export function apiListener(env: Record<string, string | undefined> = process.env) {
  const value = env.PORT ?? env.API_PORT ?? "8787";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT or API_PORT must be an integer between 1 and 65535");
  }
  return { port, host: env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1" };
}

export function assertHostedOrigins(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== "production") return;
  for (const name of ["APP_ORIGIN", "API_PUBLIC_URL"] as const) {
    try {
      const url = new URL(env[name] ?? "");
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error();
    } catch {
      throw new Error(`${name} must be a public HTTPS origin in production`);
    }
  }
}
