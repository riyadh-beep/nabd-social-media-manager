"use client";
import { useLanguage } from "./preferences";
import { useState } from "react";
import { ArrowUpRight, CheckCircle2, ExternalLink, Globe2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import type { Account, Asset, Draft } from "../lib/model";
import { accountState, socialProfiles, type PlatformId } from "../lib/studio";
import { SocialIcon } from "./social-channels";

const tiktokDocument='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;background:#fff;font:14px system-ui}blockquote{max-width:100%!important;min-width:0!important;margin:auto!important}</style></head><body><blockquote class="tiktok-embed" cite="https://www.tiktok.com/@riyadhmabda" data-unique-id="riyadhmabda" data-embed-type="creator"><section><a target="_blank" rel="noreferrer" href="https://www.tiktok.com/@riyadhmabda">@riyadhmabda</a></section></blockquote><script async src="https://www.tiktok.com/embed.js"></script></body></html>';

export function AccountHub({ accounts, drafts, assets, busy, onRefresh, onCreate }: { accounts: Account[]; drafts: Draft[]; assets: Asset[]; busy: boolean; onRefresh: () => void; onCreate: () => void }) {
  const {t}=useLanguage();
  const [selected,setSelected]=useState<PlatformId>("instagram");
  const [previewVersion,setPreviewVersion]=useState(0);
  const [livePreview,setLivePreview]=useState(true);
  function changeTab(index:number){const item=socialProfiles[(index+socialProfiles.length)%socialProfiles.length];setSelected(item.id);document.getElementById(`account-tab-${item.id}`)?.focus();}
  return <section className="account-hub">
    <header className="account-hero"><div><span className="eyebrow">{t("YOUR SOCIAL WORLD")}</span><h1>{t("Your accounts, ready when you are")}</h1><p>{t("Switch instantly between saved account views. Open the full account to browse your live feed and messages.")}</p></div><span className="account-hero-mark"><Globe2 size={64}/></span></header>
    <div className="account-tabs" role="tablist" aria-label={t("Choose a social account")}>{socialProfiles.map((item,index)=>{const status=accountState(accounts.find(account=>account.provider===item.id));return <button key={item.id} id={`account-tab-${item.id}`} role="tab" tabIndex={selected===item.id?0:-1} aria-controls={`account-panel-${item.id}`} aria-selected={selected===item.id} onClick={()=>setSelected(item.id)} onKeyDown={event=>{if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();changeTab(index+(event.key==="ArrowRight"?1:-1));}if(event.key==="Home"){event.preventDefault();changeTab(0);}if(event.key==="End"){event.preventDefault();changeTab(2);}}}><SocialIcon platform={item.id}/><span><strong>{t(item.name)}</strong><small>{item.handle}</small></span><i className={status.active?"connected-dot":"disconnected-dot"}/></button>;})}</div>
    {socialProfiles.map(profile=>{
      const account=accounts.find(item=>item.provider===profile.id),state=accountState(account);
      const recent=drafts.filter(draft=>draft.platform===profile.id&&["approved","scheduled","published"].includes(draft.status));
      const published=recent.filter(draft=>draft.status==="published");
      return <div key={profile.id} hidden={selected!==profile.id} role="tabpanel" id={`account-panel-${profile.id}`} aria-labelledby={`account-tab-${profile.id}`}>
      <div className="account-workspace">
        <section className="profile-window account-snapshot">
          <div className="profile-window-bar"><span><Globe2 size={14}/>{new URL(profile.url).hostname}/{profile.handle}</span><a className="primary" href={profile.url} target="_blank" rel="noreferrer">{t("Open in browser")} <ExternalLink size={15}/></a></div>
          <div className="profile-summary"><SocialIcon platform={profile.id}/><div><h2>{profile.handle}</h2><p>{t(profile.name)} · {published.length} {t("posts published through Nabd")}</p></div><span className="badge">{t(state.active?"Connected":"Check connection")}</span></div>
          <p className="profile-help">{t("This is your saved account portal. Open in browser shows the real profile exactly as it opens when you paste its link in Chrome, including your signed-in feed, messages, followers, and account tools.")}</p>
          {profile.id==="tiktok"&&<div className="profile-view-controls"><button className="secondary" aria-pressed={livePreview} onClick={()=>setLivePreview(value=>!value)}>{t(livePreview?"Show saved posts":"Show TikTok live preview")}</button><button className="icon-button" aria-label={t("Reload profile preview")} onClick={()=>setPreviewVersion(value=>value+1)}><RefreshCw size={16}/></button></div>}
          {profile.id==="tiktok"&&<div hidden={!livePreview}><iframe key={previewVersion} title="TikTok profile preview" srcDoc={tiktokDocument} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="strict-origin-when-cross-origin" className="profile-frame"/><p className="profile-disclaimer">{t("If the preview is unavailable, use Open full account.")}</p></div>}
          <div hidden={profile.id==="tiktok"&&livePreview}>
            {published.length?<div className="account-post-grid">{published.slice(0,9).map((draft,index)=>{const asset=assets.find(asset=>asset.id===draft.asset_id);return <article key={draft.id}>
              {asset?.preview_url?<img src={asset.preview_url} loading={index<3?"eager":"lazy"} alt={draft.visual_brief||t("Published post")}/>:<div className="post-text-cover"><SocialIcon platform={profile.id}/><p dir="auto">{draft.caption}</p></div>}
              <div><p dir="auto">{draft.caption}</p>{draft.external_post_url&&/^https:\/\//.test(draft.external_post_url)?<a href={draft.external_post_url} target="_blank" rel="noreferrer">{t("View published post")} <ArrowUpRight size={14}/></a>:<a href={profile.url} target="_blank" rel="noreferrer">{t("View on profile")} <ArrowUpRight size={14}/></a>}</div>
            </article>;})}</div>:<div className="account-empty"><SocialIcon platform={profile.id}/><h3>{t("Your full account is one click away")}</h3><p>{t("No published posts are tracked here yet. Your social account may contain other posts.")}</p><a className="secondary" href={profile.url} target="_blank" rel="noreferrer">{t("Open full account")} <ArrowUpRight size={16}/></a></div>}
          </div>
        </section>
        <aside className="account-details"><section className="panel"><div className="account-status-heading"><ShieldCheck size={21}/><h2>{t("Connection health")}</h2></div><div className="health-line"><span>{t("Publishing")}</span><strong>{t(state.active&&account?.connection_metadata?.buffer_channel_id?"Connected":"Check connection")}</strong></div><div className="health-line"><span>{t("Format")}</span><strong>{t(profile.id==="x"?"Text or image":"Photo post")}</strong></div>{profile.id==="instagram"&&<div className="health-line"><span>{t("Instagram inbox")}</span><strong>{t(account?.connection_metadata?.unipile_account_id?"Connected":"Not connected")}</strong></div>}<p className="muted">{t("Saved connection status")} · {account?.last_checked_at?new Date(account.last_checked_at).toLocaleString():t("No provider check yet.")}</p><button className="secondary" disabled={busy} onClick={onRefresh}><RefreshCw size={14}/>{t("Check connections")}</button></section>
        <section className="panel"><div className="account-status-heading"><Send size={20}/><h2>{t("Publishing activity")}</h2></div>{recent.slice(0,5).map(draft=><article className="account-post" key={draft.id}><span>{draft.status==="published"?<CheckCircle2 size={14}/>:<Send size={14}/>} {t(draft.status==="approved"?"Sending to Buffer":draft.status)}</span><p dir="auto">{draft.caption}</p></article>)}<button className="primary" onClick={onCreate}>{t("Create a post")} <ArrowUpRight size={15}/></button></section></aside>
      </div></div>;
    })}
  </section>;
}
