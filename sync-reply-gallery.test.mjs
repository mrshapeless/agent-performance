import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';import sharp from 'sharp';
test('sync publishes confirmed art only, strips private fields, deduplicates and is repeatable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gallery-test-'));const script=resolve('sync-reply-gallery.mjs');try{
  await mkdir(join(root,'logs'));await writeFile(join(root,'public-files.json'),'[]');await writeFile(join(root,'public-media.json'),'{}');
  await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toFile(join(root,'logs','art.png'));
  await writeFile(join(root,'logs','2026-01-01T10.json'),JSON.stringify({slot:'2026-01-01T10',privateNote:'never publish',replies:[{art:'art.png',reply:'https://x.com/alidadenull/status/1234567890123456789',text:'public caption',secret:'never publish'},{art:'art.png',text:'unconfirmed draft'}]}));
  const run=()=>execFileSync(process.execPath,[script,'--logs',join(root,'logs')],{cwd:root});run();const a=await readFile(join(root,'public/reply-gallery.json'),'utf8');run();assert.equal(a,await readFile(join(root,'public/reply-gallery.json'),'utf8'));assert.equal(JSON.parse(a).works.length,1);assert.ok(!a.includes('never publish'));assert.ok(!a.includes('unconfirmed'));
  await writeFile(join(root,'logs','2026-01-01T11.json'),JSON.stringify({replies:[{art:'../outside.png',reply:'https://x.com/alidadenull/status/1234567890123456780'}]}));assert.throws(run);
 }finally{await rm(root,{recursive:true,force:true});}
});
