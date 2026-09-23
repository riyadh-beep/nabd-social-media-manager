"use client";
import { BookOpen, Search } from "lucide-react";
import type { Knowledge } from "../lib/model";
import { useLanguage } from "./preferences";

export function KnowledgePicker({items,selected,search,onSearch,onChange,openLibrary}:{items:Knowledge[];selected:string[];search:string;onSearch:(value:string)=>void;onChange:(ids:string[])=>void;openLibrary:()=>void}) {
  const {t}=useLanguage();
  const visible=items.filter(item=>item.status!=="archived" && `${item.title} ${item.content}`.toLowerCase().includes(search.toLowerCase()));
  return <fieldset className="post-knowledge-picker">
    <legend><BookOpen size={17}/>{t("Choose knowledge for this post")}</legend>
    <p>{t("Select facts from AI knowledge or Sources. Only selected items will be used.")}</p>
    <div className="knowledge-picker-tools"><label><Search size={16}/><input type="search" aria-label={t("Find knowledge")} placeholder={t("Search titles or facts…")} value={search} onChange={e=>onSearch(e.target.value)}/></label><button type="button" className="text-button" onClick={openLibrary}>{t("Open AI knowledge")}</button></div>
    <div className="knowledge-picker-list">{visible.map(item=><label aria-label={item.title} htmlFor={`post-knowledge-${item.id}`} key={item.id} className={selected.includes(item.id)?"knowledge-choice chosen":"knowledge-choice"}>
      <input id={`post-knowledge-${item.id}`} type="checkbox" checked={selected.includes(item.id)} disabled={item.status!=="approved" || (selected.length>=50&&!selected.includes(item.id))} onChange={e=>onChange(e.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))}/>
      <span><strong dir="auto">{item.title}</strong><small>{t(item.scope==="chat"?"AI knowledge":"Sources")} · {t(item.status==="approved"?"Approved":"Approve first")}</small><span className="knowledge-excerpt" dir="auto">{item.content.slice(0,160)}</span></span>
    </label>)}</div>
    {!visible.length&&<p role="status">{t(items.length?"No matching knowledge. Try another search.":"Add knowledge to your library, then approve it here.")}</p>}
    <div className="knowledge-picker-footer"><span role="status">{selected.length}/50 {t("selected")}</span><button type="button" className="text-button" disabled={!selected.length} onClick={()=>onChange([])}>{t("Clear selection")}</button></div>
    <small>{t("Select at least one approved item. Your idea above is optional when knowledge is selected.")}</small>
  </fieldset>;
}
