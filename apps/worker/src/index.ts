import { generateContentSchema } from "../../../packages/contracts/src/index.js";
import { loadContentKnowledge } from "../../../packages/domain/src/content-knowledge.js";
import { choosePhotoDirection } from "../../../packages/providers/src/photo-direction.js";
import {
  selectedProductPhoto,
  photoReferenceBytes,
} from "../../../packages/domain/src/product-photos.js";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { assertCoreEnvironment } from "../../../packages/config/src/env.js";
import {
  database,
  databaseReady,
  transaction,
} from "../../../packages/database/src/client.js";
import {
  claimJob,
  completeJob,
  enqueueJob,
  holdJobForReview,
  retryImageJob,
  type ClaimedJob,
} from "../../../packages/domain/src/jobs.js";
import { scrapeKnowledge } from "../../../packages/providers/src/firecrawl.js";
import { generateChatReply } from "../../../packages/providers/src/chat-replies.js";
import { generateDrafts } from "../../../packages/providers/src/openrouter.js";
import {
  buildPosterPrompt,
  posterDirection,
} from "../../../packages/providers/src/poster-direction.js";
import {
  OpenRouterImageError,
  generateOpenRouterImage,
} from "../../../packages/providers/src/openrouter-images.js";
import { deliverN8nNotification } from "../../../packages/providers/src/n8n-notifications.js";
import {
  BufferPostRejected,
  createBufferPost,
  getBufferPost,
  listBufferChannels,
} from "../../../packages/providers/src/buffer.js";
import {
  instagramSender,
  listUnipileV1Accounts,
  sendUnipileV1Message,
} from "../../../packages/providers/src/unipile.js";
import { supabaseAdmin } from "../../../packages/providers/src/supabase.js";

const environment = assertCoreEnvironment();
const workerId = `${hostname()}:${process.pid}`;
let nextReconciliationSweepAt = 0;

type DraftForPublish = {
  id: string;
  platform: string;
  caption: string;
  hashtags: string[];
  status: string;
  scheduled_at: string | null;
  asset_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
};
type JsonRecord = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function postText(draft: DraftForPublish): string {
  return [
    draft.caption.trim(),
    ...(draft.hashtags ?? []).map((tag) =>
      tag.startsWith("#") ? tag : `#${tag}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function approveAndQueueAutoPost(client: PoolClient, brandId: string, draftId: string, version: number) {
  const owner = await client.query<{ owner_id: string }>("select owner_id from brand_profiles where id=$1", [brandId]);
  if (!owner.rows[0]) throw new Error("Workspace was not found for automatic publishing");
  const hash = createHash("sha256").update(`automatic:${draftId}:${version}`).digest("hex");
  const approved = await client.query(
    "update content_drafts set status='approved',approved_version=$3,approval_hash=$4,updated_at=now() where id=$1 and brand_id=$2 and status='draft' and approval_version=$3 returning id",
    [draftId, brandId, version, hash],
  );
  if (!approved.rowCount) throw new Error("Draft changed before automatic publishing");
  await client.query(
    "insert into draft_approvals(draft_id,version,state,content_hash,approved_by) values($1,$2,'approved',$3,$4) on conflict(draft_id,version) do nothing",
    [draftId, version, hash, owner.rows[0].owner_id],
  );
  await enqueueJob(client, {
    brandId,
    kind: "publish.submit",
    payload: { draftId, expectedVersion: version, publishMode: "now" },
    idempotencyKey: `auto-publish:${draftId}:${version}`,
  });
}

async function processContentGeneration(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const payload = generateContentSchema.parse(job.payload);
  const autoPublish = Boolean((job.payload as { autoPublish?: unknown }).autoPublish);
  if (!payload.brief || !payload.platforms?.length || !payload.language)
    throw new Error("Content generation job has invalid payload");
  const [brand, knowledge] = await Promise.all([
    database.query<{ name: string; description: string; brand_rules: unknown }>(
      "select name,description,brand_rules from public.brand_profiles where id=$1",
      [job.brand_id],
    ),
    loadContentKnowledge(database, job.brand_id, payload.knowledgeIds),
  ]);
  if (!brand.rows[0]) throw new Error("Brand was not found");

  if (payload.photoMode === "none" && payload.knowledgePhotoId)
    throw new Error(
      "Clear the selected photo before choosing no product photos",
    );
  const knowledgeIds = knowledge.map((item) => item.id);
  const candidates = payload.knowledgePhotoId
    ? [
        await selectedProductPhoto(
          database,
          job.brand_id,
          payload.knowledgePhotoId,
          knowledgeIds,
        ),
      ]
    : payload.photoMode === "none"
      ? []
      : (
          await database.query<{
            id: string;
            asset_id: string;
            knowledge_id: string;
            storage_path: string;
          }>(
            "select p.id,p.asset_id,p.knowledge_id,a.storage_path from knowledge_photos p join knowledge_items k on k.id=p.knowledge_id join assets a on a.id=p.asset_id where k.brand_id=$1 and k.status='approved' and k.id=any($2::uuid[]) and a.brand_id=$1 and a.status<>'archived' order by p.slot,k.updated_at desc,p.id limit 7",
            [job.brand_id, knowledgeIds],
          )
        ).rows;
  if (payload.photoMode === "original" && !candidates.length)
    throw new Error("Add a product photo or choose AI visuals instead");
  const analysis = candidates.length
    ? await choosePhotoDirection(
        environment,
        payload.brief,
        await Promise.all(
          candidates.map(async (photo) => ({
            id: photo.id,
            knowledgeId: photo.knowledge_id,
            title: knowledge.find((item) => item.id === photo.knowledge_id)!
              .title,
            dataUrl:
              "data:image/jpeg;base64," +
              (await privateReferenceBytes(photo.storage_path)).toString(
                "base64",
              ),
          })),
        ),
      )
    : null;
  const reference = analysis
    ? candidates.find((photo) => photo.id === analysis.photoId)!
    : null;
  // Older explicit photo requests keep their original-photo behavior.
  const useOriginal =
    payload.photoMode === "original" ||
    (!!payload.knowledgePhotoId && job.payload.photoMode === undefined);
  const drafts = await generateDrafts(environment, {
    brief: payload.brief,
    platforms: payload.platforms,
    language: payload.language,
    brand: {
      name: brand.rows[0].name,
      description: brand.rows[0].description,
      rules: brand.rows[0].brand_rules,
    },
    knowledge,
    photoDirection:
      reference && analysis
        ? {
            knowledgeId: reference.knowledge_id,
            description: analysis.description,
          }
        : undefined,
  });
  const result = await transaction(async (client) => {
    const locked = await client.query<{ id: string; updated_at: Date }>(
      "select id,updated_at from knowledge_items where brand_id=$1 and status='approved' and id=any($2::uuid[]) order by id for share",
      [job.brand_id, knowledge.map((item) => item.id)],
    );
    if (
      locked.rows.length !== knowledge.length ||
      locked.rows.some(
        (row) =>
          new Date(row.updated_at).getTime() !==
          new Date(
            knowledge.find((item) => item.id === row.id)!.updated_at,
          ).getTime(),
      )
    )
      throw new Error(
        "Selected knowledge changed during generation. Review the facts and generate again.",
      );
    const photo = reference
      ? await selectedProductPhoto(
          client,
          job.brand_id,
          reference.id,
          knowledgeIds,
        )
      : null;
    const draftIds: string[] = [],
      imageJobIds: string[] = [];
    for (const draft of drafts) {
      const inserted = await client.query<{
        id: string;
        approval_version: number;
      }>(
        "insert into public.content_drafts (brand_id,platform,language,caption,hashtags,visual_brief,source_facts,status) values ($1,$2,$3,$4,$5,$6,$7,'draft') returning id,approval_version",
        [
          job.brand_id,
          draft.platform,
          payload.language,
          draft.caption,
          draft.hashtags,
          draft.visualBrief,
          draft.sourceFacts,
        ],
      );
      const saved = inserted.rows[0];
      if (photo)
        await client.query(
          "update content_drafts set reference_asset_id=$2,reference_knowledge_id=$3,photo_grounding=$4,asset_id=$5 where id=$1",
          [
            saved.id,
            photo.asset_id,
            photo.knowledge_id,
            analysis!.description,
            useOriginal ? photo.asset_id : null,
          ],
        );
      draftIds.push(saved.id);
      if (payload.generateImages && !(photo && useOriginal))
        imageJobIds.push(
          await enqueueJob(client, {
            brandId: job.brand_id,
            kind: "image.generate",
            payload: {
              draftId: saved.id,
              expectedVersion: saved.approval_version,
              autoPublish,
            },
            idempotencyKey: `image:${saved.id}:${saved.approval_version}`,
          }),
        );
      else if (autoPublish)
        await approveAndQueueAutoPost(client, job.brand_id, saved.id, saved.approval_version);
    }
    return { draftIds, imageJobIds };
  });
  return { created: drafts.length, ...result, state: autoPublish ? "auto_publish_queued" : "review_required" };
}

async function privateReferenceBytes(path: string) {
  const downloaded = await supabaseAdmin.storage
    .from("generated-assets")
    .download(path);
  if (downloaded.error || !downloaded.data)
    throw new Error(
      "The private product photo could not be loaded. Restore it and try again.",
    );
  return photoReferenceBytes(Buffer.from(await downloaded.data.arrayBuffer()));
}

async function processImageGeneration(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const payload = job.payload as { draftId?: string; expectedVersion?: number; autoPublish?: boolean };
  if (!payload.draftId || !payload.expectedVersion)
    throw new Error("Image generation job has invalid payload");
  const draft = await database.query<{
    visual_brief: string;
    approval_version: number;
    reference_asset_id: string | null;
    reference_knowledge_id: string | null;
    platform: string;
    photo_grounding: string | null;
  }>(
    "select platform,photo_grounding,visual_brief,approval_version,reference_asset_id,reference_knowledge_id from public.content_drafts where id=$1 and brand_id=$2",
    [payload.draftId, job.brand_id],
  );
  if (
    !draft.rows[0] ||
    draft.rows[0].approval_version !== payload.expectedVersion
  )
    throw new Error("Draft changed before image generation");
  let referenceBytes: Buffer | undefined;
  if (draft.rows[0].reference_asset_id) {
    const asset = await database.query<{ storage_path: string }>(
      "select a.storage_path from assets a join knowledge_items k on k.id=$3 where a.id=$1 and a.brand_id=$2 and a.status<>'archived' and k.brand_id=$2 and k.status='approved'",
      [
        draft.rows[0].reference_asset_id,
        job.brand_id,
        draft.rows[0].reference_knowledge_id,
      ],
    );
    if (!asset.rows[0])
      throw new Error(
        "The product reference or its approved knowledge is no longer available",
      );
    referenceBytes = await privateReferenceBytes(asset.rows[0].storage_path);
  }
  const direction = posterDirection(draft.rows[0].platform);
  const image = await generateOpenRouterImage(
    environment,
    buildPosterPrompt(
      draft.rows[0].platform,
      draft.rows[0].visual_brief,
      draft.rows[0].photo_grounding,
      job.id,
    ),
    referenceBytes,
    draft.rows[0].platform === "instagram" ? "4:5" : draft.rows[0].platform === "tiktok" ? "9:16" : "16:9",
  );
  const extension = image.mimeType.includes("webp")
    ? "webp"
    : image.mimeType.includes("jpeg")
      ? "jpg"
      : "png";
  const path = `${environment.ownerUserId}/${job.brand_id}/${randomUUID()}.${extension}`;
  const upload = await supabaseAdmin.storage
    .from("generated-assets")
    .upload(path, image.bytes, { contentType: image.mimeType, upsert: false });
  if (upload.error)
    throw new Error("Generated image could not be stored privately");
  const asset = await transaction(async (client) => {
    const current = await client.query<{
      approval_version: number;
      status: string;
    }>(
      "select approval_version,status from public.content_drafts where id=$1 and brand_id=$2 for update",
      [payload.draftId, job.brand_id],
    );
    if (
      current.rows[0]?.approval_version !== payload.expectedVersion ||
      current.rows[0]?.status !== "draft"
    )
      throw new Error(
        "Draft changed while its image was being generated. Generate a new image for the current version.",
      );
    if (draft.rows[0].reference_asset_id) {
      const valid = await client.query(
        "select a.id from assets a join knowledge_items k on k.id=$3 where a.id=$1 and a.brand_id=$2 and a.status<>'archived' and k.brand_id=$2 and k.status='approved' for share of a,k",
        [
          draft.rows[0].reference_asset_id,
          job.brand_id,
          draft.rows[0].reference_knowledge_id,
        ],
      );
      if (!valid.rows.length)
        throw new Error(
          "The product reference changed while its image was being generated",
        );
    }
    const inserted = await client.query<{ id: string }>(
      "insert into public.assets (brand_id,storage_path,asset_type,mime_type,metadata,status) values ($1,$2,'generated',$3,$4::jsonb,'draft') returning id",
      [
        job.brand_id,
        path,
        image.mimeType,
        JSON.stringify({
          generated_by: "openrouter-images",
          image_model: image.model,
          reference_asset_id: draft.rows[0].reference_asset_id,
          poster_style: direction.label,
          width: direction.width,
          height: direction.height,
        }),
      ],
    );
    await client.query(
      "update public.content_drafts set asset_id=$3, approval_version=approval_version+1, approved_version=null, approval_hash=null, status='draft', updated_at=now() where id=$1 and brand_id=$2",
      [payload.draftId, job.brand_id, inserted.rows[0].id],
    );
    if (payload.autoPublish)
      await approveAndQueueAutoPost(client, job.brand_id, payload.draftId!, current.rows[0].approval_version + 1);
    return inserted.rows[0];
  });
  return { assetId: asset.id, state: "review_required" };
}

function platformForBufferService(
  service: string,
): "instagram" | "tiktok" | "x" | null {
  const value = service.toLowerCase();
  if (value.includes("instagram")) return "instagram";
  if (value.includes("tiktok")) return "tiktok";
  if (value === "twitter" || value === "x" || value.includes("twitter"))
    return "x";
  return null;
}

async function refreshProviderConnections(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const [bufferChannels, unipileResult] = await Promise.all([
    listBufferChannels(environment),
    listUnipileV1Accounts(environment.unipile),
  ]);
  await transaction(async (client) => {
    for (const channel of bufferChannels) {
      const platform = platformForBufferService(channel.service);
      if (!platform) continue;
      const status = channel.queuePaused
        ? "paused"
        : channel.disconnected || channel.locked
          ? "degraded"
          : "connected";
      await client.query(
        "insert into public.social_accounts (brand_id,provider,external_account_id,connection_status,last_checked_at,connection_metadata) values ($1,$2,$3,$4,now(),$5::jsonb) on conflict (brand_id,provider) do update set external_account_id=excluded.external_account_id,connection_status=excluded.connection_status,last_checked_at=excluded.last_checked_at,connection_metadata=coalesce(public.social_accounts.connection_metadata,'{}'::jsonb) || excluded.connection_metadata",
        [
          job.brand_id,
          platform,
          channel.id,
          status,
          JSON.stringify({
            buffer_channel_id: channel.id,
            buffer_service_id: channel.serviceId,
          }),
        ],
      );
    }
    for (const account of unipileResult.accounts) {
      if (!account.connection_params?.im) continue;
      await client.query(
        "insert into public.social_accounts (brand_id,provider,external_account_id,connection_status,last_checked_at,connection_metadata) values ($1,'instagram',$2,'connected',now(),$3::jsonb) on conflict (brand_id,provider) do update set connection_status=case when public.social_accounts.connection_status='unavailable' then 'connected' else public.social_accounts.connection_status end,last_checked_at=excluded.last_checked_at,connection_metadata=coalesce(public.social_accounts.connection_metadata,'{}'::jsonb) || excluded.connection_metadata",
        [
          job.brand_id,
          account.id,
          JSON.stringify({
            unipile_account_id: account.id,
            unipile_username: account.connection_params.im.username ?? null,
          }),
        ],
      );
    }
  });
  return {
    bufferChannels: bufferChannels.length,
    unipileAccounts: unipileResult.accounts.length,
  };
}

async function signedAssetUrl(path: string): Promise<string> {
  const signed = await supabaseAdmin.storage
    .from("generated-assets")
    .createSignedUrl(path, 60 * 60 * 24 * 8);
  if (signed.error || !signed.data.signedUrl)
    throw new Error("The approved image could not be prepared for Buffer");
  return signed.data.signedUrl;
}

async function processPublish(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const payload = job.payload as {
    draftId?: string;
    expectedVersion?: number;
    publishMode?: "now" | "queue" | "schedule";
  };
  if (!payload.draftId || !payload.expectedVersion)
    throw new Error("Publishing job has invalid payload");
  const draftResult = await database.query<DraftForPublish>(
    "select d.id,d.platform,d.caption,d.hashtags,d.status,d.scheduled_at,d.asset_id,a.storage_path,a.mime_type from public.content_drafts d left join public.assets a on a.id=d.asset_id where d.id=$1 and d.brand_id=$2",
    [payload.draftId, job.brand_id],
  );
  const draft = draftResult.rows[0];
  if (!draft || draft.status !== "approved")
    throw new Error("The post changed before it was sent to Buffer");
  if (["instagram", "tiktok"].includes(draft.platform) && !draft.storage_path)
    throw new Error(
      "This photo post needs an approved image before publishing",
    );
  const accountResult = await database.query<{
    connection_status: string;
    connection_metadata: JsonRecord;
  }>(
    "select connection_status,connection_metadata from public.social_accounts where brand_id=$1 and provider=$2",
    [job.brand_id, draft.platform],
  );
  const account = accountResult.rows[0];
  const channelId = text(account?.connection_metadata?.buffer_channel_id);
  if (!account || account.connection_status !== "connected" || !channelId)
    throw new Error(
      `Connect the ${draft.platform} Buffer channel before scheduling this post`,
    );
  const key = `publish:${draft.id}:${payload.expectedVersion}`;
  const prior = await database.query<{
    state: string;
    provider_reference: string | null;
  }>(
    "select state,provider_reference from public.provider_attempts where provider='buffer' and operation='publish' and idempotency_key=$1",
    [key],
  );
  if (prior.rows[0]?.state === "unknown")
    return {
      hold: "The Buffer result is unknown. Review Buffer before retrying this post.",
    };
  if (prior.rows[0]?.provider_reference)
    return {
      providerPostId: prior.rows[0].provider_reference,
      state: "already_submitted",
    };
  const imageUrl = draft.storage_path
    ? await signedAssetUrl(draft.storage_path)
    : null;
  const reserved = await transaction(async (client) => {
    const valid = await client.query(
      "select d.id from content_drafts d join brand_profiles b on b.id=d.brand_id where d.id=$1 and d.brand_id=$2 and d.status='approved' and d.approval_version=$3 and d.approved_version=$3 and d.archived_at is null and b.status='approved' for update of d",
      [draft.id, job.brand_id, payload.expectedVersion],
    );
    if (!valid.rowCount)
      throw new Error("This draft or its approval changed before publishing");
    const attempt = await client.query(
      "insert into public.provider_attempts (brand_id,job_id,provider,operation,idempotency_key,state) values ($1,$2,'buffer','publish',$3,'unknown') on conflict (provider,operation,idempotency_key) do nothing returning id",
      [job.brand_id, job.id, key],
    );
    return attempt.rowCount === 1;
  });
  if (!reserved)
    return {
      hold: "This version already has a Buffer attempt. Review its result before retrying.",
    };
  let post;
  try {
    post = await createBufferPost({
      environment,
      channelId,
      platform: draft.platform,
      text: postText(draft),
      mode: payload.publishMode,
      dueAt: payload.publishMode === "now" ? null : draft.scheduled_at,
      imageUrl,
    });
  } catch (error) {
    if (error instanceof BufferPostRejected)
      await transaction(async (client) => {
        await client.query(
          "update provider_attempts set state='failed',updated_at=now() where provider='buffer' and operation='publish' and idempotency_key=$1",
          [key],
        );
        await client.query(
          "update content_drafts set status='draft',approval_version=approval_version+1,approved_version=null,approval_hash=null,updated_at=now() where id=$1 and approval_version=$2",
          [draft.id, payload.expectedVersion],
        );
        await client.query(
          "update draft_approvals set state='revoked',revoked_at=now() where draft_id=$1 and version=$2",
          [draft.id, payload.expectedVersion],
        );
      });
    throw error;
  }
  await transaction(async (client) => {
    await client.query(
      "update public.provider_attempts set state='submitted',provider_reference=$2,result_excerpt=$3::jsonb,updated_at=now() where provider='buffer' and operation='publish' and idempotency_key=$1",
      [
        key,
        post.id,
        JSON.stringify({ status: post.status, dueAt: post.dueAt ?? null }),
      ],
    );
    await client.query(
      "update public.content_drafts set status='scheduled',provider_post_id=$2,updated_at=now() where id=$1",
      [draft.id, post.id],
    );
    await enqueueJob(client, {
      brandId: job.brand_id,
      kind: "publish.reconcile",
      payload: {
        operation: "post_check",
        draftId: draft.id,
        providerPostId: post.id,
      },
      idempotencyKey: `reconcile:${draft.id}:${Math.floor(Date.now() / 900_000)}`,
      runAt: new Date(Date.now() + 15_000),
    });
  });
  return {
    providerPostId: post.id,
    providerState: post.status,
    state: "submitted_to_buffer",
  };
}

async function processReconciliation(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const payload = job.payload as {
    operation?: string;
    draftId?: string;
    providerPostId?: string;
  };
  if (payload.operation === "connection_check")
    return refreshProviderConnections(job);
  if (
    payload.operation !== "post_check" ||
    !payload.draftId ||
    !payload.providerPostId
  )
    return { state: "ignored" };
  const post = await getBufferPost(environment, payload.providerPostId);
  const status = post.status.toLowerCase();
  await transaction(async (client) => {
    const state =
      status === "sent"
        ? "published"
        : status === "error" || status === "failed"
          ? "failed"
          : "scheduled";
    await client.query(
      "update public.content_drafts set status=$3,published_at=case when $3='published' then coalesce(published_at,now()) else published_at end,updated_at=now() where id=$1 and brand_id=$2",
      [payload.draftId, job.brand_id, state],
    );
    if (post.externalLink && /^https:\/\//.test(post.externalLink))
      await client.query(
        "update content_drafts set external_post_url=$2 where id=$1",
        [payload.draftId, post.externalLink],
      );
    if (state === "published")
      await client.query(
        "update public.provider_attempts set state='confirmed',updated_at=now() where provider='buffer' and operation='publish' and provider_reference=$1",
        [post.id],
      );
    if (state === "failed")
      await client.query(
        "update public.provider_attempts set state='failed',updated_at=now() where provider='buffer' and operation='publish' and provider_reference=$1",
        [post.id],
      );
    if (state === "scheduled")
      await enqueueJob(client, {
        brandId: job.brand_id,
        kind: "publish.reconcile",
        payload: {
          operation: "post_check",
          draftId: payload.draftId,
          providerPostId: post.id,
        },
        idempotencyKey: `reconcile:${payload.draftId}:${Math.floor(Date.now() / 60000) + 1}`,
        runAt: new Date(
          Math.max(
            Date.now() + 60_000,
            Math.min(
              Date.parse(post.dueAt ?? "") || Date.now(),
              Date.now() + 15 * 60_000,
            ),
          ),
        ),
      });
  });
  return { providerPostId: post.id, providerState: post.status, state: status };
}

async function processInboxEvent(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const payload = job.payload as { webhookEventId?: string };
  if (!payload.webhookEventId) throw new Error("Inbox job has invalid payload");
  const eventResult = await database.query<{
    payload: JsonRecord;
    event_type: string;
  }>(
    "select payload,event_type from public.webhook_events where id=$1 and provider='unipile'",
    [payload.webhookEventId],
  );
  const event = eventResult.rows[0];
  if (!event || event.event_type !== "message_received")
    return { state: "ignored" };
  const body = object(event.payload);
  const chatId = text(body.chat_id);
  const messageId = text(body.message_id) ?? text(body.id);
  const message = text(body.message) ?? text(body.text) ?? "[Attachment]";
  if (!chatId || !messageId) return { state: "ignored" };
  const sender = object(body.sender);
  if (sender.is_self === true || body.is_sender === true)
    return { state: "ignored" };
  const identity = instagramSender(body);
  await transaction(async (client) => {
    const conversation = await client.query<{ id: string }>(
      "insert into public.conversations (brand_id,provider,external_conversation_id,status,paused_for_human) values ($1,'instagram',$2,'open',false) on conflict (provider,external_conversation_id) do update set updated_at=now(),archived_at=null returning id",
      [job.brand_id, chatId],
    );
    await client.query(
      "update conversations set customer_username=coalesce($2,customer_username),customer_name=coalesce($3,customer_name),paused_for_human=true,status='open' where id=$1",
      [conversation.rows[0].id, identity.username, identity.name],
    );
    const inserted = await client.query<{ id: string }>(
      "insert into public.messages (conversation_id,external_message_id,sender_type,body,created_at) values ($1,$2,'customer',$3,coalesce($4::timestamptz,now())) on conflict (conversation_id,external_message_id) do nothing returning id",
      [
        conversation.rows[0].id,
        messageId,
        message,
        text(body.timestamp) ?? null,
      ],
    );
    if (inserted.rows[0])
      await client.query(
        "insert into public.escalations (conversation_id,message_id,reason,status) values ($1,$2,'New Instagram message','open')",
        [conversation.rows[0].id, inserted.rows[0].id],
      );
    if (inserted.rows[0]) {
      await client.query(
        "update reply_drafts set status='cancelled',updated_at=now() where conversation_id=$1 and status='draft'",
        [conversation.rows[0].id],
      );
      if (environment.openRouter.apiKey)
        await enqueueJob(client, {
          brandId: job.brand_id,
          kind: "reply.generate",
          payload: {
            conversationId: conversation.rows[0].id,
            messageId: inserted.rows[0].id,
            automatic: true,
          },
          idempotencyKey: `auto-reply:${inserted.rows[0].id}`,
          runAt: new Date(Date.now() + 250),
        });
    }
    await client.query(
      "update public.webhook_events set processing_status='completed' where id=$1",
      [payload.webhookEventId],
    );
  });
  return { state: "inbox_updated" };
}

async function processReplyGeneration(
  job: ClaimedJob,
): Promise<Record<string, unknown>> {
  const { conversationId, messageId } = job.payload as {
    conversationId?: string;
    messageId?: string;
  };
  if (!conversationId || !messageId)
    throw new Error("AI reply job has invalid payload");
  const conversation = await database.query(
    "select c.id,b.name from conversations c join brand_profiles b on b.id=c.brand_id where c.id=$1 and c.brand_id=$2 and c.archived_at is null",
    [conversationId, job.brand_id],
  );
  if (!conversation.rows[0]) throw new Error("Conversation was not found");
  const messages = await database.query(
    "select id,sender_type,body from messages where conversation_id=$1 order by created_at desc,id desc limit 20",
    [conversationId],
  );
  if (
    messages.rows[0]?.id !== messageId ||
    messages.rows[0]?.sender_type !== "customer"
  )
    return { state: "superseded", conversationId };
  const settings = await database.query<{
    reply_model: string | null;
    reply_knowledge_mode: "chat" | "content" | "all";
    reply_knowledge_ids: string[];
  }>(
    "select reply_model,reply_knowledge_mode,coalesce(reply_knowledge_ids,'{}'::uuid[]) as reply_knowledge_ids from automation_settings where brand_id=$1",
    [job.brand_id],
  );
  const mode = settings.rows[0]?.reply_knowledge_mode ?? "chat";
  const selectedKnowledgeIds = settings.rows[0]?.reply_knowledge_ids ?? [];
  const knowledge = await database.query(
    "select id,title,content from knowledge_items where brand_id=$1 and status='approved' and ((cardinality($3::uuid[])=0 and ($2='all' or scope=$2)) or (cardinality($3::uuid[])>0 and scope='chat' and id=any($3::uuid[]))) order by updated_at desc limit 50",
    [job.brand_id, mode, selectedKnowledgeIds],
  );
  const generated = await generateChatReply(environment, {
    brandName: conversation.rows[0].name,
    messages: messages.rows.slice().reverse(),
    knowledge: knowledge.rows,
  });
  return transaction(async (client) => {
    await client.query("select id from conversations where id=$1 for update", [
      conversationId,
    ]);
    const latest = await client.query(
      "select id from messages where conversation_id=$1 order by created_at desc,id desc limit 1",
      [conversationId],
    );
    if (latest.rows[0]?.id !== messageId)
      return { state: "superseded", conversationId };
    const current = await client.query(
      "select id,title,content from knowledge_items where brand_id=$1 and status='approved' and ((cardinality($3::uuid[])=0 and ($2='all' or scope=$2)) or (cardinality($3::uuid[])>0 and scope='chat' and id=any($3::uuid[]))) order by updated_at desc limit 50",
      [job.brand_id, mode, selectedKnowledgeIds],
    );
    if (JSON.stringify(current.rows) !== JSON.stringify(knowledge.rows))
      throw new Error(
        "Chat knowledge changed during generation. Generate a fresh suggestion.",
      );
    await client.query(
      "update reply_drafts set status='cancelled',updated_at=now() where conversation_id=$1 and status='draft'",
      [conversationId],
    );
    const saved = await client.query(
      "insert into reply_drafts(conversation_id,body,source_message_id,source_knowledge_ids,model,needs_human,review_reason,generation_job_id) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(generation_job_id) do nothing returning id",
      [
        conversationId,
        generated.text,
        messageId,
        generated.sourceKnowledgeIds,
        generated.model,
        generated.needsHuman,
        generated.reason,
        job.id,
      ],
    );
    const setting = await client.query(
      "select reply_sending_enabled from automation_settings where brand_id=$1",
      [job.brand_id],
    );
    if (
      job.payload.automatic === true &&
      setting.rows[0]?.reply_sending_enabled &&
      saved.rows[0]
    ) {
      const recent = await client.query(
        "select count(*)::int as total from background_jobs where brand_id=$1 and kind='reply.send' and payload->>'conversationId'=$2 and payload->>'automatic'='true' and created_at>now()-interval '1 hour'",
        [job.brand_id, conversationId],
      );
      if (recent.rows[0].total >= 20)
        return {
          hold: "Automatic replies paused for this conversation after 20 replies in one hour. Review it in the inbox.",
        };
      await enqueueJob(client, {
        brandId: job.brand_id,
        kind: "reply.send",
        payload: {
          conversationId,
          text: generated.text,
          replyKey: messageId,
          expectedMessageId: messageId,
          replyDraftId: saved.rows[0].id,
          automatic: true,
          needsHuman: generated.needsHuman,
        },
        idempotencyKey: `reply:${conversationId}:${messageId}`,
      });
      return {
        state: "auto_reply_queued",
        conversationId,
        replyDraftId: saved.rows[0].id,
      };
    }
    return {
      state: "review_required",
      conversationId,
      replyDraftId: saved.rows[0]?.id,
    };
  });
}

async function processReply(job: ClaimedJob): Promise<Record<string, unknown>> {
  const payload = job.payload as {
    conversationId?: string;
    text?: string;
    replyKey?: string;
    expectedMessageId?: string;
    replyDraftId?: string;
    automatic?: boolean;
    needsHuman?: boolean;
  };
  if (!payload.conversationId || !payload.text)
    throw new Error("Reply job has invalid payload");
  if (payload.automatic) {
    const setting = await database.query(
      "select reply_sending_enabled from automation_settings where brand_id=$1",
      [job.brand_id],
    );
    if (!setting.rows[0]?.reply_sending_enabled)
      return { state: "auto_reply_disabled" };
  }
  const conversation = await database.query<{
    external_conversation_id: string;
  }>(
    "select external_conversation_id from public.conversations where id=$1 and brand_id=$2 and provider='instagram'",
    [payload.conversationId, job.brand_id],
  );
  const account = await database.query<{ connection_metadata: JsonRecord }>(
    "select connection_metadata from public.social_accounts where brand_id=$1 and provider='instagram'",
    [job.brand_id],
  );
  const chatId = conversation.rows[0]?.external_conversation_id;
  const accountId = text(
    account.rows[0]?.connection_metadata?.unipile_account_id,
  );
  if (!chatId || !accountId)
    throw new Error("Connect Instagram through Unipile before sending a reply");
  if (payload.expectedMessageId) {
    const latest = await database.query(
      "select id from messages where conversation_id=$1 order by created_at desc,id desc limit 1",
      [payload.conversationId],
    );
    if (latest.rows[0]?.id !== payload.expectedMessageId)
      return {
        hold: "A new message arrived. Review the conversation before sending.",
      };
  }
  if (payload.replyDraftId) {
    const valid = await database.query(
      "select id from reply_drafts d where id=$1 and conversation_id=$2 and status='draft' and not exists(select 1 from unnest(d.source_knowledge_ids) kid where not exists(select 1 from knowledge_items k where k.id=kid and k.brand_id=$3 and k.scope='chat' and k.status='approved' and k.updated_at<=d.created_at))",
      [payload.replyDraftId, payload.conversationId, job.brand_id],
    );
    if (!valid.rowCount)
      return {
        hold: "The reply or its knowledge changed. Generate a new suggestion before sending.",
      };
  }
  const key = `reply:${payload.conversationId}:${payload.replyKey ?? job.id}`;
  const prior = await database.query<{
    state: string;
    provider_reference: string | null;
  }>(
    "select state,provider_reference from public.provider_attempts where provider='unipile' and operation='reply' and idempotency_key=$1",
    [key],
  );
  if (prior.rows[0]?.state === "unknown")
    return {
      hold: "The Instagram reply result is unknown. Review the conversation before retrying.",
    };
  if (prior.rows[0]?.provider_reference)
    return {
      messageId: prior.rows[0].provider_reference,
      state: "already_sent",
    };
  const reservation = await transaction((client) =>
    client.query(
      "insert into public.provider_attempts (brand_id,job_id,provider,operation,idempotency_key,state) values ($1,$2,'unipile','reply',$3,'unknown') on conflict (provider,operation,idempotency_key) do nothing returning id",
      [job.brand_id, job.id, key],
    ),
  );
  if (!reservation.rowCount)
    return {
      hold: "A reply attempt already exists. Review delivery before retrying.",
    };
  const sent = await sendUnipileV1Message({
    ...environment.unipile,
    accountId,
    chatId,
    text: payload.text,
  });
  await transaction(async (client) => {
    await client.query(
      "update public.provider_attempts set state='confirmed',provider_reference=$2,updated_at=now() where provider='unipile' and operation='reply' and idempotency_key=$1",
      [key, sent.id],
    );
    await client.query(
      "insert into public.messages (conversation_id,external_message_id,sender_type,body) values ($1,$2,'owner',$3) on conflict (conversation_id,external_message_id) do nothing",
      [payload.conversationId, sent.id, payload.text],
    );
    if (!payload.automatic || !payload.needsHuman)
      await client.query(
        "update public.escalations set status='replied',owner_reply=$2,resolved_at=now() where conversation_id=$1 and status='open'",
        [payload.conversationId, payload.text],
      );
    await client.query(
      "update conversations set paused_for_human=$2,updated_at=now() where id=$1",
      [payload.conversationId, !!payload.automatic && !!payload.needsHuman],
    );
    await client.query(
      "update reply_drafts set status=case when id=$2::uuid then 'sent' else 'cancelled' end,updated_at=now() where conversation_id=$1 and status='draft'",
      [payload.conversationId, payload.replyDraftId ?? null],
    );
  });
  return { messageId: sent.id, state: "confirmed" };
}

async function scheduleReconciliations(): Promise<void> {
  const now = Date.now();
  if (now < nextReconciliationSweepAt) return;
  nextReconciliationSweepAt = now + 15 * 60_000;
  const drafts = await database.query<{
    id: string;
    brand_id: string;
    provider_post_id: string;
  }>(
    "select id,brand_id,provider_post_id from public.content_drafts where status='scheduled' and provider_post_id is not null and created_at > now()-interval '30 days'",
  );
  await transaction(async (client) => {
    for (const draft of drafts.rows)
      await enqueueJob(client, {
        brandId: draft.brand_id,
        kind: "publish.reconcile",
        payload: {
          operation: "post_check",
          draftId: draft.id,
          providerPostId: draft.provider_post_id,
        },
        idempotencyKey: `reconcile:${draft.id}:${Math.floor(Date.now() / 900_000)}`,
      });
  });
}

async function processJob(
  job: ClaimedJob,
): Promise<Record<string, unknown> | { hold: string }> {
  if (job.kind === "knowledge.import") {
    const page = await scrapeKnowledge(
      environment,
      String(job.payload.url ?? ""),
    );
    const saved = await database.query(
      "insert into knowledge_items(brand_id,type,scope,title,content,source,status,import_job_id) values($1,'faq','chat',$2,$3,$4,'draft',$5) on conflict(import_job_id) do update set updated_at=knowledge_items.updated_at returning id",
      [job.brand_id, page.title, page.content, page.source, job.id],
    );
    return {
      state: "review_required",
      knowledgeId: saved.rows[0].id,
      truncated: page.truncated,
    };
  }
  if (job.kind === "content.generate") return processContentGeneration(job);
  if (job.kind === "image.generate") return processImageGeneration(job);
  if (job.kind === "publish.submit") return processPublish(job);
  if (job.kind === "publish.reconcile") return processReconciliation(job);
  if (job.kind === "inbox.process") return processInboxEvent(job);
  if (job.kind === "reply.generate") return processReplyGeneration(job);
  if (job.kind === "reply.send") return processReply(job);
  if (job.kind === "notification.deliver") {
    const payload = job.payload as {
      recipient?: string;
      subject?: string;
      html?: string;
    };
    if (!payload.recipient || !payload.subject || !payload.html)
      throw new Error("Notification delivery job has invalid payload");
    const delivery = await deliverN8nNotification(environment, {
      recipient: payload.recipient,
      subject: payload.subject,
      html: payload.html,
    });
    return delivery.state === "disabled"
      ? { state: "disabled" }
      : { state: "submitted" };
  }
  return { hold: "Unsupported job" };
}

async function tick(): Promise<void> {
  const client = await database.connect();
  try {
    await scheduleReconciliations();
    await client.query("begin");
    const job = await claimJob(client, workerId);
    await client.query("commit");
    if (!job) return;
    try {
      const result = await processJob(job);
      if (typeof (result as { hold?: unknown }).hold === "string")
        await transaction((tx) =>
          holdJobForReview(tx, job, (result as { hold: string }).hold),
        );
      else await transaction((tx) => completeJob(tx, job, result));
    } catch (error) {
      await transaction(async (tx) => {
        if (
          error instanceof OpenRouterImageError &&
          error.retryable &&
          job.kind === "image.generate" &&
          job.attempt_count < 3
        )
          await retryImageJob(tx, job, error.message, error.retryAfterSeconds);
        else
          await holdJobForReview(
            tx,
            job,
            error instanceof Error ? error.message : "Job failed",
          );
      });
    }
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* no active transaction */
    }
    console.error(
      "Worker tick failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  } finally {
    client.release();
  }
}

async function start(): Promise<void> {
  await databaseReady();
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    // Finish the current durable job before closing the pool during deployment.
    void active
      .finally(() => database.end())
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  const poll = () => {
    if (stopping) return;
    active = tick().catch(() =>
      console.error(
        "Worker could not connect to the database; the next poll will retry.",
      ),
    );
    void active.then(() => {
      if (!stopping) timer = setTimeout(poll, environment.workerPollMs);
    });
  };
  poll();
  console.log(`Nabd worker is running as ${workerId}`);
}

if (process.env.NODE_ENV !== "test")
  start().catch((error) => {
    console.error(
      "Worker startup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  });

export {
  processInboxEvent,
  processReplyGeneration,
  processReply,
  processContentGeneration,
  processImageGeneration,
};
