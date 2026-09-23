import { z } from "zod";

export const platformSchema = z.enum(["instagram", "tiktok", "x"]);
export const languageSchema = z.enum(["ar", "en"]);
export const workspaceTypeSchema = z.enum([
  "store",
  "creator",
  "business",
  "news",
]);
export const knowledgeTypeSchema = z.enum([
  "product",
  "faq",
  "policy",
  "design",
  "source",
  "instruction",
]);

export const createBrandSchema = z.object({
  name: z.string().trim().min(1).max(100),
  workspaceType: workspaceTypeSchema,
  description: z.string().trim().max(3_000).default(""),
  topics: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  audience: z.string().trim().max(500).default(""),
  languages: z.array(languageSchema).min(1).max(2).default(["en"]),
});

export const updateBrandSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  workspaceType: workspaceTypeSchema.optional(),
  description: z.string().trim().max(3_000).optional(),
  topics: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  audience: z.string().trim().max(500).optional(),
  dailyGeneration: z.boolean().optional(),
  autoReply: z.boolean().optional(),
  replyKnowledgeMode: z.enum(["chat", "content", "all"]).optional(),
  replyKnowledgeIds: z.array(z.string().uuid()).max(50).optional(),
  replyModel: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._/-]+$/, "Use a valid OpenRouter model ID")
    .max(160)
    .optional(),
  status: z.enum(["approved", "paused"]).optional(),
});

export const createKnowledgeSchema = z.object({
  scope: z.enum(["content", "chat"]).default("content"),
  type: knowledgeTypeSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(12_000),
  source: z
    .string()
    .url()
    .optional()
    .or(z.literal(""))
    .transform((value) => value || null),
});

export const generateContentSchema = z.object({
  brief: z.string().trim().min(1).max(2_000),
  platforms: z.array(platformSchema).min(1).max(3),
  language: languageSchema,
  generateImages: z.boolean().default(false),
  photoMode: z.enum(["auto", "original", "none"]).default("auto"),
  knowledgePhotoId: z.string().uuid().optional(),
  knowledgeIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Choose each knowledge item only once",
    )
    .optional(),
});

export const searchNewsSchema = z.object({
  query: z.string().trim().min(2).max(300),
  language: languageSchema.default("en"),
  limit: z.number().int().min(1).max(10).default(8),
});

export const draftActionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  publishMode: z.enum(["now", "queue", "schedule"]).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  caption: z.string().trim().min(1).max(2_200).optional(),
  assetId: z.string().uuid().nullable().optional(),
});

export const sendReplySchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  expectedMessageId: z.string().uuid().optional(),
  replyDraftId: z.string().uuid().optional(),
});

export const webhookEventSchema = z.union([
  z
    .object({
      id: z.string().min(1).max(250),
      account_id: z.string().min(1).max(250),
      account_provider: z.string().min(1).max(80),
      type: z.string().min(1).max(120),
      created_at: z.string().optional(),
      payload: z.unknown().optional(),
    })
    .transform((event) => ({
      accountId: event.account_id,
      eventId: event.id,
      eventType: event.type,
      payload: event,
    })),
  z
    .object({
      account_id: z.string().min(1).max(250),
      event: z.string().min(1).max(120),
      timestamp: z.string().min(1).max(80),
      message_id: z.string().min(1).max(250).optional(),
    })
    .passthrough()
    .transform((event) => ({
      accountId: event.account_id,
      eventId:
        event.message_id ??
        `${event.account_id}:${event.event}:${event.timestamp}`,
      eventType: event.event,
      payload: event,
    })),
]);

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;
