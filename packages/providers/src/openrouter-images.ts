import type { AppEnvironment } from "../../config/src/env.js";

export class OpenRouterImageError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

type ImageResult = { bytes: Buffer; mimeType: string; model: string };

export async function generateOpenRouterImage(
  environment: AppEnvironment,
  prompt: string,
  referenceBytes?: Buffer,
  aspectRatio?: string,
): Promise<ImageResult> {
  if (environment.openRouter.status !== "configured" || !environment.openRouter.apiKey)
    throw new Error("OpenRouter is not configured");
  const body: Record<string, unknown> = {
    model: environment.openRouter.imageModel,
    prompt,
    n: 1,
    aspect_ratio: aspectRatio ?? "4:5",
  };
  if (referenceBytes?.length)
    body.input_references = [{
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${referenceBytes.toString("base64")}` },
    }];
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.openRouter.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new OpenRouterImageError("OpenRouter image generation timed out or could not connect", true);
  });
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new OpenRouterImageError(
      retryable
        ? `OpenRouter image generation is temporarily unavailable (status ${response.status}).`
        : `OpenRouter image generation rejected this request (status ${response.status}).`,
      retryable,
    );
  }
  const payload = await response.json() as { data?: Array<{ b64_json?: unknown; media_type?: unknown }> };
  const image = payload.data?.[0];
  if (!image || typeof image.b64_json !== "string" || !image.b64_json.trim())
    throw new OpenRouterImageError("OpenRouter did not return a generated image");
  const bytes = Buffer.from(image.b64_json, "base64");
  const mimeType = typeof image.media_type === "string" && image.media_type.startsWith("image/")
    ? image.media_type : "image/png";
  if (!bytes.length) throw new OpenRouterImageError("OpenRouter returned an empty image");
  return { bytes, mimeType, model: environment.openRouter.imageModel };
}
