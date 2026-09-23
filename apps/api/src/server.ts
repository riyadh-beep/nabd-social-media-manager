import { loadContentKnowledge } from "../../../packages/domain/src/content-knowledge.js";
import {
  MAX_PHOTO_BYTES,
  MAX_PRODUCT_PHOTOS,
  normalizeProductPhoto,
  selectedProductPhoto,
} from "../../../packages/domain/src/product-photos.js";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { createHash, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  assertCoreEnvironment,
  missingCoreEnvironment,
} from "../../../packages/config/src/env.js";
import {
  apiListener,
  assertHostedOrigins,
} from "../../../packages/config/src/hosting.js";
import {
  createBrandSchema,
  createKnowledgeSchema,
  draftActionSchema,
  generateContentSchema,
  searchNewsSchema,
  sendReplySchema,
  updateBrandSchema,
  webhookEventSchema,
} from "../../../packages/contracts/src/index.js";
import {
  database,
  databaseReady,
  transaction,
} from "../../../packages/database/src/client.js";
import { enqueueJob } from "../../../packages/domain/src/jobs.js";
import { providerStatus } from "../../../packages/providers/src/status.js";
import { publicPageUrl } from "../../../packages/providers/src/firecrawl.js";
import { searchGoogleNews } from "../../../packages/providers/src/serpapi.js";
import {
  authenticatedUser,
  supabaseAdmin,
} from "../../../packages/providers/src/supabase.js";
import {
  verifyUnipileSignature,
  verifyUnipileV1Header,
} from "../../../packages/providers/src/unipile.js";

const environment = assertCoreEnvironment();
const previewCache = new Map<string, { url: string; expires: number }>();
let openRouterModelCache: { expires: number; models: Array<{ id: string; name: string }> } | null = null;
async function openRouterModels() {
  if (openRouterModelCache && openRouterModelCache.expires > Date.now()) return openRouterModelCache.models;
  if (!environment.openRouter.apiKey) return [];
  const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=text", {
    headers: { Authorization: `Bearer ${environment.openRouter.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("OpenRouter model catalog is currently unavailable");
  const payload = await response.json() as { data?: Array<{ id?: unknown; name?: unknown }> };
  const models = (payload.data ?? []).flatMap((model) =>
    typeof model.id === "string" && /^[a-zA-Z0-9._/:+-]+$/.test(model.id)
      ? [{ id: model.id, name: typeof model.name === "string" ? model.name : model.id }]
      : [],
  ).sort((a, b) => a.name.localeCompare(b.name));
  openRouterModelCache = { models, expires: Date.now() + 10 * 60_000 };
  return models;
}
async function privatePreview(path: string): Promise<string | null> {
  const cached = previewCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  try {
    const signed = await supabaseAdmin.storage
      .from("generated-assets")
      .createSignedUrl(path, 3600);
    if (!signed.data?.signedUrl) return null;
    if (previewCache.size >= 500)
      previewCache.delete(previewCache.keys().next().value!);
    previewCache.set(path, {
      url: signed.data.signedUrl,
      expires: Date.now() + 50 * 60_000,
    });
    return signed.data.signedUrl;
  } catch {
    return null;
  }
}
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.unipile-signature"],
  },
});

await server.register(cors, {
  origin: environment.appOrigin,
  credentials: true,
});
server.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_request, body, done) => done(null, body),
);

server.addContentTypeParser(
  ["image/jpeg", "image/png", "image/webp"],
  { parseAs: "buffer", bodyLimit: MAX_PHOTO_BYTES },
  (_request, body, done) => done(null, body),
);

type ApiRequest = FastifyRequest<{
  Body: unknown;
  Params: Record<string, string>;
}>;

function jsonBody(request: ApiRequest): unknown {
  if (typeof request.body !== "string") return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function contentHash(input: {
  caption: string;
  hashtags: string[];
  visualBrief: string;
  version: number;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function requireOwner(request: FastifyRequest): Promise<{ id: string }> {
  const host = String(request.headers.host ?? "")
    .split(":")[0]
    .toLowerCase();
  const localAddress =
    request.ip === "127.0.0.1" ||
    request.ip === "::1" ||
    request.ip === "::ffff:127.0.0.1";
  if (
    process.env.NODE_ENV !== "production" &&
    localAddress &&
    (host === "localhost" || host === "127.0.0.1")
  )
    return { id: environment.ownerUserId! };
  const user = await authenticatedUser(request.headers.authorization);
  if (user.id !== environment.ownerUserId)
    throw new Error("Owner access is required");
  return user;
}

async function requireBrand(
  request: FastifyRequest,
  brandId: string,
): Promise<{ id: string }> {
  const user = await requireOwner(request);
  const result = await database.query(
    "select 1 from public.brand_profiles where id = $1 and owner_id = $2",
    [brandId, user.id],
  );
  if (result.rowCount !== 1)
    throw new Error("Brand was not found or is not owned by this account");
  return user;
}

function errorReply(error: unknown) {
  if (error instanceof ZodError)
    return {
      status: 400,
      body: {
        error: "Invalid request",
        issues: error.issues.map((issue) => issue.path.join(".") || "body"),
      },
    };
  const message = error instanceof Error ? error.message : "Request failed";
  if (
    message === "Authentication is required" ||
    message === "Invalid authentication token"
  )
    return { status: 401, body: { error: message } };
  if (message.includes("Owner access") || message.includes("not owned"))
    return { status: 403, body: { error: message } };
  return { status: 400, body: { error: message } };
}

server.get("/health", async (_request, reply) => {
  try {
    await databaseReady();
    return { status: "ok", database: "connected", providers: providerStatus() };
  } catch {
    return reply
      .status(503)
      .send({
        status: "degraded",
        database: "unavailable",
        missing: missingCoreEnvironment(),
      });
  }
});

server.get("/v1/status", async (request, reply) => {
  try {
    await requireOwner(request);
    return {
      providers: providerStatus(),
      email: { status: environment.email.status },
    };
  } catch (error) {
    const failure = errorReply(error);
    return reply.status(failure.status).send(failure.body);
  }
});

server.get("/v1/openrouter/models", async (request, reply) => {
  try {
    await requireOwner(request);
    return { models: await openRouterModels() };
  } catch (error) {
    const failure = errorReply(error);
    return reply.status(failure.status).send(failure.body);
  }
});

server.get("/v1/brands", async (request, reply) => {
  try {
    const user = await requireOwner(request);
    const result = await database.query(
      "select b.*, coalesce(s.reply_sending_enabled,false) as auto_reply, coalesce(s.reply_knowledge_mode,'chat') as reply_knowledge_mode, coalesce(s.reply_knowledge_ids,'{}'::uuid[]) as reply_knowledge_ids, 'z-ai/glm-5.3-flash'::text as reply_model from public.brand_profiles b left join automation_settings s on s.brand_id=b.id where b.owner_id = $1 order by b.created_at",
      [user.id],
    );
    return { brands: result.rows };
  } catch (error) {
    const failure = errorReply(error);
    return reply.status(failure.status).send(failure.body);
  }
});

server.post("/v1/brands", async (request: ApiRequest, reply) => {
  try {
    const user = await requireOwner(request);
    const input = createBrandSchema.parse(jsonBody(request));
    const rules = {
      workspace_type: input.workspaceType,
      topics: input.topics,
      audience: input.audience,
    };
    const created = await transaction(async (client) => {
      const brand = await client.query<{ id: string }>(
        "insert into public.brand_profiles (owner_id, name, description, languages, timezone, brand_rules, status) values ($1,$2,$3,$4,$5,$6::jsonb,'approved') returning id",
        [
          user.id,
          input.name,
          input.description,
          input.languages,
          environment.timezone,
          JSON.stringify(rules),
        ],
      );
      await client.query(
        "insert into public.automation_settings (brand_id) values ($1)",
        [brand.rows[0].id],
      );
      return brand.rows[0];
    });
    return reply.status(201).send({ brand: created });
  } catch (error) {
    const failure = errorReply(error);
    return reply.status(failure.status).send(failure.body);
  }
});

server.patch("/v1/brands/:brandId", async (request: ApiRequest, reply) => {
  try {
    const { brandId } = request.params;
    await requireBrand(request, brandId);
    const input = updateBrandSchema.parse(jsonBody(request));
    if (!Object.keys(input).length)
      throw new Error("At least one workspace change is required");
    const result = await transaction(async (client) => {
      const current = await client.query<{
        brand_rules: {
          workspace_type?: string;
          topics?: string[];
          audience?: string;
        };
      }>(
        "select brand_rules from public.brand_profiles where id=$1 for update",
        [brandId],
      );
      if (!current.rows[0]) throw new Error("Workspace was not found");
      const rules = { ...(current.rows[0].brand_rules ?? {}) };
      if (input.workspaceType) rules.workspace_type = input.workspaceType;
      if (input.topics) rules.topics = input.topics;
      if (input.audience !== undefined) rules.audience = input.audience;
      const brand = await client.query(
        "update public.brand_profiles set name=coalesce($2,name), description=coalesce($3,description), brand_rules=$4::jsonb, status=coalesce($5,status), updated_at=now() where id=$1 returning *",
        [
          brandId,
          input.name ?? null,
          input.description ?? null,
          JSON.stringify(rules),
          input.status ?? null,
        ],
      );
      if (
        input.autoReply !== undefined ||
        input.replyKnowledgeMode !== undefined ||
        input.replyKnowledgeIds !== undefined ||
        input.replyModel !== undefined
      )
        await client.query(
          "insert into automation_settings(brand_id,reply_sending_enabled,reply_knowledge_mode,reply_knowledge_ids,reply_model) values($1,$2,$3,$4,$5) on conflict(brand_id) do update set reply_sending_enabled=coalesce($2,automation_settings.reply_sending_enabled),reply_knowledge_mode=coalesce($3,automation_settings.reply_knowledge_mode),reply_knowledge_ids=coalesce($4,automation_settings.reply_knowledge_ids),reply_model=coalesce($5,automation_settings.reply_model),updated_at=now()",
          [
            brandId,
            input.autoReply ?? null,
            input.replyKnowledgeMode ?? null,
            input.replyKnowledgeIds ?? null,
            input.replyModel !== undefined ? "z-ai/glm-5.3-flash" : null,
          ],
        );
      if (input.dailyGeneration !== undefined)
        await client.query(
          "update public.automation_settings set generation_enabled=$2, daily_generation_time=case when $2 then '08:00'::time else null end, updated_at=now() where brand_id=$1",
          [brandId, input.dailyGeneration],
        );
      return brand.rows[0];
    });
    return { brand: result };
  } catch (error) {
    const failure = errorReply(error);
    return reply.status(failure.status).send(failure.body);
  }
});

server.get(
  "/v1/brands/:brandId/dashboard",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      const [
        brand,
        drafts,
        knowledge,
        jobs,
        accounts,
        conversations,
        assets,
        photos,
      ] = await Promise.all([
        database.query("select * from public.brand_profiles where id=$1", [
          brandId,
        ]),
        database.query(
          "select * from public.content_drafts where brand_id=$1 and archived_at is null order by created_at desc limit 100",
          [brandId],
        ),
        database.query(
          "select * from public.knowledge_items where brand_id=$1 and status <> 'archived' order by created_at desc",
          [brandId],
        ),
        database.query(
          "select id,kind,status,error_summary,created_at,updated_at,result,attempt_count,payload->>'draftId' as draft_id,payload->>'conversationId' as conversation_id from public.background_jobs j where brand_id=$1 and archived_at is null and not exists (select 1 from public.content_drafts d where d.id::text=j.payload->>'draftId' and d.archived_at is not null) order by created_at desc limit 50",
          [brandId],
        ),
        database.query(
          "select * from public.social_accounts where brand_id=$1",
          [brandId],
        ),
        database.query(
          "select * from public.conversations where brand_id=$1 and archived_at is null order by updated_at desc limit 100",
          [brandId],
        ),
        database.query(
          "select * from public.assets where brand_id=$1 and status <> 'archived' order by created_at desc",
          [brandId],
        ),
        database.query(
          "select p.id,p.knowledge_id,p.asset_id,p.slot from knowledge_photos p join knowledge_items k on k.id=p.knowledge_id where k.brand_id=$1 and k.status<>'archived' order by p.slot",
          [brandId],
        ),
      ]);
      const conversationIds = conversations.rows.map((row) => row.id);
      const messages = conversationIds.length
        ? await database.query(
            "select * from public.messages where conversation_id = any($1::uuid[]) order by created_at",
            [conversationIds],
          )
        : { rows: [] };
      const visibleAssets = await Promise.all(
        assets.rows.map(async (asset) => {
          try {
            return {
              ...asset,
              preview_url: await privatePreview(asset.storage_path),
            };
          } catch {
            return { ...asset, preview_url: null };
          }
        }),
      );
      return {
        brand: brand.rows[0] ?? null,
        replyDrafts: conversationIds.length
          ? (
              await database.query(
                "select * from reply_drafts where conversation_id=any($1::uuid[]) and status='draft' order by created_at desc",
                [conversationIds],
              )
            ).rows
          : [],
        drafts: drafts.rows,
        knowledge: knowledge.rows.map((item) => ({
          ...item,
          photos: photos.rows
            .filter((photo) => photo.knowledge_id === item.id)
            .map((photo) => ({
              ...photo,
              preview_url:
                visibleAssets.find((asset) => asset.id === photo.asset_id)
                  ?.preview_url ?? null,
            })),
        })),
        jobs: jobs.rows,
        accounts: accounts.rows,
        conversations: conversations.rows,
        messages: messages.rows,
        assets: visibleAssets,
      };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/knowledge",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      const input = createKnowledgeSchema.parse(jsonBody(request));
      const result = await database.query(
        "insert into public.knowledge_items (brand_id,type,title,content,source,scope,status) values ($1,$2,$3,$4,$5,$6,'draft') returning *",
        [
          brandId,
          input.type,
          input.title,
          input.content,
          input.source,
          input.scope,
        ],
      );
      return reply.status(201).send({ knowledge: result.rows[0] });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/knowledge/:knowledgeId/photos",
  { bodyLimit: MAX_PHOTO_BYTES },
  async (request: ApiRequest, reply) => {
    let uploadedPath: string | undefined;
    try {
      const { brandId, knowledgeId } = request.params;
      const user = await requireBrand(request, brandId);
      if (!Buffer.isBuffer(request.body))
        throw new Error("Choose a JPG, PNG, or WebP photo");
      const bytes = await normalizeProductPhoto(
        request.body,
        String(request.headers["content-type"]).split(";")[0],
      );
      const hash = createHash("sha256").update(bytes).digest("hex");
      const photo = await transaction(async (client) => {
        const knowledge = await client.query(
          "select id from knowledge_items where id=$1 and brand_id=$2 and status<>'archived' for update",
          [knowledgeId, brandId],
        );
        if (!knowledge.rowCount)
          throw new Error("Knowledge item was not found");
        const existing = await client.query<{
          id: string;
          slot: number;
          content_hash: string;
        }>(
          "select id,slot,content_hash from knowledge_photos where knowledge_id=$1",
          [knowledgeId],
        );
        const duplicate = existing.rows.find(
          (row) => row.content_hash === hash,
        );
        if (duplicate) return { id: duplicate.id, duplicate: true };
        if (existing.rows.length >= MAX_PRODUCT_PHOTOS)
          throw new Error(
            "Each knowledge item can have up to 7 photos. Remove one before uploading another.",
          );
        const slot = Array.from(
          { length: MAX_PRODUCT_PHOTOS },
          (_, i) => i + 1,
        ).find((i) => !existing.rows.some((row) => row.slot === i))!;
        const storagePath = `${user.id}/${brandId}/products/${randomUUID()}.jpg`;
        const stored = await supabaseAdmin.storage
          .from("generated-assets")
          .upload(storagePath, bytes, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (stored.error)
          throw new Error(
            "The photo could not be stored privately. Try again.",
          );
        uploadedPath = storagePath;
        const asset = await client.query<{ id: string }>(
          "insert into assets(brand_id,storage_path,asset_type,mime_type,metadata,status) values($1,$2,'product','image/jpeg',$3,'draft') returning id",
          [
            brandId,
            storagePath,
            JSON.stringify({
              name: `Product photo ${slot}`,
              knowledge_id: knowledgeId,
            }),
          ],
        );
        return (
          await client.query(
            "insert into knowledge_photos(knowledge_id,asset_id,slot,content_hash) values($1,$2,$3,$4) returning id,asset_id,slot",
            [knowledgeId, asset.rows[0].id, slot, hash],
          )
        ).rows[0];
      });
      return reply.status(201).send({ photo });
    } catch (error) {
      if (uploadedPath)
        await supabaseAdmin.storage
          .from("generated-assets")
          .remove([uploadedPath])
          .catch(() => {});
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.delete(
  "/v1/brands/:brandId/knowledge/:knowledgeId/photos/:photoId",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, knowledgeId, photoId } = request.params;
      await requireBrand(request, brandId);
      await transaction(async (client) => {
        const knowledge = await client.query(
          "select id from knowledge_items where id=$1 and brand_id=$2 for update",
          [knowledgeId, brandId],
        );
        if (!knowledge.rowCount)
          throw new Error("Knowledge item was not found");
        await client.query(
          "delete from knowledge_photos where id=$1 and knowledge_id=$2",
          [photoId, knowledgeId],
        );
      });
      // Existing drafts retain their asset even after the photo is removed from knowledge.
      return { removed: true };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/news/search",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      const input = searchNewsSchema.parse(jsonBody(request));
      const articles = await searchGoogleNews({ environment, ...input });
      return { articles };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/knowledge/import",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      if (!environment.firecrawl?.apiKey)
        throw new Error("FIRECRAWL_API_KEY is required for website imports");
      const body = jsonBody(request) as { url?: unknown };
      if (typeof body?.url !== "string" || body.url.length > 2000)
        throw new Error("Enter a public store page URL");
      const url = publicPageUrl(body.url);
      const jobId = await transaction((client) =>
        enqueueJob(client, {
          brandId,
          kind: "knowledge.import",
          payload: { url },
          idempotencyKey: `import:${request.headers["idempotency-key"] ?? randomUUID()}`,
        }),
      );
      return reply.status(202).send({ jobId });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/knowledge/:knowledgeId/approve",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, knowledgeId } = request.params;
      const user = await requireBrand(request, brandId);
      const result = await database.query(
        "update public.knowledge_items set status='approved', verified_at=now(), updated_at=now() where id=$1 and brand_id=$2 returning *",
        [knowledgeId, brandId],
      );
      if (!result.rows[0]) throw new Error("Knowledge item was not found");
      await database.query(
        "insert into public.audit_logs (actor_id,action,entity_type,entity_id,metadata) values ($1,'knowledge.approved','knowledge_item',$2,$3::jsonb)",
        [user.id, knowledgeId, JSON.stringify({ brand_id: brandId })],
      );
      return { knowledge: result.rows[0] };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/knowledge/:knowledgeId/archive",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, knowledgeId } = request.params;
      await requireBrand(request, brandId);
      const result = await database.query(
        "update public.knowledge_items set status='archived', updated_at=now() where id=$1 and brand_id=$2 returning id",
        [knowledgeId, brandId],
      );
      if (!result.rows[0]) throw new Error("Knowledge item was not found");
      return { archived: true };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/integrations/refresh",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      const idempotencyKey =
        request.headers["idempotency-key"]?.toString() ??
        `connection-check:${new Date().toISOString().slice(0, 16)}`;
      const jobId = await transaction((client) =>
        enqueueJob(client, {
          brandId,
          kind: "publish.reconcile",
          payload: { operation: "connection_check" },
          idempotencyKey,
        }),
      );
      return reply.status(202).send({ jobId, status: "queued" });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/generate",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      const input = generateContentSchema.parse(jsonBody(request));
      const selectedKnowledge = await loadContentKnowledge(
        database,
        brandId,
        input.knowledgeIds,
      );
      if (input.knowledgePhotoId)
        await selectedProductPhoto(
          database,
          brandId,
          input.knowledgePhotoId,
          selectedKnowledge.map((item) => item.id),
        );
      const idempotencyKey =
        request.headers["idempotency-key"]?.toString() ?? randomUUID();
      const jobId = await transaction(async (client) => {
        await client.query(
          "insert into automation_settings(brand_id,last_content_settings) values($1,$2::jsonb) on conflict(brand_id) do update set last_content_settings=excluded.last_content_settings,updated_at=now()",
          [brandId, JSON.stringify(input)],
        );
        return enqueueJob(client, {
          brandId,
          kind: "content.generate",
          payload: input,
          idempotencyKey,
        });
      });
      return reply.status(202).send({ jobId, status: "queued" });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/auto-post",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId } = request.params;
      await requireBrand(request, brandId);
      const body = jsonBody(request) as { brief?: unknown; occasion?: unknown };
      if (typeof body.brief !== "string" || !body.brief.trim() || body.brief.length > 2_000)
        throw new Error("A calendar occasion needs a short content brief");
      const settings = await database.query<{ last_content_settings: unknown }>(
        "select last_content_settings from automation_settings where brand_id=$1",
        [brandId],
      );
      if (!settings.rows[0]?.last_content_settings)
        throw new Error("Create one post first so Nabd can reuse your selected knowledge, channels, language, and image preference.");
      const last = generateContentSchema.parse(settings.rows[0].last_content_settings);
      const input = generateContentSchema.parse({ ...last, brief: body.brief.trim(), generateImages: true });
      await loadContentKnowledge(database, brandId, input.knowledgeIds);
      const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const occasion = typeof body.occasion === "string" ? body.occasion.slice(0, 120) : "daily";
      const idempotencyKey = `auto-post:${dayKey}:${createHash("sha256").update(occasion).digest("hex").slice(0, 16)}`;
      const jobId = await transaction(async (client) => {
        const job = await enqueueJob(client, {
          brandId,
          kind: "content.generate",
          payload: { ...input, autoPublish: true, autoPostOccasion: occasion },
          idempotencyKey,
        });
        await client.query("update automation_settings set last_auto_post_at=now(),updated_at=now() where brand_id=$1", [brandId]);
        return job;
      });
      return reply.status(202).send({ jobId, status: "queued", mode: "auto_publish" });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/drafts/:draftId/image",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, draftId } = request.params;
      await requireBrand(request, brandId);
      const input = draftActionSchema
        .pick({ expectedVersion: true })
        .parse(jsonBody(request));
      const idempotencyKey =
        request.headers["idempotency-key"]?.toString() ??
        `image:${draftId}:${input.expectedVersion}`;
      const jobId = await transaction(async (client) => {
        const draft = await client.query(
          "select id from public.content_drafts where id=$1 and brand_id=$2 and approval_version=$3 and archived_at is null",
          [draftId, brandId, input.expectedVersion],
        );
        if (!draft.rows[0])
          throw new Error("Draft changed; refresh before generating an image");
        return enqueueJob(client, {
          brandId,
          kind: "image.generate",
          payload: { draftId, expectedVersion: input.expectedVersion },
          idempotencyKey,
        });
      });
      return reply.status(202).send({ jobId, status: "queued" });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/drafts/:draftId/archive",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, draftId } = request.params;
      await requireBrand(request, brandId);
      await transaction(async (client) => {
        const draft = await client.query<{ status: string }>(
          "select status from public.content_drafts where id=$1 and brand_id=$2 and archived_at is null for update",
          [draftId, brandId],
        );
        if (!draft.rowCount) throw new Error("Post was not found");
        if (["approved", "scheduled"].includes(draft.rows[0].status))
          throw new Error(
            "This post is already queued with Buffer. Cancel it before archiving.",
          );
        await client.query(
          "update public.content_drafts set archived_at=now(),updated_at=now() where id=$1 and brand_id=$2",
          [draftId, brandId],
        );
        await client.query(
          "update public.background_jobs set status='cancelled',archived_at=now(),updated_at=now() where brand_id=$1 and payload->>'draftId'=$2 and status='queued'",
          [brandId, draftId],
        );
      });
      return { archived: true };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/drafts/:draftId/:action",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, draftId, action } = request.params;
      const user = await requireBrand(request, brandId);
      const input = draftActionSchema.parse(jsonBody(request));
      const response = await transaction(async (client) => {
        const current = await client.query<{
          caption: string;
          hashtags: string[];
          visual_brief: string;
          approval_version: number;
          status: string;
          platform: string;
          asset_id: string | null;
          scheduled_at: string | null;
        }>(
          "select caption,hashtags,visual_brief,approval_version,status,platform,asset_id,scheduled_at from public.content_drafts where id=$1 and brand_id=$2 and archived_at is null for update",
          [draftId, brandId],
        );
        const draft = current.rows[0];
        if (!draft) throw new Error("Draft was not found");
        const workspace = await client.query(
          "select 1 from brand_profiles where id=$1 and status='approved'",
          [brandId],
        );
        if (!workspace.rowCount)
          throw new Error(
            "Resume this workspace before changing or publishing content",
          );
        const reserved = await client.query(
          "select 1 from provider_attempts where provider='buffer' and operation='publish' and idempotency_key=$1 and state in ('unknown','submitted','confirmed')",
          [`publish:${draftId}:${draft.approval_version}`],
        );
        if (reserved.rowCount)
          throw new Error(
            "This version has reached Buffer or has an uncertain outcome. Review it in Buffer before making changes.",
          );
        if (draft.approval_version !== input.expectedVersion)
          throw new Error("Draft changed; refresh before applying this action");
        if (action === "approve") {
          if (draft.status !== "draft")
            throw new Error("Only draft content can be approved");
          if (
            ["instagram", "tiktok"].includes(draft.platform) &&
            !draft.asset_id
          )
            throw new Error(
              "Generate an image before publishing this photo post",
            );
          if (
            draft.platform === "x" &&
            [draft.caption, ...draft.hashtags].join("\n\n").length > 280
          )
            throw new Error(
              "The X caption and hashtags must fit within 280 characters",
            );
          const mode =
            input.publishMode ?? (draft.scheduled_at ? "schedule" : "now");
          if (
            mode === "schedule" &&
            (!draft.scheduled_at ||
              new Date(draft.scheduled_at).getTime() < Date.now() + 60_000)
          )
            throw new Error(
              "Choose a publishing time at least one minute in the future",
            );
          if (
            draft.scheduled_at &&
            new Date(draft.scheduled_at).getTime() > Date.now() + 7 * 86400_000
          )
            throw new Error(
              "Schedule within the next seven days so the private image stays available to Buffer",
            );
          const channel = await client.query<{
            connection_status: string;
            buffer_channel_id: string | null;
          }>(
            "select connection_status,connection_metadata->>'buffer_channel_id' as buffer_channel_id from public.social_accounts where brand_id=$1 and provider=$2",
            [brandId, draft.platform],
          );
          if (
            !channel.rows[0] ||
            channel.rows[0].connection_status !== "connected" ||
            !channel.rows[0].buffer_channel_id
          )
            throw new Error(
              `Verify the ${draft.platform} Buffer channel before approving this post`,
            );
          const hash = contentHash({
            caption: draft.caption,
            hashtags: draft.hashtags,
            visualBrief: draft.visual_brief,
            version: draft.approval_version,
          });
          await client.query(
            "update public.content_drafts set status='approved', approved_version=approval_version, approval_hash=$3, updated_at=now() where id=$1 and brand_id=$2",
            [draftId, brandId, hash],
          );
          await client.query(
            "insert into public.draft_approvals (draft_id,version,state,content_hash,approved_by) values ($1,$2,'approved',$3,$4) on conflict (draft_id,version) do update set state='approved', content_hash=excluded.content_hash, approved_by=excluded.approved_by, revoked_at=null",
            [draftId, draft.approval_version, hash, user.id],
          );
          const jobId = await enqueueJob(client, {
            brandId,
            kind: "publish.submit",
            payload: {
              draftId,
              expectedVersion: draft.approval_version,
              publishMode: mode,
            },
            idempotencyKey: `publish:${draftId}:${draft.approval_version}`,
          });
          return { status: "approved", jobId };
        }
        if (action === "cancel") {
          await client.query(
            "update public.content_drafts set status='cancelled', archived_at=now(), updated_at=now() where id=$1 and brand_id=$2",
            [draftId, brandId],
          );
          await client.query(
            "update public.background_jobs set status='cancelled', archived_at=now(), updated_at=now() where brand_id=$1 and payload->>'draftId'=$2 and status='queued'",
            [brandId, draftId],
          );
          return { status: "archived" };
        }
        if (action !== "edit" && action !== "schedule")
          throw new Error("Unsupported draft action");
        if (["scheduled", "published"].includes(draft.status))
          throw new Error(
            "This post has already been submitted to Buffer and cannot be edited here",
          );
        if (input.assetId) {
          const asset = await client.query(
            "select 1 from assets where id=$1 and brand_id=$2 and status<>'archived' and mime_type like 'image/%'",
            [input.assetId, brandId],
          );
          if (!asset.rowCount)
            throw new Error("Select an image belonging to this workspace");
        }
        await client.query(
          "update draft_approvals set state='revoked',revoked_at=now() where draft_id=$1 and state='approved'",
          [draftId],
        );
        await client.query(
          "update background_jobs set status='cancelled',updated_at=now() where brand_id=$1 and kind='publish.submit' and payload->>'draftId'=$2 and status='queued'",
          [brandId, draftId],
        );
        if (
          input.scheduledAt &&
          new Date(input.scheduledAt).getTime() <= Date.now()
        )
          throw new Error("Choose a schedule time in the future");
        if (
          draft.platform === "x" &&
          [input.caption ?? draft.caption, ...draft.hashtags].join("\n\n")
            .length > 280
        )
          throw new Error(
            "The X caption and hashtags together must fit within 280 characters",
          );
        const newVersion = draft.approval_version + 1;
        const changedCaption = input.caption ?? draft.caption;
        await client.query(
          "update public.content_drafts set caption=$3, asset_id=coalesce($4,asset_id), scheduled_at=$5, approval_version=$6, approved_version=null, approval_hash=null, status='draft', updated_at=now() where id=$1 and brand_id=$2",
          [
            draftId,
            brandId,
            changedCaption,
            input.assetId ?? null,
            input.scheduledAt ?? null,
            newVersion,
          ],
        );
        return { status: "draft", version: newVersion };
      });
      return response;
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/conversations/:conversationId/suggest",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, conversationId } = request.params;
      await requireBrand(request, brandId);
      if (!environment.openRouter.apiKey)
        throw new Error("OPENROUTER_API_KEY is required for AI replies");
      const jobId = await transaction(async (client) => {
        const conversation = await client.query(
          "select id from conversations where id=$1 and brand_id=$2 and archived_at is null for update",
          [conversationId, brandId],
        );
        if (!conversation.rowCount)
          throw new Error("Conversation was not found");
        const pending = await client.query(
          "select id from background_jobs where brand_id=$1 and kind='reply.generate' and payload->>'conversationId'=$2 and status in ('queued','processing')",
          [brandId, conversationId],
        );
        if (pending.rows[0]) return pending.rows[0].id;
        const latest = await client.query(
          "select id,sender_type from messages where conversation_id=$1 order by created_at desc,id desc limit 1",
          [conversationId],
        );
        if (latest.rows[0]?.sender_type !== "customer")
          throw new Error(
            "This conversation is already answered. AI will draft a reply when the customer writes again.",
          );
        return enqueueJob(client, {
          brandId,
          kind: "reply.generate",
          payload: { conversationId, messageId: latest.rows[0].id },
          idempotencyKey: `suggest:${conversationId}:${request.headers["idempotency-key"] ?? randomUUID()}`,
        });
      });
      return reply.status(202).send({ jobId });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.patch(
  "/v1/brands/:brandId/knowledge/:knowledgeId",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, knowledgeId } = request.params;
      await requireBrand(request, brandId);
      const input = createKnowledgeSchema.parse(jsonBody(request));
      const changed = await database.query(
        "update knowledge_items set title=$3,content=$4,type=$5,source=$6,status='draft',verified_at=null,updated_at=now() where id=$1 and brand_id=$2 and scope=$7 and status<>'archived' returning id",
        [
          knowledgeId,
          brandId,
          input.title,
          input.content,
          input.type,
          input.source,
          input.scope,
        ],
      );
      if (!changed.rowCount) throw new Error("Knowledge item was not found");
      return { saved: true };
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post(
  "/v1/brands/:brandId/conversations/:conversationId/reply",
  async (request: ApiRequest, reply) => {
    try {
      const { brandId, conversationId } = request.params;
      await requireBrand(request, brandId);
      const input = sendReplySchema.parse(jsonBody(request));
      const idempotencyKey =
        request.headers["idempotency-key"]?.toString() ?? randomUUID();
      const jobId = await transaction(async (client) => {
        const conversation = await client.query(
          "select id from public.conversations where id=$1 and brand_id=$2 and provider='instagram'",
          [conversationId, brandId],
        );
        if (!conversation.rows[0])
          throw new Error("Instagram conversation was not found");
        if (input.expectedMessageId) {
          const latest = await client.query(
            "select id from messages where conversation_id=$1 order by created_at desc,id desc limit 1",
            [conversationId],
          );
          if (latest.rows[0]?.id !== input.expectedMessageId)
            throw new Error(
              "The conversation changed. Refresh and review your reply before sending.",
            );
        }
        if (input.replyDraftId) {
          const draft = await client.query(
            "select id from reply_drafts d where id=$1 and conversation_id=$2 and status='draft' and not exists(select 1 from unnest(d.source_knowledge_ids) kid where not exists(select 1 from knowledge_items k where k.id=kid and k.brand_id=$3 and k.scope='chat' and k.status='approved' and k.updated_at<=d.created_at))",
            [input.replyDraftId, conversationId, brandId],
          );
          if (!draft.rowCount)
            throw new Error(
              "The AI suggestion changed. Refresh before sending.",
            );
        }
        const replyKey = input.expectedMessageId ?? idempotencyKey;
        return enqueueJob(client, {
          brandId,
          kind: "reply.send",
          payload: {
            conversationId,
            text: input.text,
            replyKey,
            expectedMessageId: input.expectedMessageId,
            replyDraftId: input.replyDraftId,
          },
          idempotencyKey: `reply:${conversationId}:${replyKey}`,
        });
      });
      return reply.status(202).send({ jobId, status: "queued" });
    } catch (error) {
      const failure = errorReply(error);
      return reply.status(failure.status).send(failure.body);
    }
  },
);

server.post("/v1/webhooks/unipile", async (request: ApiRequest, reply) => {
  const rawBody = typeof request.body === "string" ? request.body : "";
  if (!environment.unipile.webhookSecret)
    return reply
      .status(503)
      .send({
        error:
          "UNIPILE_WEBHOOK_SECRET is required when real webhooks are enabled",
      });
  const signature = request.headers["unipile-signature"];
  const v1Header = request.headers["unipile-auth"];
  const verified = signature
    ? verifyUnipileSignature(
        Array.isArray(signature) ? signature[0] : signature,
        rawBody,
        environment.unipile.webhookSecret,
        environment.webhookToleranceSeconds,
      )
    : verifyUnipileV1Header(
        Array.isArray(v1Header) ? v1Header[0] : v1Header,
        environment.unipile.webhookSecret,
      );
  if (!verified.valid)
    return reply
      .status(401)
      .send({
        error: "Webhook signature was rejected",
        reason: verified.reason,
      });
  try {
    const event = webhookEventSchema.parse(jsonBody(request));
    await transaction(async (client) => {
      const stored = await client.query<{ id: string }>(
        "insert into public.webhook_events (provider,external_account_id,event_id,event_type,verified_at,payload) values ('unipile',$1,$2,$3,now(),$4::jsonb) on conflict (provider,external_account_id,event_id) do nothing returning id",
        [
          event.accountId,
          event.eventId,
          event.eventType,
          JSON.stringify(event.payload),
        ],
      );
      if (!stored.rows[0]) return;
      const brand = await client.query<{ id: string }>(
        "select brand_id as id from public.social_accounts where provider='instagram' and (external_account_id=$1 or connection_metadata->>'unipile_account_id'=$1)",
        [event.accountId],
      );
      if (brand.rows[0])
        await enqueueJob(client, {
          brandId: brand.rows[0].id,
          kind: "inbox.process",
          payload: { webhookEventId: stored.rows[0].id },
          idempotencyKey: `unipile:${event.accountId}:${event.eventId}`,
        });
    });
    return reply.status(200).send({ received: true });
  } catch (error) {
    const failure = errorReply(error);
    return reply.status(failure.status).send(failure.body);
  }
});

server.setErrorHandler((error: unknown, _request, reply) => {
  const code = (error as { code?: string })?.code;
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE")
    return reply
      .status(413)
      .send({
        error: _request.url.endsWith("/photos")
          ? "Each photo must be 5 MB or smaller"
          : "Request body is too large",
      });
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE")
    return reply
      .status(415)
      .send({ error: "Choose a JPG, PNG, or WebP photo" });
  const message = error instanceof Error ? error.message : "unknown error";
  const name = error instanceof Error ? error.name : "UnknownError";
  server.log.error({ err: name, message }, "API request failed");
  if (!reply.sent) reply.status(500).send({ error: "Unexpected server error" });
});

async function start(): Promise<void> {
  assertHostedOrigins();
  await databaseReady();
  await server.listen(apiListener());
  const shutdown = () => {
    void server
      .close()
      .then(() => database.end())
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.env.NODE_ENV !== "test")
  start().catch((error) => {
    console.error(
      "API startup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });

export { server };
