"use client";
import { useLanguage } from "./components/preferences";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { publicConfig } from "./lib/public-config";
import {
  BookOpen,
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Globe2,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { GuidedStudio } from "./components/guided-studio";
import { AccountHub } from "./components/account-hub";
import { PreferencesControls } from "./components/preferences";
import { AiInbox } from "./components/ai-inbox";
import { KnowledgePhotos } from "./components/knowledge-photos";
import { ChatKnowledge } from "./components/chat-knowledge";
import { NewsSearch } from "./components/news-search";
import { SaudiContentCalendar } from "./components/saudi-content-calendar";
import {
  countStats,
  friendlyError,
  publicConfigValid,
  workspaceTypes,
  type Account,
  type Asset,
  type Brand,
  type Conversation,
  type Draft,
  type Job,
  type Knowledge,
  type Message,
  type ReplyDraft,
} from "./lib/model";

type Section =
  | "chat-knowledge"
  | "create"
  | "channels"
  | "calendar"
  | "overview"
  | "content"
  | "knowledge"
  | "inbox"
  | "results"
  | "settings";
const nav = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "content", label: "Content library", icon: CalendarDays },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "knowledge", label: "Sources", icon: FileText },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "chat-knowledge", label: "AI knowledge", icon: BookOpen },
  { id: "channels", label: "Social accounts", icon: Globe2 },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
const labels = {
  store: "Online store",
  creator: "Creator / personal brand",
  business: "Business / service",
  news: "News / topic channel",
};
const date = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not scheduled";
const empty = {
  replyDrafts: [] as ReplyDraft[],
  drafts: [] as Draft[],
  knowledge: [] as Knowledge[],
  jobs: [] as Job[],
  accounts: [] as Account[],
  conversations: [] as Conversation[],
  messages: [] as Message[],
  assets: [] as Asset[],
};

export default function Home() {
  const { t } = useLanguage();
  const translateLabel = t;
  const initialConfig = () => {
    let saved = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? publicConfig.url,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? publicConfig.key,
    };
    if (typeof window !== "undefined") {
      try {
        const local = localStorage.getItem("signaldesk.public-config");
        if (local) saved = JSON.parse(local) as typeof saved;
      } catch {
        /* invalid local public configuration is ignored */
      }
    }
    return saved;
  };
  const [config, setConfig] = useState(initialConfig),
    [client, setClient] = useState<SupabaseClient | null>(() => {
      const saved = initialConfig();
      return publicConfigValid(saved.url, saved.key)
        ? createClient(saved.url, saved.key)
        : null;
    }),
    [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("riyadh@mabda.ai");
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const localMode = useSyncExternalStore(
    () => () => {},
    () => ["localhost", "127.0.0.1"].includes(window.location.hostname),
    () => false,
  );
  const [section, setSection] = useState<Section>("create"),
    [brands, setBrands] = useState<Brand[]>([]),
    [brandId, setBrandId] = useState("");
  const [data, setData] = useState(empty),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<
      "workspace" | "generate" | "knowledge" | null
    >(null),
    [editing, setEditing] = useState<Draft | null>(null),
    [filter, setFilter] = useState("all");
  const [updated, setUpdated] = useState<string | null>(null);
  const [postKnowledge, setPostKnowledge] = useState<{
    brandId: string;
    id: string;
    version: number;
  } | null>(null);
  const createFromKnowledge = (item: Knowledge) => {
    setPostKnowledge((previous) => ({
      brandId: brandId,
      id: item.id,
      version: (previous?.version ?? 0) + 1,
    }));
    go("create");
  };
  const contentKnowledge = data.knowledge.filter((k) => k.scope !== "chat");
  const impressions = data.drafts
    .flatMap((d) => d.provider_metrics ?? [])
    .filter((m) => /^(impressions|post_impressions)$/i.test(m.type || m.name))
    .map((m) => m.value)
    .filter((v): v is number => typeof v === "number");
  const epoch = useRef(0),
    lock = useRef(false),
    brand = brands.find((b) => b.id === brandId),
    stats = countStats(data.drafts, data.jobs, data.conversations);
  useEffect(() => {
    if (localMode || !client) return;
    let cancelled = false;
    client.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError(error.message);
      setSession(data.session);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, s) => {
      epoch.current++;
      setSession(s);
      if (!s) {
        setBrands([]);
        setBrandId("");
        setData(empty);
      }
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [client, localMode]);
  const api = useCallback(
    async (
      path: string,
      init: RequestInit = {},
    ): Promise<Record<string, unknown>> => {
      if (!localMode && !session) throw new Error("Sign in first.");
      const headers = new Headers(init.headers);
      if (!headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      if (session)
        headers.set("Authorization", `Bearer ${session.access_token}`);
      let r: Response;
      try {
        r = await fetch(`${publicConfig.apiBaseUrl}${path}`, {
          ...init,
          headers,
        });
      } catch {
        throw new Error(
          "Cannot reach the workspace API. Your saved data has not been replaced. Check the service connection and try Refresh data.",
        );
      }
      const body = (await r.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!r.ok)
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "The application API request failed.",
        );
      return body;
    },
    [localMode, session],
  );
  const refresh = useCallback(async () => {
    if (!localMode && (!client || !session)) return;
    const token = ++epoch.current;
    setLoading(true);
    try {
      const b = (await api("/v1/brands")) as { brands: Brand[] };
      if (token !== epoch.current) return;
      setBrands(b.brands ?? []);
      const id = brandId || b.brands?.[0]?.id;
      if (!id) {
        setData(empty);
        return;
      }
      if (!brandId) setBrandId(id);
      const dashboard = (await api(`/v1/brands/${id}/dashboard`)) as {
        replyDrafts: ReplyDraft[];
        drafts: Draft[];
        knowledge: Knowledge[];
        jobs: Job[];
        accounts: Account[];
        conversations: Conversation[];
        messages: Message[];
        assets: Asset[];
      };
      if (token !== epoch.current) return;
      setData({
        replyDrafts: dashboard.replyDrafts ?? [],
        drafts: dashboard.drafts,
        knowledge: dashboard.knowledge,
        jobs: dashboard.jobs,
        accounts: dashboard.accounts,
        conversations: dashboard.conversations,
        messages: dashboard.messages,
        assets: dashboard.assets,
      });
      setUpdated(new Date().toISOString());
      setError("");
    } catch (e) {
      if (token === epoch.current) setError(friendlyError(e));
    } finally {
      if (token === epoch.current) setLoading(false);
    }
  }, [api, client, localMode, session, brandId]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 30000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);
  async function act(work: () => Promise<unknown>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(success);
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (name === "sma_create_workspace") {
      const b = (await api("/v1/brands", {
        method: "POST",
        body: JSON.stringify({
          name: args.p_name,
          workspaceType: args.p_type,
          description: args.p_description,
          topics: args.p_topics,
          audience: args.p_audience,
          languages: args.p_languages,
        }),
      })) as { brand: { id: string } };
      return b.brand.id;
    }
    if (name === "sma_draft_action") {
      await api(
        `/v1/brands/${brandId}/drafts/${args.p_draft}/${args.p_action}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: args.p_version,
            ...(args.p_changes as object),
          }),
        },
      );
      return "";
    }
    if (name === "sma_update_workspace") {
      const c = args.p_changes as Record<string, unknown>;
      await api(`/v1/brands/${brandId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: c.name,
          description: c.description,
          workspaceType: c.workspace_type,
          topics: c.topics,
          audience: c.audience,
          dailyGeneration: c.daily_generation,
          status: c.status,
        }),
      });
      return "";
    }
    throw new Error("This command is not available in the custom API yet.");
  }
  async function queue(kind: string, payload: Record<string, unknown> = {}) {
    if (kind === "generate") {
      await api(`/v1/brands/${brandId}/generate`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      return;
    }
    if (
      kind === "image" &&
      typeof payload.draft_id === "string" &&
      typeof payload.version === "number"
    ) {
      await api(`/v1/brands/${brandId}/drafts/${payload.draft_id}/image`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: payload.version }),
      });
      return;
    }
    if (kind === "sync") {
      await api(`/v1/brands/${brandId}/integrations/refresh`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      return;
    }
    if (
      kind === "reply" &&
      typeof payload.conversation_id === "string" &&
      typeof payload.text === "string"
    ) {
      await api(
        `/v1/brands/${brandId}/conversations/${payload.conversation_id}/reply`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ text: payload.text }),
        },
      );
      return;
    }
    throw new Error("This integration is not available yet.");
  }
  const go = (id: Section) => {
    setSection(id);
    setMobile(false);
  };
  const command = (d: Draft, action: string) =>
    act(
      async () => {
        await rpc("sma_draft_action", {
          p_draft: d.id,
          p_action: action,
          p_version: d.approval_version,
          p_changes: {},
        });
      },
      action === "approve"
        ? "Approval saved. Follow the publishing job in Activity for its confirmed status."
        : "Content updated.",
    );
  function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!publicConfigValid(config.url, config.key)) {
      setError(
        "Enter an HTTPS Supabase URL and a publishable or anon key. Secret keys are not accepted.",
      );
      return;
    }
    localStorage.setItem("signaldesk.public-config", JSON.stringify(config));
    setClient(createClient(config.url, config.key));
    setError("");
  }
  if (!ready)
    return (
      <main className="auth-shell">
        <LoaderCircle className="spin" aria-label={t("Loading")} />
      </main>
    );
  if (!localMode && !client)
    return (
      <main className="auth-shell">
        <div className="auth-intro">
          <Logo />
          <span className="eyebrow">
            {t("A LITTLE STRUCTURE. MORE ROOM TO CREATE.")}
          </span>
          <h1>
            {t("Your ideas.")}
            <br />
            {t("Every channel.")}
            <br />
            <em>{t("One calm space.")}</em>
          </h1>
          <p>
            {t(
              "A home for your store, your business, or the next great AI news channel.",
            )}
          </p>
          <div className="auth-badges">
            <span>{t("Instagram")}</span>
            <span>{t("TikTok")}</span>
            <span>𝕏</span>
          </div>
        </div>
        <form className="auth-card" onSubmit={connect}>
          <span className="step-label">{t("WORKSPACE CONNECTION")}</span>
          <h2>{t("Welcome to Nabd")}</h2>
          <p>
            {t(
              "Connect the Supabase project that holds your workspace. Provider credentials remain on the application server.",
            )}
          </p>
          <label>
            {t("Project URL")}
            <input
              required
              type="url"
              value={config.url}
              placeholder={t("https://your-project.supabase.co")}
              onChange={(e) => setConfig({ ...config, url: e.target.value })}
            />
          </label>
          <label>
            {t("Publishable key")}
            <textarea
              required
              rows={3}
              value={config.key}
              placeholder={t("sb_publishable_…")}
              onChange={(e) => setConfig({ ...config, key: e.target.value })}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary">
            {t("Connect workspace")} <ArrowUpRight size={17} />
          </button>
          <small>
            {t(
              "Use the Supabase publishable key; private provider credentials never belong in this browser.",
            )}
          </small>
        </form>
      </main>
    );
  if (!localMode && !session)
    return (
      <main className="auth-shell">
        <div className="auth-intro">
          <Logo />
          <span className="eyebrow">{t("YOUR CONTENT HAS A HOME")}</span>
          <h1>
            {t("Good ideas deserve")}
            <br />
            <em>{t("a little momentum.")}</em>
          </h1>
          <p>{t("Plan, create, approve, and keep the conversation going.")}</p>
        </div>
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await client!.auth.signInWithOtp({
                email,
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: window.location.origin,
                },
              });
              if (r.error) throw r.error;
            }, "Check your email for the secure sign-in link.");
          }}
        >
          <span className="step-label">{t("OWNER ACCESS")}</span>
          <h2>{t("Welcome back")}</h2>
          <p>{t("Enter the approved owner email. Nabd will send a secure sign-in link—no password is needed.")}</p>
          <label>
            {t("Email")}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? t("Sending…") : t("Email me a sign-in link")} <ArrowUpRight size={16} />
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          <small>{t("Access is limited to approved workspace owners.")}</small>
        </form>
      </main>
    );
  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <button
          className="icon-button mobile-dismiss"
          aria-label={t("Close menu")}
          onClick={() => setMobile(false)}
        >
          <X size={18} />
        </button>
        <Logo />
        <div className="workspace-picker">
          <span className="workspace-avatar">
            {brand?.name.slice(0, 1) || t("S")}
          </span>
          <div>
            <select
              aria-label={t("Select workspace")}
              value={brandId}
              onChange={(e) => {
                epoch.current++;
                setData(empty);
                setBrandId(e.target.value);
              }}
            >
              {!brands.length && (
                <option value="">{t("Your workspace")}</option>
              )}
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <small>
              {brand
                ? t(labels[brand.workspace_type] || "Workspace")
                : t("Create your first workspace")}
            </small>
          </div>
        </div>
        <div className="nav-label">{t("WORKSPACE")}</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={section === n.id ? "nav-link active" : "nav-link"}
              onClick={() => go(n.id)}
            >
              <n.icon size={18} />
              {t(n.label)}
              {n.id === "content" && stats.review > 0 && (
                <span className="nav-count">{stats.review}</span>
              )}
            </button>
          ))}
        </nav>
        <button className="new-workspace" onClick={() => setModal("workspace")}>
          <Plus size={16} />
          {t("New workspace")}
        </button>
        <div className="sidebar-bottom">
          <div className="help-card">
            <Sparkles size={19} />
            <strong>{t("Keep your own voice.")}</strong>
            <p>{t("Every generated post waits for your approval.")}</p>
          </div>
          <div className="user-button">
            <span className="avatar">
              {(session?.user.email ?? "Local workspace")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span>
              <strong>
                {localMode ? t("Local access") : t("Workspace owner")}
              </strong>
              <small>{session?.user.email ?? t("Local workspace")}</small>
            </span>
          </div>
        </div>
      </aside>
      <section className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={t("Open menu")}
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            {t("Workspace")} <ChevronRight size={13} />
            <strong>{t(nav.find((n) => n.id === section)?.label ?? "")}</strong>
          </div>
          <div className="top-actions">
            <PreferencesControls
              onSidebarToggle={(hidden) => setMobile(!hidden)}
            />
            <span className="approval-indicator">
              <span />
              {t("Approval mode")}
            </span>
            <button
              className="icon-button"
              aria-label={t("Refresh data")}
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <span className="avatar dark">
              {(session?.user.email ?? "Local workspace")
                .slice(0, 1)
                .toUpperCase()}
            </span>
          </div>
        </header>
        <div className="page">
          {(notice || error) && (
            <div
              className={error ? "banner error" : "banner success"}
              role={error ? "alert" : "status"}
            >
              <span>{t(error || notice)}</span>
              <button
                aria-label={t("Dismiss notification")}
                onClick={() => {
                  setNotice("");
                  setError("");
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!brand && (loading || error) && (
            <div className="welcome-empty" role="status">
              <h1>{loading ? t("Loading your workspace…") : t("Workspace connection unavailable")}</h1>
              <p>{t("Your workspace could not be loaded yet. Retry the connection to see your saved content.")}</p>
              <button className="primary" disabled={loading} onClick={() => void refresh()}>
                <RefreshCw size={17} /> {t("Refresh data")}
              </button>
            </div>
          )}
          {!brand && !loading && !error && (
            <div className="welcome-empty">
              <span className="large-icon">
                <Sparkles />
              </span>
              <h1>{t("Make space for your next idea.")}</h1>
              <p>
                {t(
                  "Start with a store, a business, a personal brand, or a topic you love. No store or website is required.",
                )}
              </p>
              <button className="primary" onClick={() => setModal("workspace")}>
                <Plus size={17} />
                {t("Create your workspace")}
              </button>
            </div>
          )}
          {brand && (
            <div hidden={section !== "create"}>
              <GuidedStudio
                key={`${brand.id}:${postKnowledge?.brandId === brand.id ? postKnowledge.version : 0}`}
                initialKnowledgeId={
                  postKnowledge?.brandId === brand.id
                    ? postKnowledge.id
                    : undefined
                }
                openKnowledge={() => go("chat-knowledge")}
                brand={brand}
                drafts={data.drafts}
                assets={data.assets}
                jobs={data.jobs}
                accounts={data.accounts}
                knowledge={data.knowledge}
                api={api}
                refresh={refresh}
                dataLoaded={!!updated && !loading}
                openSources={() => go("knowledge")}
                openActivity={() => go("content")}
                checkConnections={() =>
                  void act(
                    () => queue("sync"),
                    "Connection check queued. Status updates when the provider responds.",
                  )
                }
              />
            </div>
          )}
          {brand && (
            <div hidden={section !== "channels"}>
              <AccountHub
                key={brand.id}
                accounts={data.accounts}
                drafts={data.drafts}
                assets={data.assets}
                busy={busy}
                onCreate={() => go("create")}
                onRefresh={() =>
                  void act(
                    () => queue("sync"),
                    "Connection check queued. Status updates when the provider responds.",
                  )
                }
              />
            </div>
          )}
          {brand && section === "calendar" && (
            <SaudiContentCalendar brandId={brand.id} api={api} busy={busy} refresh={refresh} />
          )}
          {brand && section === "overview" && (
            <>
              <Heading
                eyebrow={t("YOUR CREATIVE CONTROL ROOM")}
                title={t("A little momentum, every day")}
                text={`Here’s what’s happening with ${brand.name}.`}
                action={
                  <button
                    className="primary"
                    disabled={busy || brand.status === "paused"}
                    onClick={() => go("create")}
                  >
                    <Sparkles size={16} />
                    {t("Create content")}
                  </button>
                }
              />
              <section className="metrics">
                <Metric
                  title={t("Ready for review")}
                  value={stats.review}
                  detail={t("Waiting for your final touch")}
                  icon={FileText}
                  tone="orange"
                />
                <Metric
                  title={t("Publishing queue")}
                  value={stats.scheduled}
                  detail={t("Approved content")}
                  icon={CalendarDays}
                  tone="violet"
                />
                <Metric
                  title={t("Published posts")}
                  value={stats.published}
                  detail={t("Confirmed by your provider")}
                  icon={CheckCircle2}
                  tone="green"
                />
                <Metric
                  title={t("Needs attention")}
                  value={stats.attention + stats.failures}
                  detail={t("Questions and failed jobs")}
                  icon={Inbox}
                  tone="blue"
                />
              </section>
              <div className="overview-grid">
                <section className="panel">
                  <PanelHeader
                    title={t("On your content desk")}
                    text={t("Review your next posts.")}
                    action={
                      <button
                        className="text-button"
                        onClick={() => go("content")}
                      >
                        {t("View all")} <ArrowUpRight size={14} />
                      </button>
                    }
                  />
                  {data.drafts.length ? (
                    data.drafts.slice(0, 4).map((d) => (
                      <button
                        key={d.id}
                        className="draft-row"
                        onClick={() => go("content")}
                      >
                        <Platform platform={d.platform} />
                        <span className="row-body">
                          <strong>{d.caption}</strong>
                          <small>
                            {d.platform} · {d.language.toUpperCase()} ·{" "}
                            {date(d.scheduled_at)}
                          </small>
                        </span>
                        <Badge status={d.status} />
                        <ChevronRight size={15} />
                      </button>
                    ))
                  ) : (
                    <Empty
                      icon={FileText}
                      title={t("Your next post starts here")}
                      text={t(
                        "Add approved facts or source stories, then create your first batch.",
                      )}
                    />
                  )}
                </section>
                <section className="panel">
                  <PanelHeader
                    title={t("Connected channels")}
                    text={t("Your brand, across the conversation.")}
                  />
                  {["instagram", "tiktok", "x"].map((p) => {
                    const a = data.accounts.find((a) => a.provider === p);
                    return (
                      <div className="channel-row" key={p}>
                        <Platform platform={p} />
                        <span className="row-body">
                          <strong>
                            {p === "x"
                              ? t("X / Twitter")
                              : p[0].toUpperCase() + p.slice(1)}
                          </strong>
                          <small>
                            {a?.external_account_id
                              ? t("Channel linked")
                              : t("No verified channel yet")}
                          </small>
                        </span>
                        <Badge status={a?.connection_status || "unavailable"} />
                      </div>
                    );
                  })}
                  <button
                    className="full-text-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => queue("sync"),
                        "Verified provider check queued. Activity will show the result.",
                      )
                    }
                  >
                    {t("Verify connections")} <RefreshCw size={14} />
                  </button>
                </section>
              </div>
              <section className="workspace-summary">
                <span className="large-icon">
                  <Sparkles />
                </span>
                <div>
                  <span className="eyebrow">
                    {t(labels[brand.workspace_type] || "Brand workspace")}
                  </span>
                  <h2>{brand.name}</h2>
                  <p>
                    {brand.description ||
                      t(
                        "Add a description and your topics to guide the content agent.",
                      )}
                  </p>
                </div>
                <button className="secondary" onClick={() => go("knowledge")}>
                  {t("Shape your voice")} <ArrowUpRight size={16} />
                </button>
              </section>
              <div className="bottom-note">
                <span>
                  {brand.status === "paused"
                    ? t("Automation paused")
                    : t("Approval required before publishing")}
                </span>
                <span>
                  {updated ? `Updated ${date(updated)}` : t("Waiting for data")}{" "}
                  · {brand.timezone}
                </span>
              </div>
            </>
          )}
          {brand && section === "content" && (
            <>
              <Heading
                eyebrow={t("CREATE · REFINE · SHARE")}
                title={t("Your content studio")}
                text={t(
                  "Platform-specific ideas, with your perspective at the center.",
                )}
              />
              <div className="toolbar">
                <div className="tabs">
                  {[
                    "all",
                    "draft",
                    "approved",
                    "scheduled",
                    "published",
                    "failed",
                  ].map((s) => (
                    <button
                      key={s}
                      className={filter === s ? "selected" : ""}
                      onClick={() => setFilter(s)}
                    >
                      {s === "all"
                        ? t("All content")
                        : t(s[0].toUpperCase() + s.slice(1))}
                    </button>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={busy || brand.status === "paused"}
                  onClick={() => go("create")}
                >
                  <Sparkles size={16} />
                  {t("Create content")}
                </button>
              </div>
              <div className="content-grid">
                {data.drafts
                  .filter((d) => filter === "all" || d.status === filter)
                  .map((d) => {
                    const a = data.assets.find((a) => a.id === d.asset_id);
                    return (
                      <article className="content-card" key={d.id}>
                        <div className={`content-visual visual-${d.platform}`}>
                          {a?.preview_url ? (
                            <img
                              src={a.preview_url}
                              alt={d.visual_brief || "Post visual"}
                            />
                          ) : (
                            <div className="visual-placeholder">
                              <ImageIcon size={30} />
                              <span>
                                {d.visual_brief
                                  ? t("Visual awaiting generation")
                                  : t("Text-first content")}
                              </span>
                            </div>
                          )}
                          <span className="visual-platform">
                            <Platform platform={d.platform} />
                            {d.platform}
                          </span>
                          <Badge status={d.status} />
                        </div>
                        <div className="content-body">
                          <small className="eyebrow">
                            {d.language.toUpperCase()} · {date(d.scheduled_at)}
                          </small>
                          <p dir="auto">{d.caption}</p>
                          <div className="hashtags">
                            {d.hashtags?.join(" ")}
                          </div>
                          {d.platform === "tiktok" && (
                            <p className="muted">
                              {t("TikTok photo post · an image is required.")}
                            </p>
                          )}
                          <button
                            className="text-button"
                            onClick={() =>
                              void act(async () => {
                                await navigator.clipboard.writeText(d.caption);
                              }, "Caption copied.")
                            }
                          >
                            {t("Copy caption")}
                          </button>
                          {d.source_facts?.length > 0 && (
                            <details>
                              <summary>
                                {d.source_facts.length}{" "}
                                {t("supporting sources")}
                              </summary>
                              {d.source_facts.map((s, i) => (
                                <p key={i} className="source-fact">
                                  {data.knowledge.find((k) => k.id === s)
                                    ?.title || s}
                                </p>
                              ))}
                            </details>
                          )}
                          <div className="card-actions">
                            <button
                              className="secondary"
                              disabled={
                                busy ||
                                ["scheduled", "published"].includes(d.status)
                              }
                              onClick={() => setEditing(d)}
                            >
                              {t("Edit & schedule")}
                            </button>
                            {d.status === "draft" && (
                              <button
                                className="primary small"
                                disabled={busy || brand.status === "paused"}
                                title={t(
                                  "Approve this version and publish through Buffer",
                                )}
                                onClick={() => void command(d, "approve")}
                              >
                                <Check size={14} />
                                {d.scheduled_at
                                  ? t("Approve & schedule")
                                  : t("Approve & publish")}
                              </button>
                            )}
                            {["draft", "approved", "failed", "published", "cancelled"].includes(
                              d.status,
                            ) && (
                              <button
                                className="icon-button"
                                aria-label={t("Cancel post")}
                                disabled={busy}
                                onClick={() => void command(d, "cancel")}
                              >
                                <X size={16} />
                              </button>
                            )}
                          </div>
                          <button
                            className="text-button"
                            disabled={busy || d.status !== "draft"}
                            onClick={() =>
                              void act(
                                () =>
                                  queue("image", {
                                    draft_id: d.id,
                                    version: d.approval_version,
                                  }),
                                "Image generation queued.",
                              )
                            }
                          >
                            <ImageIcon size={14} />
                            {t("Generate visual")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>
              {!data.drafts.filter(
                (d) => filter === "all" || d.status === filter,
              ).length && (
                <section className="panel">
                  <Empty
                    icon={Sparkles}
                    title={t("A blank page is a good beginning")}
                    text={t(
                      "Create a batch for Instagram, TikTok, or X. Your drafts will appear here for review.",
                    )}
                  />
                </section>
              )}
            </>
          )}
          {brand && section === "knowledge" && (
            <>
              <Heading
                eyebrow={t("GIVE YOUR CONTENT SOMETHING TO SAY")}
                title={t("Knowledge & sources")}
                text={t(
                  "Approved facts keep your content accurate and unmistakably yours.",
                )}
              />
              <div className="toolbar">
                <span className="muted">
                  {
                    contentKnowledge.filter((k) => k.status === "approved")
                      .length
                  }{" "}
                  {t("approved items")}
                </span>
                <div className="button-row">
                  <span className="muted">
                    {t(
                      "Generated images are stored privately and appear here after you create them.",
                    )}
                  </span>
                  <button
                    className="primary"
                    onClick={() => setModal("knowledge")}
                  >
                    <Plus size={16} />
                    {t("Add knowledge")}
                  </button>
                </div>
              </div>
              {brand.workspace_type === "news" && (
                <>
                  <div className="info-panel">
                    <Globe2 size={20} />
                    <div>
                      <strong>
                        {t("Facts first. Your perspective second.")}
                      </strong>
                      <p>
                        {t(
                          "Add recent stories with original URLs and publication dates. The agent cites approved sources; it cannot treat its memory as current news.",
                        )}
                      </p>
                    </div>
                  </div>
                  <NewsSearch brandId={brand.id} api={api} onAdded={refresh} />
                </>
              )}
              <div className="knowledge-grid">
                {contentKnowledge.map((k) => (
                  <article className="panel knowledge-card" key={k.id}>
                    <div className="panel-title">
                      <span className="type-icon">
                        <FileText size={18} />
                      </span>
                      <Badge status={k.status} />
                    </div>
                    <small className="eyebrow">{t(k.type)}</small>
                    <h3>{k.title}</h3>
                    <p>{k.content}</p>
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
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                api(
                                  `/v1/brands/${brandId}/knowledge/${k.id}/approve`,
                                  { method: "POST" },
                                ),
                              "Knowledge approved.",
                            )
                          }
                        >
                          {t("Approve fact")}
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              api(
                                `/v1/brands/${brandId}/knowledge/${k.id}/archive`,
                                { method: "POST" },
                              ),
                            "Knowledge archived.",
                          )
                        }
                      >
                        {t("Archive")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!contentKnowledge.length && (
                <section className="panel">
                  <Empty
                    icon={FileText}
                    title={t("Build a reliable foundation")}
                    text={t(
                      "Add FAQs, product details, your writing style, or verified stories about the topics you cover.",
                    )}
                  />
                </section>
              )}
              <section className="asset-library panel">
                <div className="panel-head"><div><span className="eyebrow">{t("VISUAL LIBRARY")}</span><h2>{t("Brand assets")}</h2><p>{t("Product references and generated campaigns, kept separate for a clearer library.")}</p></div><span className="badge">{data.assets.length} {t("assets")}</span></div>
                <h3 className="asset-group-title">{t("Product references")}</h3>
                <div className="asset-grid product-assets">
                {data.assets.filter((a) => a.asset_type !== "generated").map((a) => (
                  <article key={a.id} className="asset-card">
                    {a.preview_url ? (
                      <img
                        src={a.preview_url}
                        alt={String(a.metadata?.name || a.asset_type)}
                      />
                    ) : (
                      <ImageIcon />
                    )}
                    <small>{String(a.metadata?.name || a.asset_type)}</small>
                  </article>
                ))}
                {!data.assets.some((a) => a.asset_type !== "generated") && <p className="muted">{t("No product references yet.")}</p>}
                </div>
                <h3 className="asset-group-title">{t("Generated campaigns")}</h3>
                <div className="asset-grid generated-assets">
                {data.assets.filter((a) => a.asset_type === "generated").map((a) => (
                  <article key={a.id} className="asset-card">
                    {a.preview_url ? <img src={a.preview_url} alt={String(a.metadata?.poster_style || t("Generated campaign"))} /> : <ImageIcon />}
                    <small>{String(a.metadata?.poster_style || t("Generated campaign"))}</small>
                  </article>
                ))}
                {!data.assets.some((a) => a.asset_type === "generated") && <p className="muted">{t("Your generated campaigns will appear here.")}</p>}
                </div>
              </section>
            </>
          )}
          {brand && section === "inbox" && (
            <AiInbox
              key={brand.id}
              brand={brand}
              conversations={data.conversations}
              messages={data.messages}
              replyDrafts={data.replyDrafts}
              knowledge={data.knowledge}
              jobs={data.jobs}
              api={api}
              refresh={refresh}
              openLibrary={() => go("chat-knowledge")}
            />
          )}
          {brand && section === "chat-knowledge" && (
            <ChatKnowledge
              key={brand.id}
              brandId={brand.id}
              items={data.knowledge}
              jobs={data.jobs}
              api={api}
              refresh={refresh}
              onCreatePost={createFromKnowledge}
            />
          )}
          {brand && section === "results" && (
            <>
              <Heading
                eyebrow={t("A CLEAR VIEW OF WHAT HAPPENED")}
                title={t("Activity & results")}
                text={t(
                  "Real job outcomes. No estimated numbers or sample analytics.",
                )}
              />
              <section className="metrics">
                <Metric
                  title={t("Published")}
                  value={stats.published}
                  detail={t("Confirmed posts")}
                  icon={Send}
                  tone="green"
                />
                <Metric
                  title={t("Impressions")}
                  value={
                    impressions.length
                      ? impressions.reduce((a, b) => a + b, 0)
                      : "—"
                  }
                  detail={
                    impressions.length
                      ? "Provider totals for loaded posts"
                      : "No provider metrics yet"
                  }
                  icon={Activity}
                  tone="violet"
                />
                <Metric
                  title={t("Processing")}
                  value={
                    data.jobs.filter((j) => j.status === "processing").length
                  }
                  detail={t("Jobs currently running")}
                  icon={RefreshCw}
                  tone="blue"
                />
                <Metric
                  title={t("Needs review")}
                  value={stats.failures}
                  detail={t("Failed or uncertain outcomes")}
                  icon={Inbox}
                  tone="orange"
                />
              </section>
              <section className="panel">
                <PanelHeader
                  title={t("Automation activity")}
                  text={t("The latest 50 durable jobs in this workspace.")}
                />
                {data.jobs.map((j) => (
                  <div key={j.id} className="job-row">
                    <span className="job-icon">
                      <Activity size={17} />
                    </span>
                    <span className="row-body">
                      <strong>{j.kind.replaceAll("_", " ")}</strong>
                      <small>
                        {j.error_summary || `Updated ${date(j.updated_at)}`}
                      </small>
                    </span>
                    <Badge status={j.status} />
                    <time>{date(j.created_at)}</time>
                  </div>
                ))}
                {!data.jobs.length && (
                  <Empty
                    icon={Activity}
                    title={t("Your activity will appear here")}
                    text={t("Generate content to begin tracking real work.")}
                  />
                )}
              </section>
            </>
          )}
          {brand && section === "settings" && (
            <>
              <Heading
                eyebrow={t("MAKE THIS SPACE YOURS")}
                title={t("Workspace settings")}
                text={t(
                  "Your focus, your audience, and the pace that works for you.",
                )}
              />
              <form
                key={brand.id + brand.updated_at}
                className="panel settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await rpc("sma_update_workspace", {
                      p_brand: brandId,
                      p_changes: {
                        name: f.get("name"),
                        description: f.get("description"),
                        workspace_type: f.get("workspace_type"),
                        topics: String(f.get("topics"))
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        audience: f.get("audience"),
                        daily_generation: f.get("daily_generation") === "on",
                      },
                    });
                  }, "Workspace settings saved.");
                }}
              >
                <div className="form-grid">
                  <label>
                    {t("Workspace name")}
                    <input
                      name="name"
                      required
                      maxLength={100}
                      defaultValue={brand.name}
                    />
                  </label>
                  <label>
                    {t("Workspace type")}
                    <select
                      name="workspace_type"
                      defaultValue={brand.workspace_type}
                    >
                      {workspaceTypes.map((t) => (
                        <option key={t} value={t}>
                          {translateLabel(labels[t])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="span-two">
                    {t("What is it about?")}
                    <textarea
                      name="description"
                      maxLength={3000}
                      defaultValue={brand.description}
                    />
                  </label>
                  <label>
                    {t("Topics")}
                    <input
                      name="topics"
                      defaultValue={brand.topics?.join(", ")}
                      placeholder={t("AI news, tools, research")}
                    />
                  </label>
                  <label>
                    {t("Audience")}
                    <input
                      name="audience"
                      maxLength={500}
                      defaultValue={brand.audience}
                    />
                  </label>
                </div>
                <label className="checkbox">
                  <input
                    name="daily_generation"
                    type="checkbox"
                    defaultChecked={brand.daily_generation}
                  />
                  {t("Generate a daily draft batch at 08:00 Asia/Riyadh")}
                </label>
                <button className="primary" disabled={busy}>
                  {t("Save changes")} <Check size={16} />
                </button>
              </form>
              <section className="panel pause-panel">
                <div>
                  <h3>
                    {brand.status === "paused"
                      ? t("Automation is paused")
                      : t("Automation controls")}
                  </h3>
                  <p>
                    {t(
                      "Pause prevents new generation, publishing, and replies from being claimed. Jobs already in flight may finish.",
                    )}
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      async () => {
                        await rpc("sma_update_workspace", {
                          p_brand: brandId,
                          p_changes: {
                            status:
                              brand.status === "paused" ? "approved" : "paused",
                          },
                        });
                      },
                      brand.status === "paused"
                        ? "Automation resumed."
                        : "Automation paused.",
                    )
                  }
                >
                  {brand.status === "paused" ? (
                    <Play size={16} />
                  ) : (
                    <Pause size={16} />
                  )}{" "}
                  {brand.status === "paused"
                    ? t("Resume")
                    : t("Pause automation")}
                </button>
              </section>
              <section className="panel">
                <PanelHeader
                  title={t("Publishing channels")}
                  text={t(
                    "Connect channels after their provider credentials have passed verification.",
                  )}
                />
                {data.accounts.map((a) => (
                  <div className="channel-row" key={a.id}>
                    <Platform platform={a.provider} />
                    <span className="row-body">
                      <strong>{a.provider}</strong>
                      <small>
                        {t("Last verified:")} {date(a.last_checked_at)}
                      </small>
                    </span>
                    <Badge status={a.connection_status} />
                  </div>
                ))}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => queue("sync"),
                      "Verified provider check queued.",
                    )
                  }
                >
                  <RefreshCw size={15} />
                  {t("Verify connections")}
                </button>
                <p className="muted">
                  {t(
                    "Instagram inbox sync and Buffer publishing appear only after their provider check confirms the connected channels.",
                  )}
                </p>
              </section>
            </>
          )}
        </div>
      </section>
      {modal && (
        <Modal
          title={
            modal === "workspace"
              ? "Start something worth sharing"
              : modal === "generate"
                ? "What should we create?"
                : "Add a reliable source"
          }
          close={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(
                async () => {
                  if (modal === "workspace") {
                    const id = await rpc("sma_create_workspace", {
                      p_name: f.get("name"),
                      p_type: f.get("workspace_type"),
                      p_description: f.get("description"),
                      p_topics: String(f.get("topics"))
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      p_audience: f.get("audience"),
                      p_languages: [String(f.get("language"))],
                    });
                    setBrandId(id);
                  } else if (modal === "knowledge") {
                    await api(`/v1/brands/${brandId}/knowledge`, {
                      method: "POST",
                      body: JSON.stringify({
                        type: f.get("type"),
                        title: f.get("title"),
                        content: f.get("content"),
                        source: f.get("source") || "",
                      }),
                    });
                  } else {
                    await queue("generate", {
                      brief: f.get("brief"),
                      platforms: f.getAll("platform"),
                      language: f.get("language"),
                    });
                  }
                  setModal(null);
                },
                modal === "generate"
                  ? "Generation queued. Drafts will appear after the custom worker completes the job."
                  : "Saved successfully.",
              );
            }}
          >
            {modal === "workspace" && (
              <>
                <label>
                  {t("Workspace name")}
                  <input
                    name="name"
                    required
                    maxLength={100}
                    placeholder={t("e.g. The AI Edit")}
                  />
                </label>
                <label>
                  {t("What are you building?")}
                  <select name="workspace_type" defaultValue="news">
                    {workspaceTypes.map((t) => (
                      <option key={t} value={t}>
                        {translateLabel(labels[t])}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Description")}
                  <textarea
                    name="description"
                    required
                    maxLength={3000}
                    placeholder={t(
                      "AI developments, explained in a useful, approachable way.",
                    )}
                  />
                </label>
                <label>
                  {t("Topics (comma separated)")}
                  <input
                    name="topics"
                    placeholder={t("AI news, tools, research")}
                  />
                </label>
                <label>
                  {t("Who is it for?")}
                  <input
                    name="audience"
                    maxLength={500}
                    placeholder={t("Curious founders and creators")}
                  />
                </label>
                <label>
                  {t("Language")}
                  <select name="language">
                    <option value="en">{t("English")}</option>
                    <option value="ar">{t("Arabic")}</option>
                  </select>
                </label>
                <p className="muted">
                  {t("No online store or website required.")}
                </p>
              </>
            )}
            {modal === "generate" && (
              <>
                <p className="muted">
                  {t(
                    "Uses your approved knowledge. Add current stories first when covering news.",
                  )}
                </p>
                <label>
                  {t("Creative direction")}
                  <textarea
                    name="brief"
                    required
                    maxLength={2000}
                    placeholder={t(
                      "Explain a useful AI update for busy founders. Keep it clear, grounded, and conversational.",
                    )}
                  />
                </label>
                <fieldset>
                  <legend>{t("Platforms")}</legend>
                  {["instagram", "tiktok", "x"].map((p) => (
                    <label className="checkbox" key={p}>
                      <input
                        type="checkbox"
                        name="platform"
                        value={p}
                        defaultChecked={p === "x"}
                      />
                      {p === "x" ? t("X / Twitter") : p}
                    </label>
                  ))}
                </fieldset>
                <label>
                  {t("Language")}
                  <select
                    name="language"
                    defaultValue={brand?.languages?.[0] || "en"}
                  >
                    <option value="en">{t("English")}</option>
                    <option value="ar">{t("Arabic")}</option>
                  </select>
                </label>
                <div className="info-panel compact">
                  <CheckCircle2 size={17} />
                  <p>
                    {t(
                      "Creates drafts only. Review before anything is published.",
                    )}
                  </p>
                </div>
              </>
            )}
            {modal === "knowledge" && (
              <>
                <label>
                  {t("Type")}
                  <select
                    name="type"
                    defaultValue={
                      brand?.workspace_type === "news"
                        ? "source"
                        : "instruction"
                    }
                  >
                    {[
                      "source",
                      "instruction",
                      "faq",
                      "product",
                      "policy",
                      "design",
                    ].map((t) => (
                      <option key={t} value={t}>
                        {translateLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Title")}
                  <input name="title" required maxLength={200} />
                </label>
                <label>
                  {t("Facts, excerpt, or instructions")}
                  <textarea
                    name="content"
                    required
                    rows={6}
                    maxLength={12000}
                    placeholder={t(
                      "For news: include the publication date and verified facts. For brand rules: describe your tone and visual style.",
                    )}
                  />
                </label>
                <label>
                  {t("Original source URL (optional)")}
                  <input
                    name="source"
                    type="url"
                    placeholder={t("https://…")}
                  />
                </label>
                <p className="muted">
                  {t("Saved as a draft. Approve after checking accuracy.")}
                </p>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
              >
                {t("Cancel")}
              </button>
              <button className="primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}{" "}
                {modal === "generate" ? t("Generate drafts") : t("Save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={t("Make it sound like you")}
          close={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                await rpc("sma_draft_action", {
                  p_draft: editing.id,
                  p_action: "edit",
                  p_version: editing.approval_version,
                  p_changes: {
                    caption: f.get("caption"),
                    ...(f.get("asset_id")
                      ? { assetId: f.get("asset_id") }
                      : {}),
                    scheduledAt: f.get("scheduled_at")
                      ? new Date(String(f.get("scheduled_at"))).toISOString()
                      : null,
                  },
                });
                setEditing(null);
              }, "Saved as a new draft. Review and approve the edited version.");
            }}
          >
            <label>
              {t("Caption")}
              <textarea
                name="caption"
                required
                rows={7}
                maxLength={editing.platform === "x" ? 280 : 2200}
                defaultValue={editing.caption}
              />
            </label>
            <label>
              {t("Post image")}
              <select name="asset_id" defaultValue={editing.asset_id || ""}>
                <option value="">{t("Keep current image")}</option>
                {data.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {String(a.metadata?.name || a.asset_type)} ·{" "}
                    {a.id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Publish time (your local timezone)")}
              <input
                name="scheduled_at"
                type="datetime-local"
                defaultValue={
                  editing.scheduled_at
                    ? new Date(
                        new Date(editing.scheduled_at).getTime() -
                          new Date(editing.scheduled_at).getTimezoneOffset() *
                            60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
              />
            </label>
            <p className="muted">
              {t(
                "Editing resets approval. Leave the time empty to publish after approval.",
              )}
            </p>
            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setEditing(null)}
              >
                {t("Cancel")}
              </button>
              <button className="primary" disabled={busy}>
                {t("Save draft")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
function Logo() {
  const { t } = useLanguage();
  return (
    <div className="brand">
      <img className="brand-logo" src="/signaldesk-logo.png" alt={t("Nabd")} />
      <strong>{t("Nabd")}</strong>
    </div>
  );
}
function Platform({ platform }: { platform: string }) {
  return (
    <span className={`platform ${platform}`}>
      {platform === "instagram" ? "◎" : platform === "tiktok" ? "♪" : "𝕏"}
    </span>
  );
}
function Badge({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span className={`badge ${status}`}>
      <span />
      {t(status.replaceAll("_", " "))}
    </span>
  );
}
function Metric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number | string;
  detail: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <article className="metric">
      <div className="metric-top">
        <span>{title}</span>
        <span className={`metric-icon ${tone}`}>
          <Icon size={17} />
        </span>
      </div>
      <strong>
        {typeof value === "number" ? value.toLocaleString() : value}
      </strong>
      <small>{detail}</small>
    </article>
  );
}
function Heading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>
          {title}
          <span className="orange-dot">.</span>
        </h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function PanelHeader({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Activity;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={close}>
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("Close dialog")}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
