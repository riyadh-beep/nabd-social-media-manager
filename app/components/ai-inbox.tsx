"use client";
import { useLanguage } from "./preferences";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  LoaderCircle,
  Search,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import type {
  Brand,
  Conversation,
  Job,
  Knowledge,
  Message,
  ReplyDraft,
} from "../lib/model";
type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;
const customer = (c: Conversation) =>
  c.customer_username
    ? `@${c.customer_username}`
    : c.customer_name || "Instagram customer";
const REPLY_MODEL = "z-ai/glm-5.3-flash";
const REPLY_MODEL_LABEL = "Z.ai: GLM 5.3 Flash · z-ai/glm-5.3-flash";

const time = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function AiInbox({
  brand,
  conversations,
  messages,
  replyDrafts,
  knowledge,
  jobs,
  api,
  refresh,
  openLibrary,
}: {
  brand: Brand;
  conversations: Conversation[];
  messages: Message[];
  replyDrafts: ReplyDraft[];
  knowledge: Knowledge[];
  jobs: Job[];
  api: Api;
  refresh: () => Promise<void>;
  openLibrary: () => void;
}) {
  const { t } = useLanguage();
  const [changingMode, setChangingMode] = useState(false),
    [modeError, setModeError] = useState("");
  async function toggleMode() {
    setChangingMode(true);
    setModeError("");
    try {
      await api(`/v1/brands/${brand.id}`, {
        method: "PATCH",
        body: JSON.stringify({ autoReply: !brand.auto_reply }),
      });
      await refresh();
    } catch (e) {
      setModeError(
        e instanceof Error ? e.message : "Could not change reply mode",
      );
    } finally {
      setChangingMode(false);
    }
  }
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [waiting, setWaiting] = useState(false);
  const aiKnowledge = knowledge.filter(
    (item) => item.scope === "chat" && item.status === "approved",
  );
  const initialKnowledgeIds = (brand.reply_knowledge_ids?.length
    ? brand.reply_knowledge_ids
    : aiKnowledge.map((item) => item.id));
  const initialSettingsKey = JSON.stringify({
    model: REPLY_MODEL,
    knowledgeIds: [...initialKnowledgeIds].sort(),
  });
  const [replyKnowledgeIds, setReplyKnowledgeIds] = useState<string[]>(
      brand.reply_knowledge_ids ?? [],
    ),
    [settingsState, setSettingsState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedSettings = useRef(initialSettingsKey);
  const effectiveKnowledgeIds = replyKnowledgeIds.length
    ? replyKnowledgeIds
    : aiKnowledge.map((item) => item.id);
  const settingsKey = JSON.stringify({
    model: REPLY_MODEL,
    knowledgeIds: [...effectiveKnowledgeIds].sort(),
  });
  const persistReplySettings = useCallback(async (
    configuration: { model: string; knowledgeIds: string[] },
    key: string,
  ) => {
    setChangingMode(true);
    setSettingsState("saving");
    setModeError("");
    try {
      await api(`/v1/brands/${brand.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          replyKnowledgeMode: "chat",
          replyKnowledgeIds: configuration.knowledgeIds,
          replyModel: configuration.model,
        }),
      });
      savedSettings.current = key;
      setSettingsState("saved");
    } catch (e) {
      setSettingsState("error");
      setModeError(e instanceof Error ? e.message : "Could not save AI settings");
    } finally {
      setChangingMode(false);
    }
  }, [api, brand.id]);
  useEffect(() => {
    if (settingsKey === savedSettings.current) return;
    const configuration = JSON.parse(settingsKey) as {
      model: string;
      knowledgeIds: string[];
    };
    const timer = window.setTimeout(
      () => void persistReplySettings(configuration, settingsKey),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [settingsKey, persistReplySettings]);
  const conversation =
    conversations.find((c) => c.id === selected) ?? conversations[0];
  const thread = messages.filter((m) => m.conversation_id === conversation?.id);
  const latest = thread.at(-1);
  const latestCustomerMessage = [...thread].reverse().find(
    (message) => message.sender_type === "customer",
  );
  const suggestion = replyDrafts.find(
    (d) =>
      d.conversation_id === conversation?.id &&
      d.source_message_id === latestCustomerMessage?.id,
  );
  const pending = jobs.some(
    (j) =>
      ["reply.generate", "reply.send", "inbox.process"].includes(j.kind) &&
      ["queued", "processing"].includes(j.status),
  );
  useEffect(() => {
    const timer = setInterval(() => void refresh(), pending ? 1000 : 3000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  const shown = conversations.filter(
    (c) =>
      (!waiting ||
        c.paused_for_human ||
        messages.filter((m) => m.conversation_id === c.id).at(-1)
          ?.sender_type === "customer") &&
      `${customer(c)} ${c.customer_name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="ai-inbox">
      <header className="inbox-hero">
        <div>
          <span className="eyebrow">{t("A LITTLE HELP. A HUMAN TOUCH.")}</span>
          <h1>{t("Conversations, with care")}</h1>
          <p>
            {t(
              "Your AI answers Instagram messages using the knowledge you approve.",
            )}
          </p>
        </div>
        <button className="secondary" onClick={openLibrary}>
          <BookOpen size={16} />
          {t("AI knowledge")}
        </button>
      </header>
      <div className="inbox-summary">
        <span>
          <Sparkles size={15} />
          {REPLY_MODEL_LABEL}
        </span>
        <span>
          {
            effectiveKnowledgeIds.length
          }{" "}
          {t("approved knowledge items")}
        </span>
        <button
          className="auto-reply-toggle"
          role="switch"
          aria-checked={!!brand.auto_reply}
          disabled={changingMode}
          onClick={() => void toggleMode()}
        >
          {brand.auto_reply ? t("Auto replies on") : t("Auto replies off")}
        </button>
      </div>
      <section className="reply-settings panel" aria-label="AI reply settings">
        <div>
          <span className="eyebrow">
            <Settings2 size={14} />
            {t("Reply settings")}
          </span>
          <h2>{t("Choose the AI and knowledge it can use")}</h2>
          <p>
            {t(
              "Only approved items are sent to the model. Changes apply to the next incoming message.",
            )}
          </p>
        </div>
        <div className="reply-knowledge-picker">
          <strong>{t("AI knowledge for replies")}</strong>
          <small>{t("Choose the approved AI knowledge cards Nabd may use.")}</small>
          <div>{aiKnowledge.map((item) => <div key={item.id} className="knowledge-choice">
            <input aria-label={item.title} type="checkbox" checked={effectiveKnowledgeIds.includes(item.id)} onChange={(event) => setReplyKnowledgeIds(() => {
              return event.target.checked
                ? [...new Set([...effectiveKnowledgeIds, item.id])]
                : effectiveKnowledgeIds.filter((id) => id !== item.id);
            })}/>
            <span><strong dir="auto">{item.title}</strong><small dir="auto">{item.content.slice(0, 86)}</small></span>
          </div>)}</div>
          {!aiKnowledge.length && <small>{t("Add and approve AI knowledge first.")}</small>}
        </div>
        <div className="locked-reply-model" aria-label={t("Reply model")}>
          <strong>{t("Reply model")}</strong>
          <span>{REPLY_MODEL_LABEL}</span>
          <small>{t("Used automatically for every AI reply.")}</small>
        </div>
        <button
          className="primary"
          disabled={changingMode}
          onClick={() => void persistReplySettings({ model: REPLY_MODEL, knowledgeIds: effectiveKnowledgeIds }, settingsKey)}
        >
          {changingMode ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          {settingsState === "saving" ? t("Saving…") : settingsState === "saved" ? t("Saved automatically") : settingsState === "error" ? t("Retry saving") : t("Save now")}
        </button>
      </section>
      {modeError && (
        <p role="alert" className="error">
          {modeError}
        </p>
      )}
      <div className="nabd-inbox-grid">
        <aside className="panel inbox-threads">
          <label className="inbox-search">
            <Search size={16} />
            <input
              aria-label={t("Search customers")}
              placeholder={t("Find a customer…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="tabs">
            <button
              className={!waiting ? "selected" : ""}
              onClick={() => setWaiting(false)}
            >
              {t("All")}
            </button>
            <button
              className={waiting ? "selected" : ""}
              onClick={() => setWaiting(true)}
            >
              {t("Needs reply")}
            </button>
          </div>
          {shown.map((c) => (
            <button
              className={`inbox-thread ${conversation?.id === c.id ? "selected" : ""}`}
              key={c.id}
              onClick={() => setSelected(c.id)}
            >
              <span className="avatar">
                {customer(c).replace("@", "").slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{customer(c)}</strong>
                <small dir="auto">
                  {messages.filter((m) => m.conversation_id === c.id).at(-1)
                    ?.body || t("No messages")}
                </small>
              </span>
              {messages.filter((m) => m.conversation_id === c.id).at(-1)
                ?.sender_type === "customer" && <i />}
            </button>
          ))}
          {!shown.length && (
            <p className="inbox-empty">
              {t(
                "No conversations here yet. New Instagram messages will appear automatically.",
              )}
            </p>
          )}
        </aside>
        <section className="panel inbox-thread-body">
          {conversation ? (
            <>
              <header className="inbox-person">
                <div>
                  <h2>{customer(conversation)}</h2>
                  <p>
                    {conversation.customer_name || t("Instagram conversation")}
                    {!conversation.customer_username &&
                      " · username not provided by Instagram"}
                  </p>
                </div>
                {conversation.customer_username && (
                  <a
                    href={`https://www.instagram.com/${encodeURIComponent(conversation.customer_username)}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("View profile ↗")}
                  </a>
                )}
              </header>
              <div className="messages nabd-messages">
                {thread.map((m) => (
                  <div
                    className={`bubble ${m.sender_type === "customer" ? "customer" : "owner"}`}
                    key={m.id}
                  >
                    <small>
                      {m.sender_type === "customer"
                        ? customer(conversation)
                        : t("You")}
                    </small>
                    <p dir="auto">{m.body}</p>
                    <time>{time(m.created_at)}</time>
                  </div>
                ))}
              </div>
              <ReplyComposer
                key={`${conversation.id}:${latest?.id}`}
                brand={brand}
                conversation={conversation}
                latest={latest}
                latestCustomerMessage={latestCustomerMessage}
                suggestion={suggestion}
                knowledge={knowledge}
                jobs={jobs}
                api={api}
                refresh={refresh}
                openLibrary={openLibrary}
              />
            </>
          ) : (
            <div className="inbox-empty">
              <Sparkles />
              <h2>{t("Your next conversation starts here")}</h2>
              <p>
                {t(
                  "Add store knowledge while you wait for your first message.",
                )}
              </p>
              <button className="primary" onClick={openLibrary}>
                {t("Build the AI library")}
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function ReplyComposer({
  brand,
  conversation,
  latest,
  latestCustomerMessage,
  suggestion,
  knowledge,
  jobs,
  api,
  refresh,
  openLibrary,
}: {
  brand: Brand;
  conversation: Conversation;
  latest?: Message;
  latestCustomerMessage?: Message;
  suggestion?: ReplyDraft;
  knowledge: Knowledge[];
  jobs: Job[];
  api: Api;
  refresh: () => Promise<void>;
  openLibrary: () => void;
}) {
  const { t } = useLanguage();
  const [text, setText] = useState(""),
    [usedDraft, setUsedDraft] = useState<string | undefined>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [queuedId, setQueuedId] = useState("");
  const lock = useRef(false),
    sendKey = useRef(crypto.randomUUID());
  const related = jobs.filter((j) => j.conversation_id === conversation.id),
    active = related.find((j) => ["queued", "processing"].includes(j.status)),
    queued = jobs.find((j) => j.id === queuedId),
    failure = related.find((j) =>
      ["needs_review", "failed"].includes(j.status),
    );
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const waiting = latest?.sender_type === "customer";
  const replySource = waiting ? latestCustomerMessage : undefined;
  return (
    <div className="reply-workbench">
      <div className="ai-draft-header">
        <strong>
          <Sparkles size={17} />
          {t("Nabd reply assistant")}
        </strong>
        <button
          className="secondary"
          disabled={busy || !!active || !waiting || brand.status === "paused"}
          onClick={() =>
            void run(async () => {
              const r = await api(
                `/v1/brands/${brand.id}/conversations/${conversation.id}/suggest`,
                {
                  method: "POST",
                  headers: { "Idempotency-Key": crypto.randomUUID() },
                },
              );
              setQueuedId(String(r.jobId));
              setNotice(
                "AI is drafting a reply. You can leave this page while it works.",
              );
            })
          }
        >
          {busy || active ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Sparkles size={14} />
          )}{" "}
          {suggestion ? t("Regenerate") : t("Generate AI reply")}
        </button>
      </div>
      {active && (
        <p className="muted" role="status">
          {active.kind === "reply.send"
            ? t("Sending your reply…")
            : t("Preparing an AI suggestion…")}
        </p>
      )}
      {suggestion ? (
        <div className="ai-suggestion">
          <div className="ai-suggestion-label">
            {suggestion.needs_human
              ? t("Check details before sending")
              : t("Grounded in your approved knowledge")}
          </div>
          <p dir="auto">{suggestion.body}</p>
          {suggestion.review_reason && (
            <small>{suggestion.review_reason}</small>
          )}
          <div className="citation-row">
            {suggestion.source_knowledge_ids.map((id) => (
              <button key={id} onClick={openLibrary}>
                <BookOpen size={12} />
                {knowledge.find((k) => k.id === id)?.title ??
                  t("Source changed — regenerate")}
              </button>
            ))}
          </div>
          <button
            className="secondary"
            onClick={() => {
              setText(suggestion.body);
              setUsedDraft(suggestion.id);
            }}
          >
            {t("Use this reply")} <Check size={14} />
          </button>
        </div>
      ) : (
        <p className="muted">
          {waiting
            ? t(
                "A new message can receive an automatic AI draft. You can also generate one here.",
              )
            : t(
                "You’re caught up. New messages are answered automatically when auto replies are on.",
              )}
        </p>
      )}
      {(error || (waiting && failure && !suggestion && !active)) && (
        <p className="error" role="alert">
          {error || failure?.error_summary}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {queued?.status === "completed"
            ? t("Done. The latest result appears in this conversation.")
            : notice}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api(
              `/v1/brands/${brand.id}/conversations/${conversation.id}/reply`,
              {
                method: "POST",
                headers: { "Idempotency-Key": sendKey.current },
                body: JSON.stringify({
                  text,
                  expectedMessageId: replySource?.id ?? latest?.id,
                  replyDraftId: usedDraft,
                }),
              },
            );
            setQueuedId(String(r.jobId));
            setNotice(
              "Reply queued. Delivery is confirmed only after Unipile responds.",
            );
            setText("");
          });
        }}
      >
        <label htmlFor={`reply-${conversation.id}`}>
          {t("Write a personal reply")}
        </label>
        <textarea
          id={`reply-${conversation.id}`}
          dir="auto"
          rows={3}
          maxLength={4000}
          placeholder={t("Use the AI suggestion or write your own reply…")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="reply-footer">
          <small>
            {text.length}
            {t("/4,000 · Manual reply")}
          </small>
          <button
            className="primary"
            disabled={
              busy ||
              !!active ||
              (!!queuedId &&
                queued?.kind === "reply.send" &&
                queued.status !== "failed") ||
              !text.trim() ||
              brand.status === "paused"
            }
          >
            <Send size={15} />
            {t("Send reply")}
          </button>
        </div>
      </form>
    </div>
  );
}
