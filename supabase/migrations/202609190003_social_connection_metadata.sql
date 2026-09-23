-- Provider-specific connection identities stay server-side while one social channel can use Buffer for publishing and Unipile for messaging.
alter table public.social_accounts add column if not exists connection_metadata jsonb not null default '{}'::jsonb;
