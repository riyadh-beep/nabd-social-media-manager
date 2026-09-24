import assert from "node:assert/strict";
import test from "node:test";
import { searchGoogleNews } from "../packages/providers/src/serpapi.js";

const environment = { serpApi: { status: "configured", apiKey: "test-serp-api-key" } } as never;

test("SerpAPI news search requests recent Google News results and normalizes safe articles", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  globalThis.fetch = (async (input) => {
    requestUrl = String(input);
    return new Response(JSON.stringify({ news_results: [
      { title: "A verified update", link: "https://news.example.test/story", source: { name: "Example News" }, iso_date: "2026-09-20T09:00:00Z", snippet: "A concise summary." },
      { title: "Discarded", link: "javascript:alert(1)", source: { name: "Unsafe" } },
    ] }), { status: 200 });
  }) as typeof fetch;
  try {
    const articles = await searchGoogleNews({ environment, query: "AI updates", language: "en", limit: 8 });
    const params = new URL(requestUrl).searchParams;
    assert.equal(params.get("engine"), "google_news");
    assert.equal(params.get("q"), "AI updates");
    assert.equal(params.get("hl"), "en");
    assert.equal(params.get("gl"), "sa");
    assert.equal(params.get("so"), null);
    assert.deepEqual(articles, [{ title: "A verified update", link: "https://news.example.test/story", publisher: "Example News", publishedAt: "2026-09-20T09:00:00Z", summary: "A concise summary." }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("SerpAPI news search stays unavailable until its server-side key is configured", async () => {
  await assert.rejects(() => searchGoogleNews({ environment: { serpApi: { status: "disabled" } } as never, query: "AI", language: "en", limit: 1 }), /not configured/);
});
