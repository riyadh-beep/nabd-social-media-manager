"use client";
import {useRef,useState} from "react";
import {ImagePlus,LoaderCircle,Trash2} from "lucide-react";
import type {Knowledge} from "../lib/model";
import {useLanguage} from "./preferences";

export function KnowledgePhotos({item,brandId,api,refresh}:{item:Knowledge;brandId:string;api:(path:string,init?:RequestInit)=>Promise<Record<string,unknown>>;refresh:()=>Promise<void>}){
  const {t}=useLanguage();const [busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[error,setError]=useState("");
  const input=useRef<HTMLInputElement>(null),lock=useRef(false);const photos=item.photos??[];
  async function upload(files:File[]){
    if(lock.current||!files.length)return;
    if(files.length+photos.length>7){setError(t("Each knowledge item supports up to 7 photos."));return;}
    if(files.some(file=>!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024)){setError(t("Use JPG, PNG, or WebP files, up to 5 MB each."));return;}
    lock.current=true;setBusy(true);setError("");let uploaded=0;
    try{
      for(const file of files){setProgress(`${t("Uploading photo")} ${uploaded+1}/${files.length}`);await api(`/v1/brands/${brandId}/knowledge/${item.id}/photos`,{method:"POST",headers:{"Content-Type":file.type},body:file});uploaded++;}
      setProgress(t("Photos saved. Choose one in Create to use it in a post."));
    }catch(e){setError(`${uploaded}/${files.length} ${t("photos saved")}. ${e instanceof Error?e.message:t("Upload failed. Try again.")}`);}
    finally{await refresh();setBusy(false);lock.current=false;if(input.current)input.current.value="";}
  }
  async function remove(id:string){if(lock.current)return;lock.current=true;setBusy(true);setError("");try{await api(`/v1/brands/${brandId}/knowledge/${item.id}/photos/${id}`,{method:"DELETE"});await refresh();}catch(e){setError(e instanceof Error?e.message:t("Could not remove photo"));}finally{setBusy(false);lock.current=false;}}
  return <section className="knowledge-photos" aria-label={t("Product photos")}>
    <div className="photo-heading"><strong>{t("Product photos")}</strong><small>{photos.length}/7</small></div>
    {!!photos.length&&<div className="product-photo-grid">{photos.map(photo=><figure key={photo.id}>
      {photo.preview_url?<a href={photo.preview_url} target="_blank" rel="noreferrer"><img loading="lazy" src={photo.preview_url} alt={`${item.title} · ${t("Product photo")} ${photo.slot}`}/></a>:<span>{t("Preview unavailable")}</span>}
      <button type="button" className="photo-remove" disabled={busy} aria-label={`${t("Remove photo")} ${photo.slot}`} onClick={()=>void remove(photo.id)}><Trash2 size={14}/></button>
    </figure>)}</div>}
    <input ref={input} hidden tabIndex={-1} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label={t("Upload product photos")} onChange={event=>void upload(Array.from(event.target.files??[]))}/>
    <button type="button" className="secondary" disabled={busy||photos.length>=7} onClick={()=>input.current?.click()}>{busy?<LoaderCircle size={16} className="spin"/>:<ImagePlus size={16}/>} {t("Add photos")}</button>
    <small>{t("Up to 7 photos · JPG, PNG, WebP · 5 MB each")}</small>
    <small>{t("Private until you approve a post. Removing a photo here keeps existing drafts intact.")}</small>
    {progress&&<p className="muted" role="status">{progress}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
