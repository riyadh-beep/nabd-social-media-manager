import type { Account, Draft, Job } from "./model";

export const socialProfiles = [
  { id: "instagram", name: "Instagram", handle: "@riyadhmabda", url: "https://www.instagram.com/riyadhmabda/?hl=en", format: "Caption + image", note: "Visual stories with a strong opening." },
  { id: "tiktok", name: "TikTok", handle: "@riyadhmabda", url: "https://www.tiktok.com/@riyadhmabda", format: "Photo + caption", note: "An original visual and a clear, engaging caption." },
  { id: "x", name: "X", handle: "@Riyadh_mabda", url: "https://x.com/Riyadh_mabda", format: "Post + image", note: "A concise take that starts a conversation." },
] as const;
export type PlatformId = typeof socialProfiles[number]["id"];

export function draftImageState(draft: Draft, jobs: Job[], originalJobId?: string, requestedJobId?: string) {
  const latest=jobs.filter(job=>job.kind==="image.generate"&&(job.draft_id===draft.id||job.id===originalJobId||job.id===requestedJobId))
    .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  const working=!!latest&&["queued","processing","retrying"].includes(latest.status);
  const failed=!!latest&&["failed","needs_review","cancelled"].includes(latest.status);
  // An older failed job must not override a successfully attached image or a newer retry.
  const staleFailure=failed&&!!draft.asset_id&&latest?.id===originalJobId&&!requestedJobId;
  return { job:latest, working, failed:failed&&!staleFailure || (!working&&!draft.asset_id&&!!originalJobId), ready:!working&&!!draft.asset_id&&(!failed||staleFailure) };
}

export function accountState(account?: Account, now = Date.now()) {
  if (!account?.last_checked_at) return { active: false, label: "Not verified" };
  if (now - new Date(account.last_checked_at).getTime() > 24 * 60 * 60_000) return { active: false, label: "Check connection" };
  if (account.connection_status === "connected") return { active: true, label: "Active" };
  return { active: false, label: account.connection_status === "paused" ? "Paused" : "Needs attention" };
}

export function publishBlocker(draft: Draft, account?: Account) {

  if (draft.status !== "draft") return "Already submitted or closed";
  if (!accountState(account).active || !account?.connection_metadata?.buffer_channel_id) return "Verify Buffer connection";
  if (["instagram", "tiktok"].includes(draft.platform) && !draft.asset_id) return "An image is required";
  return null;
}
