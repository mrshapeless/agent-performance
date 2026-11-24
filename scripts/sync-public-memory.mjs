import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Export only already-public text and verified publication URLs, never whole receipts.
export function publicationRecord(r,reply=false){
 const url=reply?r.reply:r.url;
 if(!/^https:\/\/x\.com\/alidadenull\/status\/\d+$/.test(url??''))return null;
 if(reply?r.confirmed!==true:r.state!=='published_chrome_verified')return null;
 if(r.mediaVerified===false)return null;
 const id=url.split('/').pop();
 const created=new Date(Number((BigInt(id)>>22n)+1288834974657n)).toISOString();
 return {seq:'browser-'+id,kind:reply?'x_reply':'x_post',created,content:{url,text:String(r.text??'').slice(0,25000),summary:r.kind==='x_article'?'Published article':reply?'Confirmed conversation reply':'Confirmed original publication',medium:r.kind==='x_article'?'article':reply?'reply':'post'}};
}
export async function sync(root){
 const records=new Map();
 for(const folder of ['own-posts','hourly-replies']){
  for(const name of await readdir(resolve(root,folder))){
   if(!/^2026-.*\.json$/.test(name)||/review|job|draft/.test(name))continue;
   let d;try{d=JSON.parse((await readFile(resolve(root,folder,name),'utf8')).replace(/^\uFEFF/,''));}catch{continue;}
   const replies=Array.isArray(d.confirmedReplies)?d.confirmedReplies:Array.isArray(d.replies)?d.replies:[];
   for(const r of [publicationRecord(d),...replies.map(r=>publicationRecord(r,true))])if(r)records.set(r.content.url,r);
  }
 }
 const events=[...records.values()].sort((a,b)=>Date.parse(a.created)-Date.parse(b.created));
 const result={version:1,latestEventAt:events.at(-1)?.created??null,events};
 await writeFile('public/browser-memory.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({count:events.length,latestEventAt:result.latestEventAt}));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await sync(resolve(process.argv[2]??'../../outputs'));
