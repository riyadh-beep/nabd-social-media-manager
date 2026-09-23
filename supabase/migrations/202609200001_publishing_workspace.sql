YªçŠx-®éÜj×¢ëiºÚ+Š§j[h‘éÜ¢éíß}Ó¢Ö¥¢ëiºÙbë5-- Archive old workspace history without removing provider references or deduplication records.
alter table public.content_drafts add column if not exÛ}í¢G§²ÚîÆ­yÙc.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant all on public.audit_logs to service_role;
