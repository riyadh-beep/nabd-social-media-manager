-- Keep the original private reference across image regeneration and photo unlinking.
alter table public.content_drafts add column reference_asset_id uuid references public.assets(id);
alter table public.content_drafts add column reference_knowledge_id uuid references public.knowledge_items(id);
alter table public.content_drafts add column photo_grounding text;
