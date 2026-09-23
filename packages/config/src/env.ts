import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ quiet: true });

const optional = z.string().trim().min(1).optional();

const rawEnvironment = z
  .object({
    SUPABASE_URL: optional,
    SUPABASE_PUBLISHABLE_KEY: optional,
    SUPABASE_SECRET_KEY: optional,
    SUPABASE_SERVICE_ROLE_KEY: optional,
    DATABASE_URL: optional,
    SUPABASE_OWNER_USER_ID: optional,
    OPENROUTER_API_KEY: optional,
    OPENROUTER_MODEL: optional,
    OPENROUTER_CHAT_MODEL: optional,
    OPENROUTER_VISION_MODEL: optional,
    OPENROUTER_IMAGE_MODEL: optional,
    SERPAPI_API_KEY: optional,
    FIRECRAWL_API_KEY: optional,
    BUFFER_API_KEY: optional,
    UNIPILE_API_KEY: optional,
    UNIPILE_DSN: optional,
    UNIPILE_WEBHOOK_SECRET: optional,
    APP_ORIGIN: optional,
    API_PUBLIC_URL: optional,
    APP_TIMEZONE: optional,
    API_PORT: optional,
    WEB_PORT: optional,
    WORKER_POLL_MS: optional,
    UNIPILE_WEBHOOK_TOLERANCE_SECONDS: optional,
    N8N_NOTIFICATION_WEBHOOK_URL: optional,
    N8N_NOTIFICATION_SHARED_SECRET: optional,
  })
  .parse(process.env);

export type ProviderStatus = "configured" | "disabled";

export type AppEnvironment = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  supabaseSecretKey?: string;
  databaseUrl?: string;
  ownerUserId?: string;
  openRouter: {
    status: ProviderStatus;
    apiKey?: string;
    model: string;
    visionModel?: string;
    chatModel?: string;
    imageModel: string;
  };
  serpApi: { status: ProviderStatus; apiKey?: string };
  firecrawl?: { apiKey?: string };
  buffer: { status: ProviderStatus; apiKey?: string };
  unipile: {
    status: ProviderStatus;
    apiKey?: string;
    dsn?: string;
    webhookSecret?: string;
  };
  email: {
    status: ProviderStatus;
    notificationWebhookUrl?: string;
    sharedSecret?: string;
  };
  appOrigin: string;
  apiPublicUrl?: string;
  timezone: string;
  apiPort: number;
  workerPollMs: number;
  webhookToleranceSeconds: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getEnvironment(): AppEnvironment {
  const secretKey =
    rawEnvironment.SUPABASE_SECRET_KEY ??
    rawEnvironment.SUPABASE_SERVICE_ROLE_KEY;
  const webPort = positiveInteger(rawEnvironment.WEB_PORT, 3000);

  return {
    supabaseUrl: rawEnvironment.SUPABASE_URL,
    supabasePublishableKey: rawEnvironment.SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: secretKey,
    databaseUrl: rawEnvironment.DATABASE_URL,
    ownerUserId: rawEnvironment.SUPABASE_OWNER_USER_ID,
    openRouter: {
      status: rawEnvironment.OPENROUTER_API_KEY ? "configured" : "disabled",
      apiKey: rawEnvironment.OPENROUTER_API_KEY,
      model: rawEnvironment.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
      visionModel:
        rawEnvironment.OPENROUTER_VISION_MODEL ?? "openai/gpt-4o-mini",
      chatModel: "z-ai/glm-5.3-flash",
      imageModel:
        rawEnvironment.OPENROUTER_IMAGE_MODEL ??
        "google/gemini-3.1-flash-lite-image",
    },
    serpApi: {
      status: rawEnvironment.SERPAPI_API_KEY ? "configured" : "disabled",
      apiKey: rawEnvironment.SERPAPI_API_KEY,
    },
    firecrawl: { apiKey: rawEnvironment.FIRECRAWL_API_KEY },
    buffer: {
      status: rawEnvironment.BUFFER_API_KEY ? "configured" : "disabled",
      apiKey: rawEnvironment.BUFFER_API_KEY,
    },
    unipile: {
      status:
        rawEnvironment.UNIPILE_API_KEY && rawEnvironment.UNIPILE_DSN
          ? "configured"
          : "disabled",
      apiKey: rawEnvironment.UNIPILE_API_KEY,
      dsn: rawEnvironment.UNIPILE_DSN,
      webhookSecret: rawEnvironment.UNIPILE_WEBHOOK_SECRET,
    },
    email: {
      status:
        rawEnvironment.N8N_NOTIFICATION_WEBHOOK_URL &&
        rawEnvironment.N8N_NOTIFICATION_SHARED_SECRET
          ? "configured"
          : "disabled",
      notificationWebhookUrl: rawEnvironment.N8N_NOTIFICATION_WEBHOOK_URL,
      sharedSecret: rawEnvironment.N8N_NOTIFICATION_SHARED_SECRET,
    },
    appOrigin: rawEnvironment.APP_ORIGIN ?? "http://localhost:" + webPort,
    apiPublicUrl: rawEnvironment.API_PUBLIC_URL,
    timezone: rawEnvironment.APP_TIMEZONE ?? "Asia/Riyadh",
    apiPort: positiveInteger(rawEnvironment.API_PORT, 8787),
    workerPollMs: positiveInteger(rawEnvironment.WORKER_POLL_MS, 500),
    webhookToleranceSeconds: positiveInteger(
      rawEnvironment.UNIPILE_WEBHOOK_TOLERANCE_SECONDS,
      300,
    ),
  };
}

export function missingCoreEnvironment(env = getEnvironment()): string[] {
  const values: Array<[string, string | undefined]> = [
    ["SUPABASE_URL", env.supabaseUrl],
    ["SUPABASE_SECRET_KEY", env.supabaseSecretKey],
    ["DATABASE_URL", env.databaseUrl],
    ["SUPABASE_OWNER_USER_ID", env.ownerUserId],
  ];
  return values.filter(([, value]) => !value).map(([key]) => key);
}

export function assertCoreEnvironment(env = getEnvironment()): AppEnvironment {
  const missing = missingCoreEnvironment(env);
  if (missing.length)
    throw new Error(
      "Missing required environment variables: " + missing.join(", "),
    );
  return env;
}
