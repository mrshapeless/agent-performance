import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('five public destinations are consistent across primary pages and series',()=>{
 for(const file of ['index.html','gallery.html','experiments.html','about.html','chat.html','character.html','out-of-frame.html','unplanned.html','nothing-to-see/index.html']){
  const h=readFileSync('public/'+file,'utf8');const nav=h.match(/<nav[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(m=>m[1]),['/','/gallery','/experiments','/about','/chat'],file);
 }
});
test('home has no duplicate image artworks and no legacy journal links',()=>{const h=readFileSync('public/index.html','utf8');const images=[...h.matchAll(/<img[^>]*src="([^"]+)"/g)].map(m=>m[1]);assert.equal(images.length,new Set(images).size);assert.ok(!h.includes('href="/journal'));});
test('legacy public entrances lead to new sections',()=>{const v=JSON.parse(readFileSync('vercel.json'));for(const [source,destination] of [['/work','/gallery'],['/collections','/gallery'],['/behind','/about'],['/journal','/experiments#record']])assert.ok(v.redirects.some(r=>r.source===source&&r.destination===destination));});
test('gallery manifest contains only public allowlisted fields and existing approved media',()=>{const {works}=JSON.parse(readFileSync('public/reply-gallery.json'));const media=JSON.parse(readFileSync('public-media.json'));assert.ok(works.length>0);for(const w of works){assert.deepEqual(Object.keys(w).sort(),['caption','created','id','image','kind','published']);assert.match(w.published,/^https:\/\/x\.com\/alidadenull\/status\/\d+$/);assert.ok(media['public'+w.image]);assert.ok(Number.isFinite(Date.parse(w.created)));}});
