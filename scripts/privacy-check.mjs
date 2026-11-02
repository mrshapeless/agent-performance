import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const approvedMedia=JSON.parse(readFileSync('config/public-media.json','utf8'));
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const violations=[];const allowed=new Set(JSON.parse(readFileSync('config/public-files.json','utf8')));for(const f of files)if(!allowed.has(f))violations.push(f+': unreviewed file path');
const forbidden=/(^|\/)(private|secrets|data|raw-data|production-dumps|\.vercel|node_modules)(\/|$)|reference-board-|clipboard|\.(png|jpe?g|webp|mp4|zip|sqlite|bundle|pem|key)$|(^|\/)\.env(?!\.example$)/i;
const credentials=/(AIza[\w-]{30,}|r8_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@)/;
const privateSources=/https?:\/\/(?:[^/\s]*pinterest\.com|disk\.yandex\.ru)\/|https?:\/\/i\.pinimg\.com\/originals\/|[CG]:[\\/](?:Users|YandexDisk)[\\/]/i;
for(const f of files){
 if(Object.hasOwn(approvedMedia,f)){
  if(!(/^public\/(films|series)\/(?:afterimage(?:-0[123])?|portrait-(?:wind|visitor|night-bus|off-air)|soft-days-0[123]|unplanned(?:-0[1-6])?|unplanned-photo-0[1-8])\.(mp4|jpg)$/.test(f)||/^public\/gallery\/reply-\d{15,22}\.jpg$/.test(f))||createHash('sha256').update(readFileSync(f)).digest('hex')!==approvedMedia[f])violations.push(f+': unreviewed media bytes');
  continue;
 }
 if(forbidden.test(f)){violations.push(f+': private/binary input');continue;}
 if(f==='scripts/privacy-check.mjs')continue;
 const s=readFileSync(f,'utf8');
 if(credentials.test(s))violations.push(f+': potential credential');
 if(privateSources.test(s))violations.push(f+': private source/location');
}
if(violations.length){console.error(violations.join('\n'));process.exit(1);}
console.log('Public source privacy check passed ('+files.length+' files).');
