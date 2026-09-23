import type { AppEnvironment } from '../../config/src/env.js';

export function publicPageUrl(value: string): string {
  let url: URL; try { url=new URL(value); } catch { throw new Error('Enter a valid public HTTPS page URL'); }
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^(\d+\.)|:/.test(url.hostname)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) throw new Error('Use a public HTTPS website, without login credentials or a custom port');
  url.hash='';return url.toString();
}
export async function scrapeKnowledge(environment: AppEnvironment, inputUrl: string) {
  const url=publicPageUrl(inputUrl);
  if(!environment.firecrawl?.apiKey)throw new Error('FIRECRAWL_API_KEY is required for website imports');
  const response=await fetch('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{authorization:`Bearer ${environment.firecrawl.apiKey}`,'content-type':'application/json'},body:JSON.stringify({url,formats:['markdown'],onlyMainContent:true,timeout:45000}),signal:AbortSignal.timeout(55000)});
  if(!response.ok)throw new Error(`Firecrawl import failed (${response.status}). Check credits and website availability.`);
  const result=await response.json() as {success?:boolean;data?:{markdown?:string;metadata?:{title?:string;statusCode?:number}}};
  if(!result.success||!result.data?.markdown?.trim()||(result.data.metadata?.statusCode??200)>=400)throw new Error('Firecrawl could not extract usable page content');
  const content=result.data.markdown.trim();
  return {title:(result.data.metadata?.title||new URL(url).hostname).slice(0,200),content:content.slice(0,12000),source:url,truncated:content.length>12000};
}
