"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Globe2,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { Job, Knowledge } from "../lib/model";
import { KnowledgePhotos } from "./knowledge-photos";
import { useLanguage } from "./preferences";

interface ChatKnowledgeProps {
  brandId: string;
  items: Knowledge[];
  jobs?: Job[];
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  refresh: () => Promise<void>;
  onCreatePost?: (item: Knowledge) => void;
}

const STARTERS = [
  {
    type: "product",
    titleKey: "Products & pricing",
    descriptionKey:
      "Describe your products, current prices, sizes, and product links. Include the date prices were checked.",
  },
  {
    type: "policy",
    titleKey: "Delivery & returns",
    descriptionKey:
      "Where do you deliver? What are your shipping fees, delivery estimates, return window, and exceptions?",
  },
  {
    type: "faq",
    titleKey: "Frequently asked questions",
    descriptionKey:
      "Write a customer question followed by an accurate answer. Include opening hours and how to contact the store.",
  },
  {
    type: "instruction",
    titleKey: "Voice & boundaries",
    descriptionKey:
      "Describe how your store speaks, preferred greetings, and when a person should take over.",
  },
] as const;

export function ChatKnowledge({
  brandId,
  items,
  jobs: _jobs = [],
  api,
  refresh,
  onCreatePost,
}: ChatKnowledgeProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Knowledge | null>(null);

  // Form states
  const [formType, setFormType] = useState<string>("faq");
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formSource, setFormSource] = useState("");

  // Import states
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");

  // General action states
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const chatItems = items.filter((item) => item.scope === "chat");
  // If no items explicitly tagged with "chat", show items or empty state
  const visibleItems = (chatItems.length > 0 ? chatItems : items.filter((k) => k.status !== "archived")).filter((k) =>
    k.status !== "archived" &&
    `${k.title} ${k.content} ${k.type}`.toLowerCase().includes(search.toLowerCase())
  );

  const approvedCount = chatItems.filter((k) => k.status === "approved").length;
  const pendingCount = chatItems.filter((k) => k.status !== "approved" && k.status !== "archived").length;

  function openNew(starter?: (typeof STARTERS)[number]) {
    setEditingItem(null);
    if (starter) {
      setFormType(starter.type);
      setFormTitle(t(starter.titleKey));
      setFormContent("");
    } else {
      setFormType("faq");
      setFormTitle("");
      setFormContent("");
    }
    setFormSource("");
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  function openEdit(item: Knowledge) {
    setEditingItem(item);
    setFormType(item.type || "faq");
    setFormTitle(item.title);
    setFormContent(item.content);
    setFormSource(item.source || "");
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingItem(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (editingItem) {
        await api(`/v1/brands/${brandId}/knowledge/${editingItem.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            scope: "chat",
            type: formType,
            title: formTitle,
            content: formContent,
            source: formSource,
          }),
        });
        setNotice(t("Saved for review"));
      } else {
        await api(`/v1/brands/${brandId}/knowledge`, {
          method: "POST",
          body: JSON.stringify({
            scope: "chat",
            type: formType,
            title: formTitle,
            content: formContent,
            source: formSource,
          }),
        });
        setNotice(t("Saved for review"));
      }
      closeEditor();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Save failed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/brands/${brandId}/knowledge/${id}/approve`, {
        method: "POST",
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not approve knowledge"));
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/v1/brands/${brandId}/knowledge/${id}/archive`, {
        method: "POST",
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not archive knowledge"));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (importing || !importUrl.trim()) return;
    setImporting(true);
    setImportError("");
    setImportNotice(t("Import is running in the background."));

    try {
      await api(`/v1/brands/${brandId}/knowledge/import`, {
        method: "POST",
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      setImportNotice(t("Imported. Review and approve the new knowledge below."));
      setImportUrl("");
      await refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("Import failed"));
      setImportNotice("");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="chat-knowledge-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("TEACH NABD ABOUT YOUR STORE")}</p>
          <h1>
            {t("Good answers start here")}
            <span className="orange-dot">.</span>
          </h1>
          <p>
            {t("A private library of the facts your reply assistant is allowed to use.")}
          </p>
        </div>
      </div>

      {notice && (
        <div className="banner success">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="tabs">
          <span className="muted">
            {approvedCount} {t("approved")} · {pendingCount} {t("awaiting review")}
          </span>
        </div>
        <div className="button-row">
          <span className="muted">
            {t("Separate from your social content sources")}
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => openNew()}
          >
            <Plus size={16} />
            {t("Add store knowledge")}
          </button>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: "24px" }}>
        <div className="panel-head">
          <div>
            <span className="eyebrow">{t("WEBSITE SOURCE")}</span>
            <h3>{t("Import from your website")}</h3>
            <p>
              {t("Turn a product, FAQ, or policy page into knowledge for your AI.")}
            </p>
          </div>
        </div>
        <form onSubmit={handleImport} style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: "260px", margin: 0 }}>
            <span className="sr-only">{t("Public page URL")}</span>
            <input
              type="url"
              placeholder={t("Public page URL")}
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              disabled={importing}
              required
            />
          </label>
          <button type="submit" className="secondary" disabled={importing || !importUrl.trim()}>
            {importing ? (
              <>
                <LoaderCircle size={16} className="spin" /> {t("Importing…")}
              </>
            ) : (
              <>
                <Globe2 size={16} /> {t("Import page")}
              </>
            )}
          </button>
        </form>
        {importNotice && <p className="muted" style={{ marginTop: "10px", fontSize: "13px" }}>{importNotice}</p>}
        {importError && <p className="error" style={{ marginTop: "10px", fontSize: "13px" }}>{importError}</p>}
      </section>

      {editorOpen && (
        <section className="panel knowledge-editor">
          <div className="panel-head">
            <div>
              <h3>{editingItem ? t("Edit knowledge") : t("Add store knowledge")}</h3>
              <p>
                {t(
                  "Use verified information. Editing an approved item requires approval again. Don’t add passwords or API keys."
                )}
              </p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={closeEditor}
              aria-label={t("Close knowledge editor")}
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSave}>
            <label>
              {t("Category")}
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
              >
                <option value="faq">{t("Frequently asked questions")}</option>
                <option value="product">{t("Products & pricing")}</option>
                <option value="policy">{t("Delivery & returns")}</option>
                <option value="instruction">{t("Voice & boundaries")}</option>
              </select>
            </label>

            <label>
              {t("Title")}
              <input
                type="text"
                required
                maxLength={200}
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </label>

            <label>
              {t("Approved facts or guidance")}
              <textarea
                required
                rows={6}
                maxLength={12000}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder={t(
                  "Write clear, verified facts or instructions that your AI can safely rely on."
                )}
              />
            </label>

            <label>
              {t("Source URL (optional)")}
              <input
                type="url"
                placeholder="https://…"
                value={formSource}
                onChange={(e) => setFormSource(e.target.value)}
              />
            </label>

            <div className="button-row" style={{ marginTop: "20px" }}>
              <button
                type="submit"
                className="primary"
                disabled={busy || !formTitle.trim() || !formContent.trim()}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : null}
                {t("Save for review")}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={closeEditor}
              >
                {t("Cancel")}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="knowledge-starters">
        {STARTERS.map((s) => (
          <button
            key={s.titleKey}
            type="button"
            onClick={() => openNew(s)}
          >
            <span>
              <Plus size={16} />
            </span>
            <strong>{t(s.titleKey)}</strong>
            <p>{t(s.descriptionKey)}</p>
          </button>
        ))}
      </div>

      <div className="library-search">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
          <Search size={16} style={{ color: "var(--muted)" }} />
          <input
            type="search"
            aria-label={t("Search AI knowledge")}
            placeholder={t("Search your store knowledge…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ margin: 0 }}
          />
        </label>
      </div>

      {visibleItems.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <span>
              <BookOpen size={24} />
            </span>
            <h3>{t("Start with the questions customers ask most")}</h3>
            <p>
              {t(
                "Add products, shipping, and returns information above. Nabd will ask for help when your library does not contain an answer."
              )}
            </p>
          </div>
        </section>
      ) : (
        <div className="knowledge-grid chat-library">
          {visibleItems.map((k) => (
            <article className="panel knowledge-card" key={k.id}>
              <div className="panel-title">
                <span className="type-icon">
                  <BookOpen size={18} />
                </span>
                <span className={`badge ${k.status}`}>
                  <span />
                  {t(k.status.replaceAll("_", " "))}
                </span>
              </div>
              <small className="eyebrow">{t(k.type)}</small>
              <h3 dir="auto">{k.title}</h3>
              <p dir="auto">{k.content}</p>

              <KnowledgePhotos
                item={k}
                brandId={brandId}
                api={api}
                refresh={refresh}
              />

              {k.source && /^https?:\/\//.test(k.source) && (
                <a
                  href={k.source}
                  target="_blank"
                  rel="noreferrer"
                  className="source-link"
                >
                  {t("View source")} <ArrowUpRight size={14} />
                </a>
              )}

              <div className="card-actions">
                {k.status !== "approved" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => handleApprove(k.id)}
                  >
                    {t("Approve")}
                  </button>
                )}

                {k.status === "approved" && onCreatePost && (
                  <button
                    type="button"
                    className="secondary"
                    title={t("Also available when choosing knowledge for a post")}
                    onClick={() => onCreatePost(k)}
                  >
                    <Sparkles size={14} /> {t("Create post")}
                  </button>
                )}

                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => openEdit(k)}
                >
                  {t("Edit knowledge")}
                </button>

                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => handleArchive(k.id)}
                >
                  {t("Archive")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
