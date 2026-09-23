"use client";
import { useLanguage } from "./preferences";

import { FormEvent, useState } from "react";
import { Check, ExternalLink, LoaderCircle, Plus, Search, Sparkles } from "lucide-react";
import { friendlyError } from "../lib/model";

type Article = { title: string; link: string; publisher: string; publishedAt: string | null; summary: string | null };
type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

export function NewsSearch({ brandId, api, onAdded }: { brandId: string; api: Api; onAdded: () => Promise<void> }) {
 const {t}=useLanguage();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [articles, setArticles] = useState<Article[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true); setError(""); setArticles([]); setAdded([]);
    try {
      const result = await api(`/v1/brands/${brandId}/news/search`, {
        method: "POST",
        body: JSON.stringify({ query: query.trim(), language, limit: 8 }),
      });
      setArticles(Array.isArray(result.articles) ? result.articles as Article[] : []);
    } catch (failure) {
      setError(friendlyError(failure));
    } finally { setBusy(false); }
  }

  async function addArticle(article: Article) {
    setAdding(article.link); setError("");
    try {
      const details = [
        article.title,
        `Publisher: ${article.publisher}`,
        article.publishedAt ? `Published: ${article.publishedAt}` : "",
        article.summary ?? "",
        `Original source: ${article.link}`,
      ].filter(Boolean).join("\n\n");
      await api(`/v1/brands/${brandId}/knowledge`, {
        method: "POST",
        body: JSON.stringify({ type: "source", title: article.title, content: details, source: article.link }),
      });
      setAdded(previous => [...previous, article.link]);
      await onAdded();
    } catch (failure) {
      setError(friendlyError(failure));
    } finally { setAdding(""); }
  }

  return <section className="news-search" aria-label={t("Search current news")}>
    <div className="news-search-heading">
      <span className="news-search-icon"><Sparkles size={18} /></span>
      <div><span className="eyebrow">{t("CURRENT NEWS DISCOVERY")}</span><h2>{t("Find a story to make your own.")}</h2><p>{t("Search recent reporting, choose the source you trust, then approve it before it guides any content.")}</p></div>
    </div>
    <form className="news-search-form" onSubmit={search}>
      <label className="sr-only" htmlFor="news-query">{t("Search recent news")}</label>
      <Search size={18} aria-hidden="true" />
      <input id="news-query" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search a topic, person, company, or AI update")} maxLength={300} />
      <select aria-label={t("News language")} value={language} onChange={event => setLanguage(event.target.value as "en" | "ar")}><option value="en">{t("English")}</option><option value="ar">العربية</option></select>
      <button className="primary" disabled={busy || query.trim().length < 2}>{busy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{t("Search news")}</button>
    </form>
    {error && <p className="news-search-error" role="alert">{error}</p>}
    {articles.length > 0 && <div className="news-results">
      <div className="news-results-title"><strong>{t("Recent results")}</strong><span>{t("Pick only stories you want to review")}</span></div>
      {articles.map(article => <article className="news-result" key={article.link}>
        <div className="news-result-copy"><span>{article.publisher}{article.publishedAt ? ` · ${article.publishedAt}` : ""}</span><h3>{article.title}</h3>{article.summary && <p>{article.summary}</p>}<a href={article.link} target="_blank" rel="noreferrer">{t("Read original")}{" "}<ExternalLink size={13} /></a></div>
        <button className={added.includes(article.link) ? "secondary added" : "secondary"} disabled={Boolean(adding) || added.includes(article.link)} onClick={() => void addArticle(article)}>{adding === article.link ? <LoaderCircle className="spin" size={15} /> : added.includes(article.link) ? <Check size={15} /> : <Plus size={15} />}{added.includes(article.link) ? t("Added for review") : t("Add as source")}</button>
      </article>)}
    </div>}
    {!busy && query && !articles.length && !error && <p className="news-empty">{t("Search recent stories, then add a source to your review list.")}</p>}
  </section>;
}
