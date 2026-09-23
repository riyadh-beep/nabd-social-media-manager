import { ArrowUpRight, Camera, MessageCircle, Music2, RefreshCw } from "lucide-react";
import { useLanguage } from "./preferences";
import type { Account } from "../lib/model";
import { accountState, socialProfiles } from "../lib/studio";

export function SocialIcon({ platform }: { platform: string }) {
  return <span className={`social-icon social-${platform}`}>{platform === "instagram" ? <Camera size={22} /> : platform === "tiktok" ? <Music2 size={22} /> : <span className="x-mark">𝕏</span>}</span>;
}

export function SocialChannels({ accounts, onRefresh, busy = false, compact = false }: { accounts: Account[]; onRefresh: () => void; busy?: boolean; compact?: boolean }) {
 const {t}=useLanguage();
  const active = accounts.filter(account => accountState(account).active).length;
  return <section className={`social-section ${compact ? "compact-social" : ""}`} aria-label={t("Social accounts")}>
    <div className="section-heading"><div><span className="eyebrow">{t("YOUR SOCIAL SPACE")}</span><h2>{t("Your channels")}{" "}<span className="count-pill">{active}{" "}{t("active")}</span></h2></div><button className="text-button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} />{t("Check connections")}</button></div>
    <div className="social-grid">{socialProfiles.map(profile => {
      const account = accounts.find(item => item.provider === profile.id), status = accountState(account);
      return <article className={`social-card ${profile.id}`} key={profile.id}>
        <div className="social-card-top"><SocialIcon platform={profile.id} /><span className={`live-status ${status.active ? "is-active" : ""}`}><i />{t(status.label)}</span></div>
        <h3>{t(profile.name)}</h3><a href={profile.url} target="_blank" rel="noreferrer" className="profile-link">{profile.handle}<ArrowUpRight size={15} /></a>
        <div className="channel-capabilities"><span>{account?.connection_metadata?.buffer_channel_id ? t("Publishing · Buffer") : t("Publishing not connected")}</span>{profile.id === "instagram" && <span><MessageCircle size={12} />{account?.connection_metadata?.unipile_account_id ? t("Inbox connected") : t("Inbox not connected")}</span>}</div>
        {!compact && <small className="connection-time">{account?.last_checked_at ? `Checked ${new Date(account.last_checked_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : t("Check connections to verify this channel.")}</small>}
      </article>;
    })}</div>
    {!compact && <p className="muted channel-note">{t("Active reflects the latest provider connection check, not whether someone is currently online. Profile links are the accounts you supplied.")}</p>}
  </section>;
}
