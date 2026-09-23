import type { AppEnvironment } from "../../config/src/env.js";

export type BufferChannel = { id: string; service: string; serviceId: string; disconnected: boolean; locked: boolean; queuePaused: boolean };
export type BufferPost = { id: string; status: string; dueAt?: string | null; sentAt?: string | null; externalLink?: string | null };

type BufferResponse<T> = { errors?: unknown[]; data?: T };

export class BufferPostRejected extends Error {}

async function bufferQuery<T>(environment: AppEnvironment, query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!environment.buffer.apiKey) throw new Error("Buffer is not configured");
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { authorization: `Bearer ${environment.buffer.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Buffer API request was rejected (${response.status})`);
  const result = await response.json() as BufferResponse<T>;
  if (result.errors?.length || !result.data) throw new Error("Buffer API returned an application error");
  return result.data;
}

export async function checkBufferAccess(environment: AppEnvironment): Promise<{ organizationCount: number }> {
  const result = await bufferQuery<{ account: { organizations: unknown[] } }>(environment, "query SignaldeskAccount { account { organizations { id } } }");
  return { organizationCount: result.account.organizations.length };
}


export async function listBufferChannels(environment: AppEnvironment): Promise<BufferChannel[]> {
  const organizations = await bufferQuery<{ account: { organizations: Array<{ id: string }> } }>(environment, "query SignaldeskOrganizations { account { organizations { id } } }");
  const channels: BufferChannel[] = [];
  for (const organization of organizations.account.organizations) {
    const data = await bufferQuery<{ channels: Array<{ id: string; service: string; serviceId: string; isDisconnected: boolean; isLocked: boolean; isQueuePaused: boolean }> }>(environment, "query SignaldeskChannels($input: ChannelsInput!) { channels(input: $input) { id service serviceId isDisconnected isLocked isQueuePaused } }", { input: { organizationId: organization.id } });
    channels.push(...data.channels.map((channel) => ({ id: channel.id, service: channel.service, serviceId: channel.serviceId, disconnected: channel.isDisconnected, locked: channel.isLocked, queuePaused: channel.isQueuePaused })));
  }
  return channels;
}

export async function createBufferPost(input: { environment: AppEnvironment; channelId: string; platform?: string; text: string; dueAt?: string | null; imageUrl?: string | null; mode?: "now" | "queue" | "schedule"; saveToDraft?: boolean }): Promise<BufferPost> {
  if (input.dueAt && new Date(input.dueAt).getTime() <= Date.now()) throw new BufferPostRejected("Choose a future publishing time before submitting again.");
  const postInput: Record<string, unknown> = {
    channelId: input.channelId,
    text: input.text,
    schedulingType: "automatic",
    mode: input.mode === "now" ? "shareNow" : input.dueAt ? "customScheduled" : "addToQueue",
    needsApproval: false,
    aiAssisted: true,
    assets: [],
    ...(input.saveToDraft ? { saveToDraft: true } : {}),
  };
  if (input.platform === "instagram") postInput.metadata = { instagram: { type: "post", shouldShareToFeed: true, isAiGenerated: true } };
  if (input.platform === "tiktok") postInput.metadata = { tiktok: { title: input.text.split("\n")[0].slice(0, 80) } };
  if (input.dueAt) postInput.dueAt = input.dueAt;
  if (input.imageUrl) postInput.assets = [{ image: { url: input.imageUrl } }];
  const result = await bufferQuery<{ createPost: { __typename: string; message?: string; post?: BufferPost } }>(input.environment, "mutation SignaldeskCreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id status dueAt sentAt externalLink } } ... on MutationError { message } } }", { input: postInput });
  if (result.createPost.__typename !== "PostActionSuccess") throw new BufferPostRejected(result.createPost.message || "Buffer could not schedule this post");
  if (!result.createPost.post?.id) throw new Error("Buffer accepted the request without returning its post ID. Review Buffer before retrying.");
  return result.createPost.post;
}

export async function getBufferPost(environment: AppEnvironment, id: string): Promise<BufferPost> {
  const result = await bufferQuery<{ post: BufferPost }>(environment, "query SignaldeskPost($input: PostInput!) { post(input: $input) { id status dueAt sentAt externalLink } }", { input: { id } });
  if (!result.post?.id) throw new Error("Buffer did not return the scheduled post");
  return result.post;
}
