# Nabd AI inbox

Nabd keeps the existing React, Node API/Worker, PostgreSQL queue, and Supabase architecture. Email remains deferred. Internal legacy storage keys and migration names retain their previous names for compatibility.

## Use

1. Open AI knowledge and add products, policies, FAQs, or tone guidance. All new and edited items start as drafts.
2. Verify the facts and approve the item. Only approved chat knowledge enters reply prompts. To use those same facts for social content, choose **Create post** on the card or select them in Create’s knowledge picker. Post creation uses only the selected items; approving chat knowledge alone does not automatically add it to posts.
3. Incoming Instagram messages create durable inbox jobs, an escalation record, and an AI draft job. The webhook does no AI work.
4. Inbox shows the sender's public username or display name when Unipile supplies it. Missing identities are labeled honestly; historical webhook records backfill existing conversations.
5. Turn **Auto replies on** in Inbox to let Nabd generate and send replies without individual approval. This is enabled for the current owner's workspace following their explicit request. Turn it off to return to draft-only operation. Manual replies remain available with Send reply.
6. A confirmed Unipile response inserts the outgoing message. Unknown delivery outcomes require review instead of an automatic retry.

Search customers or use Needs reply to find unanswered conversations. The inbox refreshes while open. Knowledge templates help organize products, delivery, returns, FAQs, and tone. Automatic generation waits ten seconds to let newer messages supersede old ones. Each conversation is limited to 20 automatic sends per hour; further attempts remain for review. Missing-information replies may ask for clarification while retaining the escalation for human follow-up. Disabling auto replies prevents queued automatic sends from being dispatched; a provider request already in flight may complete.

## Website imports and appearance

AI knowledge can import a public HTTPS product, FAQ, or policy page through Firecrawl. The import runs as a durable background job and stores up to 12,000 characters as a draft. Imported content must be reviewed and approved before chat generation can use it. FIRECRAWL_API_KEY remains server-side in the ignored local environment. Apply migration 202609200003_auto_replies_imports.sql; it adds the import job kind and a unique knowledge-to-job reference.

The top bar offers English/Arabic, light/night mode, and show/hide sidebar controls. Preferences persist in this browser. Arabic uses right-to-left layout; customer messages, URLs, generated captions, and stored knowledge retain their original content. Provider-origin error text may remain in its original language. The logo's CSS white background and decorative star were removed.

## Configuration

Existing OPENROUTER_API_KEY powers chat. OPENROUTER_CHAT_MODEL defaults to z-ai/glm-5.3-flash and is independent of OPENROUTER_MODEL for social content. Keys remain server-side. No additional credential is required for this feature. The model and provider can be unavailable or rate limited; failures are explicit and no mock silently substitutes for a provider.

Apply migration 202609200002_nabd_ai_inbox.sql after the existing migrations. It adds chat knowledge scope, sender identity fields, reply provenance, and the reply.generate queue kind. Existing reply_drafts remain protected from frontend writes.

## Boundaries

The model sees the latest 20 messages (up to 4,000 characters each) and the latest 50 approved chat knowledge items. It has no live inventory, orders, or payment access. Prompts instruct it to avoid invented facts, prices, policies, and actions. Model output is schema-validated and citation IDs must belong to approved knowledge. These checks do not guarantee factual correctness. The owner can disable auto replies and review drafts manually at any time.

New messages supersede older suggestions. The API and worker reject stale message context or changed/archived cited knowledge. Duplicate sends for the same last message use one durable job. Knowledge editing requires reapproval. Pause stops new jobs from being claimed.

## Verification

Automated tests use a PostgreSQL-compatible PGlite database, mocked OpenRouter/Unipile responses, and API injection to verify knowledge isolation, sender identity, durable generation, source checks, ownership, stale context, duplicate sends, auto-send mode, and disabling queued automatic replies. A real OpenRouter GLM 5.3 Flash request generated a validated Arabic draft with a synthetic returns policy. Firecrawl passed a real extraction test against example.com. No customer messages were sent by these tests.
