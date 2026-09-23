export const workspaceTypes = ["store", "creator", "business", "news"] as const;
export type WorkspaceType = (typeof workspaceTypes)[number];
export type Brand = {
  auto_reply?: boolean;
  reply_knowledge_mode?: "chat" | "content" | "all";
  reply_knowledge_ids?: string[];
  reply_model?: string;
  id: string;
  name: string;
  description: string;
  workspace_type: WorkspaceType;
  topics: string[];
  audience: string;
  languages: string[];
  status: string;
  timezone: string;
  daily_generation: boolean;
  updated_at: string;
};
export type Draft = {
  reference_asset_id?: string | null;
  photo_grounding?: string | null;
  external_post_url?: string | null;
  provider_metrics?: { type: string; name: string; value: number | null }[];
  metrics_updated_at?: string | null;
  id: string;
  platform: string;
  language: string;
  caption: string;
  hashtags: string[];
  visual_brief: string;
  status: string;
  scheduled_at: string | null;
  approval_version: number;
  asset_id: string | null;
  source_facts: string[];
  created_at: string;
};
export type KnowledgePhoto = {
  id: string;
  asset_id: string;
  slot: number;
  preview_url?: string | null;
};
export type Knowledge = {
  id: string;
  photos?: KnowledgePhoto[];
  scope?: "chat" | "content";
  type: string;
  title: string;
  content: string;
  source: string | null;
  status: string;
};
export type Job = {
  draft_id?: string;
  attempt_count?: number;
  conversation_id?: string;
  id: string;
  kind: string;
  status: string;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
  result?: {
    draftIds?: string[];
    imageJobIds?: string[];
    [key: string]: unknown;
  };
};
export type Account = {
  id: string;
  provider: string;
  external_account_id: string | null;
  connection_status: string;
  last_checked_at: string | null;
  connection_metadata?: {
    buffer_channel_id?: string;
    unipile_account_id?: string;
    unipile_username?: string;
  };
};
export type Conversation = {
  id: string;
  customer_username?: string | null;
  customer_name?: string | null;
  status: string;
  paused_for_human: boolean;
  updated_at: string;
};
export type ReplyDraft = {
  id: string;
  conversation_id: string;
  body: string;
  source_message_id: string;
  source_knowledge_ids: string[];
  model: string;
  needs_human: boolean;
  review_reason: string;
  created_at: string;
};
export type Message = {
  id: string;
  conversation_id: string;
  body: string;
  sender_type: string;
  created_at: string;
};
export type Asset = {
  id: string;
  storage_path: string;
  asset_type: string;
  metadata: Record<string, unknown>;
  preview_url?: string;
};
export function publicConfigValid(url: string, key: string): boolean {
  try {
    if (new URL(url).protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (key.startsWith("sb_publishable_")) return true;
  try {
    const payload = JSON.parse(
      atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload.role === "anon";
  } catch {
    return false;
  }
}
export function countStats(
  drafts: Draft[],
  jobs: Job[],
  conversations: Conversation[],
) {
  return {
    review: drafts.filter((d) => d.status === "draft").length,
    scheduled: drafts.filter((d) =>
      ["approved", "scheduled"].includes(d.status),
    ).length,
    published: drafts.filter((d) => d.status === "published").length,
    failures: jobs.filter((j) => ["failed", "needs_review"].includes(j.status))
      .length,
    attention: conversations.filter(
      (c) => c.paused_for_human && c.status !== "resolved",
    ).length,
  };
}
export function friendlyError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: string })?.message ?? error);
  if (/schema cache|does not exist|could not find.*function/i.test(message))
    return "The workspace database migration is missing. Apply the supplied Supabase migrations, then refresh.";
  if (/row.level|permission denied|not authorized|owner access/i.test(message))
    return "Your account needs owner access to this workspace.";
  return message.slice(0, 350);
}
