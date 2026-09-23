import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export const jobKinds = ["content.generate", "image.generate", "publish.submit", "publish.reconcile", "inbox.process", "reply.generate", "reply.send", "notification.deliver", "knowledge.import"] as const;
export type JobKind = (typeof jobKinds)[number];

export type ClaimedJob = {
  id: string;
  brand_id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
};

export async function enqueueJob(
  client: PoolClient,
  input: { brandId: string; kind: JobKind; payload: Record<string, unknown>; idempotencyKey: string; runAt?: Date },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    "insert into public.background_jobs (brand_id, kind, payload, idempotency_key, run_at) " +
      "values ($1, $2, $3::jsonb, $4, coalesce($5, now())) " +
      "on conflict (brand_id, kind, idempotency_key) do update set updated_at = now() returning id",
    [input.brandId, input.kind, JSON.stringify(input.payload), input.idempotencyKey, input.runAt ?? null],
  );
  return result.rows[0].id;
}

export async function claimJob(client: PoolClient, workerId: string): Promise<ClaimedJob | null> {
  const leaseToken = randomUUID();
  const result = await client.query<ClaimedJob>(
    "with next_job as (" +
      " select id from public.background_jobs where status = 'queued' and run_at <= now() and archived_at is null" +
      " and exists (select 1 from public.brand_profiles b where b.id=brand_id and b.status='approved')" +
      " order by run_at, created_at for update skip locked limit 1" +
      ") update public.background_jobs job " +
      "set status = 'processing', lease_owner = $1, lease_token = $2::uuid," +
      " lease_expires_at = now() + interval '5 minutes', attempt_count = attempt_count + 1, updated_at = now()" +
      " from next_job where job.id = next_job.id" +
      " returning job.id, job.brand_id, job.kind, job.payload, job.attempt_count, job.lease_token",
    [workerId, leaseToken],
  );
  return result.rows[0] ?? null;
}

export async function completeJob(client: PoolClient, job: ClaimedJob, result: Record<string, unknown>): Promise<void> {
  const update = await client.query(
    "update public.background_jobs set status = 'completed', result = $3::jsonb, lease_owner = null," +
      " lease_token = null, lease_expires_at = null, updated_at = now()" +
      " where id = $1 and lease_token = $2::uuid and status = 'processing'",
    [job.id, job.lease_token, JSON.stringify(result)],
  );
  if (update.rowCount !== 1) throw new Error("Job lease was lost before completion");
}

export async function holdJobForReview(client: PoolClient, job: ClaimedJob, reason: string): Promise<void> {
  await client.query(
    "update public.background_jobs set status = 'needs_review', error_summary = $3, lease_owner = null," +
      " lease_token = null, lease_expires_at = null, updated_at = now() where id = $1 and lease_token = $2::uuid",
    [job.id, job.lease_token, reason.slice(0, 800)],
  );
}

export async function retryImageJob(client: PoolClient, job: ClaimedJob, reason: string, delaySeconds=10): Promise<void> {
  if (job.kind !== "image.generate" || job.attempt_count >= 3) throw new Error("Image retry limit reached");
  const delay=Math.min(120,Math.max(5,delaySeconds,job.attempt_count*10));
  const result=await client.query("update background_jobs set status='queued',run_at=now()+$3*interval '1 second',error_summary=$4,lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=now() where id=$1 and lease_token=$2::uuid and status='processing'",[job.id,job.lease_token,delay,reason.slice(0,800)]);
  if(result.rowCount!==1)throw new Error("Job lease was lost before image retry");
}
