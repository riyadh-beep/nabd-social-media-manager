"use client";
import { CalendarDays, LoaderCircle, MapPin, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useLanguage } from "./preferences";

type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Occasion = { title: string; brief: string; date: string };

function riyadhDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}
function occasionsFor(year: number): Occasion[] {
  return [
    { date: `${year}-02-22`, title: "Saudi Founding Day", brief: "Create a respectful Saudi Founding Day post that celebrates heritage, culture, and the brand’s connection to Saudi Arabia. Do not invent discounts or historical claims." },
    { date: `${year}-03-11`, title: "Saudi Flag Day", brief: "Create a respectful Saudi Flag Day post. Keep the tone proud, culturally thoughtful, and specific to the approved brand knowledge." },
    { date: `${year}-04-25`, title: "Saudi Vision 2030 anniversary", brief: "Create a constructive Saudi Vision 2030 anniversary post. Use only approved brand facts and avoid unsupported national or business claims." },
    { date: `${year}-09-23`, title: "Saudi National Day", brief: "Create a respectful Saudi National Day post. Celebrate Saudi identity in the brand’s own voice without inventing offers, products, or claims." },
  ];
}
function islamicOccasion(date: string): Occasion | undefined {
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: "Asia/Riyadh", day: "numeric", month: "long" }).formatToParts(new Date());
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);
  const month = parts.find((part) => part.type === "month")?.value.toLowerCase() ?? "";
  if (day === 1 && month.includes("ramadan")) return { date, title: "Beginning of Ramadan", brief: "Create a considerate Ramadan greeting in the brand’s voice. Use only approved knowledge, do not invent prices, offers, timings, or religious claims." };
  if (day === 1 && month.includes("shawwal")) return { date, title: "Eid al-Fitr", brief: "Create a warm, respectful Eid al-Fitr greeting in the brand’s voice. Use only approved knowledge and do not invent offers or product claims." };
  if (day === 10 && /dhu|dhul/.test(month) && month.includes("hijjah")) return { date, title: "Eid al-Adha", brief: "Create a warm, respectful Eid al-Adha greeting in the brand’s voice. Use only approved knowledge and do not invent offers or product claims." };
  return undefined;
}

export function SaudiContentCalendar({ brandId, api, busy, refresh }: { brandId: string; api: Api; busy: boolean; refresh: () => Promise<void> }) {
  const { t } = useLanguage();
  const today = riyadhDate();
  const [running, setRunning] = useState(false), [notice, setNotice] = useState("");
  const occasions = useMemo(() => occasionsFor(today.year), [today.year]);
  const todayKey = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  const current = islamicOccasion(todayKey) ?? occasions.find((occasion) => occasion.date === todayKey);
  const next = occasions.find((occasion) => occasion.date >= todayKey) ?? occasionsFor(today.year + 1)[0];
  const first = new Date(Date.UTC(today.year, today.month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
  const cells = Array.from({ length: first + days }, (_, index) => index < first ? null : index - first + 1);
  const autoPost = async (occasion: Occasion) => {
    setRunning(true); setNotice("");
    try {
      await api(`/v1/brands/${brandId}/auto-post`, { method: "POST", body: JSON.stringify({ brief: occasion.brief, occasion: occasion.title }) });
      await refresh(); setNotice(t("Automatic post is queued with your last selected knowledge and channels."));
    } catch (error) { setNotice(error instanceof Error ? error.message : t("Could not queue the automatic post.")); }
    finally { setRunning(false); }
  };
  return <section className="saudi-calendar"><header className="calendar-hero panel"><div><span className="eyebrow"><MapPin size={14}/> {t("SAUDI ARABIA · ASIA/RIYADH")}</span><h1>{t("Your content calendar")}</h1><p>{t("Nabd checks today’s Riyadh date and highlights Saudi occasions worth planning for.")}</p></div><button className="primary" disabled={busy || running} onClick={() => void autoPost(current ?? next)}>{running ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>} {t("Auto-post for today")}</button></header>
    <div className="calendar-layout"><section className="panel month-calendar"><div className="panel-title"><div><span className="eyebrow">{t("SAUDI CONTENT PLANNER")}</span><h2>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(new Date())}</h2></div><CalendarDays size={22}/></div><div className="calendar-weekdays">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day => <span key={day}>{t(day)}</span>)}</div><div className="calendar-days">{cells.map((day, index) => { const date = day ? `${today.year}-${String(today.month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : ""; const occasion = occasions.find((item) => item.date === date); return <div key={index} className={`calendar-day ${day === today.day ? "today" : ""} ${occasion ? "occasion" : ""}`}>{day && <><strong>{day}</strong>{occasion && <small>{occasion.title}</small>}</>}</div>; })}</div></section>
      <aside className="panel occasion-panel"><span className="eyebrow">{current ? t("TODAY’S OCCASION") : t("NEXT SAUDI OCCASION")}</span><h2>{(current ?? next).title}</h2><p>{current ? t("Today is marked in the Riyadh calendar. Nabd can create, design, and queue its campaign automatically.") : t("Use the automatic workflow to prepare a relevant post using the same knowledge and channels you used last time.")}</p><small>{(current ?? next).date}</small><button className="secondary" disabled={busy || running} onClick={() => void autoPost(current ?? next)}>{t("Create and publish automatically")}</button>{notice && <p role="status" className={notice.includes("queued") ? "success" : "error"}>{notice}</p>}</aside></div>
  </section>;
}
