import type { PoolClient, Pool } from "pg";

export type ContentKnowledge = { id: string; title: string; content: string; source: string | null; updated_at: Date };

// Chat knowledge enters a post only through an explicit owner selection.
export async function loadContentKnowledge(client: Pick<Pool | PoolClient, "query">, brandId: string, ids?: string[]): Promise<ContentKnowledge[]> {
  const result = ids
    ? await client.query<ContentKnowledge>("select id,title,content,source,updated_at from knowledge_items where brand_id=$1 and status='approved' and id=any($2::uuid[]) order by id", [brandId, ids])
    : await client.query<ContentKnowledge>("select id,title,content,source,updated_at from knowledge_items where brand_id=$1 and status='approved' and scope='content' order by updated_at desc limit 50", [brandId]);
  if (ids && result.rows.length !== ids.length) throw new Error("Selected knowledge must be approved and belong to this workspace. Refresh your selection and try again.");
  if (!result.rows.length) throw new Error("Choose at least one approved knowledge item before generating content");
  return result.rows;
}
