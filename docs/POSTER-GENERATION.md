# Platform poster generation

Each platform uses a separate image job and a separate art direction: Instagram uses sunlit sandstone and plaster (768×960, 4:5); TikTok uses a dark sculptural pedestal and amber side lighting (720×1280, 9:16); X uses a wide travertine architectural still life (1280×720, 16:9). These are campaign compositions, not three crops of the same image. The actual product reference is passed to each call. OpenRouter writes platform-specific visual concepts in English independently of the caption language. Product labels and details still require human review.

The poster path uses OpenRouter's dedicated Image API with `google/gemini-3.1-flash-lite-image`, optional private reference photos, and platform-specific aspect ratios. No new credentials are required. Images stay private in Supabase and each replacement invalidates any prior approval. Image job retries never publish posts.

Transient image failures are requeued in PostgreSQL with a delay and a maximum of three total attempts. Network failures, timeout, capacity errors and unknown HTTP 400 inference failures can retry; known invalid-input, authentication, moderation and exhausted-allocation errors do not. Only HTTP status and numeric provider error codes are retained, never the raw error body. A historical TikTok HTTP 400 was reproduced using its original request and returned HTTP 200 on replay; its original provider body was not retained, so the precise underlying cause cannot be established retrospectively.

The UI distinguishes a complete batch from saved captions with failed images, offers a retry per platform, and follows the newest image job. Retrying a failed image does not regenerate successful images or captions. Review displays each full image without cropping and keeps the original product reference available for comparison.

Art-direction vocabulary adapted from **Serge Shima, visual-skills**, supplied by the user in visual-skills-main.zip: image/references/creative-direction.md, golden-rules.md, vision-decomposer.md and patterns/ecommerce.md. Source: https://github.com/smixs/visual-skills. License: https://creativecommons.org/licenses/by/4.0/. Changes: adapted general composition and material guidance to OpenRouter Gemini, added separate platform layouts, omitted other providers' model-specific parameters. No skill installation or additional image provider is required.

Provider references: https://openrouter.ai/docs/guides/overview/multimodal/image-generation.
