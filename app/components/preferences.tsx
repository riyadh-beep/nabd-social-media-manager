"use client";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Moon, Sun, PanelLeftClose, PanelLeftOpen, Languages } from 'lucide-react';
import { arabic } from '../lib/arabic';
type Preferences={language:'en'|'ar';theme:'light'|'dark';collapsed:boolean};
type UI=Preferences&{set:(value:Partial<Preferences>)=>void;t:(text:string)=>string};
const Context=createContext<UI>({language:'en',theme:'light',collapsed:false,set:()=>{},t:text=>text});
const defaults:Preferences={language:'en',theme:'light',collapsed:false};
const subscribe=()=>()=>{};
function initialPreferences():Preferences{if(typeof window==='undefined')return defaults;let next:Preferences={...defaults,theme:window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'};try{const saved=JSON.parse(localStorage.getItem('nabd.preferences')||'null');if(saved)next={language:saved.language==='ar'?'ar':'en',theme:saved.theme==='dark'?'dark':'light',collapsed:saved.collapsed===true};}catch{/* Ignore invalid local preferences. */}return next;}
export function PreferencesProvider({children}:{children:ReactNode}){
 const [saved,setPreferences]=useState<Preferences>(initialPreferences);
 const loaded=useSyncExternalStore(subscribe,()=>true,()=>false);
 const preferences=loaded?saved:defaults;
 useEffect(()=>{if(!loaded)return;document.documentElement.lang=preferences.language;document.documentElement.dir=preferences.language==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=preferences.theme;document.documentElement.dataset.sidebar=preferences.collapsed?'hidden':'visible';localStorage.setItem('nabd.preferences',JSON.stringify(preferences));},[preferences,loaded]);
 const value=useMemo<UI>(()=>({...preferences,set:patch=>setPreferences(previous=>({...previous,...patch})),t:text=>preferences.language==='ar'?(arabic[text]??text):text}),[preferences]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useLanguage=()=>useContext(Context);
export function PreferencesControls({onSidebarToggle}:{onSidebarToggle?:(hidden:boolean)=>void}){const {language,theme,collapsed,set,t}=useLanguage();return <div className="preferences-controls"><button className="icon-button" title={t(collapsed?'Show sidebar':'Hide sidebar')} aria-label={t(collapsed?'Show sidebar':'Hide sidebar')} aria-expanded={!collapsed} onClick={()=>{set({collapsed:!collapsed});onSidebarToggle?.(!collapsed);}}>{collapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button><button className="locale-button" onClick={()=>set({language:language==='en'?'ar':'en'})} aria-label={language==='en'?'Switch to Arabic':'التبديل إلى الإنجليزية'}><Languages size={17}/>{language==='en'?'العربية':'English'}</button><button className="icon-button" title={t(theme==='light'?'Night mode':'Light mode')} aria-label={t(theme==='light'?'Night mode':'Light mode')} aria-pressed={theme==='dark'} onClick={()=>set({theme:theme==='light'?'dark':'light'})}>{theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button></div>;}
