import type { AppEnvironment } from "../../config/src/env.js";

export type NewsArticle = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  summary: string | null;
};

type SerpNewsResult = {
  title?: unknown;
  link?: unknown;
  source?: { name?: unknown };
  date?: unknown;
  iso_date?: unknown;
  snippet?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Searches Google News through SerpAPI. The API key never leaves this server module. */
export async function searchGoogleNews(input: {
  environment: AppEnvironment;
  query: string;
  language: "ar" | "en";
  limit: number;
  country?: string;
}): Promise<NewsArticle[]> {
  const { environment, query, language, limit, country = "sa" } = input;
  if (!environment.serpApi.apiKey) throw new Error("SerpAPI news search is not configured");

  const params = new URLSearchParams({
    engine: "google_news",
    q: query,
    hl: language,
    gl: country,
    api_key: environment.serpApi.apiKey,
  });
  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SerpAPI news search was rejected (${response.status})`);

  const payload = await response.json() as { error?: unknown; news_results?: unknown };
  const error = text(payload.error);
  if (error) throw new Error("SerpAPI news search failed");
  const results = Array.isArray(payload.news_results) ? payload.news_results as SerpNewsResult[] : [];
  return results.flatMap((item): NewsArticle[] => {
    const title = text(item.title);
    const link = safeUrl(item.link);
    if (!title || !link) return [];
    return [{
      title,
      link,
      publisher: text(item.source?.name) ?? "Unknown publisher",
      publishedAt: text(item.iso_date) ?? text(item.date),
      summary: text(item.snippet),
    }];
  }).slice(0, limit);
}
